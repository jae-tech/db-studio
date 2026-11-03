import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('connections open at last exit reconnect once on startup and the list follows disconnects (handler doubles, no DB)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-reconnect-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const [open, closed] = [randomUUID(), randomUUID()]
    await app.evaluate(
      ({ ipcMain }, ids) => {
        const connected = new Set<string>()
        const calls: { connectionId: string; database?: string }[] = []
        Reflect.set(globalThis, 'reconnectCalls', calls)
        const set = (channel: string, handler: (input: never) => unknown) => {
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, (_event, input) => handler(input as never))
        }
        set('db:connections', () =>
          ids.map((id, index) => ({
            id,
            name: `대역 ${index}`,
            driver: 'mssql',
            host: 'not-used',
            port: 1,
            database: 'reconnect_not_live',
            username: 'fixture',
            environment: 'development',
            readOnly: true,
            encrypt: true,
            trustServerCertificate: false,
            timeoutSeconds: 30,
            maxRows: 100,
            hasPassword: false,
            status: connected.has(id) ? 'connected' : 'disconnected',
            currentDatabase: 'reconnect_not_live',
            permissionVerified: true,
          })),
        )
        set(
          'db:connect',
          (input: { connectionId: string; database?: string }) => {
            calls.push(input)
            connected.add(input.connectionId)
            return { warnings: [] }
          },
        )
        set('db:disconnect', (id: string) => {
          connected.delete(id)
          return true
        })
      },
      [open, closed],
    )
    await page.evaluate(
      (id) =>
        localStorage.setItem(
          'reconnect-connections',
          JSON.stringify([{ id, database: 'last_used_db' }]),
        ),
      open,
    )
    await page.reload()
    const calls = () =>
      app.evaluate(() => Reflect.get(globalThis, 'reconnectCalls'))
    await expect
      .poll(calls)
      .toEqual([{ connectionId: open, database: 'last_used_db' }])
    // A manual disconnect drops it from the startup list.
    await page.evaluate((id) => window.desktop!.db.disconnect(id), open)
    await expect
      .poll(
        () =>
          page.evaluate(() => localStorage.getItem('reconnect-connections')),
        { timeout: 10_000 },
      )
      .toBe('[]')
    expect(await calls()).toHaveLength(1)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
