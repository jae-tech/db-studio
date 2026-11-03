import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ImportRegistry, type ImportData } from '@main/database/ImportAdapter'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import { parseMutation, parseReadQuery } from '@main/database/policy'

const data = (): ImportData => {
  const id = randomUUID()
  return {
    id,
    tableName: `stage_${id.replaceAll('-', '')}`,
    columns: ['사업자번호', '상태'],
    rows: [
      ['0012345678', '정상'],
      [null, ''],
    ],
  }
}

describe('generic immutable Excel registry', () => {
  it('clones both source and returned rows and preserves null, empty and leading zeros', () => {
    const registry = new ImportRegistry()
    const table = data()
    registry.register(table)
    table.rows[0]![0] = 'mutated'
    const listed = registry.list()
    expect(listed[0]?.rows).toEqual([
      ['0012345678', '정상'],
      [null, ''],
    ])
    listed[0]!.rows[0]![0] = 'also mutated'
    expect(registry.list()[0]?.rows[0]?.[0]).toBe('0012345678')
    registry.unregister(table.id)
    expect(registry.list()).toEqual([])
  })
  it('allows an identical registration but refuses replacement and duplicate names', () => {
    const registry = new ImportRegistry()
    const table = data()
    registry.register(table)
    registry.register(structuredClone(table))
    expect(() =>
      registry.register({ ...table, rows: [['changed', '']] }),
    ).toThrow(/변경/)
    expect(() => registry.register({ ...table, id: randomUUID() })).toThrow(
      /중복/,
    )
  })
  it.each([
    (table: ImportData) => {
      table.columns = ['ID', 'id']
    },
    (table: ImportData) => {
      table.columns = ['ID', 'id ']
    },
    (table: ImportData) => {
      table.columns[0] = ' '
    },
    (table: ImportData) => {
      table.columns[0] = 'x\0y'
    },
    (table: ImportData) => {
      table.columns[0] = 'x'.repeat(129)
    },
    (table: ImportData) => {
      table.tableName = '#unowned'
    },
    (table: ImportData) => {
      table.id = 'untrusted'
    },
    (table: ImportData) => {
      table.rows = [['ragged']]
    },
    (table: ImportData) => {
      table.rows = [['x'.repeat(8193), '']]
    },
    (table: ImportData) => {
      table.rows = Array.from({ length: 50_001 }, () => ['', ''])
    },
  ])('rejects malformed or oversized input', (invalidate) => {
    const registry = new ImportRegistry()
    const table = data()
    invalidate(table)
    expect(() => registry.register(table)).toThrow()
    expect(registry.list()).toEqual([])
  })
  it('bounds aggregate table count and bytes without partial registration', () => {
    const registry = new ImportRegistry()
    for (let i = 0; i < 8; i++) registry.register(data())
    expect(() => registry.register(data())).toThrow(/8개/)
    expect(registry.list()).toHaveLength(8)
    registry.clear()
    const table = data()
    table.rows = Array.from({ length: 4100 }, () => [
      'x'.repeat(8192),
      'y'.repeat(8192),
    ])
    expect(() => registry.register(table)).toThrow(/64 MiB/)
    expect(registry.list()).toEqual([])
  })
  it('blocks registration and removal when the owning adapter is busy', () => {
    let busy = false
    const registry = new ImportRegistry(() => {
      if (busy) throw new Error('busy')
    })
    const table = data()
    registry.register(table)
    busy = true
    expect(() => registry.unregister(table.id)).toThrow('busy')
    expect(() => registry.register(data())).toThrow('busy')
    expect(registry.list()).toHaveLength(1)
  })
  it('exposes column metadata, never cell values, and rejects foreign logical tables', async () => {
    const adapter = new MssqlAdapter()
    const table = data()
    adapter.imports.register(table)
    const columns = await adapter.getColumns('import', table.tableName)
    expect(columns).toEqual(
      table.columns.map((name, index) => ({
        name,
        type: 'nvarchar(max)',
        nullable: true,
        primaryKey: false,
        ordinal: index + 1,
      })),
    )
    expect(JSON.stringify(columns)).not.toContain('0012345678')
    expect(await adapter.getIndexes('import', table.tableName)).toEqual([])
    expect(await adapter.getForeignKeys('import', table.tableName)).toEqual([])
    await expect(
      adapter.getColumns('import', `stage_${'f'.repeat(32)}`),
    ).rejects.toThrow(/등록되지/)
    await adapter.disconnect()
    expect(adapter.imports.list()).toEqual([])
  })
  it('preserves real tables in an import schema and reserves only generated stage names', async () => {
    const adapter = new MssqlAdapter()
    const table = data()
    adapter.imports.register(table)
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ name: 'dbo' }, { name: 'IMPORT' }])
      .mockResolvedValueOnce([
        { schema: 'dbo', name: 'items' },
        { schema: 'import', name: 'customers' },
        { schema: 'IMPORT', name: `stage_${'f'.repeat(32)}` },
        { schema: 'import', name: 'stage_unowned' },
      ])
      .mockResolvedValueOnce([
        {
          name: 'id',
          type: 'int',
          nullable: false,
          primaryKey: true,
          ordinal: 1,
        },
      ])
    Object.assign(adapter, { query })
    expect(await adapter.listSchemas()).toEqual(['dbo', 'IMPORT'])
    expect(await adapter.listTables()).toEqual([
      { schema: 'dbo', name: 'items' },
      { schema: 'import', name: 'customers' },
      { schema: 'import', name: 'stage_unowned' },
      { schema: 'import', name: table.tableName },
    ])
    expect(await adapter.getColumns('import', 'customers')).toEqual([
      {
        name: 'id',
        type: 'int',
        nullable: false,
        primaryKey: true,
        ordinal: 1,
      },
    ])
    expect(query.mock.calls[2]?.slice(1)).toEqual(['import', 'customers'])
    query.mockResolvedValueOnce([{ name: 'dbo' }])
    expect(await adapter.listSchemas()).toEqual(['dbo', 'import'])
  })
  it('runs normal table validation for non-stage import tables and refuses unknown generated names first', async () => {
    const adapter = new MssqlAdapter()
    const validate = vi.fn().mockResolvedValue([{ count: 1 }])
    const request = vi.fn().mockReturnValue({})
    const result = {
      requestId: randomUUID(),
      columns: [],
      rows: [],
      durationMs: 1,
      truncated: false,
      rowCount: 0,
    }
    const streamQuery = vi.fn().mockResolvedValue(result)
    Object.assign(adapter, {
      profile: { environment: 'development' },
      query: validate,
      request,
      streamQuery,
    })
    const query = parseReadQuery('SELECT * FROM import.customers', 10)
    expect(
      await adapter.executeQuery(
        query,
        result.requestId,
        new AbortController().signal,
      ),
    ).toEqual(result)
    expect(validate.mock.calls[0]?.slice(1)).toEqual(['import', 'customers'])
    expect(streamQuery).toHaveBeenCalledOnce()
    await expect(
      adapter.executeQuery(
        parseReadQuery(`SELECT * FROM import.stage_${'f'.repeat(32)}`, 10),
        randomUUID(),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/등록되지/)
    expect(validate).toHaveBeenCalledOnce()
    expect(streamQuery).toHaveBeenCalledOnce()
  })
})

