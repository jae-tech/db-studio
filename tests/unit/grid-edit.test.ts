import { describe, expect, it } from 'vitest'
import type { QueryResult } from '@shared/database'
import { parseMutation, parseReadQuery } from '@main/database/policy'
import { editableKeys, updateStatements } from '@/lib/gridEdit'

const result = (): QueryResult => ({
  requestId: 'r',
  columns: [
    { key: 'c0', name: 'masterCode', type: 'NVarChar' },
    { key: 'c1', name: 'code', type: 'NVarChar' },
    { key: 'c2', name: 'name', type: 'NVarChar' },
    { key: 'c3', name: 'nRef01', type: 'Int' },
  ],
  rows: [{ c0: 'SUPPLY', c1: "0'1", c2: '서버', c3: null }],
  durationMs: 0,
  truncated: false,
  rowCount: 1,
  source: { schema: 'dbo', table: 'CodeMaster', keys: ['masterCode', 'CODE'] },
})

describe('result grid edits (ADR-037)', () => {
  it('edits only non-key columns, and only when every key is in the result', () => {
    expect([...editableKeys(result())]).toEqual(['c2', 'c3'])
    const partial = result()
    partial.columns = partial.columns.filter((column) => column.key !== 'c1')
    expect(editableKeys(partial).size).toBe(0)
    expect(editableKeys({ ...result(), source: undefined }).size).toBe(0)
  })
  it('builds one key-addressed UPDATE the write policy accepts, with escaping and NULL', () => {
    const data = result()
    const row = data.rows[0]!
    row.c2 = "서버 '본체'"
    row.c3 = 'NULL'
    const [sql] = updateStatements(
      data,
      new Map([
        [
          row,
          new Map([
            ['c2', '서버'],
            ['c3', null],
          ]),
        ],
      ]),
    )
    expect(sql).toBe(
      "UPDATE [dbo].[CodeMaster] SET [name] = N'서버 ''본체''', [nRef01] = NULL WHERE [masterCode] = N'SUPPLY' AND [code] = N'0''1'",
    )
    const parsed = parseMutation(sql!)
    expect(parsed.kind).toBe('update')
    expect(parsed.assignedColumns).toEqual(['name', 'nRef01'])
  })
  it('marks only plain column lists as editable shapes', () => {
    const plain = (sql: string) => parseReadQuery(sql, 100).shape.plain
    expect(plain('SELECT * FROM dbo.t')).toBe(true)
    expect(plain('SELECT t.a, b AS b FROM dbo.t AS t')).toBe(true)
    expect(plain('SELECT a AS b FROM dbo.t')).toBe(false)
    expect(plain('SELECT a + 1 AS a FROM dbo.t')).toBe(false)
  })
})
