import type {
  ConnectionProfile,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  TableInfo,
  QueryResult,
} from '@shared/database'
import type { ReadQuery } from './policy'
import type { MutationAdapter } from './MutationAdapter'
import type { ImportAdapter } from './ImportAdapter'

// File export target: rows are streamed instead of collected, and row()
// returning true asks the adapter to pause the driver until flush() settles.
export type ResultSink = {
  columns(names: string[]): void
  row(values: unknown[]): boolean
  flush(): Promise<void>
  maxRows: number
}
export interface DatabaseAdapter {
  mutations?: MutationAdapter
  imports?: ImportAdapter
  isConnected(): boolean
  connect(
    profile: ConnectionProfile,
    password: string,
  ): Promise<{ permissionVerified: boolean; warning?: string }>
  disconnect(): Promise<void>
  listDatabases(): Promise<string[]>
  listSchemas(database?: string): Promise<string[]>
  listTables(database?: string): Promise<TableInfo[]>
  getColumns(
    schema: string,
    table: string,
    database?: string,
  ): Promise<ColumnInfo[]>
  getIndexes(
    schema: string,
    table: string,
    database?: string,
  ): Promise<IndexInfo[]>
  getForeignKeys(
    schema: string,
    table: string,
    database?: string,
  ): Promise<ForeignKeyInfo[]>
  executeQuery(
    query: ReadQuery,
    requestId: string,
    signal: AbortSignal,
    sink?: ResultSink,
  ): Promise<QueryResult>
  cancelQuery(requestId: string): boolean
  beginTransaction(isolation?: 'serializable'): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}
