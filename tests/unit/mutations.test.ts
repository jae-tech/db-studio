import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { connectionSchema, type HistoryEntry } from '@shared/database'
import { parseMutation, parseReadQuery } from '@main/database/policy'
import { DatabaseService } from '@main/database/service'
import { MutationService } from '@main/database/mutations'
import type { DatabaseAdapter } from '@main/database/DatabaseAdapter'
import type { DatabaseRepositoryPort } from '@main/database/repository'
import type { MutationSnapshot } from '@main/database/MutationAdapter'

describe('positive mutation grammar, independent of read-only SELECT policy', () => {
  it.each([
    "UPDATE dbo.items SET amount=N'it''s safe', other=-2 WHERE id=1 AND amount IS NOT NULL;",
    'DELETE FROM [dbo].[items] WHERE (id IN (1,2) OR id>=10) AND NOT (amount IS NULL)',
  ])('normalizes a single restricted statement: %s', (source) => {
    const parsed = parseMutation(source)
    expect(parsed.sql).toContain('WHERE')
    expect(parsed.table).toEqual({ schema: 'dbo', table: 'items' })
    expect(parseMutation(parsed.sql)).toEqual(parsed)
    expect(() => parseReadQuery(source, 10)).toThrow()
  })
  it.each([
    'UPDATE dbo.items SET amount=1',
    'DELETE FROM dbo.items',
    'DROP TABLE dbo.items',
    'TRUNCATE TABLE dbo.items',
    'UPDATE dbo.items SET amount=1 WHERE 1=1',
    'DELETE FROM dbo.items WHERE id=id',
    'UPDATE dbo.items SET amount=GETDATE() WHERE id=1',
    'UPDATE dbo.items SET amount=amount+1 WHERE id=1',
    'UPDATE dbo.items SET amount=1, AMOUNT=2 WHERE id=1',
    'UPDATE dbo.items SET amount=1 WHERE id=1; DELETE FROM dbo.items WHERE id=2',
    'DELETE FROM otherdb.dbo.items WHERE id=1',
    'DELETE t FROM dbo.items AS t WHERE id=1',
    'UPDATE dbo.items WITH(NOLOCK) SET amount=1 WHERE id=1',
    'UPDATE dbo.items SET amount=1 OUTPUT inserted.* WHERE id=1',
    'DELETE FROM dbo.items WHERE id IN (SELECT id FROM dbo.other)',
    'DELETE FROM dbo.items WHERE GETDATE()>1',
    'INSERT INTO dbo.items(id) VALUES(1)',
    'MERGE dbo.items USING dbo.other ON 1=1 WHEN MATCHED THEN DELETE',
    "EXEC sp_executesql N'DELETE FROM dbo.items'",
    'BEGIN TRAN; DELETE FROM dbo.items WHERE id=1',
    'UPDATE dbo.items SET amount=DEFAULT WHERE id=1',
    'DELETE FROM dbo.items WHERE dbo.fn(id)=1',
    "UPDATE dbo.items SET amount='x\0y' WHERE id=1",
  ])('refuses unsafe/ambiguous/unsupported SQL: %s', (source) =>
    expect(() => parseMutation(source)).toThrow(),
  )
  it('warns and blocks missing WHERE, while retaining safe comments/literals', () => {
    expect(() =>
      parseMutation('UPDATE dbo.items SET amount=2 /* WHERE id=1 */'),
    ).toThrow('WHERE is required')
    expect(
      parseMutation(
        "UPDATE dbo.items SET amount=N'DROP; TRUNCATE --' WHERE id=1",
      ).sql,
    ).toContain("N'DROP; TRUNCATE --'")
  })
})

