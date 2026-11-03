import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { ResultFile } from '@main/database/resultFile'
import { readWorkbook } from '@main/imports/workbook'

const directories: string[] = []
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'aidb-export-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  )
})
// Drives the writer the way the adapter does: flush whenever row() asks for it.
async function write(
  file: ResultFile,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  file.columns(columns)
  for (const row of rows) if (file.row(row)) await file.flush()
  await file.finish()
}
// Independent ZIP reader: central directory, sizes and CRC must all agree.
function unzip(bytes: Buffer): Map<string, string> {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = bytes.readUInt16LE(end + 10)
  let at = bytes.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50)
    const crc = bytes.readUInt32LE(at + 16)
    const packed = bytes.readUInt32LE(at + 20)
    const raw = bytes.readUInt32LE(at + 24)
    const nameLength = bytes.readUInt16LE(at + 28)
    const offset = bytes.readUInt32LE(at + 42)
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength)
    const start = offset + 30 + bytes.readUInt16LE(offset + 26)
    const data = inflateRawSync(bytes.subarray(start, start + packed))
    expect(data.length).toBe(raw)
    expect(crc32(data)).toBe(crc)
    files.set(name, data.toString('utf8'))
    at += 46 + nameLength
  }
  return files
}

describe('result file export', () => {
  it('writes RFC 4180 CSV with a UTF-8 BOM and leaves no partial file', async () => {
    const dir = await directory()
    const path = join(dir, 'out.csv')
    await write(
      new ResultFile(path, 'csv'),
      ['id', '이름', 'memo'],
      [
        [1, '가나', 'a,"b"\nc'],
        [2, null, Buffer.from([0xab, 0x01])],
        [true, new Date('2026-10-29T01:02:03Z'), '=1+1'],
      ],
    )
    expect(await readFile(path, 'utf8')).toBe(
      '﻿id,이름,memo\r\n1,가나,"a,""b""\nc"\r\n2,,0xab01\r\n1,2026-10-29T01:02:03.000Z,=1+1\r\n',
    )
    expect(await readdir(dir)).toEqual(['out.csv'])
  })
  it('writes an XLSX that the real workbook parser reads back', async () => {
    const dir = await directory()
    const path = join(dir, 'out.xlsx')
    await write(
      new ResultFile(path, 'xlsx'),
      ['id', '이름', 'memo'],
      [
        [1, '가나 <&>', 'line\nbreak'],
        [2.5, '', 'ctl\u0001char'],
      ],
    )
    const parsed = await readWorkbook(path)
    expect(parsed.sheets[0]!.columns).toEqual(['id', '이름', 'memo'])
    expect(parsed.sheets[0]!.rows.map((row) => row.values)).toEqual([
      ['1', '가나 <&>', 'line\nbreak'],
      ['2.5', '', 'ctlchar'],
    ])
  })
  it('streams many rows through deflate with valid sizes and CRCs', async () => {
    const dir = await directory()
    const path = join(dir, 'big.xlsx')
    const rows = Array.from({ length: 30_000 }, (_, index) => [
      index,
      `행 ${index} ${'x'.repeat(40)}`,
    ])
    const file = new ResultFile(path, 'xlsx')
    await write(file, ['n', 'text'], rows)
    const sheet = unzip(await readFile(path)).get('xl/worksheets/sheet1.xml')!
    expect(sheet.match(/<row /g)).toHaveLength(30_001)
    expect(sheet).toContain('<row r="30001"><c r="A30001"><v>29999</v></c>')
    expect(sheet.endsWith('</sheetData></worksheet>')).toBe(true)
    expect(file.truncatedCells).toBe(0)
  })
  it('truncates cells beyond the Excel limit and counts them', async () => {
    const dir = await directory()
    const path = join(dir, 'long.xlsx')
    const file = new ResultFile(path, 'xlsx')
    await write(file, ['v'], [['a'.repeat(40_000)]])
    expect(file.truncatedCells).toBe(1)
    const sheet = unzip(await readFile(path)).get('xl/worksheets/sheet1.xml')!
    expect(sheet).toContain(`>${'a'.repeat(32767)}</t>`)
  })
  it('abort removes the partial file and never overwrites an existing target', async () => {
    const dir = await directory()
    const path = join(dir, 'keep.csv')
    await writeFile(path, 'original')
    const file = new ResultFile(path, 'csv')
    file.columns(['a'])
    file.row([1])
    await file.flush()
    await file.abort()
    expect(await readdir(dir)).toEqual(['keep.csv'])
    expect(await readFile(path, 'utf8')).toBe('original')
  })
})
