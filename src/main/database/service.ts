import { randomUUID } from 'node:crypto'
import {
  cancelQuerySchema,
  connectSchema,
  executeQuerySchema,
  explorerScopeSchema,
  exportQuerySchema,
  fetchMoreSchema,
  idSchema,
  reviewQuerySchema,
  saveConnectionSchema,
  tableScopeSchema,
  type ConnectionProfile,
  type ConnectionSummary,
  type ExportResult,
  type ExplorerData,
  type HistoryEntry,
  type QueryResult,
  type QueryReview,
  type TableDetails,
} from '@shared/database'
import type { DatabaseAdapter } from './DatabaseAdapter'
import type { DatabaseRepositoryPort } from './repository'
import {
  exportRowLimit,
  mutationRowLimit,
  parseMutation,
  parseReadQuery,
  type ReadQuery,
} from './policy'
import {
  mutationPreviewSchema,
  type MutationInspection,
} from '@shared/mutation'
import { ResultFile, type ExportFormat } from './resultFile'
import { basename } from 'node:path'
import type { MetadataScope } from '../mcp/metadata'
import type { ImportData } from './ImportAdapter'
import type { ImportTable } from '@shared/imports'

type Session = {
  adapter: DatabaseAdapter
  profile: ConnectionProfile
  permissionVerified: boolean
  warning?: string
  generation: string
  importRevision?: number
}
type Continuation = {
  connectionId: string
  generation: string
  importRevision: number
  source: string
  offset: number
  order?: string[][]
  expiresAt: number
}
type Approval = {
  connectionId: string
  generation: string
  expiresAt: number
  query: ReadQuery
  source: string
}
export function databaseError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
  const messages: Record<string, string> = {
    ELOGIN:
      'SQL Server authentication failed. Check the username, password and database access.',
    ESOCKET:
      'SQL Server network/TLS connection failed. Check the host, port and certificate.',
    ETIMEOUT: 'SQL Server request timed out.',
    ECANCEL: 'Query cancelled.',
    ENOTOPEN: 'The database connection is closed. Reconnect to continue.',
  }
  if (messages[code]) return messages[code]
  if (code)
    return `SQL Server request failed (${code}). Check permissions, SQL syntax and connection settings.`
  return error instanceof Error ? error.message : 'Database operation failed'
}

