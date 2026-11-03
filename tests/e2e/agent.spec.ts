import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

test('assistant IPC is fixed and validated; the removed Claude provider is refused before any process runs', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-agent-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      CODEX_API_KEY: 'deliberate-test-sentinel-not-a-key',
    },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await expect(
      page.locator('.agent-panel').getByRole('checkbox'),
    ).toHaveCount(0)
    await expect(page.locator('.statusbar')).toContainText('연결 안 됨')
    await expect(
      page.getByRole('button', { name: '최근 SQL 오류 분석' }),
    ).toBeDisabled()
    expect(
      await page.evaluate(() => Object.keys(window.desktop!.agent).sort()),
    ).toEqual(['cancel', 'onEvent', 'reset', 'start', 'status'])
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    await expect(
      page.getByRole('button', { name: 'CLI 상태 확인' }),
    ).toBeEnabled()
    await expect(
      page.getByRole('button', { name: '메시지 보내기' }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Claude', exact: true }),
    ).toHaveCount(0)
    // Local saved-query commands do not require an available CLI.
    await expect(page.getByLabel('AI 메시지', { exact: true })).toBeEnabled()
    const result = await page.evaluate(async () => {
      const api = window.desktop!.agent
      const refused = async (input: unknown): Promise<boolean> => {
        try {
          await api.start(input as Parameters<typeof api.start>[0])
          return false
        } catch {
          return true
        }
      }
      let events = 0
      const unsubscribe = api.onEvent(() => {
        events++
      })
      const base = { requestId: crypto.randomUUID(), resume: false }
      const outcome = {
        empty: await refused({ ...base, provider: 'codex', prompt: '' }),
        claude: await refused({ ...base, provider: 'claude', prompt: 'x' }),
        gemini: await refused({ ...base, provider: 'gemini', prompt: 'x' }),
        flagModel: await refused({
          ...base,
          provider: 'codex',
          prompt: 'x',
          model: '--yolo',
        }),
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
      unsubscribe()
      return { ...outcome, events }
    })
    expect(result).toEqual({
      empty: true,
      claude: true,
      gemini: true,
      flagModel: true,
      events: 0,
    })
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
  } finally {
    await app.close()
    const target = resolve(profile)
    if (
      target.startsWith(resolve(tmpdir())) &&
      basename(target).startsWith('ai-db-agent-e2e-')
    )
      await rm(target, { recursive: true, force: true })
  }
})

test('opt-in real ChatGPT Codex CLI: text stream and same-provider resume', async () => {
  test.skip(
    process.env.AI_DB_TEST_AGENT !== '1',
    'Set AI_DB_TEST_AGENT=1 to spend two subscription CLI turns; never uses an API key.',
  )
  test.setTimeout(180_000)
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-agent-live-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    await expect(
      page.getByRole('button', { name: 'CLI 상태 확인' }),
    ).toHaveAttribute('title', /ChatGPT 로그인 확인 완료/, { timeout: 35_000 })
    await page
      .getByLabel('AI 메시지', { exact: true })
      .fill(
        'Remember marker STUDIO_42. Reply exactly STUDIO_42. Do not use any tools.',
      )
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(page.locator('.agent-offline')).not.toContainText(
      'CLI 응답을 기다리는 중',
      {
        timeout: 125_000,
      },
    )
    await expect(page.locator('.agent-offline')).toContainText('완료')
    await expect(page.getByRole('log').locator('article').last()).toContainText(
      'STUDIO_42',
    )
    await page
      .getByLabel('AI 메시지', { exact: true })
      .fill(
        'What marker did I ask you to remember? Reply only with the marker. Do not use tools.',
      )
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(page.locator('.agent-offline')).not.toContainText(
      'CLI 응답을 기다리는 중',
      {
        timeout: 125_000,
      },
    )
    await expect(page.locator('.agent-offline')).toContainText('완료')
    await expect(page.getByRole('log').locator('article').last()).toContainText(
      'STUDIO_42',
    )
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
    await page.getByRole('button', { name: '새 대화', exact: true }).click()
    await expect(page.getByRole('log').locator('article')).toHaveCount(0)
  } finally {
    await app.close()
    const target = resolve(profile)
    if (
      target.startsWith(resolve(tmpdir())) &&
      basename(target).startsWith('ai-db-agent-live-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
