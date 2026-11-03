import { createHash, randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import type { ImportData } from '@main/database/ImportAdapter'
import { parseReadQuery } from '@main/database/policy'
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
const reference = (data: ImportData): string =>
  `[import].${identifier(data.tableName)}`
// Keep assertion diagnostics bounded even if a long Unicode cell regresses.
const summarizeRows = (rows: Record<string, unknown>[]) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === 'string' && value.length > 128
          ? {
              length: value.length,
              sha256: createHash('sha256').update(value).digest('hex'),
            }
          : value,
      ]),
    ),
  )

test.skipIf(!liveWriteEnabled)(
  'dedicated SQL Server: read-only imported text tables preserve literal values, join real data and leave no objects',
  async () => {
    const fixture = await liveFixture()
    const adapter = new MssqlAdapter()
    const profile = { ...fixture.profile, readOnly: true, maxRows: 10 }
    const run = (text: string, signal = new AbortController().signal) =>
      adapter.executeQuery(parseReadQuery(text, 10), randomUUID(), signal)
    const noteColumn = "메모]';--"
    const payload = `x'); DROP TABLE ${fixture.target};-- [literal]`
    const longUnicode = '한글😀'.repeat(1500)
    const first = stage(
      ['source_key', noteColumn],
      [
        ['001', "O'Brien [literal]"],
        ['0002', payload],
        ['0003', ''],
        ['0004', null],
        ['0005', longUnicode],
      ],
    )
    const second = stage(
      ['fixture_key', 'label'],
      [
        ['001', '일치'],
        ['002', '대상 없음'],
      ],
    )
    const conversions = stage(
      ['n', 'day'],
      [
        ['1.25', '2026-10-01'],
        ['2.50', '2024-02-29'],
        ['not numeric', 'not a date'],
      ],
    )
    const selectFirst = `SELECT [source_key], ${identifier(noteColumn)} FROM ${reference(first)} ORDER BY [source_key]`
    const noPersistentObjects = async (): Promise<void> => {
      const persistent = await fixture.setup
        .request()
        .input('first', first.tableName)
        .input('second', second.tableName)
        .input('third', conversions.tableName)
        .query<{ total: number }>(
          'SELECT COUNT(*) AS total FROM sys.objects WHERE name IN (@first,@second,@third)',
        )
      expect(persistent.recordset[0]?.total).toBe(0)
      const temporary = await fixture.setup
        .request()
        .input('first', `#${first.tableName}%`)
        .input('second', `#${second.tableName}%`)
        .input('third', `#${conversions.tableName}%`)
        .query<{ total: number }>(
          'SELECT COUNT(*) AS total FROM tempdb.sys.tables WHERE name LIKE @first OR name LIKE @second OR name LIKE @third',
        )
      expect(temporary.recordset[0]?.total).toBe(0)
    }
    try {
      await adapter.connect(profile, process.env.AI_DB_TEST_PASSWORD!)
      expect(adapter.imports.list()).toEqual([])
      adapter.imports.register(first)
      adapter.imports.register(second)
      adapter.imports.register(conversions)
      expect(await adapter.listSchemas()).toContain('import')
      expect(await adapter.listTables()).toEqual(
        expect.arrayContaining([
          { schema: 'import', name: first.tableName },
          { schema: 'import', name: second.tableName },
        ]),
      )
      expect(await adapter.getColumns('import', first.tableName)).toEqual(
        first.columns.map((name, index) => ({
          name,
          type: 'nvarchar(max)',
          nullable: true,
          primaryKey: false,
          ordinal: index + 1,
        })),
      )
      expect(await adapter.getIndexes('import', first.tableName)).toEqual([])
      expect(await adapter.getForeignKeys('import', first.tableName)).toEqual(
        [],
      )
      const expected = summarizeRows(
        first.rows
          .map((row) => ({ c0: row[0], c1: row[1] }))
          .sort((a, b) => a.c0!.localeCompare(b.c0!)),
      )
      for (let iteration = 0; iteration < 3; iteration += 1) {
        const result = await run(selectFirst)
        expect(summarizeRows(result.rows)).toEqual(expected)
        expect(result.truncated).toBe(false)
        await noPersistentObjects()
      }
      // Values stay text; SQL Server's ordinary int/text comparison resolves
      // the actual id, without importing values into the business table.
      const joined = await run(
        `SELECT s.[source_key], k.[label], d.[amount] FROM ${reference(first)} AS s INNER JOIN ${reference(second)} AS k ON s.[source_key] = k.[fixture_key] INNER JOIN ${fixture.target} AS d ON k.[fixture_key] = d.[id]`,
      )
      expect(joined.rows).toEqual([{ c0: '001', c1: '일치', c2: 10 }])
      await noPersistentObjects()
      const aggregate = await run(
        `SELECT SUM(TRY_CONVERT(decimal(19,4), e.[n])) AS total FROM ${reference(conversions)} AS e`,
      )
      expect(aggregate.rows).toEqual([{ c0: 3.75 }])
      const dates = await run(
        `SELECT e.[n], TRY_CONVERT(date, e.[day], 23) AS parsed_day FROM ${reference(conversions)} AS e ORDER BY e.[n]`,
      )
      expect(dates.rows).toEqual([
        { c0: '1.25', c1: '2026-10-01' },
        { c0: '2.50', c1: '2024-02-29' },
        { c0: 'not numeric', c1: null },
      ])
      await noPersistentObjects()

      // A driver-level SELECT failure must rollback the materialized table and
      // leave the physical pool reusable, not just redact its diagnostics.
      await expect(
        run(`SELECT [missing_column] FROM ${reference(first)}`),
      ).rejects.toMatchObject({ number: 207 })
      await noPersistentObjects()
      expect(summarizeRows((await run(selectFirst)).rows)).toEqual(expected)

      const aborted = new AbortController()
      aborted.abort()
      await expect(run(selectFirst, aborted.signal)).rejects.toThrow(/cancel/i)
      await noPersistentObjects()
      expect(summarizeRows((await run(selectFirst)).rows)).toEqual(expected)

      const businessRows = await fixture.setup
        .request()
        .query<{ id: number; amount: number }>(
          `SELECT id,amount FROM ${fixture.target}`,
        )
      expect(
        businessRows.recordset.map(({ id, amount }) => ({ id, amount })),
      ).toEqual([{ id: 1, amount: 10 }])
      adapter.imports.unregister(first.id)
      await expect(run(selectFirst)).rejects.toThrow(/등록되지|삭제/)
      await expect(
        adapter.getColumns('import', first.tableName),
      ).rejects.toThrow()
      expect(
        (
          await run(
            `SELECT [label] FROM ${reference(second)} WHERE [fixture_key] = N'001'`,
          )
        ).rows,
      ).toEqual([{ c0: '일치' }])
      const missing = stage(['value'], [])
      await expect(
        run(`SELECT [value] FROM ${reference(missing)}`),
      ).rejects.toThrow(/등록되지|삭제/)
      adapter.imports.unregister(second.id)
      adapter.imports.unregister(conversions.id)
      expect(adapter.imports.list()).toEqual([])
      expect(await adapter.listSchemas()).not.toContain('import')
      await noPersistentObjects()
      await adapter.disconnect()
      expect(adapter.imports.list()).toEqual([])
    } finally {
      try {
        await adapter.disconnect()
      } finally {
        await fixture.close()
      }
    }
  },
  30000,
)

