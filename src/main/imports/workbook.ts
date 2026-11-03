import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

export type ParsedWorkbook = {
  sheets: {
    name: string
    columns: string[]
    rows: { rowNumber: number; values: string[] }[]
  }[]
}

const MAX_INPUT = 32 * 1024 * 1024
const MAX_EXPANDED = 256 * 1024 * 1024
const MAX_ENTRIES = 4096
const MAX_OUTPUT = 64 * 1024 * 1024
const MAX_ROWS = 50_000
const MAX_COLUMNS = 256
const MAX_CELL = 8192
const fail = (message: string): never => {
  throw new Error(`XLSX parsing failed: ${message}`)
}

/**
 * Best-effort, read-only XLSX values (ADR-036): every cell becomes text. Formulas give
 * Excel's cached result, links/merges/styles are presentation, and nothing in the
 * package is executed, followed or resolved. Only node:zlib and bounded scanning.
 */
export async function readWorkbook(path: string): Promise<ParsedWorkbook> {
  if (extname(path).toLowerCase() !== '.xlsx')
    throw new Error('Only .xlsx files are supported.')
  const file = await open(path, 'r')
  let bytes: Buffer
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > MAX_INPUT)
      throw new Error('Workbook must be a file no larger than 32 MiB.')
    // A bounded read also handles files that grow after stat.
    const buffer = Buffer.alloc(MAX_INPUT + 1)
    let length = 0
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, null)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    if (length > MAX_INPUT) throw new Error('Workbook exceeds 32 MiB.')
    bytes = buffer.subarray(0, length)
  } finally {
    await file.close()
  }
  return parseWorkbook(unzip(bytes))
}

export function unzip(
  bytes: Buffer,
  limit = MAX_EXPANDED,
): Map<string, string> {
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) fail('Invalid XLSX workbook package.')
  const count = bytes.readUInt16LE(end + 10)
  let at = bytes.readUInt32LE(end + 16)
  if (count === 0xffff || at === 0xffffffff)
    fail('ZIP64 workbooks are not supported.')
  if (count > MAX_ENTRIES) fail('Workbook has too many ZIP entries.')
  const parts = new Map<string, string>()
  let declared = 0
  let actual = 0
  for (let index = 0; index < count; index++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50)
      fail('Invalid ZIP directory.')
    const flags = bytes.readUInt16LE(at + 8)
    const method = bytes.readUInt16LE(at + 10)
    const compressed = bytes.readUInt32LE(at + 20)
    const size = bytes.readUInt32LE(at + 24)
    const nameLength = bytes.readUInt16LE(at + 28)
    const skip =
      nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
    const local = bytes.readUInt32LE(at + 42)
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + skip
    if (!name || /[\\:]|^\/|(^|\/)\.\.?(\/|$)/.test(name) || parts.has(name))
      fail('Unsafe or duplicate ZIP entry.')
    if (name.endsWith('/')) continue
    if (/vbaProject/i.test(name))
      fail(
        `Macros, embedded content and external links are not supported (part: ${name}).`,
      )
    if (flags & 1) fail('Encrypted workbooks are not supported.')
    declared += size
    if (declared > limit) fail('Workbook exceeds the expanded ZIP limit.')
    // Only XML parts are read; binary parts (printer settings, images) are never opened.
    if (!/\.(xml|rels)$/i.test(name)) continue
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50)
      fail('Invalid ZIP entry.')
    const start =
      local +
      30 +
      bytes.readUInt16LE(local + 26) +
      bytes.readUInt16LE(local + 28)
    const data = bytes.subarray(start, start + compressed)
    let text: Buffer
    try {
      text =
        method === 0
          ? data
          : method === 8
            ? inflateRawSync(data, {
                maxOutputLength: limit - actual + 1,
              })
            : fail('Unsupported ZIP compression.')
    } catch (error) {
      if (error instanceof RangeError)
        fail('Workbook exceeds the actual expanded ZIP limit.')
      throw error
    }
    actual += text.length
    if (actual > limit) fail('Workbook exceeds the actual expanded ZIP limit.')
    const xml = text.toString('utf8')
    if (/<!DOCTYPE/i.test(xml)) fail('DTD is not allowed in workbook XML.')
    parts.set(name, xml)
  }
  return parts
}

const entities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}
const decode = (text: string): string =>
  text.includes('&')
    ? text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) =>
        entity[0] === '#'
          ? String.fromCodePoint(
              entity[1] === 'x' || entity[1] === 'X'
                ? parseInt(entity.slice(2), 16)
                : parseInt(entity.slice(1), 10),
            )
          : (entities[entity] ?? whole),
      )
    : text
