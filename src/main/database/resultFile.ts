import { createWriteStream, type WriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import {
  crc32,
  createDeflateRaw,
  deflateRawSync,
  type DeflateRaw,
} from 'node:zlib'

export type ExportFormat = 'csv' | 'xlsx'
// Rows go into an in-memory buffer; flush() is requested once it passes this size.
const chunkSize = 1 << 20
// Excel's own cell limit; longer text would make the workbook unreadable.
const xlsxCellLimit = 32767

/** Streams one result set into a .partial file and renames it only on success. */
export class ResultFile {
  private parts: string[] = []
  private size = 0
  private rows = 0
  private written = 0
  private failure?: Error
  truncatedCells = 0
  private readonly file: WriteStream
  private readonly temp: string
  private zip?: {
    deflate: DeflateRaw
    offset: number
    crc: number
    raw: number
    packed: number
    entries: ZipEntry[]
  }
  constructor(
    private readonly path: string,
    private readonly format: ExportFormat,
  ) {
    this.temp = `${path}.partial`
    this.file = createWriteStream(this.temp, { flags: 'wx' })
    // Stream errors (disk full, permission) surface on the next write instead of crashing Main.
    this.file.on('error', (error) => {
      this.failure ??= error
    })
    // BOM lets Excel open UTF-8 CSV with Korean text correctly.
    this.push(format === 'csv' ? '﻿' : sheetStart)
  }
  columns(names: string[]): void {
    if (this.format === 'csv') this.push(csvLine(names))
    else this.push(xlsxRow(++this.rows, names, this))
  }
  /** Returns true when the caller should await flush() before sending more rows. */
  row(values: unknown[]): boolean {
    if (this.format === 'csv') this.push(csvLine(values))
    else this.push(xlsxRow(++this.rows, values, this))
    return this.size >= chunkSize
  }
  async flush(): Promise<void> {
    const text = this.parts.join('')
    this.parts = []
    this.size = 0
    if (!text) return
    const bytes = Buffer.from(text, 'utf8')
    if (this.format === 'csv') return this.write(bytes)
    const zip = await this.sheet()
    zip.crc = crc32(bytes, zip.crc)
    zip.raw += bytes.length
    if (zip.raw > 0xffffffff)
      throw new Error('XLSX 시트가 4 GiB를 넘습니다. CSV로 내보내세요.')
    if (this.failure) throw this.failure
    if (!zip.deflate.write(bytes)) await once(zip.deflate, 'drain')
  }
  async finish(): Promise<void> {
    if (this.format === 'xlsx') {
      this.push('</sheetData></worksheet>')
      await this.flush()
      await this.closeSheet()
    } else await this.flush()
    if (this.failure) throw this.failure
    this.file.end()
    await finished(this.file)
    await rename(this.temp, this.path)
  }
  async abort(): Promise<void> {
    this.zip?.deflate.destroy()
    // The handle closes asynchronously (and may still be opening); deleting before
    // 'close' can leave the .partial file behind on Windows.
    const closed = this.file.closed ? undefined : once(this.file, 'close')
    this.file.destroy()
    await closed?.catch(() => undefined)
    await rm(this.temp, { force: true })
  }
  private push(text: string): void {
    this.parts.push(text)
    this.size += text.length
  }
  private async write(bytes: Buffer): Promise<void> {
    if (this.failure) throw this.failure
    this.written += bytes.length
    if (!this.file.write(bytes)) await once(this.file, 'drain')
  }
  // Static parts are small and written whole; the sheet streams through deflate
  // with a data descriptor because its sizes are unknown until the end.
  private async sheet() {
    if (this.zip) return this.zip
    const entries: ZipEntry[] = []
    for (const [name, text] of Object.entries(staticParts)) {
      const raw = Buffer.from(text, 'utf8')
      const packed = deflateRawSync(raw)
      const entry = {
        name,
        offset: this.written,
        crc: crc32(raw),
        raw: raw.length,
        packed: packed.length,
        flags: 0,
      }
      entries.push(entry)
      await this.write(localHeader(entry))
      await this.write(packed)
    }
    const offset = this.written
    await this.write(
      localHeader({
        name: sheetName,
        offset,
        crc: 0,
        raw: 0,
        packed: 0,
        flags: 8,
      }),
    )
    const deflate = createDeflateRaw()
    const zip = { deflate, offset, crc: 0, raw: 0, packed: 0, entries }
    deflate.on('data', (chunk: Buffer) => {
      zip.packed += chunk.length
      this.written += chunk.length
    })
    deflate.on('error', (error) => {
      this.failure ??= error
    })
    deflate.pipe(this.file, { end: false })
    this.zip = zip
    return zip
  }
  private async closeSheet(): Promise<void> {
    const zip = await this.sheet()
    zip.deflate.end()
    await finished(zip.deflate)
    zip.deflate.unpipe(this.file)
    if (zip.packed > 0xffffffff || this.written > 0xffffffff)
      throw new Error('XLSX 파일이 4 GiB를 넘습니다. CSV로 내보내세요.')
    const sheet = {
      name: sheetName,
      offset: zip.offset,
      crc: zip.crc,
      raw: zip.raw,
      packed: zip.packed,
      flags: 8,
    }
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50, 0)
    descriptor.writeUInt32LE(sheet.crc, 4)
    descriptor.writeUInt32LE(sheet.packed, 8)
    descriptor.writeUInt32LE(sheet.raw, 12)
    await this.write(descriptor)
    const all = [...zip.entries, sheet]
    const start = this.written
    for (const entry of all) await this.write(centralHeader(entry))
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(all.length, 8)
    end.writeUInt16LE(all.length, 10)
    end.writeUInt32LE(this.written - start, 12)
    end.writeUInt32LE(start, 16)
    await this.write(end)
  }
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
// RFC 4180: CRLF rows, quotes only where needed. Values are not prefixed against
// spreadsheet formula injection, so the file keeps the database values exactly.
function csvLine(values: unknown[]): string {
  return `${values
    .map((value) => {
      const text = cellText(value)
      return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
    })
    .join(',')}\r\n`
}
// XML 1.0 forbids control characters, U+FFFE/U+FFFF and lone surrogates; Excel rejects them.
const invalidXml =
  // eslint-disable-next-line no-control-regex -- stripping them is the point
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
function xlsxRow(row: number, values: unknown[], file: ResultFile): string {
  const cells = values.map((value, index) => {
    const ref = `${column(index)}${row}`
    if (value === null || value === undefined) return ''
    if (typeof value === 'number' && Number.isFinite(value))
      return `<c r="${ref}"><v>${value}</v></c>`
    let text = cellText(value).replace(invalidXml, '')
    if (text.length > xlsxCellLimit) {
      // Do not leave half of a surrogate pair at the cut.
      text = text.slice(0, xlsxCellLimit).replace(/[\ud800-\udbff]$/, '')
      file.truncatedCells++
    }
    // Inline strings are never evaluated as formulas.
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
  })
  return `<row r="${row}">${cells.join('')}</row>`
}
function column(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}
const escapeXml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

type ZipEntry = {
  name: string
  offset: number
  crc: number
  raw: number
  packed: number
  flags: number
}
const sheetName = 'xl/worksheets/sheet1.xml'
const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const sheetStart = `${xml}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`
const staticParts: Record<string, string> = {
  '[Content_Types].xml': `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  '_rels/.rels': `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  'xl/workbook.xml': `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="결과" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
}
function localHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(entry.flags | 0x800, 6)
  header.writeUInt16LE(8, 8)
  header.writeUInt32LE(entry.crc, 14)
  header.writeUInt32LE(entry.packed, 18)
  header.writeUInt32LE(entry.raw, 22)
  header.writeUInt16LE(name.length, 26)
  return Buffer.concat([header, name])
}
function centralHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, 'utf8')
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(entry.flags | 0x800, 8)
  header.writeUInt16LE(8, 10)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(entry.packed, 20)
  header.writeUInt32LE(entry.raw, 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt32LE(entry.offset, 42)
  return Buffer.concat([header, name])
}