describe('Main-only table name resolution', () => {
  it('resolves only parsed table positions, preserving literals, columns and joins', () => {
    const source =
      "SELECT x.id, N'[import].[stage_a]' AS literal FROM [import].[stage_a] AS x LEFT JOIN dbo.people AS p ON x.id = p.id WHERE x.note = N'[import].[stage_a]'"
    const original = parseReadQuery(source, 100)
    const resolved = parseReadQuery(source, 100, (table) =>
      table.schema === 'import' ? { table: '#stage_a' } : undefined,
    )
    expect(resolved.sql).toContain('FROM [#stage_a] AS [x]')
    expect(resolved.sql).toContain('LEFT JOIN [dbo].[people] AS [p]')
    expect(resolved.sql).toContain("N'[import].[stage_a]' AS [literal]")
    expect(resolved.sql).toContain("[x].[note] = N'[import].[stage_a]'")
    expect(resolved.tables).toEqual(original.tables)
  })
  it('retains an implicit logical table qualifier as an explicit alias', () => {
    const resolved = parseReadQuery(
      'SELECT stage_a.id FROM import.stage_a',
      10,
      () => ({ table: '#stage_a' }),
    )
    expect(resolved.sql).toContain('SELECT TOP (11) [stage_a].[id]')
    expect(resolved.sql).toContain('FROM [#stage_a] AS [stage_a]')
  })
  it('quotes resolver output as identifiers instead of accepting raw SQL', () => {
    const resolved = parseReadQuery('SELECT * FROM import.stage_a', 10, () => ({
      table: '#x]; DROP TABLE dbo.people;--',
    }))
    expect(resolved.sql).toContain(
      '[#x]]; DROP TABLE dbo.people;--] AS [stage_a]',
    )
    expect(() =>
      parseReadQuery('DELETE FROM import.stage_a', 10, () => ({
        table: '#stage_a',
      })),
    ).toThrow()
  })
})