const attributes = (raw: string): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const match of raw.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    result[match[1]!] = decode(match[2] ?? match[3] ?? '')
  return result
}
/** Linear tag/text scan; element names lose their namespace prefix. */
function scan(
  xml: string,
  visit: (
    kind: 'open' | 'close' | 'text',
    name: string,
    raw: string,
    selfClosing: boolean,
  ) => void,
): void {
  const pattern =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)([^>]*?)(\/?)>|([^<]+)/g
  for (const match of xml.matchAll(pattern)) {
    if (match[1] !== undefined) visit('text', '', match[1], false)
    else if (match[3]) {
      const name = match[3].slice(match[3].indexOf(':') + 1)
      if (match[2]) visit('close', name, '', false)
      else visit('open', name, match[4]!, match[5] === '/')
    } else if (match[6] !== undefined)
      visit('text', '', decode(match[6]), false)
  }
}
/** Text of `t` elements, skipping phonetic `rPh` runs. */
function richText(xml: string, item: string): string[] {
  const result: string[] = []
  let current: string[] | undefined
  let inText = false
  let phonetic = 0
  scan(xml, (kind, name, raw, selfClosing) => {
    if (kind === 'open') {
      if (name === item && !selfClosing) current = []
      else if (name === item) result.push('')
      else if (name === 'rPh' && !selfClosing) phonetic++
      else if (name === 't' && !selfClosing) inText = true
    } else if (kind === 'close') {
      if (name === item && current) {
        result.push(current.join(''))
        current = undefined
      } else if (name === 'rPh') phonetic--
      else if (name === 't') inText = false
    } else if (current && inText && !phonetic) current.push(raw)
  })
  return result
}

