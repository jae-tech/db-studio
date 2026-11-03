import { deflateRawSync } from 'node:zlib'

type ZipEntry = [name: string, text: string]
export type XlsxFixtureCell = string | { numeric: string }

// Real ZIP writer with CRC and central directory, without a spreadsheet dependency.
function zip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of entries) {
    const data = Buffer.from(text)
    const compressed = deflateRawSync(data)
    const filename = Buffer.from(name)
    let crc = 0xffffffff
    for (const byte of data) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(filename.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(8, 10)
    directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(compressed.length, 20)
    directory.writeUInt32LE(data.length, 24)
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

const escapeXml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

function columnName(index: number): string {
  let name = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name
  return name
}

export function xlsxFixtureBytes({
  sheetName = '수입 내역',
  columns = ['결제번호', '금액', '이름'],
  rows = [
    ['00001234', { numeric: '1234567890.12345' }, '김민수 한글'],
    ['00000009', { numeric: '12.3400' }, '최유니코드 & <확인>'],
  ],
}: {
  sheetName?: string
  columns?: string[]
  rows?: XlsxFixtureCell[][]
} = {}): Buffer {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
  const rel =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const sheetRows = [columns, ...rows]
    .map(
      (values, rowIndex) =>
        `<row r="${rowIndex + 1}">${values
          .map((value, columnIndex) => {
            const address = `${columnName(columnIndex)}${rowIndex + 1}`
            return typeof value === 'string'
              ? `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
              : `<c r="${address}"><v>${escapeXml(value.numeric)}</v></c>`
          })
          .join('')}</row>`,
    )
    .join('')
  return zip([
    [
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ],
    [
      'xl/worksheets/sheet1.xml',
      `<worksheet xmlns="${ns}"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ],
  ])
}
