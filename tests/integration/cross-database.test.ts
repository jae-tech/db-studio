import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import type { HistoryEntry } from '@shared/database'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import { DatabaseService } from '@main/database/service'
import type { DatabaseRepositoryPort } from '@main/database/repository'
import {
  identifier,
  liveFixture,
  liveWriteEnabled,
} from '../helpers/live-mssql'

test.skipIf(!liveWriteEnabled)(
  'dedicated SQL Server: three-part names read the connected or another database (ADR-034)',
  async () => {
    const fixture = await liveFixture()
    const { profile, table } = fixture
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
    const run = (sql: string) =>
      database.executeQuery({
        connectionId: profile.id,
        requestId: randomUUID(),
        approvalToken: database.reviewQuery({ connectionId: profile.id, sql })
          .token,
      })
    try {
      await database.connect({ connectionId: profile.id })
      // The connected database by name behaves like a two-part name.
      const own = await run(
        `SELECT id, amount FROM ${identifier(profile.database)}.dbo.${identifier(table)}`,
      )
      expect(own.rows).toEqual([{ c0: 1, c1: 10 }])
      // Another database is queried in that database's catalog: master has no such table.
      await expect(
        run(`SELECT id FROM master.dbo.${identifier(table)}`),
      ).rejects.toThrow('사용자 테이블')
      await expect(
        run(`SELECT id FROM aidb_missing_${randomUUID().slice(0, 8)}.dbo.t`),
      ).rejects.toThrow('접근할 수 없습니다')
    } finally {
      await database.dispose()
      await fixture.close()
    }
  },
  60000,
)
