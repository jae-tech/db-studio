import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseService } from '@main/database/service'
import type { DatabaseRepositoryPort } from '@main/database/repository'
import type { DatabaseAdapter } from '@main/database/DatabaseAdapter'
import {
  connectionSchema,
  type HistoryEntry,
  type QueryResult,
} from '@shared/database'

const profile = connectionSchema.parse({
  id: randomUUID(),
  name: 'Test',
  host: 'localhost',
  database: 'test',
  username: 'reader',
  timeoutSeconds: 1,
})
function setup() {
  const entries: HistoryEntry[] = []
  const repo: DatabaseRepositoryPort = {
    list: () => [{ profile, hasPassword: true }],
    load: vi.fn(async () => ({ profile, password: 'secret' })),
    save: vi.fn(async () => undefined),
    delete: vi.fn(),
    history: () => entries,
    addHistory: (entry) => entries.push(entry),
  }
  const result: QueryResult = {
    requestId: 'request',
    columns: [{ key: 'c0', name: 'answer', type: 'Int' }],
    rows: [{ c0: 42 }],
    rowCount: 1,
    durationMs: 10,
    truncated: false,
  }
  let connected = false
  const adapter: DatabaseAdapter = {
    isConnected: () => connected,
    connect: vi.fn(async () => {
      connected = true
      return { permissionVerified: true }
    }),
    disconnect: vi.fn(async () => {
      connected = false
    }),
    listDatabases: vi.fn(async () => ['test']),
    listSchemas: vi.fn(async () => ['dbo']),
    listTables: vi.fn(async () => [{ schema: 'dbo', name: 'items' }]),
    getColumns: vi.fn(async () => []),
    getIndexes: vi.fn(async () => []),
    getForeignKeys: vi.fn(async () => []),
    executeQuery: vi.fn(async () => result),
    cancelQuery: vi.fn(() => true),
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  }
  let time = Date.now()
  const service = new DatabaseService(
    repo,
    () => adapter,
    () => time,
  )
  const connect = () => service.connect({ connectionId: profile.id })
  const review = () =>
    service.reviewQuery({
      connectionId: profile.id,
      sql: 'SELECT 42 AS answer;',
    })
  const execute = (token: string, connectionId = profile.id) =>
    service.executeQuery({
      connectionId,
      requestId: randomUUID(),
      approvalToken: token,
    })
  return {
    service,
    adapter,
    repo,
    entries,
    result,
    connect,
    review,
    execute,
    advance: () => {
      time += 60001
    },
  }
}

