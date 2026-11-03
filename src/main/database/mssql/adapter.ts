import sql from 'mssql'
import type {
  ConnectionProfile,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  TableInfo,
  QueryResult,
  QueryColumn,
  CellValue,
} from '@shared/database'
import type { DatabaseAdapter, ResultSink } from '../DatabaseAdapter'
import { parseReadQuery, type ReadQuery } from '../policy'
import { ImportRegistry, type ImportData } from '../ImportAdapter'
import { metadata } from './metadata'
import { assessPermissions, serializeCell } from './dialect'
import { MssqlMutations } from './mutations'

const quote = (name: string): string => `[${name.replaceAll(']', ']]')}]`

export class MssqlAdapter implements DatabaseAdapter {
  isConnected(): boolean {
    return this.pool?.connected === true
  }
  private pool?: sql.ConnectionPool
  private profile?: ConnectionProfile
  private readonly requests = new Map<string, sql.Request>()
  private transaction?: sql.Transaction
  private importTransaction?: sql.Transaction
  // Short rollback-only transaction for unlocked Excel write previews.
  private mutationScope?: sql.Transaction
  readonly imports = new ImportRegistry(() => {
    if (
      this.transaction ||
      this.importTransaction ||
      this.mutationScope ||
      this.requests.size
    )
      throw new Error('쿼리 또는 트랜잭션이 진행 중입니다.')
  })
  readonly mutations = new MssqlMutations(
    () => this.profile,
    () =>
      this.mutationScope ? new sql.Request(this.mutationScope) : this.request(),
    () => this.transaction !== undefined,
    this.requests,
    {
      find: (table) => this.imported('import', table)!,
      load: (tables, requestId, signal) => {
        const scope = this.mutationScope ?? this.transaction
        if (!scope) throw new Error('Mutation requires a transaction')
        return this.loadImports(scope, tables, requestId, signal)
      },
      isolated: (run) => this.isolated(run),
    },
  )
  async connect(
    profile: ConnectionProfile,
    password: string,
  ): Promise<{ permissionVerified: boolean; warning?: string }> {
    if (this.pool) throw new Error('Already connected')
    // mssql forwards options to Tedious; textsize bounds LOB values before they are decoded.
    const options: NonNullable<sql.config['options']> & { textsize: number } = {
      encrypt: true,
      trustServerCertificate: profile.trustServerCertificate,
      appName: 'AI DB Studio',
      enableArithAbort: true,
      abortTransactionOnError: true,
      enableQuotedIdentifier: true,
      useUTC: true,
      textsize: 16384,
    }
    const pool = new sql.ConnectionPool({
      server: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.username,
      password,
      connectionTimeout: 10000,
      requestTimeout: profile.timeoutSeconds * 1000,
      pool: { max: 2, min: 0, idleTimeoutMillis: 10000 },
      options,
    })
    // A pool error is surfaced through subsequent operations; never emit an unhandled EventEmitter error.
    pool.on('error', () => {
      this.pool = undefined
      void pool.close().catch(() => undefined)
    })
    try {
      await pool.connect()
      const rights = await pool
        .request()
        .query<{ scope: string; permission_name: string }>(metadata.permissions)
      // The login's DB roles are the authority (ADR-031): a wider account is neither refused nor warned.
      const permissionVerified = assessPermissions(rights.recordset)
      this.profile = profile
      this.pool = pool
      return { permissionVerified }
    } catch (error) {
      await pool.close().catch(() => undefined)
      throw error
    }
  }
  private request(): sql.Request {
    if (!this.pool?.connected)
      throw new Error('Connection is not available. Reconnect to continue.')
    return this.transaction
      ? new sql.Request(this.transaction)
      : this.pool.request()
  }
  private async query<T>(
    text: string,
    schema?: string,
    table?: string,
  ): Promise<T[]> {
    const request = this.request()
    if (schema !== undefined) request.input('schema', sql.NVarChar(128), schema)
    if (table !== undefined) request.input('table', sql.NVarChar(128), table)
    return (await request.query<T>(text)).recordset
  }
  private metadataSql(text: string, database?: string): string {
    // Catalog names cannot be SQL parameters; quote the validated database identifier.
    return database ? text.replaceAll('sys.', `${quote(database)}.sys.`) : text
  }
  async listDatabases(): Promise<string[]> {
    return (await this.query<{ name: string }>(metadata.databases)).map(
      (row) => row.name,
    )
  }
  async listSchemas(database?: string): Promise<string[]> {
    const schemas = (
      await this.query<{ name: string }>(
        this.metadataSql(metadata.schemas, database),
      )
    ).map((row) => row.name)
    if (database) return schemas
    return [
      ...schemas,
      ...(this.imports.list().length &&
      !schemas.some((name) => name.toLowerCase() === 'import')
        ? ['import']
        : []),
    ]
  }
  async listTables(database?: string): Promise<TableInfo[]> {
    const tables = await this.query<TableInfo>(
      this.metadataSql(metadata.tables, database),
    )
    if (database) return tables
    return [
      ...tables.filter(
        (table) =>
          !(
            table.schema.toLowerCase() === 'import' &&
            /^stage_[a-f0-9]{32}$/.test(table.name)
          ),
      ),
      ...this.imports
        .list()
        .map((data) => ({ schema: 'import', name: data.tableName })),
    ]
  }
  private imported(schema: string, table: string): ImportData | undefined {
    if (
      schema.toLowerCase() !== 'import' ||
      !/^stage_[a-f0-9]{32}$/.test(table)
    )
      return undefined
    const imported = this.imports
      .list()
      .find((data) => data.tableName === table)
    if (!imported)
      throw new Error('등록되지 않았거나 삭제된 엑셀 임시 테이블입니다.')
    return imported
  }
  async getColumns(
    schema: string,
    table: string,
    database?: string,
  ): Promise<ColumnInfo[]> {
    const imported = database ? undefined : this.imported(schema, table)
    if (imported)
      return imported.columns.map((name, index) => ({
        name,
        type: 'nvarchar(max)',
        nullable: true,
        primaryKey: false,
        ordinal: index + 1,
      }))
    return this.query(
      this.metadataSql(metadata.columns, database),
      schema,
      table,
    )
  }
  async getIndexes(
    schema: string,
    table: string,
    database?: string,
  ): Promise<IndexInfo[]> {
    if (!database && this.imported(schema, table)) return []
    return this.query(
      this.metadataSql(metadata.indexes, database),
      schema,
      table,
    )
  }
  async getForeignKeys(
    schema: string,
    table: string,
    database?: string,
  ): Promise<ForeignKeyInfo[]> {
    if (!database && this.imported(schema, table)) return []
    return this.query(
      this.metadataSql(metadata.foreignKeys, database),
      schema,
      table,
    )
  }
  async executeQuery(
    query: ReadQuery,
    requestId: string,
    signal: AbortSignal,
    sink?: ResultSink,
  ): Promise<QueryResult> {
    const profile = this.profile
    if (!profile || signal.aborted) throw new Error('Query cancelled')
    // Restrict FROM/JOIN to real local user tables, excluding synonyms, views, TVFs and external tables.
    const imported = new Map<string, ImportData>()
    for (const table of query.tables) {
      const data = table.database
        ? undefined
        : this.imported(table.schema, table.table)
      if (data) {
        imported.set(data.id, data)
        continue
      }
      // Another database: the login must have access; its catalog is read by quoted name.
      if (table.database) {
        const access = await this.query<{ ok: number | null }>(
          'SELECT HAS_DBACCESS(@schema) AS ok',
          table.database,
        )
        if (access[0]?.ok !== 1)
          throw new Error(
            `데이터베이스 '${table.database}'에 접근할 수 없습니다. 이름과 로그인 권한을 확인하세요.`,
          )
      }
      const catalog = table.database ? `${quote(table.database)}.` : ''
      const found = await this.query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${catalog}sys.tables t JOIN ${catalog}sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = @schema AND t.name = @table AND t.is_ms_shipped = 0 AND NOT EXISTS (SELECT 1 FROM ${catalog}sys.external_tables e WHERE e.object_id = t.object_id)`,
        table.schema,
        table.table,
      )
      if (found[0]?.count !== 1)
        throw new Error(
          table.database
            ? `'${table.database}' 데이터베이스에서 사용자 테이블 ${table.schema}.${table.table}을(를) 찾을 수 없습니다.`
            : 'Only current-database user tables are allowed by the Phase 2 execution policy',
        )
    }
    if (signal.aborted) throw new Error('Query cancelled')
    if (imported.size)
      return this.executeImported(
        query,
        [...imported.values()],
        requestId,
        signal,
        sink,
      )
    return this.streamQuery(query.sql, this.request(), requestId, signal, sink)
  }
  private async executeImported(
    query: ReadQuery,
    tables: ImportData[],
    requestId: string,
    signal: AbortSignal,
    sink?: ResultSink,
  ): Promise<QueryResult> {
    if (
      !this.pool?.connected ||
      !this.profile ||
      this.transaction ||
      this.importTransaction
    )
      throw new Error(
        '엑셀 조회를 시작할 수 없습니다. 연결과 진행 중인 작업을 확인하세요.',
      )
    const transaction = new sql.Transaction(this.pool)
    this.importTransaction = transaction
    let began = false
    let autoRolledBack = false
    transaction.on('rollback', () => {
      autoRolledBack = true
    })
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      began = true
      await this.loadImports(transaction, tables, requestId, signal)
      if (signal.aborted) throw new Error('Query cancelled')
      const names = new Set(tables.map((table) => table.tableName))
      const resolved = parseReadQuery(
        query.sql,
        sink?.maxRows ?? this.profile.maxRows,
        (table) =>
          !table.database &&
          table.schema.toLowerCase() === 'import' &&
          names.has(table.table)
            ? { table: `#${table.table}` }
            : undefined,
        undefined,
        this.profile.database,
        true,
      )
      return await this.streamQuery(
        resolved.sql,
        new sql.Request(transaction),
        requestId,
        signal,
        sink,
      )
    } finally {
      await this.cleanImported(transaction, began, autoRolledBack)
    }
  }
  private async loadImports(
    transaction: sql.Transaction,
    tables: ImportData[],
    requestId: string,
    signal: AbortSignal,
  ): Promise<void> {
    for (const table of tables) {
      if (signal.aborted) throw new Error('Query cancelled')
      await this.importRequest(transaction, requestId, signal, (request) =>
        request.batch(
          `CREATE TABLE ${quote(`#${table.tableName}`)} (${table.columns.map((column) => `${quote(column)} nvarchar(max) NULL`).join(', ')})`,
        ),
      )
      // JSON is a single NVARCHAR(MAX) parameter. No Excel cell becomes SQL text,
      // and OPENJSON WITH preserves long Unicode values and explicit NULLs.
      await this.importRequest(transaction, requestId, signal, (request) => {
        request.input('rows', sql.NVarChar(sql.MAX), JSON.stringify(table.rows))
        return request.query(
          `INSERT INTO ${quote(`#${table.tableName}`)} (${table.columns.map(quote).join(', ')}) SELECT ${table.columns.map((_, index) => quote(`c${index}`)).join(', ')} FROM OPENJSON(@rows) WITH (${table.columns.map((_, index) => `${quote(`c${index}`)} nvarchar(max) '$[${index}]'`).join(', ')})`,
        )
      })
    }
  }
  private async isolated<T>(run: () => Promise<T>): Promise<T> {
    if (
      !this.pool?.connected ||
      this.transaction ||
      this.importTransaction ||
      this.mutationScope
    )
      throw new Error(
        '엑셀 쓰기 미리보기를 시작할 수 없습니다. 연결과 진행 중인 작업을 확인하세요.',
      )
    const transaction = new sql.Transaction(this.pool)
    this.mutationScope = transaction
    let began = false
    let autoRolledBack = false
    transaction.on('rollback', () => {
      autoRolledBack = true
    })
    try {
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED)
      began = true
      return await run()
    } finally {
      this.mutationScope = undefined
      await this.cleanImported(transaction, began, autoRolledBack)
    }
  }
  private async cleanImported(
    transaction: sql.Transaction,
    began: boolean,
    autoRolledBack: boolean,
  ): Promise<void> {
    try {
      if (began && !autoRolledBack) await transaction.rollback()
      if (!began) await this.disconnect()
    } catch (error) {
      // An uncertain rollback must not return a successful result or leave a
      // potentially dirty physical session in the reusable pool.
      await this.disconnect().catch(() => undefined)
      throw error
    } finally {
      this.importTransaction = undefined
    }
  }
  private async importRequest<T>(
    transaction: sql.Transaction,
    requestId: string,
    signal: AbortSignal,
    execute: (request: sql.Request) => Promise<T>,
  ): Promise<T> {
    if (signal.aborted) throw new Error('Query cancelled')
    const request = new sql.Request(transaction)
    this.requests.set(requestId, request)
    const abort = (): void => {
      request.cancel()
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      return await execute(request)
    } finally {
      signal.removeEventListener('abort', abort)
      this.requests.delete(requestId)
    }
  }
  private async streamQuery(
    text: string,
    request: sql.Request,
    requestId: string,
    signal: AbortSignal,
    sink?: ResultSink,
  ): Promise<QueryResult> {
    const profile = this.profile
    if (!profile || signal.aborted) throw new Error('Query cancelled')
    request.stream = true
    request.arrayRowMode = true
    this.requests.set(requestId, request)
    const started = performance.now()
    const columns: QueryColumn[] = []
    const rows: Record<string, CellValue>[] = []
    let truncated = false
    let bytes = 0
    let exported = 0
    // Pending file writes; done waits for it so the result is never reported early.
    let flushing = Promise.resolve()
    const abort = (): void => {
      request.cancel()
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      await new Promise<void>((resolve, reject) => {
        let error: unknown
        request.on(
          'recordset',
          (values: { name: string; type?: { name?: string } }[]) => {
            if (values.length > 256) {
              error = new Error('Results exceed the 256-column limit')
              request.cancel()
              return
            }
            columns.push(
              ...values.map((column, index) => ({
                key: `c${index}`,
                name: column.name || `(column ${index + 1})`,
                type: column.type?.name ?? 'unknown',
              })),
            )
            sink?.columns(columns.map((column) => column.name))
          },
        )
        request.on('row', (values: unknown[]) => {
          if (truncated || error) return
          if (sink) {
            if (++exported > sink.maxRows) {
              error = new Error(
                `내보내기는 최대 ${sink.maxRows.toLocaleString()}행까지 지원합니다. WHERE나 TOP으로 줄이세요.`,
              )
              request.cancel()
            } else if (sink.row(values)) {
              request.pause()
              flushing = flushing
                .then(() => sink.flush())
                .then(
                  () => {
                    request.resume()
                  },
                  (cause: unknown) => {
                    error ??= cause
                    request.cancel()
                  },
                )
            }
            return
          }
          if (rows.length >= profile.maxRows) {
            truncated = true
            request.cancel()
            return
          }
          try {
            const row: Record<string, CellValue> = Object.fromEntries(
              values.map((value, index) => [
                `c${index}`,
                serializeCell(value, columns[index]?.type),
              ]),
            )
            bytes += Buffer.byteLength(JSON.stringify(row), 'utf8')
            if (bytes > 4 * 1024 * 1024) {
              truncated = true
              request.cancel()
              return
            }
            rows.push(row)
          } catch (cause) {
            error = new Error('Unable to serialize a SQL result value', {
              cause,
            })
            request.cancel()
          }
        })
        request.on('error', (cause: unknown) => {
          const code =
            cause && typeof cause === 'object' && 'code' in cause
              ? cause.code
              : undefined
          if (!error && !(truncated && code === 'ECANCEL')) error = cause
        })
        request.on('done', () => {
          void flushing.then(() => {
            if (signal.aborted) reject(new Error('Query cancelled'))
            else if (error) reject(error)
            else resolve()
          })
        })
        // stream API emits done after errors; a callback catches synchronous/early driver failures too.
        try {
          request.query(text, (cause) => {
            if (cause && !truncated && !signal.aborted) reject(cause)
          })
        } catch (cause) {
          reject(cause)
        }
      })
      return {
        requestId,
        columns,
        rows,
        durationMs: Math.round(performance.now() - started),
        truncated,
        rowCount: sink ? exported : rows.length,
      }
    } finally {
      signal.removeEventListener('abort', abort)
      this.requests.delete(requestId)
    }
  }
  cancelQuery(id: string): boolean {
    return this.requests.get(id)?.cancel() ?? false
  }
  async beginTransaction(isolation?: 'serializable'): Promise<void> {
    if (this.transaction || this.importTransaction || this.mutationScope)
      throw new Error('Transaction already active')
    if (!this.pool) throw new Error('Not connected')
    const transaction = new sql.Transaction(this.pool)
    await transaction.begin(
      isolation === 'serializable'
        ? sql.ISOLATION_LEVEL.SERIALIZABLE
        : sql.ISOLATION_LEVEL.READ_COMMITTED,
    )
    this.transaction = transaction
  }
  async commit(): Promise<void> {
    if (!this.transaction) throw new Error('No transaction')
    const transaction = this.transaction
    try {
      await transaction.commit()
    } catch (error) {
      await transaction.rollback().catch(() => undefined)
      throw error
    } finally {
      this.transaction = undefined
    }
  }
  async rollback(): Promise<void> {
    if (!this.transaction) return
    const transaction = this.transaction
    this.transaction = undefined
    await transaction.rollback()
  }
  async disconnect(): Promise<void> {
    for (const request of this.requests.values()) request.cancel()
    await this.rollback().catch(() => undefined)
    const pool = this.pool
    this.pool = undefined
    this.profile = undefined
    this.imports.clear()
    await pool?.close()
  }
}
