import { describe, expect, it } from 'vitest'
import { statementAt } from '@/lib/statements'

describe('statement under the cursor', () => {
  const two = 'SELECT * FROM dbo.OtherCompany;\n\nSELECT * FROM dbo.AddService;'
  it('picks the statement the cursor is in', () => {
    expect(statementAt(two, 5)).toBe('SELECT * FROM dbo.OtherCompany')
    expect(statementAt(two, two.length - 3)).toBe(
      'SELECT * FROM dbo.AddService',
    )
    // On the blank line between them: the statement before.
    expect(statementAt(two, two.indexOf('\n\n') + 1)).toBe(
      'SELECT * FROM dbo.OtherCompany',
    )
  })
  it('splits on blank lines without a semicolon', () => {
    const text = 'SELECT a FROM dbo.t\n  \nSELECT b FROM dbo.u'
    expect(statementAt(text, text.length)).toBe('SELECT b FROM dbo.u')
  })
  it('ignores separators inside strings, names and comments', () => {
    const text =
      "-- a; comment\nSELECT ';\n\n' AS [x;y] FROM dbo.t /* ; */;\nSELECT 2"
    expect(statementAt(text, 20)).toBe(
      "-- a; comment\nSELECT ';\n\n' AS [x;y] FROM dbo.t /* ; */",
    )
  })
  it('keeps a single statement exactly as written', () => {
    const one = '-- 주석\nSELECT 1 AS hello;'
    expect(statementAt(one, 0)).toBe(one)
  })
})
