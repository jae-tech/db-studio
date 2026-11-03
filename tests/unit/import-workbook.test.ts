import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkbook, unzip } from '@main/imports/workbook'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const directories: string[] = []

// Minimal real ZIP writer, with CRC and central directory: no parser mocks or dependencies.
function zip(entries: [string, string, number?][]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text, declaredSize] of entries) {
    const data = Buffer.from(text)
    const compressed = deflateRawSync(data)
    const filename = Buffer.from(name)
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(declaredSize ?? data.length, 22)
    header.writeUInt16LE(filename.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(8, 10)
    directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(compressed.length, 20)
    directory.writeUInt32LE(declaredSize ?? data.length, 24)
    directory.writeUInt16LE(filename.length, 28)
    directory.writeUInt32LE(offset, 42)
    local.push(header, filename, compressed)
    central.push(directory, filename)
    offset += header.length + filename.length + compressed.length
  }
  const footer = Buffer.alloc(22)
  footer.writeUInt32LE(0x06054b50)
  footer.writeUInt16LE(entries.length, 8)
  footer.writeUInt16LE(entries.length, 10)
  footer.writeUInt32LE(Buffer.concat(central).length, 12)
  footer.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, footer])
}

function inline(address: string, text: string): string {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  return `<c r="${address}" t="inlineStr"><is><t>${escaped}</t></is></c>`
}