function parseWorkbook(parts: Map<string, string>): ParsedWorkbook {
  const workbookXml = parts.get('xl/workbook.xml')
  const relsXml = parts.get('xl/_rels/workbook.xml.rels')
  const types = parts.get('[Content_Types].xml')
  if (!workbookXml || !relsXml || !types) fail('Invalid XLSX workbook package.')
  if (/macroEnabled/i.test(types!))
    fail('Only macro-free XLSX workbooks are supported.')
  let date1904 = false
  const sheetRefs: { name: string; id: string }[] = []
  scan(workbookXml!, (kind, name, raw) => {
    if (kind !== 'open') return
    if (name === 'workbookPr') {
      const flag = attributes(raw).date1904
      date1904 = flag === '1' || flag === 'true'
    } else if (name === 'sheet') {
      const attrs = attributes(raw)
      const id = Object.entries(attrs).find(
        ([key]) => /(^|:)id$/.test(key) && key !== 'sheetId',
      )?.[1]
      if (attrs.name && id) sheetRefs.push({ name: attrs.name, id })
    }
  })
  if (sheetRefs.length < 1 || sheetRefs.length > 32)
    fail('Workbook must have between 1 and 32 sheets.')
  const targets = new Map<string, string>()
  scan(relsXml!, (kind, name, raw) => {
    if (kind !== 'open' || name !== 'Relationship') return
    const attrs = attributes(raw)
    if (
      attrs.Id &&
      /\/worksheet$/.test(attrs.Type ?? '') &&
      attrs.TargetMode !== 'External'
    )
      targets.set(attrs.Id, attrs.Target ?? '')
  })
  const shared = parts.has('xl/sharedStrings.xml')
    ? richText(parts.get('xl/sharedStrings.xml')!, 'si')
    : []
  const formats = new Map<string, string>()
  const styles: string[] = []
  if (parts.has('xl/styles.xml')) {
    let inXfs = false
    scan(parts.get('xl/styles.xml')!, (kind, name, raw) => {
      if (name === 'cellXfs') inXfs = kind === 'open'
      else if (kind === 'open' && name === 'numFmt') {
        const attrs = attributes(raw)
        formats.set(attrs.numFmtId ?? '', attrs.formatCode ?? '')
      } else if (kind === 'open' && name === 'xf' && inXfs)
        styles.push(attributes(raw).numFmtId ?? '0')
    })
  }
  const cell = (kind: string, value: string, style: string): string => {
    if (kind === 's') {
      const index = Number(value)
      return Number.isInteger(index) && index >= 0 && index < shared.length
        ? shared[index]!
        : fail('Invalid shared string reference.')
    }
    // Text, booleans, ISO dates and error cells (#N/A) keep their stored text.
    if (kind === 'b')
      return value === '1' ? 'true' : value === '0' ? 'false' : value
    if (kind && kind !== 'n') return value
    if (!value || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) return value
    const formatId = styles[Number(style)] ?? '0'
    const format = formats.get(formatId)
    let isDate = ['14', '15', '16', '17', '22'].includes(formatId)
    if (format !== undefined) {
      const plain = format.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
      if (/[yd]/i.test(plain) && /^[ymdhs/ .:\-ap]+$/i.test(plain))
        isDate = true
      else if (
        /^0+$/.test(format) &&
        /^\d+$/.test(value) &&
        format.length <= 64
      )
        return value.padStart(format.length, '0')
    }
    if (!isDate) return value
    let serial = Number(value)
    if (serial < 0 || serial > 2958465 || (serial === 60 && !date1904))
      return value
    if (!date1904 && serial > 60) serial--
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31)
    const iso = new Date(base + Math.round(serial * 86_400_000)).toISOString()
    return Number.isInteger(serial)
      ? iso.slice(0, 10)
      : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
  }
  let outputBytes = 0
  const sheets: ParsedWorkbook['sheets'] = []
  for (const ref of sheetRefs) {
    const target = targets.get(ref.id)
    // Chart and dialog sheets have no cell grid.
    if (target === undefined) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const xml = parts.get(path.replace(/[^/]+\/\.\.\//g, ''))
    if (xml === undefined) fail('Worksheet part is missing.')
    const rows: { rowNumber: number; values: string[] }[] = []
    let header: string[] | undefined
    let width = 0
    let rowNumber = 0
    let values: string[] = []
    let column = 0
    let cellKind = ''
    let cellStyle = ''
    let cellText: string[] = []
    let inValue = false
    let inInline = false
    let phonetic = 0
    let address = ''
    const endRow = (): void => {
      let last = values.length
      while (last && !values[last - 1]) last--
      if (!last) return
      if (!header) {
        header = values.slice(0, last)
        width = last
        return
      }
      if (rows.length >= MAX_ROWS)
        fail(`Sheet '${ref.name}' exceeds ${MAX_ROWS} rows.`)
      width = Math.max(width, last)
      rows.push({ rowNumber, values: values.slice(0, last) })
    }
    scan(xml!, (kind, name, raw, selfClosing) => {
      if (kind === 'open') {
        if (name === 'row') {
          const r = Number(attributes(raw).r)
          rowNumber = Number.isInteger(r) && r > rowNumber ? r : rowNumber + 1
          values = []
          column = 0
          if (selfClosing) endRow()
        } else if (name === 'c') {
          const attrs = attributes(raw)
          address = attrs.r ?? ''
          const letters = /^([A-Z]{1,3})\d+$/.exec(address)?.[1]
          let next = column + 1
          if (letters) {
            next = 0
            for (const letter of letters)
              next = next * 26 + letter.charCodeAt(0) - 64
          }
          if (next <= column)
            fail(`Duplicate or unordered cell address ${address}.`)
          column = next
          cellKind = attrs.t ?? ''
          cellStyle = attrs.s ?? '0'
          cellText = []
          if (selfClosing) cellText = []
        } else if (name === 'v' && !selfClosing) inValue = true
        else if (name === 'is') inInline = true
        else if (name === 'rPh' && !selfClosing) phonetic++
        else if (name === 't' && inInline && !selfClosing) inValue = true
      } else if (kind === 'close') {
        if (name === 'v' || name === 't') inValue = false
        else if (name === 'is') inInline = false
        else if (name === 'rPh') phonetic--
        else if (name === 'c') {
          const text = cellText.join('')
          const value =
            cellKind === 'inlineStr' ? text : cell(cellKind, text, cellStyle)
          if (value) {
            if (column > MAX_COLUMNS)
              fail(
                `Sheet '${ref.name}' has values beyond column ${MAX_COLUMNS} (${address}).`,
              )
            if (value.length > MAX_CELL)
              fail(
                `Cell ${ref.name}!${address} exceeds ${MAX_CELL} characters.`,
              )
            values[column - 1] = value
            outputBytes += value.length * 3
            if (outputBytes > MAX_OUTPUT)
              fail('Workbook output exceeds 64 MiB.')
          }
        } else if (name === 'row') endRow()
      } else if (inValue && !phonetic) cellText.push(raw)
    })
    // An empty sheet has nothing to stage.
    if (!header) continue
    // Columns with neither a header nor data (e.g. an empty column A) are dropped.
    const kept = Array.from({ length: width }, (_, index) => index).filter(
      (index) =>
        (header![index] ?? '').trim() || rows.some((row) => row.values[index]),
    )
    // Blank, long or repeated headers get usable names; data wider than the header gets 열N columns.
    const seen = new Set<string>()
    const columns = kept.map((index) => {
      const base =
        (header![index] ?? '').trim().slice(0, 120) || `열${index + 1}`
      let unique = base
      for (let n = 2; seen.has(unique.toLowerCase()); n++)
        unique = `${base}_${n}`
      seen.add(unique.toLowerCase())
      return unique
    })
    sheets.push({
      name: ref.name,
      columns,
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        values: kept.map((index) => row.values[index] ?? ''),
      })),
    })
  }
  if (!sheets.length) fail('Every worksheet is empty.')
  return { sheets }
}
