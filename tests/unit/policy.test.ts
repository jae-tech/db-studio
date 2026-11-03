import { describe, expect, it } from 'vitest'
import { parseMutation, parseReadQuery } from '@main/database/policy'
import { connectionSchema } from '@shared/database'
import { assessPermissions, serializeCell } from '@main/database/mssql/dialect'

describe('restricted T-SQL parser', () => {
  it('normalizes parsed expressions and local tables with a server-side row bound', () => {
    const parsed = parseReadQuery(
      `SELECT TOP (99) a.id AS key_id, COUNT(*) AS total FROM dbo.items AS a LEFT JOIN dbo.tags AS b ON a.id = b.item_id WHERE a.name LIKE N'admin%' AND b.id IS NOT NULL GROUP BY a.id HAVING COUNT(*) > 0 ORDER BY total DESC;`,
      20,
    )
    expect(parsed.sql).toContain('TOP (21)')
    expect(parsed.sql).toContain('[dbo].[items] AS [a]')
    expect(parsed.tables).toEqual([
      { schema: 'dbo', table: 'items', alias: 'a' },
      { schema: 'dbo', table: 'tags', alias: 'b' },
    ])
    expect(
      parseReadQuery(
        `SELECT N'it''s; DROP TABLE dbo.x' AS [sql]; -- comment`,
        100,
      ).sql,
    ).toContain("N'it''s; DROP TABLE dbo.x'")
  })
  it.each([
    'SELECT 1 AS value',
    'SELECT [delete] FROM [dbo].[update]',
    '/* outer /* inner */ done */ SELECT 2 + 3 * 4 AS value',
    'SELECT DISTINCT name FROM dbo.people WHERE id IN (1, 2, 3) ORDER BY name',
    'SELECT UPPER(name), ISNULL(score, 0) FROM dbo.people WHERE NOT score = 0',
  ])('accepts known read grammar: %s', (query) =>
    expect(parseReadQuery(query, 10).kind).toBe('select'),
  )
  it.each([
    'DELETE FROM dbo.people',
    'UPDATE dbo.people SET name = 1',
    'DROP TABLE dbo.people',
    'TRUNCATE TABLE dbo.people',
    'SELECT 1; DELETE FROM dbo.people',
    'SELECT 1;;',
    'SELECT 1 INTO dbo.copy',
    'SELECT * INTO #temp FROM dbo.people',
    'EXEC sp_help',
    'SELECT dbo.user_function()',
    'SELECT [dbo].[fn]()',
    'SELECT * FROM OPENROWSET(1)',
    'SELECT * FROM OPENQUERY(server, 1)',
    'SELECT NEXT VALUE FOR dbo.seq',
    'SELECT @x = 1',
    'SELECT @@version',
    'WITH x AS (SELECT 1 AS n) SELECT * FROM x',
    'SELECT (SELECT 1)',
    'SELECT * FROM other.dbo.people',
    'SELECT * FROM dbo.people WITH (UPDLOCK)',
    'SELECT * FROM dbo.people FOR XML AUTO',
    'SELECT * FROM dbo.people OPTION (RECOMPILE)',
    'SELECT 1 UNION SELECT 2',
    'SELECT 1 --x\nDROP TABLE dbo.people',
    'SELECT 1 /* unclosed',
    "SELECT 'unclosed",
    'SELECT [unclosed',
    'SELECT [escaped]]identifier;DROP TABLE x] FROM dbo.people; EXEC x',
    'SELECT * FROM dbo.people CROSS APPLY dbo.fn()',
    'SELECT * FROM #temp',
    'SELECT * FROM dbo.people WHERE id IN (SELECT id FROM dbo.people)',
  ])('fails closed: %s', (query) =>
    expect(() => parseReadQuery(query, 100)).toThrow(),
  )
  it('bounds complexity and input size', () => {
    expect(() =>
      parseReadQuery('SELECT ' + '('.repeat(60) + '1' + ')'.repeat(60), 10),
    ).toThrow()
    expect(() => parseReadQuery(' '.repeat(200001), 10)).toThrow()
    expect(() => parseReadQuery('SELECT 1', 0)).toThrow()
  })
})
describe('least-privilege policy and wire encoding', () => {
  it('requires effective CONNECT and rejects write/admin/EXECUTE permissions', () => {
    const read = [
      { scope: 'DATABASE', permission_name: 'CONNECT' },
      { scope: 'OBJECT', permission_name: 'SELECT' },
    ]
    expect(assessPermissions(read)).toBe(true)
    expect(
      assessPermissions([
        ...read,
        {
          scope: 'DATABASE',
          permission_name: 'VIEW ANY COLUMN ENCRYPTION KEY DEFINITION',
        },
      ]),
    ).toBe(true)
    for (const permission of [
      'INSERT',
      'UPDATE',
      'EXECUTE',
      'CONTROL',
      'ALTER',
    ])
      expect(
        assessPermissions([
          ...read,
          { scope: 'OBJECT', permission_name: permission },
        ]),
      ).toBe(false)
    expect(assessPermissions([])).toBe(false)
    expect(
      assessPermissions([
        ...read,
        { scope: 'SERVER', permission_name: 'CONTROL SERVER' },
      ]),
    ).toBe(false)
  })
  it('allows production cert trust and write opt-in like SSMS, but still rejects injected hosts (ADR-031)', () => {
    const profile = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'test',
      host: 'localhost',
      database: 'test',
      username: 'reader',
    }
    expect(connectionSchema.safeParse(profile).success).toBe(true)
    expect(
      connectionSchema.safeParse({
        ...profile,
        readOnly: false,
        environment: 'production',
      }).success,
    ).toBe(true)
    expect(
      connectionSchema.safeParse({
        ...profile,
        environment: 'production',
        trustServerCertificate: true,
      }).success,
    ).toBe(true)
    // Encryption itself stays mandatory.
    expect(
      connectionSchema.safeParse({
        ...profile,
        environment: 'production',
        encrypt: false,
      }).success,
    ).toBe(false)
    expect(
      connectionSchema.safeParse({ ...profile, host: 'localhost;password=x' })
        .success,
    ).toBe(false)
  })
  it('serializes dates, bigint, binary and bounded cells', () => {
    expect(serializeCell(999999999999999999n)).toBe('999999999999999999')
    expect(serializeCell(new Date('2026-01-01Z'))).toBe(
      '2026-01-01T00:00:00.000Z',
    )
    expect(serializeCell(new Date('2024-05-07Z'), 'Date')).toBe('2024-05-07')
    expect(serializeCell(Buffer.from([0, 255]))).toBe('0x00ff')
    expect(String(serializeCell('x'.repeat(10000))).length).toBeLessThan(8300)
    expect(String(serializeCell('x'.repeat(10000)))).toContain(
      '[cell truncated]',
    )
  })
})

