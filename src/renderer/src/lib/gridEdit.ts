import type { CellValue, QueryResult } from '@shared/database'
import type { MutationState } from '@shared/mutation'
import { desktop } from './desktop'

type Row = Record<string, CellValue>
/** Edited cells per row: column key → original value. */
export type RowEdits = Map<Row, Map<string, CellValue>>

const quote = (name: string): string => `[${name.replaceAll(']', ']]')}]`
const literal = (value: CellValue): string =>
  value === null
    ? 'NULL'
    : typeof value === 'number'
      ? String(value)
      : typeof value === 'boolean'
        ? value
          ? '1'
          : '0'
        : `N'${value.replaceAll("'", "''")}'`

/** Column keys the grid may edit: result columns of the source table that are not keys. */
export function editableKeys(result: QueryResult): Set<string> {
  const source = result.source
  if (!source) return new Set()
  const keys = new Set(source.keys.map((key) => key.toLowerCase()))
  const names = result.columns.map((column) => column.name.toLowerCase())
  // Every PK column must be in the result to address a row exactly once.
  if (![...keys].every((key) => names.includes(key))) return new Set()
  return new Set(
    result.columns
      .filter((column) => !keys.has(column.name.toLowerCase()))
      .map((column) => column.key),
  )
}

/** One UPDATE per edited row, addressed by its primary key. A typed `NULL` writes NULL. */
export function updateStatements(
  result: QueryResult,
  edits: RowEdits,
): string[] {
  const source = result.source!
  const byName = new Map(
    result.columns.map((column) => [column.name.toLowerCase(), column]),
  )
  const table = `${quote(source.schema)}.${quote(source.table)}`
  return [...edits].map(([row, cells]) => {
    const set = [...cells.keys()].map((key) => {
      const column = result.columns.find((item) => item.key === key)!
      const value = row[key] ?? null
      return `${quote(column.name)} = ${value === 'NULL' ? 'NULL' : literal(value)}`
    })
    const where = source.keys.map((name) => {
      const column = byName.get(name.toLowerCase())!
      const value = row[column.key] ?? null
      if (value === null)
        throw new Error(`키 열 ${name}이(가) NULL인 행은 편집할 수 없습니다.`)
      return `${quote(column.name)} = ${literal(value)}`
    })
    return `UPDATE ${table} SET ${set.join(', ')} WHERE ${where.join(' AND ')}`
  })
}

/** The guarded write path (ADR-013/033): locked re-check, apply, then COMMIT. */
export async function applyWrite(
  connectionId: string,
  sql: string,
): Promise<MutationState> {
  const mutations = desktop().db.mutations
  const previewed = await mutations.preview({ connectionId, sql })
  if (previewed.stage !== 'preview') return previewed
  const applied = await mutations.apply({
    id: previewed.id,
    approvalHash: previewed.approvalHash,
  })
  if (applied.stage !== 'applied' || !applied.commitToken) return applied
  return mutations.commit({
    id: applied.id,
    approvalHash: applied.approvalHash,
    commitToken: applied.commitToken,
    databaseConfirmation: applied.database,
  })
}