it('binds metadata scope to the connection generation and rejects cached/late reads after disconnect', async () => {
  const f = setup()
  await f.connect()
  const scope = f.service.metadataScope(profile.id)
  expect(await scope.tables()).toEqual([{ schema: 'dbo', name: 'items' }])
  await f.service.disconnect(profile.id)
  expect(() => scope.assertCurrent()).toThrow()
  await f.connect()
  expect(f.service.metadataScope(profile.id).key).not.toBe(scope.key)
  await expect(scope.describe('dbo', 'items')).rejects.toThrow()
  expect(f.adapter.executeQuery).not.toHaveBeenCalled()
  expect(f.entries).toHaveLength(0)
  await f.service.dispose()
})
it('reads only accessible cross-database metadata without changing the connection', async () => {
  const f = setup()
  vi.mocked(f.adapter.listDatabases).mockResolvedValue(['test', 'Archive'])
  vi.mocked(f.adapter.listSchemas).mockImplementation(async (database) =>
    database === 'Archive' ? ['sales'] : ['dbo'],
  )
  vi.mocked(f.adapter.listTables).mockImplementation(async (database) =>
    database === 'Archive'
      ? [{ schema: 'sales', name: 'old_orders' }]
      : [{ schema: 'dbo', name: 'items' }],
  )
  await f.connect()
  expect(await f.service.getExplorer(profile.id)).toMatchObject({
    database: 'test',
    tables: [{ schema: 'dbo', name: 'items' }],
  })
  expect(
    await f.service.getExplorer({
      connectionId: profile.id,
      database: 'archive',
    }),
  ).toMatchObject({
    database: 'Archive',
    schemas: ['sales'],
    tables: [{ schema: 'sales', name: 'old_orders' }],
  })
  expect(f.adapter.listTables).toHaveBeenCalledWith('Archive')
  await f.service.describeTable({
    connectionId: profile.id,
    database: 'archive',
    schema: 'sales',
    table: 'old_orders',
  })
  expect(f.adapter.getColumns).toHaveBeenCalledWith(
    'sales',
    'old_orders',
    'Archive',
  )
  expect(f.service.listConnections()[0]?.currentDatabase).toBe('test')
  await expect(
    f.service.getExplorer({
      connectionId: profile.id,
      database: 'missing',
    }),
  ).rejects.toThrow('접근할 수 없습니다')
  await expect(
    f.service.describeTable({
      connectionId: profile.id,
      database: 'missing',
      schema: 'dbo',
      table: 'secret',
    }),
  ).rejects.toThrow('접근할 수 없습니다')
  expect(f.adapter.listTables).not.toHaveBeenCalledWith('missing')
  expect(f.adapter.getColumns).not.toHaveBeenCalledWith(
    'dbo',
    'secret',
    'missing',
  )
  await f.service.dispose()
})
afterEach(() => vi.useRealTimers())
describe('database service security and lifecycle (test double, no live DB)', () => {
  it('requires a connection and single-use approval and sends only parsed SQL', async () => {
    const env = setup()
    expect(() => env.review()).toThrow('No database connected')
    await env.connect()
    await expect(env.execute(randomUUID())).rejects.toThrow('approval')
    expect(env.adapter.executeQuery).not.toHaveBeenCalled()
    const review = env.review()
    await expect(env.execute(review.token)).resolves.toEqual(env.result)
    expect(env.adapter.executeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ sql: 'SELECT TOP (1001) 42 AS [answer]' }),
      expect.any(String),
      expect.any(AbortSignal),
    )
    await expect(env.execute(review.token)).rejects.toThrow('approval')
    expect(env.entries[0]?.status).toBe('success')
    await env.service.dispose()
  })
  it('invalidates approval on expiry and reconnect and refuses writes before the driver', async () => {
    const env = setup()
    await env.connect()
    expect(() =>
      env.service.reviewQuery({
        connectionId: profile.id,
        sql: 'DELETE FROM dbo.items',
      }),
    ).toThrow()
    const old = env.review()
    env.advance()
    await expect(env.execute(old.token)).rejects.toThrow('expired')
    const beforeDisconnect = env.review()
    await env.service.disconnect(profile.id)
    await env.connect()
    await expect(env.execute(beforeDisconnect.token)).rejects.toThrow(
      'approval',
    )
    expect(env.adapter.executeQuery).not.toHaveBeenCalled()
    await env.service.dispose()
  })
  it('cancels only the matching request and prevents concurrent execution per connection', async () => {
    const env = setup()
    await env.connect()
    vi.mocked(env.adapter.executeQuery).mockImplementation(
      (_query, _id, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          ),
        ),
    )
    const first = env.review()
    const second = env.review()
    const requestId = randomUUID()
    const running = env.service.executeQuery({
      connectionId: profile.id,
      requestId,
      approvalToken: first.token,
    })
    const failed = expect(running).rejects.toThrow('cancelled')
    await Promise.resolve()
    await expect(env.execute(second.token)).rejects.toThrow('One query')
    expect(
      env.service.cancelQuery({ connectionId: randomUUID(), requestId }),
    ).toBe(false)
    expect(
      env.service.cancelQuery({ connectionId: profile.id, requestId }),
    ).toBe(true)
    await failed
    expect(env.entries[0]?.status).toBe('cancelled')
    await env.service.dispose()
  })
  it('bounds execution with a timeout and records failures', async () => {
    vi.useFakeTimers()
    const env = setup()
    await env.connect()
    vi.mocked(env.adapter.executeQuery).mockImplementation(
      (_query, _id, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          ),
        ),
    )
    const task = env.execute(env.review().token)
    const assertion = expect(task).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
    expect(env.entries[0]?.status).toBe('cancelled')
    await env.service.dispose()
  })
  it('cleans up a failed connection and never exposes passwords in summaries', async () => {
    const env = setup()
    vi.mocked(env.adapter.connect).mockRejectedValueOnce(
      Object.assign(new Error('internal details'), { code: 'ELOGIN' }),
    )
    await expect(env.connect()).rejects.toThrow('authentication failed')
    expect(env.adapter.disconnect).toHaveBeenCalled()
    expect(JSON.stringify(env.service.listConnections())).not.toContain(
      'secret',
    )
    expect(env.service.listConnections()[0]?.status).toBe('disconnected')
    await env.service.dispose()
  })
  it('shutdown aborts requests before disconnecting the pool', async () => {
    const env = setup()
    await env.connect()
    vi.mocked(env.adapter.executeQuery).mockImplementation(
      (_query, _id, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          ),
        ),
    )
    const task = env.execute(env.review().token)
    const assertion = expect(task).rejects.toThrow('closing')
    await Promise.resolve()
    await env.service.dispose()
    await assertion
    expect(env.adapter.disconnect).toHaveBeenCalled()
    expect(env.entries[0]?.status).toBe('cancelled')
  })
})

