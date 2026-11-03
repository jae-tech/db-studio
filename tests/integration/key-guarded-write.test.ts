import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import type { HistoryEntry } from '@shared/database'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import { DatabaseService } from '@main/database/service'
import { MutationService } from '@main/database/mutations'
import type { DatabaseRepositoryPort } from '@main/database/repository'
import { updateStatements } from '@/lib/gridEdit'
import {
  identifier,
  liveFixture,
  liveWriteEnabled,
} from '../helpers/live-mssql'

test.skipIf(!liveWriteEnabled)(
  'dedicated SQL Server: a PK table without rowversion is edited from a SELECT result (ADR-035/037)',
  async () => {
    const fixture = await liveFixture({ rowversion: false })
    const { profile, setup, table, target } = fixture
    const history: HistoryEntry[] = []
    const repo: DatabaseRepositoryPort = {
      list: () => [{ profile, hasPassword: true }],
      load: async () => ({
        profile,
        password: process.env.AI_DB_TEST_PASSWORD!,
      }),
      save: async () => {},
      delete: () => {},
      history: () => history,
      addHistory: (entry) => history.push(entry),
    }
    const database = new DatabaseService(repo, () => new MssqlAdapter())
    const writes = new MutationService(database, repo.addHistory)
    const amount = async () =>
      (
        await setup
          .request()
          .query<{ amount: number }>(`SELECT amount FROM ${target} WHERE id=1`)
      ).recordset[0]?.amount
    try {
      await database.connect({ connectionId: profile.id })
      const result = await database.executeQuery({
        connectionId: profile.id,
        requestId: randomUUID(),
        approvalToken: database.reviewQuery({
          connectionId: profile.id,
          sql: `SELECT id, amount FROM dbo.${identifier(table)}`,
        }).token,
      })
      expect(result.source).toEqual({ schema: 'dbo', table, keys: ['id'] })
      // An aliased column is not a plain source column: no editing.
      const aliased = await database.executeQuery({
        connectionId: profile.id,
        requestId: randomUUID(),
        approvalToken: database.reviewQuery({
          connectionId: profile.id,
          sql: `SELECT id, amount AS total FROM dbo.${identifier(table)}`,
        }).token,
      })
      expect(aliased.source).toBeUndefined()
      const row = result.rows[0]!
      row.c1 = '25'
      const [sql] = updateStatements(
        result,
        new Map([[row, new Map([['c1', 10]])]]),
      )
      const reviewed = await writes.preview({
        connectionId: profile.id,
        sql: sql!,
      })
      expect({ stage: reviewed.stage, detail: reviewed.detail }).toEqual({
        stage: 'preview',
        detail: undefined,
      })
      const applied = await writes.apply({
        id: reviewed.id,
        approvalHash: reviewed.approvalHash,
      })
      expect(applied.stage).toBe('applied')
      const committed = await writes.commit({
        id: applied.id,
        approvalHash: applied.approvalHash,
        commitToken: applied.commitToken!,
        databaseConfirmation: applied.database,
      })
      expect(committed.stage).toBe('committed')
      expect(await amount()).toBe(25)
    } finally {
      await database.dispose()
      await fixture.close()
    }
  },
  60000,
)