function entries(
  cells = '<c r="A2"><v>12.3400</v></c>',
  options: { date1904?: boolean; styles?: string; shared?: string } = {},
): [string, string, number?][] {
  const result: [string, string, number?][] = [
    [
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    ],
    [
      'xl/workbook.xml',
      `<workbook xmlns="${NS}" xmlns:r="${REL}"><workbookPr date1904="${options.date1904 ? '1' : '0'}"/><sheets><sheet name="정산" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ],
    [
      'xl/worksheets/sheet1.xml',
      `<worksheet xmlns="${NS}"><sheetData><row r="1">${inline('A1', '결제번호')}${inline('B1', '금액')}${inline('C1', '일자')}</row><row r="2">${cells}</row></sheetData></worksheet>`,
    ],
  ]
  if (options.styles) result.push(['xl/styles.xml', options.styles])
  if (options.shared) result.push(['xl/sharedStrings.xml', options.shared])
  return result
}

async function fixture(
  data: [string, string, number?][],
  name = '정산.xlsx',
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-xlsx-test-'))
  directories.push(directory)
  const path = join(directory, name)
  await writeFile(path, zip(data))
  return path
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('bounded best-effort XLSX reader (ADR-036)', () => {
  it('reads actual ZIP, Unicode, shared/inline strings, exact decimals and 1900 dates', async () => {
    const path = await fixture(
      entries(
        '<c r="A2" t="s"><v>0</v></c><c r="B2"><v>1234567890.12345</v></c><c r="C2" s="1"><v>45292</v></c>',
        {
          shared: `<sst xmlns="${NS}"><si><r><t>00</t></r><r><t>123한글</t></r></si></sst>`,
          styles: `<styleSheet xmlns="${NS}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
        },
      ),
    )
    expect(await readWorkbook(path)).toEqual({
      sheets: [
        {
          name: '정산',
          columns: ['결제번호', '금액', '일자'],
          rows: [
            {
              rowNumber: 2,
              values: ['00123한글', '1234567890.12345', '2024-01-01'],
            },
          ],
        },
      ],
    })
  })

  it('preserves zero-formatted numeric identifiers, decimal scale and 1904 dates', async () => {
    const path = await fixture(
      entries(
        '<c r="A2" s="1"><v>123</v></c><c r="B2"><v>12.3400</v></c><c r="C2" s="2"><v>0</v></c>',
        {
          date1904: true,
          styles: `<styleSheet xmlns="${NS}"><numFmts><numFmt numFmtId="164" formatCode="00000000"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`,
        },
      ),
    )
    expect((await readWorkbook(path)).sheets[0]?.rows[0]?.values).toEqual([
      '00000123',
      '12.3400',
      '1904-01-01',
    ])
  })

  it('reads cached formula results and keeps lossy numbers as their stored text', async () => {
    const path = await fixture(
      entries(
        '<c r="A2"><f>1+1</f><v>2</v></c><c r="B2"><v>1234567890123456</v></c><c r="C2"><v>1.23E+15</v></c>',
      ),
    )
    expect((await readWorkbook(path)).sheets[0]?.rows[0]?.values).toEqual([
      '2',
      '1234567890123456',
      '1.23E+15',
    ])
  })

  it.each([
    [
      'duplicate cells',
      '<c r="A2"><v>1</v></c><c r="A2"><v>2</v></c>',
      /Duplicate/,
    ],
    ['values beyond column 256', '<c r="IW2"><v>12</v></c>', /column 256/],
    ['cell length', inline('A2', 'a'.repeat(8193)), /8192/],
  ])('rejects %s', async (_name, cells, expected) => {
    await expect(readWorkbook(await fixture(entries(cells)))).rejects.toThrow(
      expected,
    )
  })

  it('ignores links, external-link parts and binary parts: only values are read', async () => {
    const parsed = await readWorkbook(
      await fixture([
        ...entries(),
        ['xl/externalLinks/externalLink1.xml', '<externalLink/>'],
        [
          'xl/externalLinks/_rels/externalLink1.xml.rels',
          '<Relationships><Relationship TargetMode="External" Target="file:///other.xlsx"/></Relationships>',
        ],
        ['xl/custom.bin', 'blob'],
      ]),
    )
    expect(parsed.sheets[0]?.rows[0]?.values).toEqual(['12.3400', '', ''])
  })

  it.each([
    ['ZIP traversal', '../outside.xml', '<outside/>', /Unsafe/],
    ['duplicate ZIP entries', 'xl/workbook.xml', '<workbook/>', /duplicate/],
    [
      'macros',
      'xl/vbaProject.bin',
      'macro',
      /Macros.*part: xl\/vbaProject\.bin/,
    ],
    [
      'DTD',
      'extra.xml',
      '<!DOCTYPE root [<!ENTITY x "test">]><root>&x;</root>',
      /DTD/,
    ],
  ])('rejects %s packages', async (_name, path, content, expected) => {
    await expect(
      readWorkbook(await fixture([...entries(), [path, content]])),
    ).rejects.toThrow(expected)
  })

  it('accepts the printer-settings binary part Excel adds to ordinary workbooks', async () => {
    const parsed = await readWorkbook(
      await fixture([
        ...entries(),
        ['xl/printerSettings/printerSettings1.bin', 'DEVMODE'],
      ]),
    )
    expect(parsed.sheets[0]?.rows.length).toBeGreaterThan(0)
  })

  it('rejects ZIP bombs by declared and by actual decompressed size', async () => {
    await expect(
      readWorkbook(
        await fixture([
          ...entries(),
          ['huge.xml', 'small', 256 * 1024 * 1024 + 1],
        ]),
      ),
    ).rejects.toThrow(/expanded ZIP/)
    // Metadata that lies about the size is caught while inflating.
    expect(() =>
      unzip(zip([...entries(), ['dishonest.xml', 'x'.repeat(5000), 1]]), 4096),
    ).toThrow(/actual expanded ZIP/)
  })

  it('enforces worksheet and row limits', async () => {
    const sheets = entries()
    const workbook = sheets.find(([path]) => path === 'xl/workbook.xml')!
    workbook[1] = workbook[1].replace(
      '<sheet name="정산" sheetId="1" r:id="rId1"/>',
      Array.from(
        { length: 33 },
        (_, index) => `<sheet name="sheet${index}" r:id="rId1"/>`,
      ).join(''),
    )
    await expect(readWorkbook(await fixture(sheets))).rejects.toThrow(
      /1 and 32 sheets/,
    )
    const rows = entries()
    const sheet = rows.find(([path]) => path === 'xl/worksheets/sheet1.xml')!
    sheet[1] = sheet[1].replace(
      '</sheetData>',
      Array.from(
        { length: 50_000 },
        (_, index) =>
          `<row r="${index + 3}"><c r="A${index + 3}"><v>1</v></c></row>`,
      ).join('') + '</sheetData>',
    )
    await expect(readWorkbook(await fixture(rows))).rejects.toThrow(
      /50000 rows/,
    )
  })

  it.each([
    ['60', '14', '60'],
    ['45292.5', '14', '2024-01-01 12:00:00'],
    ['123', '49', '123'],
  ])(
    'keeps unsupported or time-of-day numeric date/style values readable: %s',
    async (value, formatId, expected) => {
      const parsed = await readWorkbook(
        await fixture(
          entries(`<c r="A2" s="0"><v>${value}</v></c>`, {
            styles: `<styleSheet xmlns="${NS}"><cellXfs><xf numFmtId="${formatId}"/></cellXfs></styleSheet>`,
          }),
        ),
      )
      expect(parsed.sheets[0]?.rows[0]?.values[0]).toBe(expected)
    },
  )

  it.each([
    [inline('A1', 'ID') + inline('B1', 'id'), ['ID', 'id_2']],
    [
      inline('A1', 'ID') +
        inline('C1', 'amount') +
        '</row><row r="2">' +
        inline('B2', 'x'),
      ['ID', '열2', 'amount'],
    ],
    [inline('A1', 'x'.repeat(129)), ['x'.repeat(120)]],
  ])('names blank, repeated and long headers', async (header, expected) => {
    const data = entries()
    const sheet = data.find(([path]) => path === 'xl/worksheets/sheet1.xml')!
    sheet[1] = `<worksheet xmlns="${NS}"><sheetData><row r="1">${header}</row></sheetData></worksheet>`
    expect(
      (await readWorkbook(await fixture(data))).sheets[0]?.columns,
    ).toEqual(expected)
  })

  it('treats executable-looking filenames and cell content only as data', async () => {
    const text = "'; throw 'injected'; $(Get-Process)"
    const path = await fixture(
      entries(inline('A2', text)),
      "book'; throw 'owned.xlsx",
    )
    expect((await readWorkbook(path)).sheets[0]?.rows[0]?.values).toEqual([
      text,
      '',
      '',
    ])
  })

  it('rejects legacy extensions and oversized input before reading it', async () => {
    await expect(readWorkbook('legacy.xls')).rejects.toThrow(/Only .xlsx/)
    const path = await fixture(entries())
    await writeFile(path, Buffer.alloc(32 * 1024 * 1024 + 1))
    await expect(readWorkbook(path)).rejects.toThrow(/32 MiB/)
  })
})
