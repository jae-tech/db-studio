export type ImportData = {
  id: string
  tableName: string
  columns: string[]
  rows: (string | null)[][]
}

export interface ImportAdapter {
  register(data: ImportData): void
  unregister(id: string): void
  list(): ImportData[]
}

/** Main-memory immutable tables. No rows are returned by database metadata methods. */
export class ImportRegistry implements ImportAdapter {
  private readonly tables = new Map<
    string,
    { data: ImportData; bytes: number }
  >()
  constructor(private readonly assertIdle: () => void = () => undefined) {}
  register(data: ImportData): void {
    this.assertIdle()
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        data.id,
      ) ||
      !/^stage_[a-f0-9]{32}$/.test(data.tableName) ||
      data.columns.length < 1 ||
      data.columns.length > 256 ||
      data.columns.some(
        (column) =>
          !column.trim() || column.length > 128 || column.includes('\0'),
      ) ||
      new Set(data.columns.map((column) => column.trimEnd().toLowerCase()))
        .size !== data.columns.length ||
      data.rows.length > 50000 ||
      data.rows.some(
        (row) =>
          row.length !== data.columns.length ||
          row.some(
            (value) =>
              value !== null &&
              (typeof value !== 'string' || value.length > 8192),
          ),
      )
    )
      throw new Error('엑셀 임시 테이블의 형식 또는 크기가 올바르지 않습니다.')
    const existing = this.tables.get(data.id)
    if (existing) {
      if (JSON.stringify(existing.data) === JSON.stringify(data)) return
      throw new Error('이미 등록된 엑셀 임시 테이블은 변경할 수 없습니다.')
    }
    if (
      this.tables.size >= 8 ||
      [...this.tables.values()].some(
        (table) => table.data.tableName === data.tableName,
      )
    )
      throw new Error('임시 테이블 이름이 중복되거나 8개 한도를 초과했습니다.')
    const bytes = Buffer.byteLength(JSON.stringify(data))
    if (
      bytes +
        [...this.tables.values()].reduce((sum, table) => sum + table.bytes, 0) >
      64 * 1024 * 1024
    )
      throw new Error('엑셀 임시 테이블은 연결당 전체 64 MiB까지 지원합니다.')
    this.tables.set(data.id, { data: structuredClone(data), bytes })
  }
  unregister(id: string): void {
    this.assertIdle()
    this.tables.delete(id)
  }
  list(): ImportData[] {
    return [...this.tables.values()].map(({ data }) => structuredClone(data))
  }
  clear(): void {
    this.tables.clear()
  }
}
