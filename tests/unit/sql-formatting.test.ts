import { describe, expect, it } from 'vitest'
import {
  defaultSqlFormatting,
  dedentSql,
  formatSql,
  inferSqlFormatting,
  minimalIdentifier,
  sqlFormattingSchema,
} from '@shared/sqlFormatting'
import { parseReadQuery, parseMutation } from '@main/database/policy'
import { settingsSchema, defaultSettings } from '@shared/contracts'
import { agentRequestSchema } from '@shared/agent'
import { useWorkspace } from '@/store'
import { randomUUID } from 'node:crypto'

const sample =
  'select [fp].[presetId], [fp].[userId], [fp].[dataTableKey], fp.filterName from [Athena].[dbo].[FilterPreset] fp inner join Athena.dbo.Users u on u.id=fp.userId inner join Athena.dbo.Users currentUser on currentUser.id=@userId where fp.dataTableKey=@dataTableKey and ((fp.userId=@userId) or (fp.isShared=1 and u.agentId=currentUser.agentId and u.teamCode=currentUser.teamCode)) order by fp.createdAt desc'

describe('SQL presentation formatter', () => {
  it('uses leading commas, bare ordinary names, preserved parameters and aligned JOIN ON', () => {
    const output = formatSql(sample)
    expect(output).toContain(
      'SELECT  fp.presetId\n    ,   fp.userId\n    ,   fp.dataTableKey\n    ,   fp.filterName',
    )
    expect(output).toContain('FROM Athena.dbo.FilterPreset fp')
    expect(output).not.toContain('[')
    expect(output).toContain(
      'WHERE fp.dataTableKey = @dataTableKey\nAND ((fp.userId = @userId)\nOR (fp.isShared = 1\n    AND u.agentId = currentUser.agentId\n    AND u.teamCode = currentUser.teamCode))',
    )
    const joins = output
      .split('\n')
      .filter((line) => line.startsWith('INNER JOIN'))
    expect(joins).toHaveLength(2)
    expect(joins[0]!.indexOf(' ON ')).toBe(joins[1]!.indexOf(' ON '))
    expect(output).toContain('ORDER BY fp.createdAt DESC')
    expect(formatSql(output)).toBe(output)
  })
  it('changes configured case/comma/indent/alignment without changing literals or identifiers', () => {
    const output = formatSql(sample, {
      ...defaultSqlFormatting(),
      keywordCase: 'lower',
      commaStyle: 'trailing',
      indentWidth: 2,
      alignJoinOn: false,
      breakConditions: false,
      identifierQuotes: 'preserve',
    })
    expect(output).toContain('select  [fp].[presetId],\n        [fp].[userId],')
    expect(output).toContain(
      'where fp.dataTableKey = @dataTableKey and ((fp.userId = @userId) or',
    )
    const joins = output
      .split('\n')
      .filter((line) => line.startsWith('inner join'))
    expect(joins[0]!.indexOf(' on ')).not.toBe(joins[1]!.indexOf(' on '))
    expect(output).toContain('fp.createdAt desc')
    expect(
      formatSql(output, {
        ...defaultSqlFormatting(),
        keywordCase: 'lower',
        commaStyle: 'trailing',
        indentWidth: 2,
        alignJoinOn: false,
        breakConditions: false,
        identifierQuotes: 'preserve',
      }),
    ).toBe(output)
  })
  it.each([
    'order',
    'user',
    'table',
    'value',
    'NULLIF',
    'TRY_CONVERT',
    'current_user',
    'a b',
    'a]b',
    '금액',
    '1column',
    'x;DROP TABLE t',
  ])('retains required identifier quoting: %s', (name) => {
    expect(minimalIdentifier(name)).toBe(`[${name.replaceAll(']', ']]')}]`)
  })
  it('preserves string contents, escaped quotes, quoted function names, numbers and nested comments', () => {
    const sql = `select N'[x], FROM -- 한글 ''quoted''' as [label], 0x00Ff as [binaryValue], 1e-3 as smallNumber, [dbo].[customFn]([id]) from [dbo].[items] /* outer /* inner [a] */ kept */ -- do not move FROM into comment\n where [id] > -1;`
    const output = formatSql(sql)
    for (const text of [
      "N'[x], FROM -- 한글 ''quoted'''",
      '0x00Ff',
      '1e-3',
      'dbo.[customFn](id)',
      '/* outer /* inner [a] */ kept */',
      '-- do not move FROM into comment\n',
    ])
      expect(output).toContain(text)
    expect(formatSql(output)).toBe(output)
    expect(formatSql('select "A B", [a]]b] from dbo.x')).toContain(
      '"A B"\n    ,   [a]]b]',
    )
  })
  it.each([
    "select 'broken",
    'select [broken',
    'select (a from t',
    'select a) from t',
    'select /* broken',
  ])('refuses malformed input without guessing: %s', (sql) =>
    expect(() => formatSql(sql)).toThrow(),
  )
  it('keeps decimal/function commas inline and statement separators intact', () => {
    expect(
      formatSql(
        'select TRY_CONVERT(decimal(18,2), x), COALESCE(x, 0) from dbo.t; select 2 as answer;',
      ),
    ).toContain('TRY_CONVERT(decimal(18, 2), x)\n    ,   COALESCE(x, 0)')
    expect(formatSql('SELECT 1; SELECT 2;')).toBe('SELECT  1;\nSELECT  2;')
  })
  it('preserves standalone GO boundaries but does not turn a column called GO into a batch', () => {
    expect(
      formatSql(
        "SELECT 'GO';\nGO 2 -- keep this comment\nSELECT GO FROM dbo.t;",
      ),
    ).toBe("SELECT  'GO';\nGO 2 -- keep this comment\nSELECT  GO\nFROM dbo.t;")
  })
  it('refuses unfamiliar lexical forms instead of spacing them into different SQL', () => {
    expect(() => formatSql('SELECT $123.00')).toThrow('원문')
    expect(() => formatSql('SELECT `name` FROM dbo.t')).toThrow('원문')
  })
  it('preserves the execution parser normalized SELECT and write semantics', () => {
    expect(() => parseReadQuery(formatSql(sample), 100)).toThrow()
    const reads = [
      'SELECT Rows AS Only, Partition AS Rows, id AS Order FROM dbo.items',
      'SELECT t.[amount], t.id FROM dbo.items AS t WHERE t.id = 1 ORDER BY t.id DESC',
      "SELECT COALESCE(t.amount, 0), N'[x]' AS label FROM dbo.items AS t WHERE t.id IN (1, 2)",
      'SELECT COUNT(*) AS n FROM dbo.items WHERE id > 0',
    ]
    for (const sql of reads)
      expect(parseReadQuery(formatSql(sql), 100).sql).toBe(
        parseReadQuery(sql, 100).sql,
      )
    for (const sql of [
      'UPDATE dbo.items SET amount = 20 WHERE id = 1',
      'DELETE FROM dbo.items WHERE id = 1',
    ])
      expect(parseMutation(formatSql(sql)).sql).toBe(parseMutation(sql).sql)
  })
  it('formats generated tabs without changing the original, with an explicit malformed-draft warning', () => {
    useWorkspace.setState({ settings: defaultSettings(), notice: '' })
    const original = useWorkspace.getState().settings.tabs[0]!
    const connectionId = randomUUID()
    useWorkspace
      .getState()
      .openProposal('SELECT [id], [amount] FROM [dbo].[items]', connectionId)
    expect(useWorkspace.getState().settings.tabs[0]).toEqual(original)
    expect(useWorkspace.getState().settings.tabs.at(-1)?.sql).toBe(
      'SELECT  id\n    ,   amount\nFROM dbo.items',
    )
    useWorkspace.getState().openProposal("SELECT 'broken", connectionId)
    expect(useWorkspace.getState().settings.tabs.at(-1)?.sql).toBe(
      "SELECT 'broken",
    )
    expect(useWorkspace.getState().notice).toContain('원문')
  })
  it('accepts only bounded presentation options on the existing agent context', () => {
    const input = {
      requestId: randomUUID(),
      provider: 'codex',
      prompt: 'hello',
      resume: false,
      context: {
        connectionId: randomUUID(),
        shareSchema: true,
        sqlFormatting: defaultSqlFormatting(),
      },
    }
    expect(agentRequestSchema.safeParse(input).success).toBe(true)
    expect(
      agentRequestSchema.safeParse({
        ...input,
        context: {
          ...input.context,
          sqlFormatting: { ...defaultSqlFormatting(), indentWidth: 5000 },
        },
      }).success,
    ).toBe(false)
    expect(
      agentRequestSchema.safeParse({
        ...input,
        context: {
          ...input.context,
          sqlFormatting: { ...defaultSqlFormatting(), shell: 'bad' },
        },
      }).success,
    ).toBe(false)
  })
  it('migrates old preferences by defaults, validates options and does not overwrite old tabs', () => {
    const old = defaultSettings()
    const legacy = Object.fromEntries(
      Object.entries(old).filter(([key]) => key !== 'sqlFormatting'),
    )
    expect(settingsSchema.parse(legacy).sqlFormatting).toEqual(
      defaultSqlFormatting(),
    )
    expect(settingsSchema.parse(legacy).tabs).toEqual(old.tabs)
    expect(sqlFormattingSchema.safeParse({ indentWidth: 3 }).success).toBe(
      false,
    )
    expect(sqlFormattingSchema.safeParse({ extra: 'untrusted' }).success).toBe(
      false,
    )
  })
  it('infers settings that reproduce a sample query style', () => {
    const source =
      'select [fp].[presetId], fp.userId from dbo.FilterPreset fp inner join dbo.Users u on u.id=fp.userId where fp.isShared=1 and u.agentId=3 order by fp.createdAt desc;'
    for (const style of [
      {
        keywordCase: 'lower',
        commaStyle: 'trailing',
        breakConditions: false,
        identifierQuotes: 'preserve',
      },
      {
        keywordCase: 'upper',
        commaStyle: 'leading',
        breakConditions: true,
        identifierQuotes: 'minimal',
      },
    ] as const) {
      const sample = formatSql(source, { ...defaultSqlFormatting(), ...style })
      const inferred = inferSqlFormatting(sample)
      expect(inferred).toMatchObject(style)
      expect(formatSql(sample, inferred)).toBe(sample)
    }
  })
  it('learns keyword-column style from code copied mid-line', () => {
    const sample = [
      'SELECT  SSS.suppSalesId',
      '                            ,   SSS.supplyItemId',
      '                        FROM    Athena.dbo.SupplementarySales SS WITH (NOLOCK)',
      '                        INNER JOIN Athena.dbo.SupplementarySales_Supply SSS WITH (NOLOCK)   ON SSS.parentSuppSalesId = SS.suppSalesId',
      '                                                                                            AND SSS.isDeleted = 0',
      '                        WHERE   SS.divSolution = @serviceCode',
      '                        AND     (',
      '                                    (@customerId > 0 AND SS.customerId = @customerId)',
      '                                    OR',
      "                                    (@customerId = 0 AND SS.customerDiv = 'SALES')",
      '                                )',
    ].join('\n')
    // The first line was copied without its indent; the rest keep 24 extra spaces.
    expect(dedentSql(sample).split('\n')[1]).toBe('    ,   SSS.supplyItemId')
    const inferred = inferSqlFormatting(sample)
    expect(inferred).toMatchObject({
      alignKeywords: true,
      commaStyle: 'leading',
    })
    expect(formatSql(sample, inferred)).toBe(
      [
        'SELECT  SSS.suppSalesId',
        '    ,   SSS.supplyItemId',
        'FROM    Athena.dbo.SupplementarySales SS WITH (NOLOCK)',
        'INNER JOIN Athena.dbo.SupplementarySales_Supply SSS WITH (NOLOCK) ON SSS.parentSuppSalesId = SS.suppSalesId',
        '                                                                  AND SSS.isDeleted = 0',
        'WHERE   SS.divSolution = @serviceCode',
        'AND     (',
        '            (@customerId > 0 AND SS.customerId = @customerId)',
        '            OR',
        "            (@customerId = 0 AND SS.customerDiv = 'SALES')",
        '        )',
      ].join('\n'),
    )
  })
})
