import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('edits a plain single-table result in the grid and saves through preview/apply/COMMIT; grid text size is a setting (handler doubles, no DB)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-grid-edit-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ ipcMain }, connectionId) => {
      // Main-handler doubles only: no SQL Server is called.
      const sent: string[] = []
      Reflect.set(globalThis, 'gridEditSent', sent)
      let state: Record<string, unknown> | null = null
      const set = (channel: string, handler: (input: never) => unknown) => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, input) => handler(input as never))
      }
      set('db:connections', () => [
        {
          id: connectionId,
          name: '편집 대역',
          driver: 'mssql',
          host: 'not-used',
          port: 1,
          database: 'edit_not_live',
          username: 'fixture',
          environment: 'development',
          readOnly: false,
          encrypt: true,
          trustServerCertificate: false,
          timeoutSeconds: 30,
          maxRows: 100,
          hasPassword: false,
          status: 'connected',
          currentDatabase: 'edit_not_live',
          permissionVerified: true,
        },
      ])
      set('db:explorer', () => ({
        database: 'edit_not_live',
        databases: ['edit_not_live'],
        schemas: [],
        tables: [],
      }))
      set('db:review', () => ({
        token: '00000000-0000-4000-8000-000000000001',
        sql: 'SELECT 1',
        database: 'edit_not_live',
        expiresAt: Date.now() + 60000,
        maxRows: 100,
        timeoutSeconds: 30,
      }))
      set('db:execute', () => ({
        requestId: '00000000-0000-4000-8000-000000000002',
        columns: [
          { key: 'c0', name: 'code', type: 'NVarChar' },
          { key: 'c1', name: 'name', type: 'NVarChar' },
          { key: 'c2', name: 'qty', type: 'Int' },
        ],
        rows: [
          { c0: '01', c1: '서버', c2: 495 },
          { c0: '02', c1: '주변기기', c2: 436 },
        ],
        durationMs: 1,
        truncated: false,
        rowCount: 2,
        source: { schema: 'dbo', table: 'CodeMaster', keys: ['code'] },
      }))
      set('mutation:state', () => state)
      set('mutation:preview', (input: { sql: string }) => {
        sent.push(input.sql)
        state = {
          id: '00000000-0000-4000-8000-000000000003',
          connectionId,
          database: 'edit_not_live',
          kind: 'update',
          sql: input.sql,
          approvalHash: 'a'.repeat(64),
          policyVersion: 'UI-HANDLER-DOUBLE',
          stage: 'preview',
          expiresAt: Date.now() + 60000,
          affectedRows: 1,
          message: 'Fixture only.',
        }
        return state
      })
      set('mutation:apply', () => {
        state = {
          ...state!,
          stage: 'applied',
          commitToken: '00000000-0000-4000-8000-000000000004',
        }
        return state
      })
      set('mutation:commit', () => {
        state = { ...state!, stage: 'committed' }
        return state
      })
    }, randomUUID())
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page
      .getByLabel('SQL 연결')
      .selectOption({ label: '편집 대역 · edit_not_live (연결됨)' })
    await page.keyboard.press('Control+Enter')
    const cell = page
      .locator('.result-grid-cell[data-col-id="c1"]')
      .filter({ hasText: '서버' })
    await expect(cell).toBeVisible()
    // Key columns are read-only; other columns edit in place and stay marked.
    await page.locator('.result-grid-cell[data-col-id="c0"]').first().dblclick()
    await expect(page.locator('.result-grid-editor')).toHaveCount(0)
    // Opening and closing a numeric cell without typing is not an edit.
    await page
      .locator('.result-grid-cell[data-col-id="c2"]')
      .filter({ hasText: /^495$/ })
      .dblclick()
    await page.keyboard.press('Enter')
    await expect(page.locator('.result-grid-cell.cell-edited')).toHaveCount(0)
    await expect(page.getByText(/^변경 \d+행$/)).toHaveCount(0)
    await cell.dblclick()
    await page.keyboard.press('Control+a')
    await page.keyboard.type("서버 '본체'")
    await page.keyboard.press('Enter')
    await expect(page.locator('.result-grid-cell.cell-edited')).toHaveCount(1)
    await expect(page.getByText('변경 1행')).toBeVisible()
    // Small accent buttons keep their on-accent text color (dark theme #092b23).
    await expect(page.getByRole('button', { name: '편집 저장' })).toHaveCSS(
      'color',
      'rgb(9, 43, 35)',
    )
    await page.getByRole('button', { name: '편집 저장' }).click()
    await expect(page.getByText('변경 1행')).toHaveCount(0)
    expect(
      await app.evaluate(() => Reflect.get(globalThis, 'gridEditSent')),
    ).toEqual([
      "UPDATE [dbo].[CodeMaster] SET [name] = N'서버 ''본체''' WHERE [code] = N'01'",
    ])
    await expect(page.locator('.result-grid-cell.cell-edited')).toHaveCount(0)
    // 취소 restores the original value without sending anything.
    const second = page
      .locator('.result-grid-cell[data-col-id="c1"]')
      .filter({ hasText: '주변기기' })
    await second.dblclick()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('바뀜')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: '편집 취소' }).click()
    await expect(
      page
        .locator('.result-grid-cell[data-col-id="c1"]')
        .filter({ hasText: '주변기기' }),
    ).toBeVisible()
    // Smaller text gives shorter rows.
    const height = () =>
      page
        .locator('.result-grid-host .result-grid-row')
        .first()
        .evaluate((row) => row.clientHeight)
    const before = await height()
    await page.getByRole('button', { name: '설정 열기', exact: true }).click()
    await page
      .getByRole('region', { name: '설정' })
      .getByLabel('결과 표 글자 크기', { exact: true })
      .selectOption('10')
    await page.getByRole('button', { name: 'SQL 작업 공간 열기' }).click()
    await expect.poll(height).toBeLessThan(before)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings()))
            .gridFontSize,
      )
      .toBe(10)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
