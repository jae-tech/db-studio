import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SavedQuery } from '@shared/database'
import { savedQueryRequest } from '@/lib/savedQueryRequest'

const scope = { connectionId: randomUUID(), database: 'sales' }
const monthly: SavedQuery = {
  ...scope,
  id: randomUUID(),
  name: '월별 매출',
  aliases: ['매출', 'Monthly Sales'],
  sql: 'SELECT 1 AS answer',
}

describe('local saved query chat commands', () => {
  it.each([
    '월별 매출',
    ' monthly   SALES ',
    '매출 조회해줘',
    '월별 매출 실행해줘',
    '/조회 매출',
    '저장 쿼리 월별 매출 실행',
    '저장쿼리 매출 조회해줘',
  ])('resolves exact names and aliases: %s', (text) => {
    expect(savedQueryRequest([monthly], scope, text)).toBe(monthly)
  })
  it.each(['안녕', '엑셀 고객 목록 조회해줘', '월별', 'SQL을 작성해줘'])(
    'leaves ordinary AI prompts untouched: %s',
    (text) => expect(savedQueryRequest([monthly], scope, text)).toBeUndefined(),
  )
  it.each(['/조회 없는이름', '/조회', '저장 쿼리 월별 실행'])(
    'refuses explicit missing or partial names: %s',
    (text) =>
      expect(() => savedQueryRequest([monthly], scope, text)).toThrow(
        '없습니다',
      ),
  )
  it('does not interpolate arguments or rewrite the stored SQL', () => {
    expect(() =>
      savedQueryRequest([monthly], scope, '/조회 매출 고객=7'),
    ).toThrow()
    expect(savedQueryRequest([monthly], scope, '매출')?.sql).toBe(monthly.sql)
  })
  it('refuses another database, connection, or disconnected scope', () => {
    for (const other of [
      { ...scope, database: 'other' },
      { ...scope, connectionId: randomUUID() },
      undefined,
    ])
      expect(() => savedQueryRequest([monthly], other, '매출')).toThrow()
    const otherDb = { ...monthly, id: randomUUID(), database: 'other' }
    expect(savedQueryRequest([monthly, otherDb], scope, '매출')).toBe(monthly)
  })
  it('refuses ambiguous aliases and command-vs-literal names', () => {
    const duplicate = { ...monthly, id: randomUUID(), name: '다른 쿼리' }
    expect(() =>
      savedQueryRequest([monthly, duplicate], scope, '매출'),
    ).toThrow('여러 개')
    const literal = {
      ...monthly,
      id: randomUUID(),
      name: '매출 조회해줘',
      aliases: [],
    }
    expect(() =>
      savedQueryRequest([monthly, literal], scope, '매출 조회해줘'),
    ).toThrow('여러 개')
    expect(
      savedQueryRequest([monthly, literal], scope, '/조회 매출 조회해줘'),
    ).toBe(literal)
  })
})