const fixtures: { service: MutationService; database: DatabaseService }[] = []
async function setup(overrides: Record<string, unknown> = {}) {
  const profile = connectionSchema.parse({
    id: randomUUID(),
    name: 'write fixture',
    host: 'localhost',
    database: 'fixture',
    username: 'writer',
    readOnly: false,
    timeoutSeconds: 1,
    ...overrides,
  })
  let connected = false
  let now = Date.now()
  const history: HistoryEntry[] = []
  const snapshot: MutationSnapshot = {
    versions: ['0x0000000000000001'],
    count: 1,
    rowsDigest: '',
    metadataHash: 'a'.repeat(64),
    executionSql:
      'UPDATE [dbo].[items] SET [value] = 2\nOUTPUT deleted.[rv]\nWHERE ([id] = 1) AND [rv] IN (0x0000000000000001)',
    sample: {
      requestId: randomUUID(),
      columns: [{ key: 'c0', name: 'id', type: 'int' }],
      rows: [{ c0: 1 }],
      rowCount: 1,
      durationMs: 0,
      truncated: false,
    },
  }
  const adapter: DatabaseAdapter = {
    isConnected: () => connected,
    connect: vi.fn(async () => {
      connected = true
      return { permissionVerified: true }
    }),
    disconnect: vi.fn(async () => {
      connected = false
    }),
    listDatabases: vi.fn(async () => ['fixture']),
    listSchemas: vi.fn(async () => ['dbo']),
    listTables: vi.fn(async () => [{ schema: 'dbo', name: 'items' }]),
    getColumns: vi.fn(async () => []),
    getIndexes: vi.fn(async () => []),
    getForeignKeys: vi.fn(async () => []),
    executeQuery: vi.fn(async () => snapshot.sample),
    cancelQuery: vi.fn(() => true),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    mutations: {
      preview: vi.fn(async () => structuredClone(snapshot)),
      apply: vi.fn(async () => 1),
      inspect: vi.fn(async () => ({
        kind: 'update' as const,
        target: 'dbo.items',
        affectedRows: 1,
        sample: snapshot.sample,
      })),
      checkTarget: vi.fn(async () => {}),
    },
  }
  const repository: DatabaseRepositoryPort = {
    list: () => [{ profile, hasPassword: true }],
    load: async () => ({
      profile,
      password: 'fixture-only-not-a-live-password',
    }),
    save: async () => {},
    delete: () => {},
    history: () => history,
    addHistory: (entry) => history.push(entry),
  }
  const database = new DatabaseService(
    repository,
    () => adapter,
    () => now,
  )
  await database.connect({ connectionId: profile.id })
  const recordHistory = vi.fn((entry: HistoryEntry) => {
    history.push(entry)
  })
  const service = new MutationService(database, recordHistory, () => now)
  const preview = () =>
    service.preview({
      connectionId: profile.id,
      sql: 'UPDATE dbo.items SET amount=2 WHERE id=1',
    })
  const f = {
    profile,
    adapter,
    database,
    service,
    history,
    snapshot,
    preview,
    recordHistory,
    advance: (ms: number) => {
      now += ms
    },
  }
  fixtures.push(f)
  return f
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.service.dispose()
    await fixture.database.dispose()
  }
  vi.useRealTimers()
})
describe('Main-owned approval and transaction lifecycle (explicit DB/driver doubles)', () => {
  it('keeps writes opt-in in every environment (ADR-031)', async () => {
    expect(
      connectionSchema.safeParse({
        id: randomUUID(),
        name: 'x',
        host: 'h',
        database: 'd',
        username: 'u',
      }).data?.readOnly,
    ).toBe(true)
    const f = await setup({ readOnly: true })
    await expect(f.preview()).rejects.toThrow('Writes are disabled')
    expect(f.adapter.mutations!.preview).not.toHaveBeenCalled()
    // Production follows the same explicit opt-in; the DB login's roles decide the rest.
    const production = await setup({
      environment: 'production',
      readOnly: true,
    })
    await expect(production.preview()).rejects.toThrow('Writes are disabled')
    const writable = await setup({ environment: 'production', readOnly: false })
    expect((await writable.preview()).stage).toBe('preview')
  })
  it('previews without writing and binds one-use apply + separate COMMIT', async () => {
    const f = await setup()
    const preview = await f.preview()
    expect(preview.stage).toBe('preview')
    expect(preview.approvalHash).toMatch(/^[a-f0-9]{64}$/)
    expect(preview.commitToken).toBeUndefined()
    expect(f.adapter.beginTransaction).not.toHaveBeenCalled()
    expect(f.adapter.mutations!.apply).not.toHaveBeenCalled()
    await expect(
      f.service.apply({ id: preview.id, approvalHash: '0'.repeat(64) }),
    ).rejects.toThrow('hash')
    await expect(
      f.service.apply({
        id: preview.id,
        approvalHash: preview.approvalHash,
        sql: 'DELETE FROM dbo.items',
      }),
    ).rejects.toThrow()
    const applied = await f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    expect(applied.stage).toBe('applied')
    expect(f.adapter.beginTransaction).toHaveBeenCalledWith('serializable')
    expect(f.adapter.commit).not.toHaveBeenCalled()
    expect(() =>
      f.database.reviewQuery({ connectionId: f.profile.id, sql: 'SELECT 1' }),
    ).toThrow('progress')
    expect(() => f.database.metadataScope(f.profile.id)).toThrow()
    await expect(
      f.service.apply({ id: preview.id, approvalHash: preview.approvalHash }),
    ).rejects.toThrow()
    await expect(
      f.service.commit({
        id: applied.id,
        approvalHash: applied.approvalHash,
        commitToken: applied.commitToken!,
        databaseConfirmation: 'wrong',
      }),
    ).rejects.toThrow('confirmation')
    const committed = await f.service.commit({
      id: applied.id,
      approvalHash: applied.approvalHash,
      commitToken: applied.commitToken!,
      databaseConfirmation: 'fixture',
    })
    expect(committed.stage).toBe('committed')
    expect(committed.commitToken).toBeUndefined()
    expect(f.adapter.commit).toHaveBeenCalledTimes(1)
    expect(f.database.listConnections()[0]?.status).toBe('disconnected')
    expect(f.history[0]?.status).toBe('committed')
    await expect(
      f.service.commit({
        id: applied.id,
        approvalHash: applied.approvalHash,
        commitToken: applied.commitToken!,
        databaseConfirmation: 'fixture',
      }),
    ).rejects.toThrow('consumed')
  })
  it.each(['versions', 'metadataHash', 'executionSql'] as const)(
    'rolls back instead of applying a changed %s',
    async (field) => {
      const f = await setup()
      const preview = await f.preview()
      vi.mocked(f.adapter.mutations!.preview).mockResolvedValueOnce({
        ...f.snapshot,
        [field]: field === 'versions' ? ['0x0000000000000002'] : 'changed',
      })
      expect(
        (
          await f.service.apply({
            id: preview.id,
            approvalHash: preview.approvalHash,
          })
        ).stage,
      ).toBe('rolled-back')
      expect(f.adapter.mutations!.apply).not.toHaveBeenCalled()
      expect(f.adapter.rollback).toHaveBeenCalledTimes(1)
      expect(f.adapter.commit).not.toHaveBeenCalled()
    },
  )
  it('invalidates approval after reconnect and refuses empty/oversized driver snapshots', async () => {
    const f = await setup()
    const preview = await f.preview()
    await f.database.disconnect(f.profile.id)
    await f.database.connect({ connectionId: f.profile.id })
    expect(
      (
        await f.service.apply({
          id: preview.id,
          approvalHash: preview.approvalHash,
        })
      ).stage,
    ).toBe('error')
    expect(f.adapter.beginTransaction).not.toHaveBeenCalled()
    vi.mocked(f.adapter.mutations!.preview).mockResolvedValueOnce({
      ...f.snapshot,
      versions: [],
    })
    expect((await f.preview()).stage).toBe('error')
  })
  it('rolls back on DML errors, affected-count mismatch, explicit cancellation and shutdown', async () => {
    const f = await setup()
    let preview = await f.preview()
    vi.mocked(f.adapter.mutations!.apply).mockRejectedValueOnce(
      new Error('constraint error with private details'),
    )
    const failed = await f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    expect(failed.stage).toBe('rolled-back')
    expect(failed.message).not.toContain('private')
    await f.database.connect({ connectionId: f.profile.id })
    preview = await f.preview()
    vi.mocked(f.adapter.mutations!.apply).mockResolvedValueOnce(2)
    expect(
      (
        await f.service.apply({
          id: preview.id,
          approvalHash: preview.approvalHash,
        })
      ).stage,
    ).toBe('rolled-back')
    await f.database.connect({ connectionId: f.profile.id })
    preview = await f.preview()
    await f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    expect((await f.service.rollback({ id: preview.id })).stage).toBe(
      'rolled-back',
    )
    await f.database.connect({ connectionId: f.profile.id })
    preview = await f.preview()
    await f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    await f.service.dispose()
    expect((await f.service.state(f.profile.id))?.stage).toBe('rolled-back')
    expect(f.adapter.commit).not.toHaveBeenCalled()
  })
  it('expires preview without writes and automatically rolls back an uncommitted transaction', async () => {
    const f = await setup()
    await f.preview()
    f.advance(60001)
    expect((await f.service.state(f.profile.id))?.stage).toBe('cancelled')
    expect(f.adapter.beginTransaction).not.toHaveBeenCalled()
    const preview = await f.preview()
    await f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    f.advance(30001)
    expect((await f.service.state(f.profile.id))?.stage).toBe('rolled-back')
    expect(f.adapter.commit).not.toHaveBeenCalled()
  })
  it('rolls back on the real idle timer and blocks concurrent apply replay', async () => {
    vi.useFakeTimers()
    const f = await setup()
    const preview = await f.preview()
    const first = f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    await expect(
      f.service.apply({ id: preview.id, approvalHash: preview.approvalHash }),
    ).rejects.toThrow('state')
    await first
    await vi.advanceTimersByTimeAsync(30001)
    expect((await f.service.state(f.profile.id))?.stage).toBe('rolled-back')
    expect(f.adapter.mutations!.apply).toHaveBeenCalledTimes(1)
    expect(f.adapter.commit).not.toHaveBeenCalled()
  })
  it('cancels a driver request on the operation timeout and releases the connection', async () => {
    vi.useFakeTimers()
    const f = await setup()
    vi.mocked(f.adapter.mutations!.preview).mockImplementationOnce(
      async (_query, _id, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          ),
        ),
    )
    const pending = f.preview()
    await vi.advanceTimersByTimeAsync(1001)
    expect((await pending).stage).toBe('cancelled')
    expect(f.adapter.cancelQuery).toHaveBeenCalled()
    expect(f.database.listConnections()[0]?.status).toBe('connected')
  })
  it.each(['commit', 'rollback', 'beginTransaction'] as const)(
    'does not claim success or rollback when %s fails ambiguously',
    async (method) => {
      const f = await setup()
      const preview = await f.preview()
      if (method === 'beginTransaction') {
        vi.mocked(f.adapter.beginTransaction).mockRejectedValueOnce(
          new Error('lost ack'),
        )
        expect(
          (
            await f.service.apply({
              id: preview.id,
              approvalHash: preview.approvalHash,
            })
          ).stage,
        ).toBe('unknown')
      } else {
        const applied = await f.service.apply({
          id: preview.id,
          approvalHash: preview.approvalHash,
        })
        vi.mocked(f.adapter[method]).mockRejectedValueOnce(
          new Error('lost ack'),
        )
        const result =
          method === 'commit'
            ? await f.service.commit({
                id: applied.id,
                approvalHash: applied.approvalHash,
                commitToken: applied.commitToken!,
                databaseConfirmation: 'fixture',
              })
            : await f.service.rollback({ id: applied.id })
        expect(result.stage).toBe('unknown')
      }
      expect(f.history[0]?.status).toBe('unknown')
      expect(f.database.listConnections()[0]?.status).toBe('disconnected')
    },
  )
  it('keeps acknowledged COMMIT distinct from a local history save failure', async () => {
    const f = await setup()
    const preview = await f.preview()
    const applied = await f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    f.recordHistory.mockImplementationOnce(() => {
      throw new Error('sqlite unavailable')
    })
    const result = await f.service.commit({
      id: applied.id,
      approvalHash: applied.approvalHash,
      commitToken: applied.commitToken!,
      databaseConfirmation: 'fixture',
    })
    expect(result.stage).toBe('committed')
    expect(result.message).toContain('history could not be saved')
    expect(f.adapter.rollback).not.toHaveBeenCalled()
  })
  it('does not race a submitted COMMIT with rollback/disconnect', async () => {
    const f = await setup()
    const preview = await f.preview()
    const applied = await f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    let acknowledge!: () => void
    vi.mocked(f.adapter.commit).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve
        }),
    )
    const commit = f.service.commit({
      id: applied.id,
      approvalHash: applied.approvalHash,
      commitToken: applied.commitToken!,
      databaseConfirmation: 'fixture',
    })
    await expect(f.service.rollback({ id: applied.id })).rejects.toThrow(
      'cannot be cancelled',
    )
    const disconnect = f.service.abortConnection(f.profile.id)
    expect(f.adapter.rollback).not.toHaveBeenCalled()
    acknowledge()
    expect((await commit).stage).toBe('committed')
    await disconnect
  })
  it('cannot commit after rollback has been requested, even before the rollback promise settles', async () => {
    const f = await setup()
    const preview = await f.preview()
    const applied = await f.service.apply({
      id: preview.id,
      approvalHash: preview.approvalHash,
    })
    const rollback = f.service.rollback({ id: applied.id })
    await expect(
      f.service.commit({
        id: applied.id,
        approvalHash: applied.approvalHash,
        commitToken: applied.commitToken!,
        databaseConfirmation: 'fixture',
      }),
    ).rejects.toThrow()
    expect((await rollback).stage).toBe('rolled-back')
    expect(f.adapter.commit).not.toHaveBeenCalled()
  })
  it('refuses write leases while an explorer metadata request is still in flight', async () => {
    const f = await setup()
    let finish!: (rows: string[]) => void
    vi.mocked(f.adapter.listDatabases).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const explorer = f.database.getExplorer(f.profile.id)
    await expect(f.preview()).rejects.toThrow('Wait for the current query')
    expect(f.adapter.beginTransaction).not.toHaveBeenCalled()
    finish(['fixture'])
    await explorer
    expect((await f.preview()).stage).toBe('preview')
  })
})
