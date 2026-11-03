import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

test('assistant panel is icon-first with no guide or status chatter, preserves accessible controls and gives conversation room (no DB or AI)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-compact-agent-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    // This test covers the right-hand column layout (bottom is the default).
    await page.evaluate(async () => {
      const settings = await window.desktop!.getSettings()
      await window.desktop!.saveSettings({ ...settings, agentDock: 'right' })
    })
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const panel = page.locator('.agent-panel')
    const input = page.getByLabel('AI 메시지', { exact: true })
    // The usage guide was removed from the chat panel; policy notes live in the AI settings view.
    await expect(panel.locator('details')).toHaveCount(0)
    await expect(panel.getByText('사용 안내')).toHaveCount(0)
    await expect(panel.getByRole('checkbox')).toHaveCount(0)
    await input.fill('작성 중인 질문')
    await expect(input).toHaveValue('작성 중인 질문')
    await mkdir('.omx/agent-panel-compact', { recursive: true })
    for (const theme of ['dark', 'light'] as const) {
      if (theme === 'light')
        await page.getByRole('button', { name: '테마 전환' }).click()
      for (const size of [
        { width: 1500, height: 800 },
        { width: 1080, height: 720 },
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, dimensions) =>
            BrowserWindow.getAllWindows()[0]!.setContentSize(
              dimensions.width,
              dimensions.height,
            ),
          size,
        )
        await expect
          .poll(() => page.evaluate(() => innerWidth))
          .toBe(size.width)
        await expect
          .poll(() =>
            panel.getByRole('log').evaluate((element) => element.clientHeight),
          )
          .toBeGreaterThanOrEqual(180)
        await expect
          .poll(() =>
            panel.evaluate(
              (element) => element.scrollHeight - element.clientHeight,
            ),
          )
          .toBeLessThanOrEqual(1)
        await expect(
          page.getByRole('button', { name: '메시지 보내기' }),
        ).toBeInViewport()
        await expect(
          page.getByRole('button', { name: '새 대화', exact: true }),
        ).toBeInViewport()
        await page.screenshot({
          path: `.omx/agent-panel-compact/${theme}-${size.width}x${size.height}.png`,
        })
      }
    }
    // Diagnostic handler double: no real CLI is detected or invoked here.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('agent:status')
      ipcMain.handle('agent:status', () => [
        {
          provider: 'codex',
          installed: true,
          available: true,
          auth: 'subscription',
          version: 'fixture',
          reason: 'ChatGPT 로그인 확인 완료. 반복하지 않을 긴 진단 설명입니다.',
        },
      ])
    })
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    await expect(
      page.getByRole('button', { name: 'CLI 상태 확인' }),
    ).toHaveAttribute('title', /ChatGPT 로그인 확인 완료/)
    // Minimum panel width: one-line title, every header icon visible, nothing overflows.
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>('.app')!
        .style.setProperty('--agent-width', '280px'),
    )
    await expect
      .poll(() =>
        page
          .locator('.agent-panel')
          .evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeLessThanOrEqual(281)
    await expect(page.getByRole('img', { name: 'AI 도우미' })).toBeVisible()
    const header = page.locator('.agent-panel .panel-title')
    await expect
      .poll(() => header.evaluate((element) => element.clientHeight))
      .toBeLessThanOrEqual(49)
    expect(
      await header.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(0)
    const title = header.locator('span').first()
    expect(
      await title.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeLessThan(28)
    for (const name of [
      '새 대화',
      '최근 SQL 오류 분석',
      'CLI 상태 확인',
      'AI 패널 접기',
    ])
      await expect(
        header.getByRole('button', { name, exact: true }),
      ).toBeInViewport()
    await page.screenshot({
      path: '.omx/agent-panel-compact/minimum-width.png',
    })
    // A working sign-in adds no text line; the long reason lives in AI 설정.
    await expect(page.locator('.agent-panel [role="note"]')).toHaveCount(0)
    await expect(page.locator('.agent-panel')).not.toContainText('긴 진단 설명')
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
    // Bottom dock at its minimum height: header and composer fit, no scrollbar.
    await page.evaluate(async () => {
      const settings = await window.desktop!.getSettings()
      await window.desktop!.saveSettings({
        ...settings,
        agentDock: 'bottom',
        agentHeight: 140,
      })
    })
    await page.reload()
    await expect(input).toBeInViewport()
    expect(
      await panel.evaluate(
        (element: HTMLElement) => element.scrollHeight - element.clientHeight,
      ),
    ).toBe(0)
  } finally {
    await app.close()
    const target = resolve(profile)
    if (
      target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith('ai-db-compact-agent-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
