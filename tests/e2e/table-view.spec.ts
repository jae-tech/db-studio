import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('table search, center table view with NULL column and ordered SELECT (handler doubles, no DB)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-table-view-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ ipcMain }, connectionId) => {
      // Main-handler doubles only: fixed metadata, no SQL Server.
      const set = (channel: string, handler: () => unknown): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
      }
      set('db:connections', () => [
        {
          id: connectionId,
          name: '테이블 대역',
          driver: 'mssql',
          host: 'not-used',
          port: 1,
          database: 'table_not_live',
          username: 'fixture',
          environment: 'development',
          readOnly: true,
          encrypt: true,
          trustServerCertificate: false,
          timeoutSeconds: 30,
          maxRows: 100,
          hasPassword: false,
          status: 'connected',
          currentDatabase: 'table_not_live',
          permissionVerified: true,
        },
      ])
      set('db:explorer', () => ({
        database: 'table_not_live',
        databases: ['table_not_live'],
        schemas: ['dbo', 'sales'],
        tables: [
          { schema: 'dbo', name: 'members' },
          { schema: 'dbo', name: 'settlements' },
          { schema: 'sales', name: 'orders' },
        ],
      }))
      set('db:describe', () => ({
        columns: [
          {
            name: 'id',
            type: 'int',
            nullable: false,
            primaryKey: true,
            ordinal: 1,
          },
          {
            name: 'memo',
            type: 'varchar',
            nullable: true,
            primaryKey: false,
            ordinal: 2,
          },
          {
            name: '정산금액',
            type: 'money',
            nullable: true,
            primaryKey: false,
            ordinal: 3,
          },
        ],
        indexes: [{ name: 'PK_settlements', column: 'id', unique: true }],
        foreignKeys: [],
      }))
    }, randomUUID())
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.getByRole('button', { name: /^테이블 대역/ }).click()
    const tree = page.locator('.database-tree')
    await expect(tree.getByRole('button', { name: 'orders' })).toBeVisible()
    await page.getByLabel('테이블 검색').fill('settle')
    await expect(
      page.getByRole('status').filter({ hasText: '1개 테이블' }),
    ).toBeVisible()
    await expect(tree.getByRole('button', { name: 'orders' })).toHaveCount(0)
    await expect(tree.getByText('sales')).toHaveCount(0)
    await tree.getByRole('button', { name: 'settlements' }).click()

    const view = page.getByRole('region', { name: '테이블 상세' })
    await expect(
      view.getByRole('heading', { name: 'dbo.settlements' }),
    ).toBeVisible()
    const rows = view.locator('.column-table tbody tr')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(1)).toContainText('예')
    await expect(rows.nth(0)).toContainText('—')
    await expect(view).not.toContainText('?')
    await page.screenshot({ path: '.omx/readability/table-view.png' })

    // Drag 정산금액 onto the first row, ↓/↑ round-trip, drop memo from the SELECT.
    const source = await rows.nth(2).locator('.column-grip').boundingBox()
    const target = await rows.nth(0).boundingBox()
    await page.mouse.move(
      source!.x + source!.width / 2,
      source!.y + source!.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(source!.x + source!.width / 2, source!.y - 12, {
      steps: 4,
    })
    await expect(rows.nth(2)).toHaveClass(/dragging/)
    await page.mouse.move(
      target!.x + target!.width / 2,
      target!.y + target!.height / 2,
      { steps: 8 },
    )
    await expect(rows.nth(0)).toHaveClass(/drop-target/)
    await page.mouse.up()
    await expect(rows.nth(0)).toContainText('정산금액')
    await view.getByRole('button', { name: '정산금액 아래로' }).click()
    await expect(rows.nth(1)).toContainText('정산금액')
    await view.getByRole('button', { name: '정산금액 위로' }).click()
    await expect(rows.nth(2)).toContainText('memo')
    await view.getByLabel('memo 선택').uncheck()
    await view.getByRole('button', { name: '순서 저장' }).click()
    await expect
      .poll(async () =>
        Object.values(
          (await page.evaluate(() => window.desktop!.getSettings()))
            .columnLayouts,
        ),
      )
      .toEqual([{ order: ['정산금액', 'id', 'memo'], hidden: ['memo'] }])
    await expect(view.getByRole('button', { name: '순서 저장' })).toBeDisabled()

    // Virtual FK from the table itself: base table fixed, same-named PK auto-paired, blank name → target table.
    await expect(view.getByLabel('기준 테이블', { exact: true })).toHaveValue(
      'dbo.settlements',
    )
    await view
      .getByLabel('연결 테이블', { exact: true })
      .selectOption({ label: 'dbo.members' })
    await expect(view.getByLabel('기준 열 1', { exact: true })).toHaveValue(
      'id',
    )
    await expect(view.getByLabel('연결 열 1', { exact: true })).toHaveValue(
      'id',
    )
    await view.getByRole('button', { name: '관계 검증 후 저장' }).click()
    await expect(view.getByText('관계를 저장했습니다.')).toBeVisible()
    await view.screenshot({
      path: '.omx/readability/table-view-relationship.png',
    })
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings()))
            .virtualRelationships,
      )
      .toEqual([
        expect.objectContaining({
          name: 'members',
          source: { schema: 'dbo', table: 'settlements' },
          target: { schema: 'dbo', table: 'members' },
          columns: [{ source: 'id', target: 'id' }],
        }),
      ])
    await expect(view.getByText('dbo.settlements → dbo.members')).toBeVisible()

    // Reopening the table (here after visiting another one) restores the saved layout.
    await page.getByLabel('테이블 검색').fill('')
    await tree.getByRole('button', { name: 'members' }).click()
    await expect(
      view.getByRole('heading', { name: 'dbo.members' }),
    ).toBeVisible()
    // The relation also shows on the linked table's view.
    await expect(view.getByText('dbo.settlements → dbo.members')).toBeVisible()
    await tree.getByRole('button', { name: 'settlements' }).click()
    await expect(rows.nth(0)).toContainText('정산금액')
    await expect(view.getByLabel('memo 선택')).not.toBeChecked()
    await expect(view.getByText('저장된 순서 적용 중')).toBeVisible()
    await view.getByRole('button', { name: 'SELECT를 편집기에서 열기' }).click()
    await expect(view).toHaveCount(0)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
            ?.sql,
      )
      .toBe('SELECT  TOP (100) [정산금액]\n    ,   id\nFROM dbo.settlements;')
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
