import { expect, test } from 'vitest'
import type { HistoryEntry } from '@shared/database'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import { DatabaseService } from '@main/database/service'
import { MutationService } from '@main/database/mutations'
import { parseMutation } from '@main/database/policy'
import { randomUUID } from 'node:crypto'
import type { DatabaseRepositoryPort } from '@main/database/repository'
import {
  identifier,
  liveFixture,
  liveWriteEnabled,
} from '../helpers/live-mssql'

test.skipIf(!liveWriteEnabled)(
  'dedicated SQL Server: commit, rollback, locks, expiry, shutdown, stale preview, trigger and permission refusal',
  async () => {
    const fixture = await liveFixture()
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
    const adapter = new MssqlAdapter()
    const database = new DatabaseService(repo, () => adapter)
    const writes = new MutationService(database, repo.addHistory)
    const connect = () => database.connect({ connectionId: profile.id })
    const preview = (text: string) =>
      writes.preview({ connectionId: profile.id, sql: text })
    const amount = async () =>
      (
        await setup
          .request()
          .query<{ amount: number }>(`SELECT amount FROM ${target} WHERE id=1`)
      ).recordset[0]?.amount
    try {
      await connect()
      const raw = await setup
        .request()
        .query<{ version: string }>(
          `SELECT CONVERT(varchar(18),CONVERT(binary(8),rv),1) AS version FROM ${target}`,
        )
      expect(raw.recordset[0]?.version).toMatch(/^0x[0-9a-fA-F]{16}$/)
      // Exercise the actual driver contract too; service failures intentionally
      // redact low-level diagnostics from Renderer-facing error states.
      const snapshot = await adapter.mutations.preview(
        parseMutation(`UPDATE dbo.${table} SET amount=20 WHERE id=1`),
        randomUUID(),
        new AbortController().signal,
        false,
      )
      expect(snapshot.versions).toEqual([
        raw.recordset[0]!.version.toLowerCase(),
      ])
      let reviewed = await preview(
        `UPDATE dbo.${table} SET amount=20 WHERE id=1`,
      )
      expect(reviewed.stage).toBe('preview')
      let applied = await writes.apply({
        id: reviewed.id,
        approvalHash: reviewed.approvalHash,
      })
      expect(applied.stage).toBe('applied')
      await expect(
        writes.commit({
          id: applied.id,
          approvalHash: applied.approvalHash,
          commitToken: applied.commitToken!,
          databaseConfirmation: 'wrong-database',
        }),
      ).rejects.toThrow(/confirmation/)
      expect(
        (
          await writes.commit({
            id: applied.id,
            approvalHash: applied.approvalHash,
            commitToken: applied.commitToken!,
            databaseConfirmation: profile.database,
          })
        ).stage,
      ).toBe('committed')
      expect(await amount()).toBe(20)

      await connect()
      reviewed = await preview(`DELETE FROM dbo.${table} WHERE id=1`)
      applied = await writes.apply({
        id: reviewed.id,
        approvalHash: reviewed.approvalHash,
      })
      expect(applied.stage).toBe('applied')
      // A separate physical connection must not read the uncommitted deletion.
      const blocked = setup.request()
      await expect(
        blocked.query(
          `SET LOCK_TIMEOUT 300; SELECT amount FROM ${target} WHERE id=1`,
        ),
      ).rejects.toMatchObject({ number: 1222 })
      await setup.request().query('SET LOCK_TIMEOUT -1')
      expect((await writes.rollback({ id: applied.id })).stage).toBe(
        'rolled-back',
      )
      expect(await amount()).toBe(20)

      await connect()
      reviewed = await preview(`UPDATE dbo.${table} SET amount=30 WHERE id=1`)
      await setup.request().query(`UPDATE ${target} SET amount=21 WHERE id=1`)
      expect(
        (
          await writes.apply({
            id: reviewed.id,
            approvalHash: reviewed.approvalHash,
          })
        ).stage,
      ).toBe('rolled-back')
      expect(await amount()).toBe(21)

      await connect()
      reviewed = await preview(`UPDATE dbo.${table} SET amount=30 WHERE id=1`)
      applied = await writes.apply({
        id: reviewed.id,
        approvalHash: reviewed.approvalHash,
      })
      expect(applied.stage).toBe('applied')
      // Do not poll state(): it has its own expiry fallback and would mask a
      // broken automatic timer. The independent DB read must unblock itself.
      await new Promise((resolve) => setTimeout(resolve, 31000))
      expect(await amount()).toBe(21)
      expect((await writes.state(profile.id))?.stage).toBe('rolled-back')

      await connect()
      const trigger = identifier(`${table}_trigger`)
      await setup
        .request()
        .query(
          `CREATE TRIGGER [dbo].${trigger} ON ${target} AFTER UPDATE AS BEGIN SET NOCOUNT ON; END`,
        )
      expect(
        (await preview(`UPDATE dbo.${table} SET amount=30 WHERE id=1`)).stage,
      ).toBe('error')
      expect(await amount()).toBe(21)
      await setup.request().query(`DROP TRIGGER [dbo].${trigger}`)

      // dbo/sysadmin would mask DENY; this case requires a separate setup user.
      if (process.env.AI_DB_TEST_SETUP_USER) {
        await setup
          .request()
          .query(
            `DENY UPDATE ON OBJECT::${target} TO ${identifier(profile.username)}`,
          )
        expect(
          (await preview(`UPDATE dbo.${table} SET amount=30 WHERE id=1`)).stage,
        ).toBe('error')
        expect(await amount()).toBe(21)
        await setup
          .request()
          .query(
            `GRANT UPDATE ON OBJECT::${target} TO ${identifier(profile.username)}`,
          )
      }

      reviewed = await preview(`DELETE FROM dbo.${table} WHERE id=1`)
      expect(reviewed.stage).toBe('preview')
      applied = await writes.apply({
        id: reviewed.id,
        approvalHash: reviewed.approvalHash,
      })
      expect(applied.stage).toBe('applied')
      expect(
        (
          await writes.commit({
            id: applied.id,
            approvalHash: applied.approvalHash,
            commitToken: applied.commitToken!,
            databaseConfirmation: profile.database,
          })
        ).stage,
      ).toBe('committed')
      expect(await amount()).toBeUndefined()
      expect(
        history.filter((entry) => entry.status === 'committed'),
      ).toHaveLength(2)
      await setup
        .request()
        .query(`INSERT INTO ${target} (id,amount) VALUES (1,10)`)
      await connect()
      reviewed = await preview(`UPDATE dbo.${table} SET amount=40 WHERE id=1`)
      applied = await writes.apply({
        id: reviewed.id,
        approvalHash: reviewed.approvalHash,
      })
      expect(applied.stage).toBe('applied')
      await writes.dispose()
      expect(await amount()).toBe(10)
      expect((await writes.state(profile.id))?.stage).toBe('rolled-back')
    } finally {
      try {
        await writes.dispose()
      } finally {
        try {
          await database.dispose()
        } finally {
          await fixture.close()
        }
      }
    }
  },
  90000,
)