describe('Excel-stage write grammar', () => {
  const stage = `[import].[stage_${'a'.repeat(32)}]`
  it('renders UPDATE JOIN and INSERT SELECT against the session #temp copy with conversion checks', () => {
    const update = parseMutation(
      `UPDATE t SET t.amount = TRY_CONVERT(decimal(18, 2), s.[금액]), note = s.memo FROM dbo.items AS t JOIN ${stage} AS s ON t.code = s.code AND t.id = TRY_CONVERT(int, s.id) WHERE s.flag <> N'skip';`,
    )
    expect(update).toMatchObject({
      kind: 'update',
      table: { schema: 'dbo', table: 'items' },
      assignedColumns: ['amount', 'note'],
      predicateColumns: ['code', 'id'],
      join: {
        alias: 't',
        stage: `[#stage_${'a'.repeat(32)}] AS [s]`,
        rawColumns: ['note'],
        importColumns: ['금액', 'memo', 'code', 'id', 'flag'],
      },
    })
    expect(update.join!.checks).toEqual([
      "([s].[금액] IS NOT NULL AND (TRY_CONVERT(DECIMAL(18, 2), [s].[금액]) IS NULL OR LTRIM(RTRIM([s].[금액])) = N''))",
      "([s].[code] IS NULL OR LTRIM(RTRIM([s].[code])) = N'')",
      "([s].[id] IS NULL OR LTRIM(RTRIM([s].[id])) = N'' OR TRY_CONVERT(INT, [s].[id]) IS NULL)",
    ])
    expect(update.sql).toContain(`INNER JOIN ${stage} AS [s]`)
    const insert = parseMutation(
      `INSERT INTO dbo.items (id, code) SELECT TRY_CONVERT(int, s.id), s.code FROM ${stage} AS s LEFT JOIN dbo.items AS t ON t.id = TRY_CONVERT(int, s.id) WHERE t.id IS NULL`,
    )
    expect(insert).toMatchObject({
      kind: 'insert',
      assignedColumns: ['id', 'code'],
      join: { alias: 't', rawColumns: ['code'] },
      predicateSql: '([t].[id] IS NULL)',
    })
  })
  it.each([
    // stage must be an aliased import stage, target must be aliased and not import
    `UPDATE t SET amount = 1 FROM dbo.items AS t JOIN dbo.other AS s ON t.id = s.id`,
    `UPDATE t SET amount = 1 FROM dbo.items AS t JOIN ${stage} ON t.id = 1`,
    `UPDATE t SET amount = 1 FROM dbo.items AS x JOIN ${stage} AS s ON x.id = s.id`,
    `UPDATE s SET amount = 1 FROM ${stage} AS s JOIN ${stage} AS t ON t.id = s.id`,
    // values: no target references, arithmetic or functions
    `UPDATE t SET amount = t.amount + 1 FROM dbo.items AS t JOIN ${stage} AS s ON t.id = s.id`,
    `UPDATE t SET amount = UPPER(s.v) FROM dbo.items AS t JOIN ${stage} AS s ON t.id = s.id`,
    // ON: only target = stage equalities joined by AND
    `UPDATE t SET amount = 1 FROM dbo.items AS t JOIN ${stage} AS s ON t.id = 1`,
    `UPDATE t SET amount = 1 FROM dbo.items AS t JOIN ${stage} AS s ON t.id = s.id OR t.id = s.k`,
    `UPDATE t SET amount = 1 FROM dbo.items AS t JOIN ${stage} AS s ON t.id > s.id`,
    `UPDATE t SET amount = 1 FROM dbo.items AS t JOIN ${stage} AS s ON t.id = s.id; DROP TABLE dbo.items`,
    `UPDATE t SET amount = 1 FROM dbo.items AS t LEFT JOIN ${stage} AS s ON t.id = s.id`,
    // INSERT: same-table LEFT JOIN only, matching counts, no target values
    `INSERT INTO dbo.items (id) SELECT s.id FROM ${stage} AS s LEFT JOIN dbo.other AS t ON t.id = s.id`,
    `INSERT INTO dbo.items (id, code) SELECT s.id FROM ${stage} AS s`,
    `INSERT INTO dbo.items (id) SELECT t.id FROM ${stage} AS s LEFT JOIN dbo.items AS t ON t.id = s.id`,
    `INSERT INTO dbo.items (id) SELECT s.id FROM dbo.other AS s`,
    `INSERT INTO dbo.items (id) VALUES (1)`,
    `INSERT INTO dbo.items (id) SELECT s.id FROM ${stage} AS s WHERE t.id IS NULL`,
  ])('refuses %s', (sql) => {
    expect(() => parseMutation(sql)).toThrow()
  })
})

