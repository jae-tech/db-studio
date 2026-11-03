import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('renames SQL tabs inline and exports the result SQL through Main (handler doubles, no DB)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-export-ui-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const connectionId = randomUUID()
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()

    // Tab rename: double-click, Enter commits, Escape restores, blank keeps the old name.
    const tab = page.getByRole('tab', { name: /쿼리 1/ })
    await tab.dblclick()
    const input = page.getByLabel('SQL 탭 이름', { exact: true })
    await input.fill('월별 매출')
    await input.press('Enter')
    await expect(page.getByRole('tab', { name: /월별 매출/ })).toBeVisible()
    await page.getByRole('tab', { name: /월별 매출/ }).press('F2')
    await input.fill('버려질 이름')
    await input.press('Escape')
    await expect(page.getByRole('tab', { name: /월별 매출/ })).toBeVisible()
    await page.getByRole('tab', { name: /월별 매출/ }).dblclick()
    await input.fill('   ')
    await input.press('Enter')
    await expect(page.getByRole('tab', { name: /월별 매출/ })).toBeVisible()
    // Settings save is debounced (350ms); wait for the persisted title before reloading.
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.desktop!.getSettings()).tabs[0]!.title,
        ),
      )
      .toBe('월별 매출')

    await page.evaluate(async (id) => {
      const settings = await window.desktop!.getSettings()
      settings.tabs[0]!.connectionId = id
      settings.tabs[0]!.sql = 'SELECT id FROM dbo.fixture ORDER BY id'
      await window.desktop!.saveSettings(settings)
    }, connectionId)
    await app.evaluate(({ ipcMain }, id) => {
      const state = { reviewed: [] as string[], exports: [] as unknown[] }
      Reflect.set(globalThis, 'exportFixture', state)
      const set = (name: string, handler: (input: unknown) => unknown) => {
        ipcMain.removeHandler(name)
        ipcMain.handle(name, (_event, input: unknown) => handler(input))
      }
      set('db:connections', () => [
        {
          id,
          name: 'Export double',
          driver: 'mssql',
          status: 'connected',
          currentDatabase: 'export_fixture',
          readOnly: true,
          maxRows: 1000,
        },
      ])
      set('db:explorer', () => ({
        database: 'export_fixture',
        databases: ['export_fixture'],
        schemas: [],
        tables: [],
      }))
      set('db:review', (input) => {
        state.reviewed.push((input as { sql: string }).sql)
        return {
          token: crypto.randomUUID(),
          database: 'export_fixture',
          sql: 'SELECT id FROM dbo.fixture ORDER BY id',
          expiresAt: Date.now() + 60000,
          maxRows: 1000,
          timeoutSeconds: 10,
        }
      })
      set('db:execute', () => ({
        requestId: crypto.randomUUID(),
        columns: [{ key: 'c0', name: 'id', type: 'int' }],
        rows: [{ c0: 1 }],
        rowCount: 1,
        durationMs: 1,
        truncated: true,
      }))
      set('db:export-query', (input) => {
        state.exports.push(input)
        return state.exports.length === 1
          ? {
              fileName: '결과.xlsx',
              rowCount: 25000,
              durationMs: 12,
              truncatedCells: 1,
            }
          : null
      })
    }, connectionId)
    await page.reload()
    await expect(page.getByRole('tab', { name: /월별 매출/ })).toBeVisible()
    const xlsx = page.getByRole('button', {
      name: '결과 전체 XLSX로 내보내기',
      exact: true,
    })
    await expect(xlsx).toHaveCount(0)
    await page.keyboard.press('Control+Enter')
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^1$/ }),
    ).toBeVisible()
    // The editor changes after the run; export must use the SQL that produced the result.
    await page.evaluate(async () => {
      const settings = await window.desktop!.getSettings()
      settings.tabs[0]!.sql = 'SELECT 1 AS changed'
      await window.desktop!.saveSettings(settings)
    })
    await xlsx.click()
    await expect(
      page.getByText(
        '결과.xlsx에 25,000행을 저장했습니다 · 12 ms · Excel 셀 한도(32,767자)로 1개 셀을 잘랐습니다',
      ),
    ).toBeVisible()
    await page
      .getByRole('button', { name: '결과 전체 CSV로 내보내기', exact: true })
      .click()
    await expect(page.getByText('내보내기를 취소했습니다.')).toBeVisible()
    const stats = (await app.evaluate(() =>
      Reflect.get(globalThis, 'exportFixture'),
    )) as { reviewed: string[]; exports: { format: string }[] }
    expect(stats.reviewed).toEqual([
      'SELECT id FROM dbo.fixture ORDER BY id',
      'SELECT id FROM dbo.fixture ORDER BY id',
      'SELECT id FROM dbo.fixture ORDER BY id',
    ])
    expect(stats.exports.map((item) => item.format)).toEqual(['xlsx', 'csv'])
    expect(Object.keys(stats.exports[0]!).sort()).toEqual([
      'approvalToken',
      'connectionId',
      'format',
      'requestId',
    ])
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
