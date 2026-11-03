import { describe, expect, it } from 'vitest'
import {
  databaseSchemaContext,
  identifier,
  memberContext,
  tableAliases,
  tableQueryPrefix,
} from '@/lib/sqlCompletion'

describe('SQL completion context', () => {
  it('maps aliases and table names from FROM/JOIN/UPDATE/INTO', () => {
    const aliases = tableAliases(
      'SELECT * FROM dbo.items AS t INNER JOIN [import].[stage_ab] s ON t.id = s.id LEFT JOIN [고객 정보] AS [고객] ON 1 = 1 WHERE t.id = 1',
    )
    expect(aliases.get('t')).toEqual({ schema: 'dbo', table: 'items' })
    expect(aliases.get('items')).toEqual({ schema: 'dbo', table: 'items' })
    expect(aliases.get('s')).toEqual({ schema: 'import', table: 'stage_ab' })
    expect(aliases.get('고객')).toEqual({ table: '고객 정보' })
    // Keywords after a table are not aliases.
    expect(aliases.has('where')).toBe(false)
    expect(aliases.has('on')).toBe(false)
    expect(tableAliases('UPDATE t SET a = 1 FROM dbo.x AS t').get('t')).toEqual(
      { schema: 'dbo', table: 'x' },
    )
    // Three-part names keep the catalog so alias columns use that database.
    const three = tableAliases(
      'SELECT * FROM Athena.dbo.CustomerAddInfo c WHERE c.',
    )
    expect(three.get('c')).toEqual({
      database: 'Athena',
      schema: 'dbo',
      table: 'CustomerAddInfo',
    })
    expect(three.has('dbo')).toBe(false)
  })
  it('detects qualifier.partial right before the cursor only', () => {
    expect(memberContext('SELECT t.')).toEqual({
      qualifier: 't',
      partial: '',
      bracket: false,
    })
    expect(memberContext('SELECT t.am')).toMatchObject({ partial: 'am' })
    expect(memberContext('WHERE [s].[고객 코')).toEqual({
      qualifier: 's',
      partial: '고객 코',
      bracket: true,
    })
    expect(memberContext('FROM dbo.')).toMatchObject({ qualifier: 'dbo' })
    expect(memberContext('SELECT t.id, x')).toBeUndefined()
    expect(memberContext('FROM a.b c')).toBeUndefined()
  })
  it('recognizes the database and schema before a three-part table name', () => {
    expect(databaseSchemaContext('SELECT * FROM Archive.dbo.')).toEqual({
      database: 'Archive',
      schema: 'dbo',
    })
    expect(databaseSchemaContext('FROM [Archive DB].[sales].[ord')).toEqual({
      database: 'Archive DB',
      schema: 'sales',
    })
    expect(databaseSchemaContext('FROM dbo.')).toBeUndefined()
  })
  it('brackets names the restricted parser cannot read unquoted', () => {
    expect(identifier('amount')).toBe('amount')
    expect(identifier('금액')).toBe('[금액]')
    expect(identifier('order')).toBe('[order]')
    expect(identifier('a]b')).toBe('[a]]b]')
  })
  it('only starts a SELECT for a standalone table reference or leading FROM', () => {
    expect(tableQueryPrefix('')).toEqual({
      text: 'SELECT * FROM ',
      offset: 0,
      bare: true,
    })
    expect(tableQueryPrefix('  dbo.set')).toEqual({
      text: 'SELECT * FROM ',
      offset: 2,
      bare: true,
    })
    expect(tableQueryPrefix('FROM dbo.')).toEqual({
      text: 'SELECT * ',
      offset: 0,
      bare: false,
    })
    expect(tableQueryPrefix('Archive.dbo.')).toEqual({
      text: 'SELECT * FROM ',
      offset: 0,
      bare: true,
    })
    expect(tableQueryPrefix('FROM Archive.dbo.')).toEqual({
      text: 'SELECT * ',
      offset: 0,
      bare: false,
    })
    expect(tableQueryPrefix('SELECT 1;\n  settlements')).toEqual({
      text: 'SELECT * FROM ',
      offset: 12,
      bare: true,
    })
    expect(tableQueryPrefix('SELECT * FROM dbo.')).toBeUndefined()
    expect(tableQueryPrefix('UPDATE dbo.')).toBeUndefined()
    expect(tableQueryPrefix('SELECT *\nFROM dbo.')).toBeUndefined()
  })
})
