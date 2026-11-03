import { z } from 'zod'
import type { MutationApi } from './mutation'
import type { ImportApi } from './imports'

export const idSchema = z.string().uuid()
const name = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes('\0'), 'NUL 문자는 사용할 수 없습니다')
export const connectionSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(80),
    driver: z.literal('mssql').default('mssql'),
    host: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) => !/[;\s\\\0]/.test(value),
        '호스트 이름 또는 IP를 입력하고 포트는 별도 항목에 지정하세요',
      ),
    port: z.number().int().min(1).max(65535).default(1433),
    database: name,
    username: name,
    environment: z.enum(['development', 'production']).default('development'),
    readOnly: z.boolean().default(true),
    encrypt: z.literal(true).default(true),
    trustServerCertificate: z.boolean().default(false),
    timeoutSeconds: z.number().int().min(1).max(120).default(30),
    maxRows: z.number().int().min(1).max(5000).default(1000),
  })
  .strict()
export type ConnectionProfile = z.infer<typeof connectionSchema>
export const saveConnectionSchema = z
  .object({
    profile: connectionSchema,
    password: z.string().max(4096).optional(),
  })
  .strict()
export type SaveConnection = z.infer<typeof saveConnectionSchema>
export type ConnectionSummary = ConnectionProfile & {
  hasPassword: boolean
  status: 'disconnected' | 'connecting' | 'connected'
  currentDatabase: string
  permissionVerified: boolean
  warning?: string
}
export const connectSchema = z
  .object({ connectionId: idSchema, database: name.optional() })
  .strict()
export const scopeSchema = z.object({ connectionId: idSchema }).strict()
export const explorerScopeSchema = z.union([
  idSchema,
  scopeSchema.extend({ database: name }).strict(),
])
export type ExplorerScope = z.infer<typeof explorerScopeSchema>
export const tableScopeSchema = scopeSchema
  .extend({ schema: name, table: name, database: name.optional() })
  .strict()
export type TableScope = z.infer<typeof tableScopeSchema>
export type TableInfo = { schema: string; name: string }
export type ColumnInfo = {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  ordinal: number
}
export type IndexInfo = {
  name: string
  column: string
  unique: boolean
  primaryKey: boolean
  ordinal: number
}
export type ForeignKeyInfo = {
  name: string
  column: string
  referencedSchema: string
  referencedTable: string
  referencedColumn: string
}
export type TableDetails = {
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
}
export type ExplorerData = {
  database: string
  databases: string[]
  schemas: string[]
  tables: TableInfo[]
}
export const reviewQuerySchema = z
  .object({ connectionId: idSchema, sql: z.string().min(1).max(200_000) })
  .strict()
export type ReviewQuery = z.infer<typeof reviewQuerySchema>
export type QueryReview = {
  token: string
  sql: string
  database: string
  expiresAt: number
  maxRows: number
  timeoutSeconds: number
}
export const executeQuerySchema = z
  .object({
    connectionId: idSchema,
    requestId: idSchema,
    approvalToken: idSchema,
  })
  .strict()
export type ExecuteQuery = z.infer<typeof executeQuerySchema>
export const exportQuerySchema = executeQuerySchema
  .extend({ format: z.enum(['csv', 'xlsx']) })
  .strict()
export type ExportQuery = z.infer<typeof exportQuerySchema>
// null when the user cancels the save dialog.
export type ExportResult = {
  fileName: string
  rowCount: number
  durationMs: number
  truncatedCells: number
} | null
export const fetchMoreSchema = z
  .object({
    connectionId: idSchema,
    requestId: idSchema,
    continuation: idSchema,
  })
  .strict()
export type FetchMore = z.infer<typeof fetchMoreSchema>
export const cancelQuerySchema = z
  .object({ connectionId: idSchema, requestId: idSchema })
  .strict()
