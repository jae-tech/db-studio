import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('model picker under the chat and the left AI settings view share CLI catalogs and saved choices (handler doubles, no AI)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-ai-settings-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ ipcMain }) => {
      const state = { status: 0, started: [] as unknown[] }
      Reflect.set(globalThis, 'aiSettingsFixture', state)
      ipcMain.removeHandler('agent:status')
      ipcMain.handle('agent:status', () => {
        state.status++
        return [
          {
            provider: 'codex',
            installed: true,
            available: true,
            auth: 'subscription',
            version: '0.165.0',
            reason: 'Handler double',
            models: ['gpt-6.1-sol', 'gpt-6-luna'],
          },
          {
            provider: 'copilot',
            installed: true,
            available: true,
            auth: 'subscription',
            version: '1.0.105',
            reason: 'Handler double',
            models: ['claude-sonnet-5.5', 'gpt-5.5'],
          },
        ]
      })
      ipcMain.removeHandler('agent:start')
      ipcMain.handle('agent:start', (event, request) => {
        state.started.push(request)
        event.sender.send('agent:event', {
          requestId: request.requestId,
          provider: request.provider,
          type: 'done',
          outcome: 'completed',
        })
      })
    })
    const picker = page.getByLabel('AI 모델', { exact: true })
    await expect(picker).toHaveValue('codex|')
    // Startup already checked the real CLIs; re-check against the double. No model is called.
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    await expect(picker.locator('option')).toHaveCount(6)
    await picker.selectOption('copilot|gpt-5.5')
    await expect(picker).toHaveValue('copilot|gpt-5.5')
    await page.getByLabel('AI 메시지', { exact: true }).fill('안녕')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect
      .poll(async () =>
        app.evaluate(
          () =>
            (
              Reflect.get(globalThis, 'aiSettingsFixture') as {
                started: { provider: string; model?: string }[]
              }
            ).started,
        ),
      )
      .toEqual([
        expect.objectContaining({ provider: 'copilot', model: 'gpt-5.5' }),
      ])

    // Left menu AI view: same status, per-provider default model, switch assistant.
    await page.getByRole('button', { name: 'AI 설정 열기' }).click()
    const view = page.getByRole('region', { name: 'AI 설정' })
    await expect(
      view.getByRole('article', { name: 'GitHub Copilot' }),
    ).toContainText('대화에 사용 중')
    await view
      .getByLabel('Codex (ChatGPT) 기본 모델', { exact: true })
      .selectOption('gpt-6-luna')
    await view
      .getByRole('article', { name: 'Codex (ChatGPT)' })
      .getByRole('button', { name: '이 AI로 대화' })
      .click()
    await expect(picker).toHaveValue('codex|gpt-6-luna')
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings()))
            .agentModels,
      )
      .toEqual({ codex: 'gpt-6-luna', copilot: 'gpt-5.5' })
    const stats = (await app.evaluate(() =>
      Reflect.get(globalThis, 'aiSettingsFixture'),
    )) as { status: number }
    expect(stats.status).toBe(1)
    await page.screenshot({ path: '.omx/readability/ai-settings.png' })
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
