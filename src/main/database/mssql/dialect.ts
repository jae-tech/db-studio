import type { CellValue } from '@shared/database'

const safePermissions: Record<string, Set<string>> = {
  DATABASE: new Set([
    'CONNECT',
    'SELECT',
    'VIEW DEFINITION',
    'VIEW DATABASE STATE',
    'VIEW DATABASE PERFORMANCE STATE',
    'VIEW DATABASE SECURITY STATE',
    'VIEW ANY COLUMN ENCRYPTION KEY DEFINITION',
    'VIEW ANY COLUMN MASTER KEY DEFINITION',
    'VIEW PERFORMANCE DEFINITION',
    'VIEW SECURITY DEFINITION',
    'SHOWPLAN',
    'UNMASK',
  ]),
  SERVER: new Set([
    'CONNECT SQL',
    'VIEW ANY DATABASE',
    'VIEW ANY DEFINITION',
    'VIEW SERVER STATE',
    'VIEW SERVER PERFORMANCE STATE',
    'VIEW SERVER SECURITY STATE',
  ]),
  SCHEMA: new Set(['SELECT', 'VIEW DEFINITION']),
  OBJECT: new Set(['SELECT', 'VIEW DEFINITION', 'REFERENCES', 'UNMASK']),
}
export function assessPermissions(
  rows: { scope: string; permission_name: string }[],
): boolean {
  return (
    rows.some(
      (row) => row.scope === 'DATABASE' && row.permission_name === 'CONNECT',
    ) &&
    rows.every(
      (row) => safePermissions[row.scope]?.has(row.permission_name) === true,
    )
  )
}
/** Bound cells before IPC. Decimal/bigint remain strings; duplicate column names are handled by index keys. */
export function serializeCell(value: unknown, type?: string): CellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  // A `date` column has no time part, so it shows like SSMS: 2024-05-07.
  if (value instanceof Date)
    return type === 'Date'
      ? value.toISOString().slice(0, 10)
      : value.toISOString()
  if (Buffer.isBuffer(value))
    return `0x${value.subarray(0, 2048).toString('hex')}${value.length > 2048 ? '… [cell truncated]' : ''}`
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return (text ?? String(value)).length > 8192
    ? `${text.slice(0, 8192)}… [cell truncated]`
    : text
}