export class DatabaseService {
  private readonly sessions = new Map<string, Session>()
  private readonly busy = new Set<string>()
  private readonly metadataReaders = new Map<string, number>()
  private readonly approvals = new Map<string, Approval>()
  private readonly continuations = new Map<string, Continuation>()
  private readonly running = new Map<
    string,
    {
      connectionId: string
      controller: AbortController
      done: Promise<QueryResult>
    }
  >()
  private disposed = false
  private readonly connectionJobs = new Set<Promise<unknown>>()
  constructor(
    private readonly repository: DatabaseRepositoryPort,
    private readonly createAdapter: () => DatabaseAdapter,
    private readonly now: () => number = Date.now,
  ) {}
  listConnections(): ConnectionSummary[] {
    return this.repository.list().map(({ profile, hasPassword }) => {
      const session = this.sessions.get(profile.id)
      return {
        ...profile,
        hasPassword,
        status: session?.adapter.isConnected()
          ? 'connected'
          : this.busy.has(profile.id)
            ? 'connecting'
            : 'disconnected',
        currentDatabase: session?.profile.database ?? profile.database,
        permissionVerified: session?.permissionVerified ?? false,
        warning: session?.warning,
      }
    })
  }
  private assertImportIdle(id: string): Session {
    const bound = this.session(id)
    if (
      this.metadataReaders.has(id) ||
      [...this.running.values()].some((item) => item.connectionId === id)
    )
      throw new Error('실행 중인 조회가 끝난 뒤 임시 테이블을 변경하세요.')
    if (!bound.adapter.imports)
      throw new Error('이 연결은 엑셀 임시 테이블을 지원하지 않습니다.')
    return bound
  }
  registerImport(connectionId: string, data: ImportData): string {
    const id = idSchema.parse(connectionId)
    const bound = this.assertImportIdle(id)
    bound.adapter.imports!.register(data)
    bound.importRevision = (bound.importRevision ?? 0) + 1
    this.invalidate(id)
    return bound.profile.database
  }
  unregisterImport(connectionId: string, stageId: string): void {
    const id = idSchema.parse(connectionId)
    idSchema.parse(stageId)
    this.assertIdle(id)
    if (!this.sessions.has(id)) return
    const bound = this.assertImportIdle(id)
    bound.adapter.imports!.unregister(stageId)
    bound.importRevision = (bound.importRevision ?? 0) + 1
    this.invalidate(id)
  }
  listImports(connectionId: string): ImportTable[] {
    const bound = this.session(idSchema.parse(connectionId))
    return (bound.adapter.imports?.list() ?? []).map((data) => ({
      stageId: data.id,
      connectionId,
      database: bound.profile.database,
      schema: 'import',
      tableName: data.tableName,
      columns: [...data.columns],
      rowCount: data.rows.length,
    }))
  }
  /** Read-only change preview for any connection; the guarded apply path decides separately. */
  async inspectMutation(input: unknown): Promise<MutationInspection> {
    const { connectionId, sql } = mutationPreviewSchema.parse(input)
    const query = parseMutation(
      sql,
      this.session(connectionId).profile.database,
    )
    return this.metadataRead(connectionId, async ({ adapter, profile }) => {
      if (!adapter.mutations)
        throw new Error('이 연결은 변경 미리보기를 지원하지 않습니다.')
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(),
        profile.timeoutSeconds * 1000,
      )
      const id = randomUUID()
      try {
        const inspection = await adapter.mutations.inspect(
          query,
          id,
          controller.signal,
        )
        let applyBlocked: string | undefined
        if (profile.readOnly)
          applyBlocked =
            'Writes are disabled. Enable restricted writes on the connection profile and reconnect.'
        else if (
          inspection.affectedRows < 1 ||
          inspection.affectedRows > mutationRowLimit
        )
          applyBlocked = `Preview must match between 1 and ${mutationRowLimit} rows; narrow the WHERE clause`
        else
          applyBlocked = await adapter.mutations
            .checkTarget(query, id, controller.signal)
            .then(
              () => undefined,
              (error: unknown) => databaseError(error),
            )
        return {
          ...inspection,
          database: profile.database,
          ...(applyBlocked ? { applyBlocked } : {}),
        }
      } catch (error) {
        throw new Error(databaseError(error), { cause: error })
      } finally {
        clearTimeout(timer)
      }
    })
  }
  acquireMutationLease(input: unknown) {
    const id = idSchema.parse(input)
    const bound = this.session(id)
    if (bound.profile.readOnly || !bound.adapter.mutations)
      throw new Error(
        'Writes are disabled. Enable restricted writes on the connection profile and reconnect.',
      )
    if (
      this.metadataReaders.has(id) ||
      [...this.running.values()].some((item) => item.connectionId === id)
    )
      throw new Error('Wait for the current query before previewing a mutation')
    this.busy.add(id)
    this.invalidate(id)
    let released = false
    return {
      adapter: bound.adapter,
      profile: { ...bound.profile },
      generation: bound.generation,
      assertCurrent: (): void => {
        if (
          released ||
          this.disposed ||
          this.sessions.get(id)?.generation !== bound.generation ||
          !bound.adapter.isConnected()
        )
          throw new Error('Mutation connection changed or closed')
      },
      release: (): void => {
        if (!released) {
          released = true
          this.busy.delete(id)
        }
      },
      retire: async (): Promise<void> => {
        try {
          await bound.adapter.disconnect()
        } finally {
          if (this.sessions.get(id)?.generation === bound.generation)
            this.sessions.delete(id)
          this.invalidate(id)
        }
      },
    }
  }
  private assertIdle(id: string): void {
    if (this.disposed) throw new Error('Database service is shutting down')
    if (this.busy.has(id))
      throw new Error('Connection operation is in progress')
  }
  private session(id: string): Session {
    this.assertIdle(id)
    const session = this.sessions.get(id)
    if (!session)
      throw new Error(
        'No database connected. Select and connect a saved connection first.',
      )
    return session
  }
  private invalidate(id: string): void {
    for (const [token, approval] of this.approvals)
      if (approval.connectionId === id) this.approvals.delete(token)
    for (const [token, item] of this.continuations)
      if (item.connectionId === id) this.continuations.delete(token)
  }
  private track<T>(job: Promise<T>): Promise<T> {
    this.connectionJobs.add(job)
    return job.finally(() => {
      this.connectionJobs.delete(job)
    })
  }
  private metadataRead<T>(
    id: string,
    read: (session: Session) => Promise<T>,
  ): Promise<T> {
    const bound = this.session(id)
    this.metadataReaders.set(id, (this.metadataReaders.get(id) ?? 0) + 1)
    return this.track(
      (async () => {
        try {
          const result = await read(bound)
          if (
            this.disposed ||
            this.sessions.get(id)?.generation !== bound.generation ||
            !bound.adapter.isConnected()
          )
            throw new Error('Metadata connection changed')
          return result
        } finally {
          const remaining = (this.metadataReaders.get(id) ?? 1) - 1
          if (remaining) this.metadataReaders.set(id, remaining)
          else this.metadataReaders.delete(id)
        }
      })(),
    )
  }
  saveConnection(input: unknown): Promise<ConnectionSummary> {
    return this.track(this.saveInternal(input))
  }
  private async saveInternal(input: unknown): Promise<ConnectionSummary> {
    const { profile, password } = saveConnectionSchema.parse(input)
    this.assertIdle(profile.id)
    if (this.sessions.has(profile.id))
      throw new Error('Disconnect before editing a connection')
    if (
      !this.repository.list().some((item) => item.profile.id === profile.id) &&
      this.repository.list().length >= 30
    )
      throw new Error('Maximum 30 saved connections')
    this.busy.add(profile.id)
    try {
      await this.repository.save(profile, password)
      return this.listConnections().find((item) => item.id === profile.id)!
    } finally {
      this.busy.delete(profile.id)
    }
  }
  connect(input: unknown): Promise<ConnectionSummary> {
    return this.track(this.connectInternal(input))
  }
  private async connectInternal(input: unknown): Promise<ConnectionSummary> {
    const { connectionId: id, database } = connectSchema.parse(input)
    this.assertIdle(id)
    if (this.sessions.has(id))
      throw new Error('Disconnect before connecting or changing database')
    this.busy.add(id)
    const adapter = this.createAdapter()
    try {
      const stored = await this.repository.load(id)
      const profile = {
        ...stored.profile,
        database: database ?? stored.profile.database,
      }
      const permissions = await adapter.connect(profile, stored.password)
      if (this.disposed) {
        await adapter.disconnect()
        throw new Error('Database service is shutting down')
      }
      this.sessions.set(id, {
        adapter,
        profile,
        ...permissions,
        generation: randomUUID(),
      })
      return this.listConnections().find((item) => item.id === id)!
    } catch (error) {
      await adapter.disconnect().catch(() => undefined)
      throw new Error(databaseError(error), { cause: error })
    } finally {
      this.busy.delete(id)
    }
  }
  async disconnect(input: unknown): Promise<void> {
    const id = idSchema.parse(input)
    this.assertIdle(id)
    this.busy.add(id)
    this.invalidate(id)
    try {
      const running = [...this.running.values()].filter(
        (item) => item.connectionId === id,
      )
      for (const item of running) item.controller.abort()
      await Promise.allSettled(running.map((item) => item.done))
      const session = this.sessions.get(id)
      this.sessions.delete(id)
      await session?.adapter.disconnect()
    } finally {
      this.busy.delete(id)
    }
  }
  async deleteConnection(input: unknown): Promise<void> {
    const id = idSchema.parse(input)
    await this.disconnect(id)
    this.repository.delete(id)
  }
  async getExplorer(input: unknown): Promise<ExplorerData> {
    const scope = explorerScopeSchema.parse(input)
    const connectionId = typeof scope === 'string' ? scope : scope.connectionId
    const requested = typeof scope === 'string' ? undefined : scope.database
    return this.metadataRead(connectionId, async ({ profile, adapter }) => {
      const databases = await adapter.listDatabases()
      const catalog = this.metadataCatalog(
        profile.database,
        databases,
        requested,
      )
      const schemas = await adapter.listSchemas(catalog)
      const tables = await adapter.listTables(catalog)
      return {
        database: catalog ?? profile.database,
        databases,
        schemas,
        tables,
      }
    })
  }
  private metadataCatalog(
    current: string,
    accessible: string[],
    requested: string | undefined,
  ): string | undefined {
    if (!requested || requested.toLowerCase() === current.toLowerCase())
      return undefined
    const found = accessible.find(
      (database) => database.toLowerCase() === requested.toLowerCase(),
    )
    if (!found)
      throw new Error(
        `데이터베이스 '${requested}'에 접근할 수 없습니다. 이름과 로그인 권한을 확인하세요.`,
      )
    return found
  }
  async describeTable(input: unknown): Promise<TableDetails> {
    const { connectionId, schema, table, database } =
      tableScopeSchema.parse(input)
    return this.metadataRead(connectionId, async ({ profile, adapter }) => {
      const catalog = database
        ? this.metadataCatalog(
            profile.database,
            await adapter.listDatabases(),
            database,
          )
        : undefined
      return {
        columns: await adapter.getColumns(schema, table, catalog),
        indexes: await adapter.getIndexes(schema, table, catalog),
        foreignKeys: await adapter.getForeignKeys(schema, table, catalog),
      }
    })
  }
  metadataScope(input: unknown): MetadataScope {
    const connectionId = idSchema.parse(input)
    const bound = this.session(connectionId)
    const importRevision = bound.importRevision ?? 0
    const assertCurrent = (): void => {
      const current = this.session(connectionId)
      if (
        current.generation !== bound.generation ||
        (current.importRevision ?? 0) !== importRevision ||
        !current.adapter.isConnected()
      )
        throw new Error('Metadata scope is disconnected or has changed')
    }
    assertCurrent()
    return {
      key: `${connectionId}:${bound.generation}:${importRevision}`,
      connectionId,
      database: bound.profile.database,
      maxRows: bound.profile.maxRows,
      assertCurrent,
      tables: () =>
        this.metadataRead(connectionId, async () => {
          assertCurrent()
          const result = await bound.adapter.listTables()
          assertCurrent()
          return result
        }),
      describe: (schema, table) =>
        this.track(
          (async () => {
            tableScopeSchema.parse({ connectionId, schema, table })
            assertCurrent()
            const result = await this.describeTable({
              connectionId,
              schema,
              table,
            })
            assertCurrent()
            return result
          })(),
        ),
    }
  }
  reviewQuery(input: unknown): QueryReview {
    const { connectionId, sql } = reviewQuerySchema.parse(input)
    const session = this.session(connectionId)
    for (const [token, approval] of this.approvals)
      if (approval.expiresAt <= this.now()) this.approvals.delete(token)
    if (this.approvals.size >= 100)
      throw new Error('Too many pending approvals')
    const query = parseReadQuery(
      sql,
      session.profile.maxRows,
      undefined,
      undefined,
      session.profile.database,
      true,
    )
    const token = randomUUID()
    const expiresAt = this.now() + 60000
    this.approvals.set(token, {
      connectionId,
      generation: session.generation,
      query,
      expiresAt,
      source: sql,
    })
    return {
      token,
      sql: query.sql,
      database: session.profile.database,
      expiresAt,
      maxRows: session.profile.maxRows,
      timeoutSeconds: session.profile.timeoutSeconds,
    }
  }
  async executeQuery(input: unknown): Promise<QueryResult> {
    const { connectionId, requestId, approvalToken } =
      executeQuerySchema.parse(input)
    const { session, source, base } = this.approved(connectionId, approvalToken)
    return this.run(session, connectionId, requestId, source, base, 0)
  }
  /** Streams the whole approved SELECT to a user-chosen file; the grid's row/byte caps do not apply. */
  async exportQuery(
    input: unknown,
    choosePath: (format: ExportFormat) => Promise<string | undefined>,
  ): Promise<ExportResult> {
    const { connectionId, requestId, approvalToken, format } =
      exportQuerySchema.parse(input)
    const { session, source } = this.approved(connectionId, approvalToken)
    const path = await choosePath(format)
    if (!path) return null
    if (this.session(connectionId).generation !== session.generation)
      throw new Error('연결이 바뀌었습니다. 내보내기를 다시 실행하세요.')
    const file = new ResultFile(path, format)
    // run() may refuse synchronously before its own cleanup is armed; the .partial file must not linger.
    let result: QueryResult
    try {
      result = await this.run(
        session,
        connectionId,
        requestId,
        source,
        parseReadQuery(
          source,
          exportRowLimit,
          undefined,
          undefined,
          session.profile.database,
          true,
        ),
        0,
        undefined,
        file,
      )
    } catch (error) {
      await file.abort()
      throw error
    }
    return {
      fileName: basename(path),
      rowCount: result.rowCount,
      durationMs: result.durationMs,
      truncatedCells: file.truncatedCells,
    }
  }
  private approved(connectionId: string, approvalToken: string) {
    const session = this.session(connectionId)
    const approval = this.approvals.get(approvalToken)
    this.approvals.delete(approvalToken)
    if (
      !approval ||
      approval.connectionId !== connectionId ||
      approval.generation !== session.generation ||
      approval.expiresAt <= this.now()
    )
      throw new Error(
        'Query approval is missing, expired or belongs to another connection. Review again.',
      )
    const base = parseReadQuery(
      approval.source,
      session.profile.maxRows,
      undefined,
      undefined,
      session.profile.database,
      true,
    )
    if (base.sql !== approval.query.sql)
      throw new Error('Query policy changed. Review again.')
    return { session, source: approval.source, base }
  }
  /** Next page of a truncated result. The one-time token binds the session generation and import state. */
  async fetchMore(input: unknown): Promise<QueryResult> {
    const { connectionId, requestId, continuation } =
      fetchMoreSchema.parse(input)
    const session = this.session(connectionId)
    const saved = this.continuations.get(continuation)
    this.continuations.delete(continuation)
    if (
      !saved ||
      saved.connectionId !== connectionId ||
      saved.generation !== session.generation ||
      saved.importRevision !== (session.importRevision ?? 0) ||
      saved.expiresAt <= this.now()
    )
      throw new Error('More rows are no longer available. Run the query again.')
    return this.run(
      session,
      connectionId,
      requestId,
      saved.source,
      parseReadQuery(
        saved.source,
        session.profile.maxRows,
        undefined,
        undefined,
        session.profile.database,
        true,
      ),
      saved.offset,
      saved.order,
    )
  }
  private continueAt(next: Continuation): string {
    for (const [id, item] of this.continuations)
      if (item.expiresAt <= this.now()) this.continuations.delete(id)
    while (this.continuations.size >= 50)
      this.continuations.delete(this.continuations.keys().next().value!)
    const id = randomUUID()
    this.continuations.set(id, next)
    return id
  }
  private async pageOrder(
    session: Session,
    base: ReadQuery,
  ): Promise<string[][] | undefined> {
    const table = base.shape.single
    if (base.shape.ordered || base.shape.aggregate || !table || table.database)
      return undefined
    const columns = await session.adapter
      .getColumns(table.schema, table.table)
      .catch(() => [])
    const keys = columns.filter((column) => column.primaryKey)
    if (!keys.length || keys.length > 8) return undefined
    return keys.map((column) => [table.alias ?? table.table, column.name])
  }
  /** Editable source for a plain single-table SELECT of this database (ADR-037). */
  private async editSource(
    session: Session,
    base: ReadQuery,
  ): Promise<QueryResult['source']> {
    const table = base.shape.single
    if (
      !table ||
      table.database ||
      base.shape.aggregate ||
      !base.shape.plain ||
      table.schema.toLowerCase() === 'import'
    )
      return undefined
    // Editing is optional: a failed key lookup only leaves the grid read-only.
    const columns = await Promise.resolve()
      .then(() => session.adapter.getColumns(table.schema, table.table))
      .catch(() => [])
    const keys = columns
      .filter((column) => column.primaryKey)
      .map((column) => column.name)
    if (!keys.length) return undefined
    return { schema: table.schema, table: table.table, keys }
  }
  private run(
    session: Session,
    connectionId: string,
    requestId: string,
    source: string,
    base: ReadQuery,
    offset: number,
    given?: string[][],
    file?: ResultFile,
  ): Promise<QueryResult> {
    if (
      [...this.running.values()].some(
        (item) => item.connectionId === connectionId,
      )
    )
      throw new Error('One query per connection can run at a time')
    if (
      this.running.has(requestId) ||
      this.repository.history().some((entry) => entry.id === requestId)
    )
      throw new Error('Duplicate request ID')
    const controller = new AbortController()
    const started = this.now()
    const entry: HistoryEntry = {
      id: requestId,
      connectionId,
      connectionName: session.profile.name,
      database: session.profile.database,
      sql: source,
      startedAt: new Date(started).toISOString(),
      durationMs: 0,
      rowCount: 0,
      status: 'error',
      message: '',
    }
    // ponytail: fixed 30-minute export ceiling; make it a profile setting if exports need longer.
    const timeout = setTimeout(
      () => controller.abort(new Error('Query timed out')),
      file ? 30 * 60_000 : session.profile.timeoutSeconds * 1000,
    )
    const done = Promise.resolve().then(async () => {
      try {
        if (file) {
          const result = await session.adapter.executeQuery(
            base,
            requestId,
            controller.signal,
            {
              columns: (names) => file.columns(names),
              row: (values) => file.row(values),
              flush: () => file.flush(),
              maxRows: exportRowLimit,
            },
          )
          if (controller.signal.aborted) throw controller.signal.reason
          await file.finish()
          entry.status = 'success'
          entry.rowCount = result.rowCount
          entry.message = `${result.rowCount}행을 파일로 내보냈습니다.`
          return result
        }
        // Single-table SQL without ORDER BY pages in primary-key order from the first page on.
        const order = offset === 0 ? await this.pageOrder(session, base) : given
        // A cancel/shutdown during the key lookup must not start the query.
        if (controller.signal.aborted) throw controller.signal.reason
        const pageable =
          !base.shape.userOffset && (base.shape.ordered || !!order)
        const query = pageable
          ? parseReadQuery(
              source,
              session.profile.maxRows,
              undefined,
              {
                offset,
                order,
              },
              session.profile.database,
              true,
            )
          : base
        const result = await session.adapter.executeQuery(
          query,
          requestId,
          controller.signal,
        )
        if (controller.signal.aborted) throw controller.signal.reason
        if (offset === 0) result.source = await this.editSource(session, base)
        entry.status = 'success'
        entry.rowCount = result.rowCount
        entry.message = result.truncated
          ? 'Result limit reached; output was truncated.'
          : 'Completed'
        const next = offset + result.rowCount
        if (
          pageable &&
          result.truncated &&
          result.rowCount > 0 &&
          (base.shape.top === undefined || next < base.shape.top)
        )
          result.continuation = this.continueAt({
            connectionId,
            generation: session.generation,
            importRevision: session.importRevision ?? 0,
            source,
            offset: next,
            order,
            expiresAt: this.now() + 10 * 60_000,
          })
        return result
      } catch (error) {
        await file?.abort()
        entry.status = controller.signal.aborted ? 'cancelled' : 'error'
        entry.message = controller.signal.aborted
          ? controller.signal.reason instanceof Error
            ? controller.signal.reason.message
            : 'Query cancelled'
          : databaseError(error)
        throw new Error(entry.message, { cause: error })
      } finally {
        clearTimeout(timeout)
        this.running.delete(requestId)
        entry.durationMs = this.now() - started
        this.repository.addHistory(entry)
      }
    })
    this.running.set(requestId, { connectionId, controller, done })
    return done
  }
  cancelQuery(input: unknown): boolean {
    const { connectionId, requestId } = cancelQuerySchema.parse(input)
    const running = this.running.get(requestId)
    if (!running || running.connectionId !== connectionId) return false
    running.controller.abort(new Error('Query cancelled by user'))
    return true
  }
  getHistory(): HistoryEntry[] {
    return this.repository.history()
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.approvals.clear()
    this.continuations.clear()
    for (const item of this.running.values())
      item.controller.abort(new Error('Application closing'))
    await Promise.allSettled(
      [...this.running.values()].map((item) => item.done),
    )
    await Promise.allSettled([...this.connectionJobs])
    await Promise.allSettled(
      [...this.sessions.values()].map((session) =>
        session.adapter.disconnect(),
      ),
    )
    this.sessions.clear()
    // Pending connection attempts detect disposed and close themselves before returning.
  }
}
