import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import type { AgentRequest } from '@shared/agent'
import { defaultSqlFormatting } from '@shared/sqlFormatting'

test('selected DB metadata is automatic on send, switches/cancels scope, and disconnect returns to text only (handler doubles)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-auto-context-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const ids = [randomUUID(), randomUUID()]
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.evaluate(async (id) => {
      const settings = await window.desktop!.getSettings()
      settings.tabs[0]!.connectionId = id
      await window.desktop!.saveSettings(settings)
    }, ids[0]!)
    await app.evaluate(({ ipcMain }, connections) => {
      const state = {
        database: 'first_db',
        connected: true,
        hold: false,
        requests: [] as AgentRequest[],
        cancelled: [] as string[],
      }
      Reflect.set(globalThis, 'autoContextFixture', state)
      const set = (name: string, handler: (input: unknown) => unknown) => {
        ipcMain.removeHandler(name)
        ipcMain.handle(name, (_event, input: unknown) => handler(input))
      }
      set('db:connections', () =>
        connections.map((id, index) => ({
          id,
          name: index ? 'Beta' : 'Alpha',
          driver: 'mssql',
          readOnly: true,
          status: state.connected ? 'connected' : 'disconnected',
          currentDatabase: index ? 'other_db' : state.database,
        })),
      )
      set('db:explorer', () => ({ databases: [], schemas: [], tables: [] }))
      set('agent:status', () => [
        {
          provider: 'codex',
          installed: true,
          available: true,
          auth: 'subscription',
          reason: 'Handler double only',
          version: 'fixture',
        },
      ])
      ipcMain.removeHandler('agent:start')
      ipcMain.handle('agent:start', (event, request: AgentRequest) => {
        state.requests.push(request)
        if (!state.hold)
          event.sender.send('agent:event', {
            requestId: request.requestId,
            provider: request.provider,
            type: 'done',
            outcome: 'completed',
          })
      })
      ipcMain.removeHandler('agent:cancel')
      ipcMain.handle('agent:cancel', (event, input: { requestId: string }) => {
        state.cancelled.push(input.requestId)
        event.sender.send('agent:event', {
          requestId: input.requestId,
          provider: 'codex',
          type: 'done',
          outcome: 'cancelled',
        })
      })
    }, ids)
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const panel = page.locator('.agent-panel')
    await expect(panel.getByRole('checkbox')).toHaveCount(0)
    await expect(page.locator('.title-center')).toContainText(
      'Alpha · first_db',
    )
    const stats = () =>
      app.evaluate(
        () =>
          Reflect.get(globalThis, 'autoContextFixture') as {
            requests: AgentRequest[]
            cancelled: string[]
          },
      )
    expect((await stats()).requests).toEqual([])
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    expect((await stats()).requests).toEqual([])
    const send = async () => {
      await page
        .getByLabel('AI 메시지', { exact: true })
        .fill('조회 쿼리를 작성해줘')
      await page.getByRole('button', { name: '메시지 보내기' }).click()
    }
    await send()
    await expect.poll(async () => (await stats()).requests.length).toBe(1)
    expect((await stats()).requests[0]).toMatchObject({
      prompt: '조회 쿼리를 작성해줘',
      context: { connectionId: ids[0], shareSchema: true },
    })
    await app.evaluate(() => {
      Reflect.get(globalThis, 'autoContextFixture').database = 'second_db'
    })
    await expect(page.locator('.title-center')).toContainText(
      'Alpha · second_db',
      { timeout: 8000 },
    )
    expect((await stats()).requests).toHaveLength(1)
    await send()
    await expect.poll(async () => (await stats()).requests.length).toBe(2)
    expect((await stats()).requests[1]!.context).toEqual({
      connectionId: ids[0],
      shareSchema: true,
      sqlFormatting: defaultSqlFormatting(),
    })
    await app.evaluate(() => {
      Reflect.get(globalThis, 'autoContextFixture').hold = true
    })
    await send()
    await expect.poll(async () => (await stats()).requests.length).toBe(3)
    await page.getByLabel('SQL 연결', { exact: true }).selectOption(ids[1]!)
    await expect
      .poll(async () => (await stats()).cancelled)
      .toContain((await stats()).requests[2]!.requestId)
    await expect(page.locator('.title-center')).toContainText('Beta · other_db')
    await app.evaluate(() => {
      Reflect.get(globalThis, 'autoContextFixture').hold = false
    })
    await send()
    await expect.poll(async () => (await stats()).requests.length).toBe(4)
    expect((await stats()).requests[3]!.context).toEqual({
      connectionId: ids[1],
      shareSchema: true,
      sqlFormatting: defaultSqlFormatting(),
    })
    await app.evaluate(() => {
      Reflect.get(globalThis, 'autoContextFixture').connected = false
    })
    await expect(page.locator('.statusbar')).toContainText('연결 안 됨', {
      timeout: 8000,
    })
    await send()
    await expect.poll(async () => (await stats()).requests.length).toBe(5)
    expect((await stats()).requests[4]!.context).toBeUndefined()
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
  } finally {
    await app.close()
    const target = resolve(profile)
    if (
      target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith('ai-db-auto-context-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