describe('result paging', () => {
  it('renders Main pages with OFFSET/FETCH instead of TOP and keeps the user order', () => {
    const page = parseReadQuery(
      'SELECT a.id FROM dbo.items AS a ORDER BY a.name DESC',
      1000,
      undefined,
      { offset: 1000 },
    )
    expect(page.sql).not.toContain('TOP')
    expect(page.sql).toContain(
      'ORDER BY [a].[name] DESC\nOFFSET 1000 ROWS FETCH NEXT 1001 ROWS ONLY',
    )
    // Normalized page SQL re-parses to itself (the Excel #temp path re-parses it).
    expect(parseReadQuery(page.sql, 1000).sql).toBe(page.sql)
  })
  it('uses the fallback key order only for single-table, non-aggregate SQL', () => {
    expect(
      parseReadQuery('SELECT * FROM dbo.items', 10, undefined, {
        offset: 0,
        order: [['items', 'id']],
      }).sql,
    ).toContain(
      'ORDER BY [items].[id] ASC\nOFFSET 0 ROWS FETCH NEXT 11 ROWS ONLY',
    )
    expect(() =>
      parseReadQuery('SELECT COUNT(*) FROM dbo.items', 10, undefined, {
        offset: 0,
        order: [['items', 'id']],
      }),
    ).toThrow('ORDER BY')
    expect(() =>
      parseReadQuery('SELECT * FROM dbo.items', 10, undefined, { offset: 10 }),
    ).toThrow('ORDER BY')
    expect(
      parseReadQuery('SELECT DISTINCT a FROM dbo.items', 10).shape,
    ).toMatchObject({ aggregate: true, ordered: false })
    expect(
      parseReadQuery(
        'SELECT a.x FROM dbo.a AS a JOIN dbo.b AS b ON a.id = b.id',
        10,
      ).shape.single,
    ).toBeUndefined()
  })
  it('caps pages by the user TOP and supports hand-written OFFSET/FETCH', () => {
    expect(
      parseReadQuery(
        'SELECT TOP 1500 id FROM dbo.items ORDER BY id',
        1000,
        undefined,
        {
          offset: 1000,
        },
      ).sql,
    ).toContain('FETCH NEXT 500 ROWS ONLY')
    expect(() =>
      parseReadQuery(
        'SELECT TOP 1000 id FROM dbo.items ORDER BY id',
        1000,
        undefined,
        {
          offset: 1000,
        },
      ),
    ).toThrow('No more rows')
    const own = parseReadQuery(
      'SELECT id FROM dbo.items ORDER BY id OFFSET 5 ROWS FETCH NEXT 99999 ROWS ONLY',
      100,
    )
    expect(own.sql).toContain('OFFSET 5 ROWS FETCH NEXT 101 ROWS ONLY')
    expect(own.shape.userOffset).toBe(true)
    expect(() =>
      parseReadQuery('SELECT id FROM dbo.items OFFSET 5 ROWS', 100),
    ).toThrow('ORDER BY')
    expect(() =>
      parseReadQuery(
        'SELECT TOP 5 id FROM dbo.items ORDER BY id OFFSET 5 ROWS',
        100,
      ),
    ).toThrow('TOP')
  })
})
describe('select-list star shape (ADR-028)', () => {
  it('flags * and alias.* but not COUNT(*) or multiplication', () => {
    const star = (sql: string) => parseReadQuery(sql, 10).shape.star
    expect(star('SELECT * FROM dbo.items')).toBe(true)
    expect(star('SELECT i.id, i.* FROM dbo.items AS i')).toBe(true)
    expect(star('SELECT COUNT(*) AS n FROM dbo.items')).toBe(false)
    expect(star('SELECT id * 2 AS twice FROM dbo.items')).toBe(false)
  })
})
describe('three-part names (ADR-034)', () => {
  it('accepts the connected database, renders schema.table, refuses others', () => {
    const query = parseReadQuery(
      'SELECT id FROM Athena.dbo.CustomerAddInfo',
      10,
      undefined,
      undefined,
      'athena',
    )
    expect(query.sql).toContain('FROM [dbo].[CustomerAddInfo]')
    expect(query.sql).not.toContain('Athena')
    expect(query.tables).toEqual([
      expect.objectContaining({ schema: 'dbo', table: 'CustomerAddInfo' }),
    ])
    expect(() =>
      parseReadQuery(
        'SELECT id FROM Other.dbo.CustomerAddInfo',
        10,
        undefined,
        undefined,
        'Athena',
      ),
    ).toThrow('current-database')
    // User SELECTs may name another database; it is kept and quoted.
    const other = parseReadQuery(
      'SELECT c.id FROM Other.dbo.CustomerAddInfo AS c JOIN dbo.Local AS l ON l.id = c.id',
      10,
      undefined,
      undefined,
      'Athena',
      true,
    )
    expect(other.sql).toContain('FROM [Other].[dbo].[CustomerAddInfo] AS [c]')
    expect(other.sql).toContain('JOIN [dbo].[Local] AS [l]')
    expect(other.tables[0]).toMatchObject({ database: 'Other', schema: 'dbo' })
    expect(() =>
      parseMutation(
        'DELETE FROM Other.dbo.CustomerAddInfo WHERE id = 1',
        'Athena',
      ),
    ).toThrow('current-database')
    expect(() =>
      parseReadQuery('SELECT id FROM Athena.dbo.CustomerAddInfo', 10),
    ).toThrow('current-database')
    expect(
      parseMutation(
        'UPDATE Athena.dbo.CustomerAddInfo SET memo = 1 WHERE id = 1',
        'Athena',
      ).table,
    ).toEqual({ schema: 'dbo', table: 'CustomerAddInfo' })
  })
})
