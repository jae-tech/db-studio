import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('AI SELECT runs immediately in its own tab; AI writes open a preview and wait for the user (handler doubles, no DB/AI)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-auto-run-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const connectionId = randomUUID()
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.evaluate(async (id) => {
      const settings = await window.desktop!.getSettings()
      settings.tabs[0]!.connectionId = id
      await window.desktop!.saveSettings(settings)
    }, connectionId)
    await app.evaluate(({ ipcMain }, id) => {
      const state = {
        reviewed: [] as string[],
        executed: 0,
        previewed: [] as string[],
        applied: 0,
        committed: [] as string[],
        turn: 0,
      }
      Reflect.set(globalThis, 'autoRunFixture', state)
      const set = (name: string, handler: (input: unknown) => unknown) => {
        ipcMain.removeHandler(name)
        ipcMain.handle(name, (_event, input: unknown) => handler(input))
      }
      set('db:connections', () => [
        {
          id,
          name: 'Auto-run double',
          driver: 'mssql',
          status: 'connected',
          currentDatabase: 'auto_fixture',
          environment: 'development',
          readOnly: false,
          maxRows: 1000,
        },
      ])
      set('db:explorer', () => ({
        database: 'auto_fixture',
        databases: ['auto_fixture'],
        schemas: [],
        tables: [],
      }))
      set('agent:status', () => [
        {
          provider: 'codex',
          available: true,
          installed: true,
          auth: 'subscription',
          reason: 'Handler double',
          version: 'fixture',
        },
      ])
      set('db:review', (input) => {
        state.reviewed.push((input as { sql: string }).sql)
        return {
          token: crypto.randomUUID(),
          database: 'auto_fixture',
          sql: 'normalized',
          expiresAt: Date.now() + 60000,
          maxRows: 1000,
          timeoutSeconds: 10,
        }
      })
      set('db:execute', () => {
        state.executed++
        return {
          requestId: crypto.randomUUID(),
          columns: [{ key: 'c0', name: 'name', type: 'nvarchar' }],
          rows: [{ c0: 'auto-run-row' }],
          rowCount: 1,
          durationMs: 1,
          truncated: false,
        }
      })
      let mutation: unknown = null
      set('mutation:state', () => mutation)
      set('mutation:inspect', (input) => {
        state.previewed.push((input as { sql: string }).sql)
        return {
          kind: 'update',
          database: 'auto_fixture',
          target: 'dbo.items',
          affectedRows: 1,
          sample: {
            requestId: id,
            columns: [
              { key: 'c0', name: 'id', type: 'preview' },
              { key: 'c1', name: 'amount', type: 'preview' },
              { key: 'c2', name: '→ amount', type: 'preview' },
            ],
            rows: [{ c0: '7', c1: '1', c2: '2' }],
            rowCount: 1,
            durationMs: 0,
            truncated: false,
          },
        }
      })
      set('mutation:preview', (input) => {
        const sql = (input as { sql: string }).sql
        mutation = {
          id: crypto.randomUUID(),
          connectionId: id,
          database: 'auto_fixture',
          kind: 'update',
          sql,
          approvalHash: 'a'.repeat(64),
          policyVersion: 'UI-HANDLER-DOUBLE',
          stage: 'preview',
          expiresAt: Date.now() + 60000,
          affectedRows: 1,
          preview: {
            requestId: id,
            columns: [{ key: 'c0', name: 'id', type: 'int' }],
            rows: [{ c0: 7 }],
            rowCount: 1,
            durationMs: 0,
            truncated: false,
          },
          message: 'Fixture only. Nothing executed.',
        }
        return mutation
      })
      set('mutation:apply', () => {
        state.applied++
        mutation = {
          ...(mutation as object),
          stage: 'applied',
          commitToken: crypto.randomUUID(),
          message: 'Fixture only: UNCOMMITTED.',
        }
        return mutation
      })
      set('mutation:commit', (input) => {
        state.committed.push(
          (input as { databaseConfirmation: string }).databaseConfirmation,
        )
        mutation = {
          ...(mutation as object),
          stage: 'committed',
          message: 'Fixture only: COMMIT acknowledged.',
        }
        return mutation
      })
      ipcMain.removeHandler('agent:start')
      ipcMain.handle('agent:start', (event, request) => {
        const write = state.turn++ > 0
        const send = (payload: object) =>
          event.sender.send('agent:event', {
            requestId: request.requestId,
            provider: 'codex',
            ...payload,
          })
        send({
          type: 'proposal',
          proposal: {
            id: crypto.randomUUID(),
            connectionId: id,
            database: 'auto_fixture',
            sql: write
              ? 'UPDATE dbo.items SET amount = 2 WHERE id = 7'
              : 'SELECT name FROM dbo.items',
            explanation: 'fixture',
            ...(write ? { draft: true } : {}),
          },
        })
        send({ type: 'done', outcome: 'completed' })
      })
    }, connectionId)
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const stats = async () =>
      (await app.evaluate(() => Reflect.get(globalThis, 'autoRunFixture'))) as {
        reviewed: string[]
        executed: number
        previewed: string[]
        applied: number
        committed: string[]
      }
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    const message = page.getByLabel('AI 메시지', { exact: true })
    await message.fill('품목 이름 조회해줘')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    // No open/run click: the SELECT runs in a new tab and the grid shows the row.
    await expect(page.getByRole('tab', { name: /AI 조회/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: 'auto-run-row' }),
    ).toBeVisible()
    expect(await stats()).toMatchObject({
      reviewed: [expect.stringContaining('name')],
      executed: 1,
      previewed: [],
    })

    await message.fill('7번 금액을 2로 바꿔줘')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect(
      page.getByRole('tab', { name: /AI 변경 · 확인 필요/ }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByText('변경 미리보기 — 아직 적용되지 않음', { exact: false }),
    ).toBeVisible()
    const after = await stats()
    expect(after.previewed).toHaveLength(1)
    expect(after.previewed[0]).toContain('UPDATE')
    expect(after.executed).toBe(1)
    expect(after.applied).toBe(0)
    expect(after.reviewed).toHaveLength(1)
    expect(after.committed).toEqual([])
    // One question replaces the review/apply/typed-DB steps for AI writes.
    await expect(page.getByText('1행을 변경합니다. 실행할까요?')).toBeVisible()
    await page.getByRole('button', { name: '실행', exact: true }).click()
    await expect
      .poll(async () => (await stats()).committed)
      .toEqual(['auto_fixture'])
    expect((await stats()).applied).toBe(1)
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
