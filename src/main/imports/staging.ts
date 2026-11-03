import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { ImportStage, ImportWorkbook } from '@shared/imports'
import type { ParsedWorkbook } from './workbook'

export type { ParsedWorkbook } from './workbook'
export type ImportRawRow = { rowNumber: number; values: (string | null)[] }
export interface ImportStagePort {
  open(path: string, workbook: ParsedWorkbook): ImportWorkbook
  stage(input: { workbookId: string; sheetName: string }): ImportStage
  get(id: string): ImportStage
  getRows(id: string): ImportRawRow[]
  prune(protectedStages: ReadonlySet<string>): void
  discard(id: string, protectedStages: ReadonlySet<string>): void
  dispose(): void
}

/** All imported cells stay in Main's memory-only SQLite connection, never the settings DB. */
export class ImportStageStore implements ImportStagePort {
  private readonly db: Database.Database
  private workbooks = new Map<
    string,
    { metadata: ImportWorkbook; parsed: ParsedWorkbook; touched: number }
  >()
  private stages = new Map<string, { metadata: ImportStage; touched: number }>()
  private readonly ttl = 30 * 60 * 1000
  constructor(
    private readonly now: () => number = Date.now,
    factory: () => Database.Database = () => new Database(':memory:'),
  ) {
    this.db = factory()
  }
  open(path: string, workbook: ParsedWorkbook): ImportWorkbook {
    if (this.workbooks.size >= 3)
      throw new Error(
        '열린 통합 문서는 최대 3개입니다. 먼저 기존 문서를 삭제하세요.',
      )
    if (
      !workbook.sheets.length ||
      workbook.sheets.length > 32 ||
      new Set(workbook.sheets.map((sheet) => sheet.name)).size !==
        workbook.sheets.length
    )
      throw new Error('통합 문서 시트 목록이 올바르지 않습니다.')
    for (const sheet of workbook.sheets) {
      if (
        !sheet.name ||
        sheet.name.length > 128 ||
        !sheet.columns.length ||
        sheet.columns.length > 256 ||
        sheet.rows.length > 50000
      )
        throw new Error('가져오기 시트 크기 제한을 초과했습니다.')
      if (
        sheet.columns.some(
          (column) =>
            !column.trim() || column.length > 128 || column.includes('\0'),
        ) ||
        new Set(sheet.columns.map((column) => column.toLowerCase())).size !==
          sheet.columns.length
      )
        throw new Error(
          '열 이름은 비어 있지 않은 128자 이하여야 하며 대소문자 구분 없이 고유해야 합니다.',
        )
      const numbers = new Set<number>()
      for (const row of sheet.rows) {
        if (
          !Number.isSafeInteger(row.rowNumber) ||
          row.rowNumber < 1 ||
          numbers.has(row.rowNumber) ||
          row.values.length > sheet.columns.length ||
          row.values.some(
            (value) => typeof value !== 'string' || value.length > 8192,
          )
        )
          throw new Error('가져오기 행 데이터가 올바르지 않습니다.')
        numbers.add(row.rowNumber)
      }
    }
    const metadata: ImportWorkbook = {
      id: randomUUID(),
      fileName: basename(path),
      sheets: workbook.sheets.map((sheet) => ({
        name: sheet.name,
        columns: [...sheet.columns],
        rowCount: sheet.rows.length,
      })),
    }
    this.workbooks.set(metadata.id, {
      metadata,
      parsed: structuredClone(workbook),
      touched: this.now(),
    })
    return structuredClone(metadata)
  }
  stage(input: { workbookId: string; sheetName: string }): ImportStage {
    const workbook = this.workbooks.get(input.workbookId)
    const sheet = workbook?.parsed.sheets.find(
      (item) => item.name === input.sheetName,
    )
    if (!workbook || !sheet)
      throw new Error('통합 문서 또는 시트를 찾을 수 없습니다.')
    if (this.stages.size >= 8)
      throw new Error(
        '임시 테이블은 최대 8개입니다. 먼저 기존 테이블을 삭제하세요.',
      )
    const id = randomUUID()
    const tableName = `stage_${id.replaceAll('-', '')}`
    this.db.exec(
      `CREATE TEMP TABLE "${tableName}" (row_number INTEGER PRIMARY KEY, data TEXT NOT NULL)`,
    )
    try {
      const insert = this.db.prepare(
        `INSERT INTO "${tableName}" (row_number, data) VALUES (?, ?)`,
      )
      this.db.transaction(() => {
        for (const row of sheet.rows)
          insert.run(row.rowNumber, JSON.stringify(row.values))
      })()
    } catch (error) {
      this.db.exec(`DROP TABLE "${tableName}"`)
      throw error
    }
    const metadata: ImportStage = {
      id,
      workbookId: input.workbookId,
      sheetName: sheet.name,
      tableName,
      columns: [...sheet.columns],
      rowCount: sheet.rows.length,
      sample: structuredClone(sheet.rows.slice(0, 20)),
    }
    workbook.touched = this.now()
    this.stages.set(id, { metadata, touched: this.now() })
    return structuredClone(metadata)
  }
  get(id: string): ImportStage {
    const stage = this.stages.get(id)
    if (!stage) throw new Error('임시 테이블이 없거나 만료되었습니다.')
    stage.touched = this.now()
    const workbook = this.workbooks.get(stage.metadata.workbookId)
    if (workbook) workbook.touched = this.now()
    return structuredClone(stage.metadata)
  }
  getRows(id: string): ImportRawRow[] {
    const stage = this.get(id)
    return (
      this.db
        .prepare(
          `SELECT row_number, data FROM "${stage.tableName}" ORDER BY row_number`,
        )
        .all() as { row_number: number; data: string }[]
    ).map((row) => {
      const values = JSON.parse(row.data) as string[]
      return {
        rowNumber: row.row_number,
        values: stage.columns.map((_, index) => values[index] ?? null),
      }
    })
  }
  prune(protectedStages: ReadonlySet<string>): void {
    for (const [id, stage] of this.stages) {
      if (!protectedStages.has(id) && stage.touched + this.ttl <= this.now())
        this.discard(id, protectedStages)
    }
    for (const [id, workbook] of this.workbooks) {
      if (
        workbook.touched + this.ttl <= this.now() &&
        ![...this.stages.values()].some(
          (stage) =>
            protectedStages.has(stage.metadata.id) &&
            stage.metadata.workbookId === id,
        )
      )
        this.discard(id, protectedStages)
    }
  }
  discard(id: string, protectedStages: ReadonlySet<string>): void {
    const ids = this.stages.has(id)
      ? [id]
      : [...this.stages.values()]
          .filter((stage) => stage.metadata.workbookId === id)
          .map((stage) => stage.metadata.id)
    if (ids.some((stageId) => protectedStages.has(stageId)))
      throw new Error('사용 중인 임시 테이블을 연결에서 먼저 해제하세요.')
    for (const stageId of ids) {
      this.db.exec(
        `DROP TABLE "${this.stages.get(stageId)!.metadata.tableName}"`,
      )
      this.stages.delete(stageId)
    }
    this.workbooks.delete(id)
  }
  dispose(): void {
    this.stages.clear()
    this.workbooks.clear()
    this.db.close()
  }
}
