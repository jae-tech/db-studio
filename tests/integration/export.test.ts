import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
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

// Reads the streamed sheet back and checks every entry's CRC and size.
function sheetXml(bytes: Buffer): string {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let at = bytes.readUInt32LE(end + 16)
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    const packed = bytes.readUInt32LE(at + 20)
    const nameLength = bytes.readUInt16LE(at + 28)
    const offset = bytes.readUInt32LE(at + 42)
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength)
    const start = offset + 30 + bytes.readUInt16LE(offset + 26)
    const data = inflateRawSync(bytes.subarray(start, start + packed))
    expect(crc32(data)).toBe(bytes.readUInt32LE(at + 16))
    expect(data.length).toBe(bytes.readUInt32LE(at + 24))
    if (name === 'xl/worksheets/sheet1.xml') return data.toString('utf8')
    at += 46 + nameLength
  }
  throw new Error('sheet missing')
}

test.skipIf(!liveWriteEnabled)(
  'dedicated SQL Server: exports 50,000 rows beyond the grid cap to CSV and XLSX with driver backpressure',
  async () => {
    const fixture = await liveFixture()
    const { profile, setup, table, target } = fixture
    const dir = await mkdtemp(join(tmpdir(), 'aidb-live-export-'))
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
    const exportTo = async (
      sql: string,
      format: 'csv' | 'xlsx',
      path: string,
    ) =>
      database.exportQuery(
        {
          connectionId: profile.id,
          requestId: randomUUID(),
          approvalToken: database.reviewQuery({ connectionId: profile.id, sql })
            .token,
          format,
        },
        async () => path,
      )
    try {
      await setup
        .request()
        .query(
          `DELETE FROM ${target}; WITH n AS (SELECT TOP (50000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b) INSERT INTO ${target} (id, amount) SELECT i, 100000 - i FROM n`,
        )
      await database.connect({ connectionId: profile.id })
      const sql = `SELECT id, amount AS [금액] FROM dbo.${identifier(table)} ORDER BY id`

      const csvPath = join(dir, 'all.csv')
      const csv = await exportTo(sql, 'csv', csvPath)
      expect(csv).toMatchObject({ fileName: 'all.csv', rowCount: 50000 })
      const lines = (await readFile(csvPath, 'utf8')).split('\r\n')
      expect(lines[0]).toBe('﻿id,금액')
      expect(lines[1]).toBe('1,99999')
      expect(lines[50000]).toBe('50000,50000')
      expect(lines).toHaveLength(50002)

      const xlsxPath = join(dir, 'all.xlsx')
      const xlsx = await exportTo(sql, 'xlsx', xlsxPath)
      expect(xlsx).toMatchObject({ rowCount: 50000, truncatedCells: 0 })
      const sheet = sheetXml(await readFile(xlsxPath))
      expect(sheet.match(/<row /g)).toHaveLength(50001)
      expect(sheet).toContain(
        '<row r="50001"><c r="A50001"><v>50000</v></c><c r="B50001"><v>50000</v></c></row>',
      )

      // The grid path still stops at the profile cap.
      const grid = await database.executeQuery({
        connectionId: profile.id,
        requestId: randomUUID(),
        approvalToken: database.reviewQuery({ connectionId: profile.id, sql })
          .token,
      })
      expect(grid.rowCount).toBe(profile.maxRows)

      // Writes stay refused on the export path, and a refused run leaves no file.
      expect(() =>
        database.reviewQuery({
          connectionId: profile.id,
          sql: `DELETE FROM dbo.${identifier(table)}`,
        }),
      ).toThrow()
      await expect(
        exportTo(
          `SELECT id FROM dbo.${identifier(table)} WHERE 1 / (id - id) = 0`,
          'xlsx',
          join(dir, 'failed.xlsx'),
        ),
      ).rejects.toThrow()
      expect((await readdir(dir)).sort()).toEqual(['all.csv', 'all.xlsx'])
      expect(history.map((entry) => entry.status)).toEqual([
        'success',
        'success',
        'success',
        'error',
      ])
    } finally {
      await database.dispose()
      await fixture.close()
      await rm(dir, { recursive: true, force: true })
    }
  },
  120000,
)
