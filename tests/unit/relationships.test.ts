import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { defaultSettings, settingsSchema } from '@shared/contracts'
import {
  scopedRelationships,
  virtualRelationshipSchema,
  virtualRelationshipsSchema,
  type VirtualRelationship,
} from '@shared/relationships'
import {
  relationshipScope,
  boundedRelationships,
} from '@main/mcp/relationships'
import { MetadataCache, type MetadataScope } from '@main/mcp/metadata'
import { ToolSession } from '@main/mcp/session'

const relation = (): VirtualRelationship => ({
  id: randomUUID(),
  connectionId: randomUUID(),
  database: 'test',
  name: '부가서비스 밴',
  aliases: ['VAN'],
  description: '고객별 밴 서비스 연결',
  source: { schema: 'dbo', table: 'customers' },
  target: { schema: 'dbo', table: 'services' },
  columns: [{ source: 'id', target: 'customerId' }],
  joinType: 'LEFT',
  cardinality: 'one-to-many',
})
function fixture() {
  const r = relation()
  let saved = [r]
  let connected = true
  const base: MetadataScope = {
    key: 'generation',
    connectionId: r.connectionId,
    database: r.database,
    maxRows: 10,
    assertCurrent() {
      if (!connected) throw new Error('Disconnected')
    },
    tables: vi.fn(async () => [
      { schema: 'dbo', name: 'customers' },
      { schema: 'dbo', name: 'services' },
    ]),
    describe: vi.fn(async (_schema: string, table: string) => ({
      columns: (table === 'customers' ? ['id'] : ['customerId']).map(
        (name) => ({
          name,
          type: 'int',
          nullable: false,
          primaryKey: false,
          ordinal: 1,
        }),
      ),
      indexes: [],
      foreignKeys: [],
    })),
  }
  const scope = relationshipScope(base, () => saved)
  const proposals = vi.fn()
  const session = new ToolSession(
    scope,
    new MetadataCache(),
    new AbortController().signal,
    proposals,
  )
  const call = async (name: string, args = {}) => {
    const result = await session.call(name, args)
    return {
      error: result.isError,
      data: JSON.parse(
        result.content[0]!.text.startsWith('{')
          ? result.content[0]!.text
          : '{}',
      ),
    }
  }
  return {
    r,
    base,
    scope,
    call,
    proposals,
    set: (values: VirtualRelationship[]) => {
      saved = values
    },
    disconnect: () => {
      connected = false
    },
  }
}
describe('local virtual relationships', () => {
  it('defaults old settings and round-trips bounded composite-key definitions', () => {
    expect(defaultSettings().virtualRelationships).toEqual([])
    expect(
      virtualRelationshipSchema.parse({
        ...relation(),
        source: { schema: 'dbo', table: ' special name ' },
      }).source.table,
    ).toBe(' special name ')
    const r = relation()
    r.columns.push({ source: 'region', target: 'region' })
    expect(
      settingsSchema.parse({ virtualRelationships: [r] }).virtualRelationships,
    ).toEqual([r])
    expect(
      virtualRelationshipSchema.safeParse({ ...r, sql: 'DROP TABLE x' })
        .success,
    ).toBe(false)
    expect(
      virtualRelationshipSchema.safeParse({
        ...r,
        columns: [r.columns[0], r.columns[0]],
      }).success,
    ).toBe(false)
    expect(
      virtualRelationshipSchema.safeParse({ ...r, columns: [] }).success,
    ).toBe(false)
  })
  it('limits scope size and rejects duplicate IDs', () => {
    const r = relation()
    expect(virtualRelationshipsSchema.safeParse([r, r]).success).toBe(false)
    expect(
      virtualRelationshipsSchema.safeParse(
        Array.from({ length: 21 }, () => ({ ...r, id: randomUUID() })),
      ).success,
    ).toBe(false)
    expect(
      virtualRelationshipsSchema.safeParse(
        Array.from({ length: 101 }, () => ({
          ...r,
          id: randomUUID(),
          connectionId: randomUUID(),
        })),
      ).success,
    ).toBe(false)
  })
  it('isolates connection and database; unrelated settings do not change the scope', () => {
    const { r, base, scope, set } = fixture()
    const other = { ...r, id: randomUUID(), database: 'other' }
    expect(
      scopedRelationships(
        [r, other, { ...r, connectionId: randomUUID() }],
        r.connectionId,
        r.database,
      ),
    ).toEqual([r])
    set([r, other])
    expect(() => scope.assertCurrent()).not.toThrow()
    expect(relationshipScope(base, () => [r, other]).key).toBe(scope.key)
    set([{ ...r, joinType: 'INNER' }])
    expect(() => scope.assertCurrent()).toThrow('changed')
    expect(
      relationshipScope(base, () => [{ ...r, joinType: 'INNER' }]).key,
    ).not.toBe(scope.key)
  })
  it('discovers business names and keeps virtual hints separate from physical FK constraints', async () => {
    const { call, base } = fixture()
    const list = await call('db_list_tables')
    expect(list.error).toBeUndefined()
    expect(list.data.virtualRelationships[0]).toMatchObject({
      name: '부가서비스 밴',
      aliases: ['VAN'],
    })
    expect(base.describe).not.toHaveBeenCalled()
    for (const table of ['customers', 'services']) {
      const fk = await call('db_get_foreign_keys', { schema: 'dbo', table })
      expect(fk.error).toBeUndefined()
      expect(fk.data.foreignKeys).toEqual([])
      expect(fk.data.virtualRelationships[0]).toMatchObject({
        status: 'columns-present',
        joinType: 'LEFT',
        cardinality: 'one-to-many',
      })
    }
    expect(base.describe).toHaveBeenCalledTimes(2)
  })
  it('marks removed columns and unavailable tables invalid, never asserting enforced uniqueness', async () => {
    const f = fixture()
    vi.mocked(f.base.describe).mockResolvedValue({
      columns: [],
      foreignKeys: [],
      indexes: [],
    })
    expect(
      (
        await f.call('db_get_foreign_keys', {
          schema: 'dbo',
          table: 'customers',
        })
      ).data.virtualRelationships[0].status,
    ).toBe('invalid')
    const g = fixture()
    vi.mocked(g.base.tables).mockResolvedValue([
      { schema: 'dbo', name: 'customers' },
    ])
    expect(
      (
        await g.call('db_get_foreign_keys', {
          schema: 'dbo',
          table: 'customers',
        })
      ).data.virtualRelationships[0].status,
    ).toBe('invalid')
  })
  it('revokes cached access and proposals after relationship edits or disconnect', async () => {
    const f = fixture()
    await f.call('db_list_tables')
    f.set([])
    expect((await f.call('db_list_tables')).error).toBe(true)
    expect(
      (
        await f.call('db_propose_sql', {
          sql: 'SELECT id FROM dbo.customers',
          explanation: 'test',
        })
      ).error,
    ).toBe(true)
    expect(f.proposals).not.toHaveBeenCalled()
    const g = fixture()
    g.disconnect()
    expect(
      (
        await g.call('db_get_foreign_keys', {
          schema: 'dbo',
          table: 'customers',
        })
      ).error,
    ).toBe(true)
  })
  it('bounds large UTF-8 hint output and explicitly indicates truncation', () => {
    const result = boundedRelationships(
      Array.from({ length: 20 }, () => ({
        ...relation(),
        description: '가'.repeat(500),
      })),
    )
    expect(result.virtualRelationships.length).toBeGreaterThan(0)
    expect(result.virtualRelationshipsTruncated).toBe(true)
    expect(
      Buffer.byteLength(JSON.stringify(result.virtualRelationships)),
    ).toBeLessThanOrEqual(12000)
  })
})