export type CellValue = string | number | boolean | null
export type QueryColumn = { key: string; name: string; type: string }
export type QueryResult = {
  requestId: string
  columns: QueryColumn[]
  rows: Record<string, CellValue>[]
  durationMs: number
  truncated: boolean
  rowCount: number
  // One-time token for the next page; absent when there are no more rows or paging is undefined.
  continuation?: string
  // Set when every result column is a plain column of one current-database table with a
  // primary key: the grid may edit it through the guarded write path (ADR-037).
  source?: { schema: string; table: string; keys: string[] }
}
export type HistoryEntry = {
  id: string
  connectionId: string
  connectionName: string
  database: string
  sql: string
  startedAt: string
  durationMs: number
  rowCount: number
  status:
    'success' | 'error' | 'cancelled' | 'committed' | 'rolled-back' | 'unknown'
  message: string
}
export interface DatabaseApi {
  imports: ImportApi
  mutations: MutationApi
  listConnections(): Promise<ConnectionSummary[]>
  saveConnection(input: SaveConnection): Promise<ConnectionSummary>
  deleteConnection(connectionId: string): Promise<void>
  connect(input: z.infer<typeof connectSchema>): Promise<ConnectionSummary>
  disconnect(connectionId: string): Promise<void>
  getExplorer(input: ExplorerScope): Promise<ExplorerData>
  describeTable(input: TableScope): Promise<TableDetails>
  reviewQuery(input: ReviewQuery): Promise<QueryReview>
  executeQuery(input: ExecuteQuery): Promise<QueryResult>
  fetchMore(input: FetchMore): Promise<QueryResult>
  exportQuery(input: ExportQuery): Promise<ExportResult>
  cancelQuery(input: z.infer<typeof cancelQuerySchema>): Promise<boolean>
  getHistory(): Promise<HistoryEntry[]>
  listSavedQueries(): Promise<SavedQuery[]>
  saveQuery(input: SaveQuery): Promise<SavedQuery>
  deleteSavedQuery(id: string): Promise<void>
}
const queryName = z.string().trim().min(1).max(64)
export const saveQuerySchema = z
  .object({
    connectionId: idSchema,
    database: name,
    name: queryName,
    aliases: z.array(queryName).max(8),
    sql: z.string().trim().min(1).max(200_000),
  })
  .strict()
export type SaveQuery = z.infer<typeof saveQuerySchema>
export type SavedQuery = SaveQuery & { id: string }
/** Names compare trimmed, whitespace-collapsed, NFC and case-insensitive. */
export const queryKey = (value: string): string =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
const keys = (query: Pick<SaveQuery, 'name' | 'aliases'>): string[] =>
  [query.name, ...query.aliases].map(queryKey)
/**
 * Exact name/alias match inside one connection + database. Never guesses:
 * no match or more than one match is an error, so nothing arbitrary runs.
 */
export function resolveSavedQuery(
  queries: SavedQuery[],
  scope: { connectionId: string; database: string },
  text: string,
): SavedQuery {
  const key = queryKey(text)
  const found = queries.filter(
    (query) =>
      query.connectionId === scope.connectionId &&
      query.database === scope.database &&
      keys(query).includes(key),
  )
  if (found.length === 0)
    throw new Error(
      `현재 DB에 '${text.trim()}' 이름이나 별칭의 저장 쿼리가 없습니다.`,
    )
  if (found.length > 1)
    throw new Error(
      `'${text.trim()}'이(가) 저장 쿼리 여러 개와 일치합니다. 정확한 이름을 사용하세요.`,
    )
  return found[0]!
}
/** Throws when a name/alias is reused in the same connection + database. */
export function assertUniqueQueryNames(
  queries: SavedQuery[],
  next: SaveQuery & { id?: string },
): void {
  const own = keys(next)
  if (new Set(own).size !== own.length)
    throw new Error('이름과 별칭은 서로 겹치지 않아야 합니다.')
  const taken = queries
    .filter(
      (query) =>
        query.id !== next.id &&
        query.connectionId === next.connectionId &&
        query.database === next.database,
    )
    .flatMap(keys)
  const clash = own.find((key) => taken.includes(key))
  if (clash)
    throw new Error(
      `'${clash}'은(는) 이 DB의 다른 저장 쿼리가 이미 사용 중입니다.`,
    )
}
