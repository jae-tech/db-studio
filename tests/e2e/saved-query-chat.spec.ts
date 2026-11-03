import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('local chat names use existing SELECT path, reject ambiguity/scope races and never call AI (Main-handler doubles, no DB)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-chat-query-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const connectionId = randomUUID()
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const saved = await page.evaluate(async (id) => {
      const query = await window.desktop!.db.saveQuery({
        connectionId: id,
        database: 'chat_fixture',
        name: '월별 매출',
        aliases: ['매출'],
        sql: 'SELECT 42 AS answer;',
      })
      await window.desktop!.db.saveQuery({
        connectionId: id,
        database: 'other',
        name: '다른 DB 전용',
        aliases: [],
        sql: 'SELECT 999 AS answer;',
      })
      const settings = await window.desktop!.getSettings()
      settings.tabs[0]!.connectionId = id
      await window.desktop!.saveSettings(settings)
      return query
    }, connectionId)
    await app.evaluate(
      ({ ipcMain }, fixture) => {
        const state = {
          executed: 0,
          agents: 0,
          duplicate: false,
          delay: false,
          switched: false,
        }
        Reflect.set(globalThis, 'chatQueryFixture', state)
        const set = (channel: string, handler: (input: unknown) => unknown) => {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, (_event, input: unknown) => handler(input))
        }
        // Deliberate handler doubles, not a real database or CLI.
        set('db:connections', () => [
          {
            id: fixture.connectionId,
            name: 'Chat fixture (not live)',
            driver: 'mssql',
            status: 'connected',
            currentDatabase: 'chat_fixture',
            readOnly: true,
          },
        ])
        set('db:explorer', () => ({
          database: 'chat_fixture',
          databases: ['chat_fixture'],
          schemas: [],
          tables: [],
        }))
        set('db:saved-queries', async () => {
          if (state.delay)
            await new Promise((resolve) => setTimeout(resolve, 1200))
          return state.duplicate
            ? [fixture.saved, { ...fixture.saved, id: fixture.duplicateId }]
            : [fixture.saved]
        })
        set('db:review', (input) => ({
          token: fixture.token,
          sql: (input as { sql: string }).sql,
          database: state.switched ? 'other' : 'chat_fixture',
          expiresAt: Date.now() + 60000,
          maxRows: 10,
          timeoutSeconds: 10,
        }))
        set('db:execute', (input) => {
          state.executed++
          return {
            requestId: (input as { requestId: string }).requestId,
            columns: [{ key: 'c0', name: 'answer', type: 'int' }],
            rows: [{ c0: 42 }],
            rowCount: 1,
            truncated: false,
            durationMs: 1,
          }
        })
        set('agent:start', () => {
          state.agents++
          throw new Error('Unexpected AI call')
        })
        // A machine without the CLI: the startup check reports it unavailable.
        set('agent:status', () => [
          {
            provider: 'codex',
            installed: false,
            available: false,
            auth: 'unavailable',
            reason: 'Fixture: CLI not installed',
          },
        ])
      },
      { connectionId, saved, duplicateId: randomUUID(), token: randomUUID() },
    )
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const input = page.getByLabel('AI 메시지', { exact: true })
    const send = page.getByRole('button', { name: '메시지 보내기' })
    const stats = () =>
      app.evaluate(
        () =>
          Reflect.get(globalThis, 'chatQueryFixture') as {
            executed: number
            agents: number
          },
      )
    const command = async (text: string) => {
      await input.fill(text)
      await send.click()
    }
    await command('매출 조회해줘')
    await expect(page.getByRole('log').locator('article').last()).toContainText(
      '조회 완료',
    )
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^42$/ }),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await stats()).toMatchObject({ executed: 1, agents: 0 })
    await command('/조회 없는이름')
    await expect(page.locator('.agent-footer [role="alert"]')).toContainText(
      '없습니다',
    )
    await command('SQL을 작성해줘')
    await expect(page.locator('.agent-footer [role="alert"]')).toContainText(
      'CLI not installed',
    )
    await app.evaluate(() => {
      Reflect.get(globalThis, 'chatQueryFixture').duplicate = true
    })
    await command('매출')
    await expect(page.locator('.agent-footer [role="alert"]')).toContainText(
      '여러 개',
    )
    await app.evaluate(() => {
      const state = Reflect.get(globalThis, 'chatQueryFixture')
      state.duplicate = false
      state.switched = true
    })
    await command('/조회 매출')
    await expect(page.getByRole('log').locator('article').last()).toContainText(
      '실행하지 못했습니다',
    )
    await expect(page.getByRole('status')).toContainText(
      '데이터베이스가 바뀌었습니다',
    )
    expect(await stats()).toMatchObject({ executed: 1, agents: 0 })
    await app.evaluate(() => {
      const state = Reflect.get(globalThis, 'chatQueryFixture')
      state.switched = false
      state.delay = true
    })
    await command('/조회 매출')
    await page.getByRole('button', { name: '새 SQL 탭', exact: true }).click()
    await expect(page.locator('.agent-footer [role="alert"]')).toContainText(
      '작업 탭이 바뀌었습니다',
    )
    expect(await stats()).toMatchObject({ executed: 1, agents: 0 })
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
