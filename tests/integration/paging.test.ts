import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import type { HistoryEntry, QueryResult } from '@shared/database'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import { DatabaseService } from '@main/database/service'
import type { DatabaseRepositoryPort } from '@main/database/repository'
import {
  identifier,
  liveFixture,
  liveWriteEnabled,
} from '../helpers/live-mssql'

test.skipIf(!liveWriteEnabled)(
  'dedicated SQL Server: "load more" pages 2500 rows exactly once in PK or ORDER BY order and refuses stale tokens',
  async () => {
    const fixture = await liveFixture()
    const { profile, setup, table, target } = fixture
    const history: HistoryEntry[] = []
    const repo: DatabaseRepositoryPort = {
      list: () => [{ profile, hasPassword: true }],
      load: async () => ({
        profile: { ...profile, readOnly: true },
        password: process.env.AI_DB_TEST_PASSWORD!,
      }),
      save: async () => {},
      delete: () => {},
      history: () => history,
      addHistory: (entry) => history.push(entry),
    }
    const database = new DatabaseService(repo, () => new MssqlAdapter())
    const run = async (sql: string) => {
      const review = database.reviewQuery({ connectionId: profile.id, sql })
      return database.executeQuery({
        connectionId: profile.id,
        requestId: randomUUID(),
        approvalToken: review.token,
      })
    }
    const more = (result: QueryResult) =>
      database.fetchMore({
        connectionId: profile.id,
        requestId: randomUUID(),
        continuation: result.continuation!,
      })
    const all = async (first: QueryResult) => {
      const pages = [first.rowCount]
      const rows = [...first.rows]
      let page = first
      while (page.continuation) {
        page = await more(page)
        pages.push(page.rowCount)
        rows.push(...page.rows)
      }
      return { pages, ids: rows.map((row) => Number(row.c0)) }
    }
    try {
      // ids 1..2500 in scrambled insert order; amount descends so ORDER BY amount reverses ids.
      await setup
        .request()
        .query(
          `DELETE FROM ${target}; WITH n AS (SELECT TOP (2500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b) INSERT INTO ${target} (id, amount) SELECT (i * 7919) % 2500 + 1, 100000 - ((i * 7919) % 2500 + 1) FROM n`,
        )
      await database.connect({ connectionId: profile.id })
      const expected = Array.from({ length: 2500 }, (_, index) => index + 1)

      // No ORDER BY on a single table: primary-key order from the first page on.
      const first = await run(`SELECT id, amount FROM dbo.${identifier(table)}`)
      expect(first.rowCount).toBe(1000)
      expect(first.truncated).toBe(true)
      const keyed = await all(first)
      expect(keyed.pages).toEqual([1000, 1000, 500])
      expect(keyed.ids).toEqual(expected)

      // The user's ORDER BY is kept across pages.
      const ordered = await all(
        await run(
          `SELECT t.id FROM dbo.${identifier(table)} AS t ORDER BY t.amount DESC`,
        ),
      )
      expect(ordered.ids).toEqual(expected)

      // TOP bounds the total across pages.
      const topped = await all(
        await run(
          `SELECT TOP 1500 id FROM dbo.${identifier(table)} ORDER BY id`,
        ),
      )
      expect(topped.pages).toEqual([1000, 500])

      // Aggregates/joins without ORDER BY are truncated without a continuation.
      const joined = await run(
        `SELECT a.id FROM dbo.${identifier(table)} AS a INNER JOIN dbo.${identifier(table)} AS b ON a.id = b.id`,
      )
      expect(joined.truncated).toBe(true)
      expect(joined.continuation).toBeUndefined()

      // One-time tokens: reuse and reconnect are refused.
      const again = await run(`SELECT id FROM dbo.${identifier(table)}`)
      await more(again)
      await expect(more(again)).rejects.toThrow('no longer available')
      const stale = await run(`SELECT id FROM dbo.${identifier(table)}`)
      await database.disconnect(profile.id)
      await database.connect({ connectionId: profile.id })
      await expect(more(stale)).rejects.toThrow('no longer available')
      expect(history.every((entry) => entry.status === 'success')).toBe(true)
    } finally {
      await database.dispose()
      await fixture.close()
    }
  },
  60000,
)