it('invalidates approvals and metadata scopes when immutable Excel sources change', async () => {
  const f = setup()
  const { ImportRegistry } = await import('@main/database/ImportAdapter')
  f.adapter.imports = new ImportRegistry()
  await f.connect()
  const stage = {
    id: randomUUID(),
    tableName: 'stage_' + randomUUID().replaceAll('-', ''),
    columns: ['상품코드'],
    rows: [['00123']],
  }
  const scope = f.service.metadataScope(profile.id)
  const approval = f.review()
  expect(f.service.registerImport(profile.id, stage)).toBe(profile.database)
  expect(() => scope.assertCurrent()).toThrow('changed')
  await expect(f.execute(approval.token)).rejects.toThrow('approval')
  const listed = f.service.listImports(profile.id)
  expect(listed).toMatchObject([
    { stageId: stage.id, schema: 'import', columns: ['상품코드'], rowCount: 1 },
  ])
  expect(JSON.stringify(listed)).not.toContain('00123')
  const second = f.service.metadataScope(profile.id)
  const approved = f.review()
  f.service.unregisterImport(profile.id, stage.id)
  expect(() => second.assertCurrent()).toThrow('changed')
  await expect(f.execute(approved.token)).rejects.toThrow('approval')
  expect(f.service.listImports(profile.id)).toEqual([])
  await f.service.disconnect(profile.id)
  expect(() => f.service.unregisterImport(profile.id, stage.id)).not.toThrow()
  await f.service.dispose()
})

it('refuses changing Excel sources while metadata or SELECT is in progress', async () => {
  const f = setup()
  const { ImportRegistry } = await import('@main/database/ImportAdapter')
  f.adapter.imports = new ImportRegistry()
  await f.connect()
  const stage = {
    id: randomUUID(),
    tableName: 'stage_' + randomUUID().replaceAll('-', ''),
    columns: ['id'],
    rows: [['1']],
  }
  let release!: () => void
  vi.mocked(f.adapter.listTables).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve([])
      }),
  )
  const reading = f.service.metadataScope(profile.id).tables()
  expect(() => f.service.registerImport(profile.id, stage)).toThrow('조회')
  release()
  await reading
  f.service.registerImport(profile.id, stage)
  let complete!: (value: QueryResult) => void
  vi.mocked(f.adapter.executeQuery).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const running = f.execute(f.review().token)
  await vi.waitFor(() => expect(f.adapter.executeQuery).toHaveBeenCalled())
  expect(() => f.service.unregisterImport(profile.id, stage.id)).toThrow('조회')
  complete(f.result)
  await running
  expect(f.service.listImports(profile.id)).toHaveLength(1)
  await f.service.dispose()
})
describe('result file export (test double, real file)', () => {
  it('streams the whole approved SELECT without the grid cap and records history', async () => {
    const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'aidb-service-export-'))
    try {
      const env = setup()
      await env.connect()
      // Cancelled save dialog: the one-time approval is consumed, nothing runs.
      const cancelled = env.review()
      await expect(
        env.service.exportQuery(
          {
            connectionId: profile.id,
            requestId: randomUUID(),
            approvalToken: cancelled.token,
            format: 'csv',
          },
          async () => undefined,
        ),
      ).resolves.toBeNull()
      expect(env.adapter.executeQuery).not.toHaveBeenCalled()
      await expect(env.execute(cancelled.token)).rejects.toThrow('approval')
      vi.mocked(env.adapter.executeQuery).mockImplementationOnce(
        async (_query, requestId, _signal, sink) => {
          sink!.columns(['answer'])
          for (let n = 0; n < 3; n++) if (sink!.row([n])) await sink!.flush()
          return { ...env.result, requestId, rows: [], rowCount: 3 }
        },
      )
      const path = join(dir, 'answer.csv')
      const saved = await env.service.exportQuery(
        {
          connectionId: profile.id,
          requestId: randomUUID(),
          approvalToken: env.review().token,
          format: 'csv',
        },
        async () => path,
      )
      expect(saved).toMatchObject({ fileName: 'answer.csv', rowCount: 3 })
      expect(env.adapter.executeQuery).toHaveBeenCalledWith(
        expect.objectContaining({ sql: 'SELECT TOP (1048576) 42 AS [answer]' }),
        expect.any(String),
        expect.any(AbortSignal),
        expect.objectContaining({ maxRows: 1_048_575 }),
      )
      expect(await readFile(path, 'utf8')).toBe('﻿answer\r\n0\r\n1\r\n2\r\n')
      expect(env.entries.at(-1)).toMatchObject({
        status: 'success',
        rowCount: 3,
      })
      // A driver failure removes the partial file and keeps no output.
      vi.mocked(env.adapter.executeQuery).mockRejectedValueOnce(
        new Error('boom'),
      )
      await expect(
        env.service.exportQuery(
          {
            connectionId: profile.id,
            requestId: randomUUID(),
            approvalToken: env.review().token,
            format: 'xlsx',
          },
          async () => join(dir, 'failed.xlsx'),
        ),
      ).rejects.toThrow('boom')
      expect(await readdir(dir)).toEqual(['answer.csv'])
      expect(env.entries.at(-1)?.status).toBe('error')
      await env.service.dispose()
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})
