import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { MutationState } from '@shared/mutation'

test('running a write with 변경 미리보기 shows the affected data, then 취소 or 실행 (apply+COMMIT) — Main-handler doubles, no DB', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-write-ui-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const connectionId = randomUUID()
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(
      ({ ipcMain }, fixture) => {
        // Test doubles only. Production handlers are tested separately by unit/IPC tests.
        const stats = {
          inspected: 0,
          previewed: 0,
          applied: 0,
          committed: 0,
          rolledBack: 0,
          confirmation: '',
        }
        Reflect.set(globalThis, 'writeUiFixtureStats', stats)
        let state: MutationState | null = null
        let next = 0
        const set = (
          channel: string,
          handler: (input: unknown) => unknown,
        ): void => {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, (_event, input: unknown) => handler(input))
        }
        set('db:connections', () => [
          {
            id: fixture.connectionId,
            name: 'UI handler double — not a DB',
            driver: 'mssql',
            host: 'not-used',
            port: 1,
            database: 'ui_fixture_not_live',
            username: 'fixture',
            environment: 'development',
            readOnly: false,
            encrypt: true,
            trustServerCertificate: false,
            timeoutSeconds: 30,
            maxRows: 100,
            hasPassword: false,
            status: 'connected',
            currentDatabase: 'ui_fixture_not_live',
            permissionVerified: false,
          },
        ])
        set('db:explorer', () => ({
          database: 'ui_fixture_not_live',
          databases: ['ui_fixture_not_live'],
          schemas: [],
          tables: [],
        }))
        set('mutation:state', () => state)
        set('mutation:inspect', (input) => {
          stats.inspected++
          return {
            kind: 'update',
            database: 'ui_fixture_not_live',
            target: 'dbo.items',
            affectedRows: 1,
            sample: {
              requestId: fixture.connectionId,
              columns: [
                { key: 'c0', name: 'id', type: 'preview' },
                { key: 'c1', name: 'amount', type: 'preview' },
                { key: 'c2', name: '→ amount', type: 'preview' },
              ],
              rows: [{ c0: '1', c1: '10', c2: '2' }],
              rowCount: 1,
              durationMs: 0,
              truncated: false,
            },
            sql: (input as { sql: string }).sql,
          }
        })
        set('mutation:preview', (input) => {
          stats.previewed++
          const request = input as { sql: string }
          state = {
            id: fixture.ids[next++]!,
            connectionId: fixture.connectionId,
            database: 'ui_fixture_not_live',
            kind: 'update',
            sql: request.sql,
            approvalHash: 'a'.repeat(64),
            policyVersion: 'UI-HANDLER-DOUBLE',
            stage: 'preview',
            expiresAt: Date.now() + 60000,
            affectedRows: 1,
            importRows: { total: 5, unmatched: 2 },
            preview: {
              requestId: fixture.connectionId,
              columns: [{ key: 'c0', name: 'id', type: 'int' }],
              rows: [{ c0: 1 }],
              rowCount: 1,
              durationMs: 0,
              truncated: false,
            },
            message: 'Fixture only. Nothing executed.',
          }
          return state
        })
        set('mutation:apply', () => {
          stats.applied++
          state = {
            ...state!,
            stage: 'applied',
            commitToken: fixture.token,
            expiresAt: Date.now() + 30000,
            message: 'Fixture only: UNCOMMITTED. Explicit commit required.',
          }
          return state
        })
        set('mutation:commit', (input) => {
          stats.confirmation = (
            input as { databaseConfirmation: string }
          ).databaseConfirmation
          if (stats.confirmation !== 'ui_fixture_not_live')
            throw new Error('Wrong fixture database')
          stats.committed++
          state = {
            ...state!,
            stage: 'committed',
            message: 'Fixture only: COMMIT acknowledged.',
          }
          return state
        })
        set('mutation:rollback', () => {
          stats.rolledBack++
          state = {
            ...state!,
            stage: 'rolled-back',
            message: 'Fixture only: rollback acknowledged.',
          }
          return state
        })
      },
      { connectionId, ids: [randomUUID(), randomUUID()], token: randomUUID() },
    )
    await page
      .getByLabel('SQL 연결', { exact: true })
      .selectOption(connectionId)
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('UPDATE dbo.items SET amount=2 WHERE id=1')
    const stats = () =>
      app.evaluate(() => Reflect.get(globalThis, 'writeUiFixtureStats'))
    const run = { click: () => page.keyboard.press('Control+Enter') }
    const toggle = page.getByLabel('변경 미리보기', { exact: true })
    const view = page.locator('[aria-label="변경 미리보기"].mutation-state')
    // Toggle off: the write is neither run nor previewed.
    const sqlView = page.getByRole('button', { name: 'SQL 작업 공간 열기' })
    await page.getByRole('button', { name: '설정 열기', exact: true }).click()
    await expect(toggle).toBeChecked()
    await toggle.uncheck()
    await sqlView.click()
    await page.locator('.monaco-editor').click()
    await run.click()
    await expect(
      page.getByText('"변경 미리보기"를 켜야 실행할 수 있습니다'),
    ).toBeVisible()
    expect(await stats()).toMatchObject({ inspected: 0, previewed: 0 })
    // Toggle on: running shows the data that would change; 취소 leaves everything untouched.
    await page.getByRole('button', { name: '설정 열기', exact: true }).click()
    await toggle.check()
    await sqlView.click()
    await page.locator('.monaco-editor').click()
    await run.click()
    await expect(view).toContainText('변경 미리보기 — 아직 적용되지 않음')
    await expect(view.locator('th')).toHaveText(['id', 'amount', '→ amount'])
    await expect(view.locator('td.next')).toHaveText('2')
    await expect(view).toContainText('1행을 변경합니다. 실행할까요?')
    await view.getByRole('button', { name: '취소', exact: true }).click()
    await expect(view).toHaveCount(0)
    expect(await stats()).toMatchObject({
      inspected: 1,
      previewed: 0,
      applied: 0,
      committed: 0,
    })
    // 실행 = guarded preview → apply → COMMIT in one answer.
    await page.keyboard.press('Control+Enter')
    await expect(view).toContainText('1행을 변경합니다. 실행할까요?')
    await view.getByRole('button', { name: '실행', exact: true }).click()
    await expect(page.locator('.mutation-state')).toContainText('COMMIT 완료')
    expect(await stats()).toMatchObject({
      inspected: 2,
      previewed: 1,
      applied: 1,
      committed: 1,
      rolledBack: 0,
      confirmation: 'ui_fixture_not_live',
    })
  } finally {
    await app.close()
    const target = resolve(directory)
    if (
      target.startsWith(resolve(tmpdir())) &&
      basename(target).startsWith('ai-db-write-ui-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
