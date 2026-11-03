import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectionSchema } from '@shared/database'
import { parseReadQuery } from '@main/database/policy'

const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  permissions: [
    { scope: 'DATABASE', permission_name: 'CONNECT' },
    { scope: 'OBJECT', permission_name: 'SELECT' },
  ],
  columns: [
    { name: 'duplicate', type: { name: 'Int' } },
    { name: 'duplicate', type: { name: 'Int' } },
  ],
  cancelled: 0,
  closed: 0,
  hold: false,
  requests: [] as { stream: boolean; cancel(): boolean }[],
  bound: [] as [string, unknown][],
  fail: false,
  transaction: { begin: 0, commit: 0, rollback: 0 },
  isolations: [] as (number | undefined)[],
}))
vi.mock('mssql', async () => {
  const { EventEmitter } = await import('node:events')
  class Request extends EventEmitter {
    stream = false
    arrayRowMode = false
    private cancelled = false
    constructor() {
      super()
      state.requests.push(this)
    }
    input(name: string, _type: unknown, value: unknown): this {
      state.bound.push([name, value])
      return this
    }
    cancel(): boolean {
      state.cancelled++
      this.cancelled = true
      if (state.hold)
        queueMicrotask(() => {
          this.emit('error', { code: 'ECANCEL' })
          this.emit('done')
        })
      return true
    }
    query(
      text: string,
      callback?: (error: unknown) => void,
    ): Promise<unknown> | void {
      if (!this.stream)
        return Promise.resolve({
          recordset: text.includes('fn_my_permissions')
            ? state.permissions
            : text.includes('COUNT(*)')
              ? [{ count: 1 }]
              : [],
        })
      if (state.hold) return
      queueMicrotask(() => {
        this.emit('recordset', state.columns)
        for (const row of state.rows) {
          if (this.cancelled) break
          this.emit('row', row)
        }
        if (state.fail)
          this.emit(
            'error',
            Object.assign(new Error('driver failure'), { code: 'EREQUEST' }),
          )
        else if (this.cancelled) this.emit('error', { code: 'ECANCEL' })
        this.emit('done')
        callback?.(state.fail ? new Error('driver failure') : null)
      })
    }
  }
  class ConnectionPool extends EventEmitter {
    connected = false
    async connect(): Promise<this> {
      this.connected = true
      return this
    }
    request(): Request {
      return new Request()
    }
    async close(): Promise<void> {
      state.closed++
      this.connected = false
    }
  }
  class Transaction {
    async begin(isolation?: number): Promise<void> {
      state.transaction.begin++
      state.isolations.push(isolation)
    }
    async commit(): Promise<void> {
      state.transaction.commit++
    }
    async rollback(): Promise<void> {
      state.transaction.rollback++
    }
  }
  return {
    default: {
      ConnectionPool,
      Request,
      Transaction,
      NVarChar: () => 'nvarchar',
      ISOLATION_LEVEL: { READ_COMMITTED: 2, SERIALIZABLE: 4 },
    },
  }
})
import { MssqlAdapter } from '@main/database/mssql/adapter'

const profile = connectionSchema.parse({
  id: randomUUID(),
  name: 'test',
  host: 'localhost',
  database: 'test',
  username: 'reader',
  maxRows: 2,
})
beforeEach(() => {
  state.rows = [
    [1, 2],
    [3, 4],
    [5, 6],
  ]
  state.permissions = [
    { scope: 'DATABASE', permission_name: 'CONNECT' },
    { scope: 'OBJECT', permission_name: 'SELECT' },
  ]
  state.columns = [
    { name: 'duplicate', type: { name: 'Int' } },
    { name: 'duplicate', type: { name: 'Int' } },
  ]
  state.cancelled = 0
  state.closed = 0
  state.hold = false
  state.requests = []
  state.bound = []
  state.fail = false
  state.transaction = { begin: 0, commit: 0, rollback: 0 }
  state.isolations = []
})

describe('MSSQL streaming adapter (driver double)', () => {
  it('caps rows, cancels the driver and preserves duplicate column names by index', async () => {
    const adapter = new MssqlAdapter()
    await adapter.connect(profile, 'secret')
    const result = await adapter.executeQuery(
      parseReadQuery('SELECT 1 AS one, 2 AS two', 2),
      randomUUID(),
      new AbortController().signal,
    )
    expect(result.rows).toEqual([
      { c0: 1, c1: 2 },
      { c0: 3, c1: 4 },
    ])
    expect(result.truncated).toBe(true)
    expect(result.columns.map((column) => column.key)).toEqual(['c0', 'c1'])
    expect(state.cancelled).toBe(1)
    await adapter.disconnect()
    expect(state.closed).toBe(1)
  })
  it('bounds IPC result bytes and wide result sets', async () => {
    const adapter = new MssqlAdapter()
    await adapter.connect({ ...profile, maxRows: 1000 }, 'secret')
    state.rows = Array.from({ length: 600 }, () => ['x'.repeat(8192)])
    const result = await adapter.executeQuery(
      parseReadQuery('SELECT 1', 1000),
      randomUUID(),
      new AbortController().signal,
    )
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result.rows))).toBeLessThan(
      4 * 1024 * 1024,
    )
    state.columns = Array.from({ length: 257 }, () => ({
      name: 'x',
      type: { name: 'Int' },
    }))
    await expect(
      adapter.executeQuery(
        parseReadQuery('SELECT 1', 2),
        randomUUID(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('256-column')
    await adapter.disconnect()
  })
  it('connects production accounts with wider DB roles without refusing or warning (ADR-031)', async () => {
    state.permissions.push({ scope: 'DATABASE', permission_name: 'UPDATE' })
    const adapter = new MssqlAdapter()
    const result = await adapter.connect(
      { ...profile, environment: 'production' },
      'secret',
    )
    expect(result).toMatchObject({ permissionVerified: false })
    expect(result.warning).toBeUndefined()
    expect(state.closed).toBe(0)
    await adapter.disconnect()
  })
  it('passes metadata names as parameters and cancels active streams', async () => {
    const adapter = new MssqlAdapter()
    await adapter.connect(profile, 'secret')
    await adapter.getColumns('dbo', "name'; DROP TABLE x--")
    expect(state.bound).toEqual([
      ['schema', 'dbo'],
      ['table', "name'; DROP TABLE x--"],
    ])
    state.hold = true
    const controller = new AbortController()
    const task = adapter.executeQuery(
      parseReadQuery('SELECT 1', 2),
      randomUUID(),
      controller.signal,
    )
    const assertion = expect(task).rejects.toThrow('cancelled')
    controller.abort()
    await assertion
    expect(state.cancelled).toBe(1)
    await adapter.disconnect()
  })
  it('propagates SQL errors and cleans up explicit transactions', async () => {
    const adapter = new MssqlAdapter()
    await adapter.connect(profile, 'secret')
    state.fail = true
    await expect(
      adapter.executeQuery(
        parseReadQuery('SELECT 1', 2),
        randomUUID(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('driver failure')
    await adapter.beginTransaction()
    await adapter.commit()
    await adapter.beginTransaction()
    await adapter.disconnect()
    expect(state.transaction).toEqual({ begin: 2, commit: 1, rollback: 1 })
  })
  it('pins SERIALIZABLE isolation for guarded writes while retaining the read transaction default', async () => {
    const adapter = new MssqlAdapter()
    await adapter.connect(profile, 'fixture-only')
    await adapter.beginTransaction('serializable')
    await adapter.rollback()
    await adapter.beginTransaction()
    await adapter.disconnect()
    expect(state.isolations).toEqual([4, 2])
  })
})