test.skipIf(!liveWriteEnabled)(
  'dedicated SQL Server: cancelling imported-table work rolls back and permits another query',
  async () => {
    const fixture = await liveFixture()
    const adapter = new MssqlAdapter()
    const data = stage(
      ['value'],
      Array.from({ length: 2000 }, (_, index) => [String(index)]),
    )
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await adapter.connect(
        { ...fixture.profile, readOnly: true, maxRows: 10 },
        process.env.AI_DB_TEST_PASSWORD!,
      )
      adapter.imports.register(data)
      // A bounded cancel timer interrupts staging or this deliberately large
      // read-only join. The driver's five-second fixture timeout is a fallback.
      const pending = adapter.executeQuery(
        parseReadQuery(
          `SELECT COUNT(*) AS total FROM ${reference(data)} AS a INNER JOIN ${reference(data)} AS b ON 1 = 1 INNER JOIN ${reference(data)} AS c ON 1 = 1`,
          10,
        ),
        randomUUID(),
        controller.signal,
      )
      timer = setTimeout(() => controller.abort(), 50)
      await expect(pending).rejects.toThrow(/cancel/i)
      const after = await adapter.executeQuery(
        parseReadQuery(`SELECT COUNT(*) AS total FROM ${reference(data)}`, 10),
        randomUUID(),
        new AbortController().signal,
      )
      expect(after.rows).toEqual([{ c0: 2000 }])
      const temporary = await fixture.setup
        .request()
        .input('prefix', `#${data.tableName}%`)
        .query<{ total: number }>(
          'SELECT COUNT(*) AS total FROM tempdb.sys.tables WHERE name LIKE @prefix',
        )
      expect(temporary.recordset[0]?.total).toBe(0)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      controller.abort()
      try {
        await adapter.disconnect()
      } finally {
        await fixture.close()
      }
    }
  },
  15000,
)
