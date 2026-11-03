import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Ctrl+Space and "." suggest schema tables and alias columns from metadata (handler doubles, no DB)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-completion-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    // No connection yet: Ctrl+Space says why only keywords are offered.
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+Space')
    await expect(
      page.getByText(/DB가 연결되지 않아 테이블·열 자동완성을 할 수 없습니다/),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await app.evaluate(({ ipcMain }, connectionId) => {
      // Main-handler doubles only: metadata comes from fixed values, no SQL Server.
      const set = (
        channel: string,
        handler: (_event: unknown, input: unknown) => unknown,
      ): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
      }
      set('db:connections', () => [
        {
          id: connectionId,
          name: '자동완성 대역',
          driver: 'mssql',
          host: 'not-used',
          port: 1,
          database: 'complete_not_live',
          username: 'fixture',
          environment: 'development',
          readOnly: true,
          encrypt: true,
          trustServerCertificate: false,
          timeoutSeconds: 30,
          maxRows: 100,
          hasPassword: false,
          status: 'connected',
          currentDatabase: 'complete_not_live',
          permissionVerified: true,
        },
      ])
      set('db:explorer', (_event, input) =>
        typeof input === 'object' &&
        input !== null &&
        'database' in input &&
        input.database === 'Archive'
          ? {
              database: 'Archive',
              databases: ['complete_not_live', 'Archive'],
              schemas: ['dbo', 'history'],
              tables: [
                { schema: 'dbo', name: 'old_orders' },
                { schema: 'history', name: 'audit' },
              ],
            }
          : {
              database: 'complete_not_live',
              databases: ['complete_not_live', 'Archive'],
              schemas: ['dbo', 'sales'],
              tables: [
                { schema: 'dbo', name: 'settlements' },
                { schema: 'sales', name: 'orders' },
              ],
            },
      )
      set('db:describe', (_event, input) => ({
        columns: [
          {
            name: 'id',
            type: 'int',
            nullable: false,
            primaryKey: true,
            ordinal: 1,
          },
          {
            name:
              typeof input === 'object' &&
              input !== null &&
              'database' in input &&
              input.database === 'Archive'
                ? 'archived_total'
                : '정산금액',
            type: 'decimal(18,2)',
            nullable: true,
            primaryKey: false,
            ordinal: 2,
          },
        ],
        indexes: [],
        foreignKeys: [],
      }))
    }, randomUUID())
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page
      .getByLabel('SQL 연결')
      .selectOption({ label: '자동완성 대역 · complete_not_live (연결됨)' })
    const suggestions = page.locator('.suggest-widget .monaco-list-row')
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('SELECT * FROM dbo.')
    await expect(suggestions.filter({ hasText: 'settlements' })).toBeVisible()
    await expect(suggestions.filter({ hasText: 'orders' })).toHaveCount(0)
    await page.keyboard.press('Enter')
    await page.keyboard.type(' AS t WHERE t.')
    await expect(suggestions.filter({ hasText: '정산금액' })).toBeVisible()
    await page.screenshot({ path: '.omx/readability/sql-completion.png' })
    await suggestions.filter({ hasText: '정산금액' }).click()
    await page.keyboard.press('Escape')
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
            ?.sql,
      )
      .toBe('SELECT * FROM dbo.settlements AS t WHERE t.[정산금액]')
    // Ctrl+Space outside a qualifier offers tables as well as keywords.
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' ')
    await page.keyboard.press('Control+Space')
    await expect(suggestions.filter({ hasText: 'sales.orders' })).toBeVisible()
    // Cursor on the editor's last visible line: the list extends below the
    // editor and must stay visible and clickable instead of being clipped.
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.editor-region')!.style.height =
        '96px'
    })
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('SELECT *\nFROM dbo.settlements AS t\nWHERE t.')
    const row = suggestions.filter({ hasText: '정산금액' })
    await expect(row).toBeVisible()
    const clipped = await row.evaluate((element) => {
      const region = document
        .querySelector('.editor-region')!
        .getBoundingClientRect()
      const widget = element.closest('.suggest-widget')!.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      const hit = document.elementFromPoint(
        box.left + 20,
        box.top + box.height / 2,
      )
      return {
        overflows: widget.bottom > region.bottom,
        reachable: !!hit && element.contains(hit),
      }
    })
    expect(clipped).toEqual({ overflows: true, reachable: true })
    await page.screenshot({ path: '.omx/readability/sql-completion-short.png' })
    // Keywords are followed by a space; functions open parentheses around the cursor.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('sel')
    await expect(
      suggestions.filter({ hasText: /^SELECT$/ }).first(),
    ).toBeVisible()
    await page.keyboard.press('Enter')
    await page.keyboard.type('cou')
    await expect(
      suggestions.filter({ hasText: /^COUNT$/ }).first(),
    ).toBeVisible()
    await page.keyboard.press('Enter')
    await page.keyboard.type('1')
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
            ?.sql,
      )
      .toBe('SELECT COUNT(1)')
    // A table picked from Ctrl+Space alone becomes an executable SELECT.
    const completeTable = async (
      typed: string,
      choice: string,
      expected: string,
    ) => {
      await page.locator('.monaco-editor').click()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+a')
      await page.keyboard.press('Backspace')
      await page.keyboard.type(typed)
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
              ?.sql,
        )
        .toBe(typed)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+Space')
      await suggestions.filter({ hasText: choice }).first().click()
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
              ?.sql,
        )
        .toBe(expected)
    }
    await completeTable('', 'sales.orders', 'SELECT * FROM sales.orders')
    await completeTable(
      'sett',
      'dbo.settlements',
      'SELECT * FROM dbo.settlements',
    )
    await completeTable('dbo.', 'settlements', 'SELECT * FROM dbo.settlements')
    await completeTable(
      'FROM dbo.',
      'settlements',
      'SELECT * FROM dbo.settlements',
    )
    await completeTable('UPDATE dbo.', 'settlements', 'UPDATE dbo.settlements')
    await completeTable(
      'SELECT 1;\nsett',
      'dbo.settlements',
      'SELECT 1;\nSELECT * FROM dbo.settlements',
    )
    await completeTable(
      'FROM Archive.dbo.',
      'old_orders',
      'SELECT * FROM Archive.dbo.old_orders',
    )
    await completeTable(
      'Archive.dbo.',
      'old_orders',
      'SELECT * FROM Archive.dbo.old_orders',
    )
    await page.keyboard.type(' AS a WHERE a.')
    await expect(
      suggestions.filter({ hasText: 'archived_total' }),
    ).toBeVisible()
    await expect(suggestions.filter({ hasText: '정산금액' })).toHaveCount(0)
    await suggestions.filter({ hasText: 'archived_total' }).click()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
            ?.sql,
      )
      .toBe('SELECT * FROM Archive.dbo.old_orders AS a WHERE a.archived_total')
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('SELECT * FROM Archive.')
    await expect(suggestions.filter({ hasText: 'dbo' })).toBeVisible()
    await expect(suggestions.filter({ hasText: 'history' })).toBeVisible()
    await suggestions.filter({ hasText: 'dbo' }).click()
    await page.keyboard.type('.')
    await expect(suggestions.filter({ hasText: 'old_orders' })).toBeVisible()
    await expect(suggestions.filter({ hasText: 'settlements' })).toHaveCount(0)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
