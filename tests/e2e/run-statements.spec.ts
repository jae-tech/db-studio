import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Ctrl+Enter runs the statement at the cursor, Alt+X runs every statement with a result tab each (handler doubles, no DB)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-statements-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ ipcMain }, connectionId) => {
      // Main-handler doubles only: each reviewed statement returns its own row.
      const reviewed: string[] = []
      Reflect.set(globalThis, 'statementsReviewed', reviewed)
      const set = (channel: string, handler: (input: never) => unknown) => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, input) => handler(input as never))
      }
      set('db:connections', () => [
        {
          id: connectionId,
          name: '문장 대역',
          driver: 'mssql',
          host: 'not-used',
          port: 1,
          database: 'statements_not_live',
          username: 'fixture',
          environment: 'development',
          readOnly: true,
          encrypt: true,
          trustServerCertificate: false,
          timeoutSeconds: 30,
          maxRows: 100,
          hasPassword: false,
          status: 'connected',
          currentDatabase: 'statements_not_live',
          permissionVerified: true,
        },
      ])
      set('db:explorer', () => ({
        database: 'statements_not_live',
        databases: ['statements_not_live'],
        schemas: [],
        tables: [],
      }))
      set('db:review', (input: { sql: string }) => {
        reviewed.push(input.sql)
        return {
          token: crypto.randomUUID(),
          sql: input.sql,
          database: 'statements_not_live',
          expiresAt: Date.now() + 60000,
          maxRows: 100,
          timeoutSeconds: 30,
        }
      })
      set('db:execute', () => {
        const last = reviewed.at(-1)!
        return {
          requestId: crypto.randomUUID(),
          columns: [{ key: 'c0', name: 'source', type: 'nvarchar' }],
          rows: [{ c0: last.includes('AddService') ? 'add-row' : 'other-row' }],
          durationMs: 1,
          truncated: false,
          rowCount: 1,
        }
      })
    }, randomUUID())
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await expect(page.getByRole('button', { name: /^쿼리 실행/ })).toHaveCount(
      0,
    )
    await page
      .getByLabel('SQL 연결')
      .selectOption({ label: '문장 대역 · statements_not_live (연결됨)' })
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText(
      'SELECT * FROM dbo.OtherCompany;\n\nSELECT * FROM dbo.AddService;',
    )
    const reviewed = () =>
      app.evaluate(() => Reflect.get(globalThis, 'statementsReviewed'))
    // Cursor is on the second statement.
    await page.keyboard.press('Control+Enter')
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: 'add-row' }),
    ).toBeVisible()
    expect(await reviewed()).toEqual(['SELECT * FROM dbo.AddService'])
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Control+Enter')
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: 'other-row' }),
    ).toBeVisible()
    // Alt+X: both statements, one result tab each; the last one is shown.
    await page.keyboard.press('Alt+x')
    const tabs = page.getByRole('tablist', { name: '전체 실행 결과' })
    await expect(tabs.getByRole('tab')).toHaveCount(2)
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: 'add-row' }),
    ).toBeVisible()
    expect((await reviewed()).slice(-2)).toEqual([
      'SELECT * FROM dbo.OtherCompany',
      'SELECT * FROM dbo.AddService',
    ])
    await expect(tabs.getByRole('tab', { name: '결과 1' })).toContainText(
      'dbo.OtherCompany',
    )
    await tabs.getByRole('tab', { name: '결과 1' }).click()
    await page
      .locator('.results-region')
      .screenshot({ path: '.omx/readability/result-batch-tabs.png' })
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: 'other-row' }),
    ).toBeVisible()
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
