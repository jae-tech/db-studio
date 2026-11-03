import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import type { HistoryEntry } from '@shared/database'
import type { ImportData } from '@main/database/ImportAdapter'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import { DatabaseService } from '@main/database/service'
import { MutationService } from '@main/database/mutations'
import type { DatabaseRepositoryPort } from '@main/database/repository'
import {
  identifier,
  liveFixture,
  liveWriteEnabled,
} from '../helpers/live-mssql'

const stage = (columns: string[], rows: (string | null)[][]): ImportData => ({
  id: randomUUID(),
  tableName: `stage_${randomUUID().replaceAll('-', '')}`,
  columns,
  rows,
})

test.skipIf(!liveWriteEnabled)(
  'dedicated SQL Server: Excel-stage UPDATE JOIN and INSERT SELECT preview, refusals, locked recheck, commit and rollback',
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
    const rows = async () =>
      (
        await setup.request().query<{
          id: number
          amount: number
        }>(`SELECT id, amount FROM ${target} ORDER BY id`)
      ).recordset
    // A fresh session per step: commit/rollback retire the connection and its registrations.
    const ready = async (data: ImportData): Promise<string> => {
      await database.disconnect(profile.id)
      await database.connect({ connectionId: profile.id })
      database.registerImport(profile.id, data)
      return `[import].${identifier(data.tableName)}`
    }
    const preview = (text: string) =>
      writes.preview({ connectionId: profile.id, sql: text })
    const commit = async (text: string) => {
      const reviewed = await preview(text)
      expect(reviewed.stage, reviewed.detail).toBe('preview')
      const applied = await writes.apply({
        id: reviewed.id,
        approvalHash: reviewed.approvalHash,
      })
      expect(applied.stage, applied.detail).toBe('applied')
      return writes.commit({
        id: applied.id,
        approvalHash: applied.approvalHash,
        commitToken: applied.commitToken!,
        databaseConfirmation: profile.database,
      })
    }
    try {
      if (process.env.AI_DB_TEST_SETUP_USER)
        await setup
          .request()
          .query(
            `GRANT INSERT ON OBJECT::${target} TO ${identifier(profile.username)}`,
          )
      await setup
        .request()
        .query(`INSERT INTO ${target} (id,amount) VALUES (2,20),(3,30)`)

      // UPDATE JOIN: text keys with leading zeros match via TRY_CONVERT; unmatched Excel rows are ignored.
      const prices = stage(
        ['코드', '금액'],
        [
          ['001', '15'],
          ['0003', '35'],
          ['999', '1'],
        ],
      )
      let source = await ready(prices)
      const update = `UPDATE t SET amount = TRY_CONVERT(int, s.[금액]) FROM dbo.${identifier(table)} AS t INNER JOIN ${source} AS s ON t.id = TRY_CONVERT(int, s.[코드])`
      const reviewed = await preview(update)
      expect(reviewed.stage, reviewed.detail).toBe('preview')
      expect(reviewed.kind).toBe('update')
      expect(reviewed.affectedRows).toBe(2)
      // '999' matches no target under ON; it is counted, not changed.
      expect(reviewed.importRows).toEqual({ total: 3, unmatched: 1 })
      expect(reviewed.preview?.columns.map((column) => column.name)).toEqual([
        'id',
        'amount',
        '→ amount',
      ])
      expect(reviewed.preview?.rows).toEqual([
        { c0: '1', c1: '10', c2: '15' },
        { c0: '3', c1: '30', c2: '35' },
      ])
      // The unlocked preview transaction left no change behind.
      expect(await rows()).toEqual([
        { id: 1, amount: 10 },
        { id: 2, amount: 20 },
        { id: 3, amount: 30 },
      ])
      await writes.rollback({ id: reviewed.id })
      expect((await commit(update)).stage).toBe('committed')
      expect(await rows()).toEqual([
        { id: 1, amount: 15 },
        { id: 2, amount: 20 },
        { id: 3, amount: 35 },
      ])

      // Refusals: one target matched twice, failed conversion, raw text into an int column.
      const duplicate = stage(
        ['코드', '금액'],
        [
          ['1', '11'],
          ['01', '12'],
        ],
      )
      source = await ready(duplicate)
      let refused = await preview(
        `UPDATE t SET amount = TRY_CONVERT(int, s.[금액]) FROM dbo.${identifier(table)} AS t JOIN ${source} AS s ON t.id = TRY_CONVERT(int, s.[코드])`,
      )
      expect(refused.stage).toBe('error')
      expect(refused.detail).toContain('여러 개와 일치')
      const broken = stage(
        ['코드', '금액'],
        [
          ['1', 'abc'],
          ['2', ''],
        ],
      )
      source = await ready(broken)
      refused = await preview(
        `UPDATE t SET amount = TRY_CONVERT(int, s.[금액]) FROM dbo.${identifier(table)} AS t JOIN ${source} AS s ON t.id = TRY_CONVERT(int, s.[코드])`,
      )
      expect(refused.detail).toContain('2행의 값 또는 JOIN 키')
      refused = await preview(
        `UPDATE t SET amount = s.[금액] FROM dbo.${identifier(table)} AS t JOIN ${source} AS s ON t.id = TRY_CONVERT(int, s.[코드])`,
      )
      expect(refused.detail).toContain('문자열 열에만')
      expect(await rows()).toEqual([
        { id: 1, amount: 15 },
        { id: 2, amount: 20 },
        { id: 3, amount: 35 },
      ])

      // INSERT SELECT with an anti-join adds only missing ids.
      const additions = stage(
        ['id', 'amount'],
        [
          ['1', '100'],
          ['4', '40'],
          ['5', '50'],
        ],
      )
      source = await ready(additions)
      const insert = `INSERT INTO dbo.${identifier(table)} (id, amount) SELECT TRY_CONVERT(int, s.id), TRY_CONVERT(int, s.amount) FROM ${source} AS s LEFT JOIN dbo.${identifier(table)} AS t ON t.id = TRY_CONVERT(int, s.id) WHERE t.id IS NULL`
      let planned = await preview(insert)
      expect(planned.stage, planned.detail).toBe('preview')
      expect(planned.kind).toBe('insert')
      expect(planned.affectedRows).toBe(2)
      expect(planned.importRows).toEqual({ total: 3 })
      expect(planned.preview?.rows).toEqual(
        expect.arrayContaining([
          { c0: '4', c1: '40' },
          { c0: '5', c1: '50' },
        ]),
      )
      // Rollback leaves the table unchanged.
      let applied = await writes.apply({
        id: planned.id,
        approvalHash: planned.approvalHash,
      })
      expect(applied.stage, applied.detail).toBe('applied')
      expect(applied.affectedRows).toBe(2)
      expect((await writes.rollback({ id: applied.id })).stage).toBe(
        'rolled-back',
      )
      expect(await rows()).toHaveLength(3)

      // A blank join key never matches, so the anti-join would re-insert existing data; it is refused.
      const blankKey = stage(
        ['id', 'amount'],
        [
          ['', '1'],
          ['6', '60'],
        ],
      )
      source = await ready(blankKey)
      refused = await preview(
        `INSERT INTO dbo.${identifier(table)} (id, amount) SELECT TRY_CONVERT(int, s.amount), TRY_CONVERT(int, s.amount) FROM ${source} AS s LEFT JOIN dbo.${identifier(table)} AS t ON t.id = TRY_CONVERT(int, s.id) WHERE t.id IS NULL`,
      )
      expect(refused.stage).toBe('error')
      expect(refused.detail).toContain('1행의 값 또는 JOIN 키')
      expect(await rows()).toHaveLength(3)

      // A concurrent insert between preview and apply changes the locked plan and is refused.
      source = await ready(additions)
      planned = await preview(insert)
      expect(planned.stage, planned.detail).toBe('preview')
      await setup
        .request()
        .query(`INSERT INTO ${target} (id,amount) VALUES (4,44)`)
      applied = await writes.apply({
        id: planned.id,
        approvalHash: planned.approvalHash,
      })
      expect(applied.stage).toBe('rolled-back')
      expect(await rows()).toEqual([
        { id: 1, amount: 15 },
        { id: 2, amount: 20 },
        { id: 3, amount: 35 },
        { id: 4, amount: 44 },
      ])

      source = await ready(additions)
      expect((await commit(insert)).stage).toBe('committed')
      expect(await rows()).toEqual([
        { id: 1, amount: 15 },
        { id: 2, amount: 20 },
        { id: 3, amount: 35 },
        { id: 4, amount: 44 },
        { id: 5, amount: 50 },
      ])
      expect(
        history.filter((entry) => entry.status === 'committed'),
      ).toHaveLength(2)
      const leftovers = await setup
        .request()
        .query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM sys.objects WHERE name LIKE 'stage[_]%'`,
        )
      expect(leftovers.recordset[0]?.total).toBe(0)
    } finally {
      await writes.dispose()
      await database.dispose()
      await fixture.close()
    }
  },
  60000,
)