describe('restricted TRY_CONVERT for text Excel columns', () => {
  it.each([
    [
      'SUM(TRY_CONVERT(decimal(19,4), x.amount))',
      'SUM(TRY_CONVERT(DECIMAL(19, 4), [x].[amount]))',
    ],
    [
      'TRY_CONVERT(numeric(38,0), x.amount)',
      'TRY_CONVERT(NUMERIC(38, 0), [x].[amount])',
    ],
    ['TRY_CONVERT(int, x.amount)', 'TRY_CONVERT(INT, [x].[amount])'],
    ['TRY_CONVERT(bigint, x.amount)', 'TRY_CONVERT(BIGINT, [x].[amount])'],
    [
      'TRY_CONVERT(date, x.start_date, 23)',
      'TRY_CONVERT(DATE, [x].[start_date], 23)',
    ],
    [
      'TRY_CONVERT(date, x.start_date, 112)',
      'TRY_CONVERT(DATE, [x].[start_date], 112)',
    ],
    [
      'TRY_CONVERT(date, x.start_date, 126)',
      'TRY_CONVERT(DATE, [x].[start_date], 126)',
    ],
    [
      "TRY_CONVERT(decimal(1,1), NULLIF(x.amount, N''))",
      "TRY_CONVERT(DECIMAL(1, 1), NULLIF([x].[amount], N''))",
    ],
  ])('normalizes a validated conversion: %s', (expression, expected) => {
    const query = parseReadQuery(
      `SELECT ${expression} AS result FROM import.stage_a AS x`,
      100,
    )
    expect(query.sql).toContain(expected)
    expect(parseReadQuery(query.sql, 100).sql).toBe(query.sql)
  })
  it('supports conversions in predicates and groups with the existing table resolver', () => {
    const query = parseReadQuery(
      'SELECT TRY_CONVERT(date,x.day,23), SUM(TRY_CONVERT(decimal(19,4),x.amount)) FROM import.stage_a AS x WHERE TRY_CONVERT(int,x.amount) IS NOT NULL GROUP BY TRY_CONVERT(date,x.day,23) HAVING SUM(TRY_CONVERT(decimal(19,4),x.amount)) > 0',
      100,
      () => ({ table: '#stage_a' }),
    )
    expect(query.sql).toContain('FROM [#stage_a] AS [x]')
    expect(query.sql).toContain(
      'WHERE (TRY_CONVERT(INT, [x].[amount]) IS NOT NULL)',
    )
    expect(query.sql).toContain('GROUP BY TRY_CONVERT(DATE, [x].[day], 23)')
  })
  it.each([
    'TRY_CONVERT(xml, x.amount)',
    'TRY_CONVERT(float, x.amount)',
    'TRY_CONVERT(sql_variant, x.amount)',
    'TRY_CONVERT(dbo.mytype, x.amount)',
    'TRY_CONVERT([int], x.amount)',
    'TRY_CONVERT(decimal, x.amount)',
    'TRY_CONVERT(decimal(19), x.amount)',
    'TRY_CONVERT(decimal(0,0), x.amount)',
    'TRY_CONVERT(decimal(39,0), x.amount)',
    'TRY_CONVERT(decimal(19,20), x.amount)',
    'TRY_CONVERT(decimal(19,-1), x.amount)',
    'TRY_CONVERT(decimal(19.0,4), x.amount)',
    'TRY_CONVERT(decimal(19,1+1), x.amount)',
    'TRY_CONVERT(int(10), x.amount)',
    'TRY_CONVERT(date, x.day, 1)',
    'TRY_CONVERT(date, x.day, 101)',
    "TRY_CONVERT(date, x.day, N'23')",
    'TRY_CONVERT(date, x.day, 23.0)',
    'TRY_CONVERT(date, x.day, x.style)',
    'TRY_CONVERT(date, x.day, 23, 112)',
    'TRY_CONVERT(int, (SELECT 1))',
    'dbo.TRY_CONVERT(int,x.amount)',
    'TRY_CONVERT(int, dbo.fn(x.amount))',
    'TRY_CONVERT(int, x.amount COLLATE database_default)',
  ])('refuses unsupported or injected conversion: %s', (expression) => {
    expect(() =>
      parseReadQuery(`SELECT ${expression} FROM import.stage_a AS x`, 100),
    ).toThrow()
  })
  it.each([
    'UPDATE dbo.people SET amount=TRY_CONVERT(int,1) WHERE id=1',
    'UPDATE dbo.people SET amount=1 WHERE id=TRY_CONVERT(int,1)',
    'DELETE FROM dbo.people WHERE TRY_CONVERT(int,id)=1',
  ])('does not broaden restricted mutation expressions: %s', (sql) => {
    expect(() => parseMutation(sql)).toThrow()
  })
})
