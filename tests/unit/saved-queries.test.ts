import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  assertUniqueQueryNames,
  resolveSavedQuery,
  type SavedQuery,
} from '@shared/database'

const connectionId = randomUUID()
const other = randomUUID()
const query = (
  name: string,
  aliases: string[],
  scope = { connectionId, database: 'sales' },
): SavedQuery => ({
  id: randomUUID(),
  ...scope,
  name,
  aliases,
  sql: `SELECT 1 AS [${name}]`,
})

describe('saved query names', () => {
  const monthly = query('월별 매출', ['매출', 'Monthly Sales'])
  const sameNameOtherDb = query('월별 매출', [], {
    connectionId,
    database: 'hr',
  })
  const sameNameOtherConnection = query('월별 매출', [], {
    connectionId: other,
    database: 'sales',
  })
  const all = [monthly, sameNameOtherDb, sameNameOtherConnection]
  const scope = { connectionId, database: 'sales' }

  it('matches name or alias exactly within the current connection and database', () => {
    expect(resolveSavedQuery(all, scope, '월별 매출')).toBe(monthly)
    expect(resolveSavedQuery(all, scope, '  monthly   SALES ')).toBe(monthly)
    expect(resolveSavedQuery(all, scope, '매출')).toBe(monthly)
    expect(
      resolveSavedQuery(all, { connectionId, database: 'hr' }, '월별 매출'),
    ).toBe(sameNameOtherDb)
  })
  it('never guesses: partial, unknown and ambiguous names are refused', () => {
    expect(() => resolveSavedQuery(all, scope, '월별')).toThrow('없습니다')
    expect(() => resolveSavedQuery(all, scope, '매출 쿼리')).toThrow()
    expect(() =>
      resolveSavedQuery([monthly, query('다른 쿼리', ['매출'])], scope, '매출'),
    ).toThrow('여러 개')
  })
  it('refuses reused names/aliases in the same scope only', () => {
    const next = {
      ...scope,
      name: '새 쿼리',
      aliases: ['MONTHLY sales'],
      sql: 'SELECT 1',
    }
    expect(() => assertUniqueQueryNames(all, next)).toThrow('이미 사용 중')
    expect(() =>
      assertUniqueQueryNames(all, { ...next, aliases: ['새  쿼리'] }),
    ).toThrow('겹치지')
    expect(() =>
      assertUniqueQueryNames(all, { ...next, database: 'other', aliases: [] }),
    ).not.toThrow()
  })
})
