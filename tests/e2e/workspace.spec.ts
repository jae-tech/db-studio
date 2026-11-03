import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('isolated Electron workspace persists settings and rejects unsafe IPC', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-studio-test-'))
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${profile}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await expect(
      page.getByText('데이터베이스에 연결해 시작하세요'),
    ).toBeVisible()
    await expect(page.getByText('쿼리 결과를 확인하세요')).toBeVisible()
    await expect(page.locator('.monaco-editor')).toBeVisible()
    expect(
      await page.evaluate(() => typeof Reflect.get(window, 'require')),
    ).toBe('undefined')
    expect(
      await page.evaluate(() => Object.keys(window.desktop ?? {}).sort()),
    ).toEqual([
      'agent',
      'db',
      'getInfo',
      'getSettings',
      'saveSettings',
      'saveSettingsSync',
      'setZoom',
    ])
    const before = await page.evaluate(() => window.desktop!.getSettings())
    expect(before.tabs).toHaveLength(1)
    await expect(
      page.getByRole('button', { name: '메시지 보내기' }),
    ).toBeDisabled()
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('status')).toContainText(
      '연결된 데이터베이스가 없습니다',
    )
    await page.getByRole('button', { name: '테마 전환' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: '새 SQL 탭' }).click()
    await expect(page.getByRole('tab', { name: '쿼리 2' })).toBeVisible()
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('SELECT 42 AS answer;')
    await page.getByLabel('AI 모델', { exact: true }).selectOption('copilot|')
    // Real pointer drag on the explorer boundary: 248px default + 52px.
    const explorerHandle = await page
      .getByRole('separator', { name: '탐색기 너비' })
      .boundingBox()
    const x = explorerHandle!.x + explorerHandle!.width / 2
    const y = explorerHandle!.y + explorerHandle!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 30, y, { steps: 3 })
    await page.mouse.move(x + 52, y, { steps: 3 })
    await page.mouse.up()
    expect(
      await page
        .locator('.explorer')
        .evaluate((element) =>
          Math.round(element.getBoundingClientRect().width),
        ),
    ).toBe(300)
    // Editor/results boundary: dragging down by 80px grows the editor by 80px.
    const editorBefore = await page
      .locator('.editor-region')
      .evaluate((element) => element.getBoundingClientRect().height)
    const editorHandle = await page
      .getByRole('separator', { name: '편집기 높이' })
      .boundingBox()
    const ex = editorHandle!.x + editorHandle!.width / 2
    const ey = editorHandle!.y + editorHandle!.height / 2
    await page.mouse.move(ex, ey)
    await page.mouse.down()
    await page.mouse.move(ex, ey + 80, { steps: 4 })
    await page.mouse.up()
    expect(
      Math.round(
        (await page
          .locator('.editor-region')
          .evaluate((element) => element.getBoundingClientRect().height)) -
          editorBefore,
      ),
    ).toBe(80)
    // Exercise real preload -> Main -> SQLite write; wait on durable settings rather than a fixed delay.
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.desktop!.getSettings()).explorerWidth,
        ),
      )
      .toBe(300)
    const changed = await page.evaluate(() => window.desktop!.getSettings())
    expect(changed.theme).toBe('light')
    expect(changed.provider).toBe('copilot')
    expect(changed.tabs).toHaveLength(2)
    expect(changed.tabs[1]?.sql).toBe('SELECT 42 AS answer;')
    const rejected = await page.evaluate(async () => {
      try {
        await window.desktop!.saveSettings({
          ...(await window.desktop!.getSettings()),
          explorerWidth: 9999,
        })
        return false
      } catch {
        return true
      }
    })
    expect(rejected).toBe(true)
    expect(await page.evaluate(() => window.desktop!.getSettings())).toEqual(
      changed,
    )
    await page.screenshot({ path: 'test-results/workspace-light.png' })
    expect(errors).toEqual([])
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByRole('tab', { name: '쿼리 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByLabel('AI 모델', { exact: true })).toHaveValue(
      'copilot|',
    )
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).explorerWidth,
    ).toBe(300)
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).tabs[1]?.sql,
    ).toBe('SELECT 42 AS answer;')
    await page.getByRole('button', { name: '테마 전환' }).click()
    await page.screenshot({ path: 'test-results/workspace-dark.png' })
    // Close immediately after an edit: beforeunload must flush the pending debounce.
    // Keyboard on the bottom AI chat boundary: ArrowUp raises the lower pane by 16px.
    await page.getByRole('separator', { name: 'AI 패널 높이' }).focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    const closed = app.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.close(),
    )
    await closed
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).agentHeight,
    ).toBe(332)
    // Reload right after an edit: the pending save flushes and the window stays open.
    await page.getByRole('separator', { name: 'AI 패널 높이' }).focus()
    await page.keyboard.press('ArrowUp')
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).agentHeight,
    ).toBe(348)
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
