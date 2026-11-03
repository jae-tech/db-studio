import sql from 'mssql'
import { createHash } from 'node:crypto'
import type { ConnectionProfile, QueryResult } from '@shared/database'
import type { ImportData } from '../ImportAdapter'
import type { MutationAdapter, MutationSnapshot } from '../MutationAdapter'
import { mutationRowLimit, type MutationQuery } from '../policy'
import { serializeCell } from './dialect'

const q = (name: string): string => `[${name.replaceAll(']', ']]')}]`
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Rowversion hex compares case-insensitively; key text must stay exact for case-sensitive collations.
const snapshotValue = (value: unknown, rowversion: boolean): string =>
  rowversion ? String(value).toLowerCase() : String(value)
// Deterministic text for PK snapshot values: ISO dates, hex binary, round-trip floats.
const keyStyle = (systemType: number): string =>
  [40, 41, 42, 43, 58, 61].includes(systemType)
    ? ',126'
    : [165, 173].includes(systemType)
      ? ',1'
      : [59, 62].includes(systemType)
        ? ',3'
        : ''
type Column = {
  name: string
  systemType: number
  userType: number
  maxLength: number
  nullable: boolean
  computed: boolean
  identity: boolean
  primaryKey: boolean
  ordinal: number
  hidden: boolean
  generatedAlways: number
  encrypted: boolean
  masked: boolean
}
type Header = {
  objectId: number
  schemaVersion: string
  canInspect: number
  canSelect: number
  canWrite: number
  risks: number
}
const scalarTypes = new Set([
  36, 40, 41, 42, 43, 48, 52, 56, 58, 59, 60, 61, 62, 104, 106, 108, 122, 127,
  165, 167, 173, 175, 189, 231, 239,
])
// nchar/nvarchar only: varchar/char would silently turn unmapped Unicode into '?'.
const textTypes = new Set([231, 239])
export type MutationImports = {
  find(table: string): ImportData
  // Creates the session #temp copies in the active mutation transaction.
  load(
    tables: ImportData[],
    requestId: string,
    signal: AbortSignal,
  ): Promise<void>
  // Runs an unlocked preview inside a short transaction that is rolled back.
  isolated<T>(run: () => Promise<T>): Promise<T>
}
export const mutationMetadataSql = {
  header: `SELECT t.object_id AS objectId, CONVERT(varchar(33),t.modify_date,126) AS schemaVersion,
    HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','VIEW DEFINITION') AS canInspect,
    HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'.'+QUOTENAME(t.name),'OBJECT','SELECT') AS canSelect,
    HAS_PERMS_BY_NAME(QUOTENAME(s.name)+'.'+QUOTENAME(t.name),'OBJECT',@permission) AS canWrite,
    t.temporal_type + t.is_memory_optimized + t.is_filetable + t.is_replicated + t.is_merge_published + t.is_tracked_by_cdc + t.is_remote_data_archive_enabled
      + (SELECT COUNT(*) FROM sys.triggers g WHERE g.parent_id=t.object_id AND g.is_disabled=0)
      + (SELECT COUNT(*) FROM sys.check_constraints c WHERE c.parent_object_id=t.object_id)
      + (SELECT COUNT(*) FROM sys.security_predicates p WHERE p.target_object_id=t.object_id)
      + (SELECT COUNT(*) FROM sys.foreign_keys f WHERE f.referenced_object_id=t.object_id AND (f.delete_referential_action<>0 OR f.update_referential_action<>0)) AS risks
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
    WHERE s.name=@schema AND t.name=@table AND t.is_ms_shipped=0
      AND NOT EXISTS (SELECT 1 FROM sys.external_tables e WHERE e.object_id=t.object_id)`,
  columns: `SELECT c.name, c.system_type_id AS systemType, c.user_type_id AS userType, c.max_length AS maxLength,
    CONVERT(bit,c.is_nullable) AS nullable, CONVERT(bit,c.is_computed) AS computed, CONVERT(bit,c.is_identity) AS [identity],
    CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i ON i.object_id=ic.object_id AND i.index_id=ic.index_id WHERE ic.object_id=c.object_id AND ic.column_id=c.column_id AND i.is_primary_key=1) THEN 1 ELSE 0 END) AS primaryKey,
    c.column_id AS ordinal, CONVERT(bit,c.is_hidden) AS hidden, c.generated_always_type AS generatedAlways,
    CONVERT(bit,CASE WHEN c.encryption_type IS NULL THEN 0 ELSE 1 END) AS encrypted,
    CONVERT(bit,CASE WHEN EXISTS(SELECT 1 FROM sys.masked_columns m WHERE m.object_id=c.object_id AND m.column_id=c.column_id AND m.is_masked=1) THEN 1 ELSE 0 END) AS masked
    FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
    WHERE s.name=@schema AND t.name=@table ORDER BY c.column_id`,
}

export class MssqlMutations implements MutationAdapter {
  constructor(
    private readonly profile: () => ConnectionProfile | undefined,
    private readonly request: () => sql.Request,
    private readonly inTransaction: () => boolean,
    private readonly requests: Map<string, sql.Request>,
    private readonly imports?: MutationImports,
  ) {}
  private gate(): void {
    const profile = this.profile()
    if (!profile || profile.readOnly)
      throw new Error('Write opt-in is required')
  }
  private stages(query: MutationQuery): ImportData[] {
    if (!query.join) return []
    if (!this.imports)
      throw new Error('이 연결은 엑셀 임시 테이블을 지원하지 않습니다.')
    return query.join.imports.map((name) => this.imports!.find(name))
  }
  private async query<T>(
    text: string,
    query: MutationQuery,
    id: string,
    signal: AbortSignal,
    array = false,
    ungated = false,
  ): Promise<T[]> {
    if (!ungated) this.gate()
    if (signal.aborted) throw new Error('Mutation cancelled')
    const request = this.request()
    request.input('schema', sql.NVarChar(128), query.table.schema)
    request.input('table', sql.NVarChar(128), query.table.table)
    request.input('permission', sql.NVarChar(128), query.kind.toUpperCase())
    request.arrayRowMode = array
    const abort = (): void => {
      request.cancel()
    }
    signal.addEventListener('abort', abort, { once: true })
    this.requests.set(id, request)
    try {
      if (signal.aborted) throw new Error('Mutation cancelled')
      const result = await request.query<T>(text)
      if (signal.aborted) throw new Error('Mutation cancelled')
      return result.recordset
    } finally {
      signal.removeEventListener('abort', abort)
      this.requests.delete(id)
    }
  }
  private async target(query: MutationQuery, id: string, signal: AbortSignal) {
    const stages = this.stages(query)
    const header = (
      await this.query<Header>(mutationMetadataSql.header, query, id, signal)
    )[0]
    if (
      !header ||
      header.canInspect !== 1 ||
      header.canSelect !== 1 ||
      header.canWrite !== 1 ||
      header.risks !== 0
    )
      throw new Error(
        'Write target refused: metadata visibility/permissions or unsupported table side effects',
      )
    const columns = await this.query<Column>(
      mutationMetadataSql.columns,
      query,
      id,
      signal,
    )
    const version = columns.filter(
      (column) =>
        column.systemType === 189 && !column.nullable && !column.primaryKey,
    )
    const keys = columns.filter((column) => column.primaryKey)
    // Without a rowversion the PK values identify the previewed rows (ADR-035).
    if (
      columns.length === 0 ||
      columns.length > 128 ||
      version.length > 1 ||
      keys.length === 0 ||
      keys.length > 8 ||
      columns.some(
        (column) =>
          column.computed ||
          column.hidden ||
          column.generatedAlways !== 0 ||
          column.encrypted ||
          column.masked ||
          column.systemType !== column.userType ||
          !scalarTypes.has(column.systemType) ||
          column.maxLength < 0 ||
          column.maxLength > 2048,
      )
    )
      throw new Error(
        'Write target requires a PK and bounded built-in scalar columns; computed/LOB/user-defined types are unsupported',
      )
    for (const name of [...query.assignedColumns, ...query.predicateColumns])
      if (!columns.some((column) => column.name === name))
        throw new Error('Use exact, existing column names')
    for (const name of query.assignedColumns) {
      const column = columns.find((column) => column.name === name)!
      if (
        column.identity ||
        column.systemType === 189 ||
        (query.kind !== 'insert' && column.primaryKey)
      )
        throw new Error('PK, identity and rowversion updates are blocked')
    }
    for (const name of query.join?.rawColumns ?? [])
      if (
        !textTypes.has(
          columns.find((column) => column.name === name)!.systemType,
        )
      )
        throw new Error(
          '엑셀 원문 텍스트는 문자열 열에만 넣을 수 있습니다. 숫자·날짜 열에는 TRY_CONVERT를 사용하세요.',
        )
    for (const name of query.join?.importColumns ?? [])
      if (!stages.some((stage) => stage.columns.includes(name)))
        throw new Error(
          '엑셀 임시 테이블에 없는 열입니다. 정확한 열 이름을 사용하세요.',
        )
    return {
      columns,
      version: version[0],
      keys,
      // Registered stage rows are immutable; hashing them binds the approval to this data.
      hash: digest({ header, columns, stages }),
    }
  }
  /** Row identity text: the rowversion as hex, or (without one) the PK values length-prefixed. */
  private identity(
    target: { version?: Column; keys: Column[] },
    prefix = '',
  ): string {
    if (target.version)
      return `CONVERT(varchar(18),CONVERT(binary(8),${prefix}${q(target.version.name)}),1)`
    return `CONCAT(${target.keys
      .map((key) => {
        const text = `CONVERT(nvarchar(4000),${prefix}${q(key.name)}${keyStyle(key.systemType)})`
        return `DATALENGTH(${text}),N':',${text},N'|'`
      })
      .join(',')})`
  }
  private execution(
    query: MutationQuery,
    identity: { version?: Column; keys: Column[] },
    versions: string[],
  ): string {
    const target = `${q(query.table.schema)}.${q(query.table.table)}`
    const output = (side: string): string =>
      `OUTPUT ${this.identity(identity, `${side}.`)} AS [version]`
    const join = query.join
    const where = query.predicateSql ? `\nWHERE ${query.predicateSql}` : ''
    if (query.kind === 'insert')
      return `INSERT INTO ${target} (${query.assignedColumns.map(q).join(', ')})\n${output('inserted')}\nSELECT ${join!.values.join(', ')}\nFROM ${join!.stage}${join!.target ? `\nLEFT JOIN ${join!.target} ON ${join!.on}` : ''}${where}`
    const version = identity.version?.name
    if (
      versions.length === 0 ||
      versions.length > mutationRowLimit ||
      versions.some((value) =>
        version ? !/^0x[0-9a-f]{16}$/.test(value) : value.length > 20_000,
      )
    )
      throw new Error('Invalid target snapshot')
    const prefix = join ? `${q(join.alias!)}.` : ''
    // Key snapshots are text the DB produced; they go back only as escaped N'' literals.
    const guard = version
      ? `${prefix}${q(version)} IN (${versions.join(', ')})`
      : `${this.identity(identity, prefix)} IN (${versions.map((value) => `N'${value.replaceAll("'", "''")}'`).join(', ')})`
    if (join)
      return `UPDATE ${q(join.alias!)} SET ${query.setSql}\n${output('deleted')}\nFROM ${join.target}\nINNER JOIN ${join.stage} ON ${join.on}\nWHERE ${query.predicateSql ? `(${query.predicateSql}) AND ` : ''}${guard}`
    return `${query.kind === 'update' ? `UPDATE ${target} SET ${query.setSql}` : `DELETE FROM ${target}`}\n${output('deleted')}\nWHERE (${query.predicateSql}) AND ${guard}`
  }
  async checkTarget(
    query: MutationQuery,
    id: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.target(query, id, signal)
  }
  // Read-only preview built only from the parsed statement's rendered parts.
  async inspect(query: MutationQuery, id: string, signal: AbortSignal) {
    const stages = query.join ? this.stages(query) : []
    const read = async () => {
      if (stages.length) await this.imports!.load(stages, id, signal)
      const columns = await this.query<Column>(
        mutationMetadataSql.columns,
        query,
        id,
        signal,
        false,
        true,
      )
      if (!columns.length)
        throw new Error('대상 테이블을 찾을 수 없거나 조회 권한이 없습니다.')
      for (const name of [...query.assignedColumns, ...query.predicateColumns])
        if (!columns.some((column) => column.name === name))
          throw new Error('Use exact, existing column names')
      for (const name of query.join?.importColumns ?? [])
        if (!stages.some((stage) => stage.columns.includes(name)))
          throw new Error(
            '엑셀 임시 테이블에 없는 열입니다. 정확한 열 이름을 사용하세요.',
          )
      const join = query.join
      const column = (name: string): string =>
        join?.alias ? `${q(join.alias)}.${q(name)}` : q(name)
      const keys = columns.filter((item) => item.primaryKey)
      const insert = query.kind === 'insert'
      const values = join?.values ?? query.newValues ?? []
      // Context columns: keys first, then others, never the columns being changed.
      const shown = insert
        ? []
        : [...keys, ...columns.filter((item) => !item.primaryKey)]
            .filter(
              (item) =>
                item.systemType !== 189 &&
                !query.assignedColumns.includes(item.name),
            )
            .slice(0, query.kind === 'delete' ? 16 : 6)
      const changed = insert ? [] : query.assignedColumns
      const names = [
        ...shown.map((item) => item.name),
        ...changed.flatMap((name) => [name, `→ ${name}`]),
        ...(insert ? query.assignedColumns.map((name) => `+ ${name}`) : []),
      ]
      const select = [
        ...shown.map((item) => column(item.name)),
        ...changed.flatMap((name, index) => [column(name), values[index]!]),
        ...(insert ? values : []),
      ].map(
        (sql, index) => `CONVERT(nvarchar(512),${sql}) AS ${q(`c${index}`)}`,
      )
      const where = query.predicateSql ? ` WHERE ${query.predicateSql}` : ''
      const from = join
        ? insert
          ? `${join.stage}${join.target ? ` LEFT JOIN ${join.target} ON ${join.on}` : ''}`
          : `${join.target} INNER JOIN ${join.stage} ON ${join.on}`
        : `${q(query.table.schema)}.${q(query.table.table)}`
      const order =
        !insert && keys.length
          ? ` ORDER BY ${keys.map((item) => column(item.name)).join(', ')}`
          : ''
      const counted = await this.query<{ count: number | string }>(
        `SELECT COUNT_BIG(*) AS [count] FROM ${from}${where}`,
        query,
        id,
        signal,
        false,
        true,
      )
      const rows = await this.query<unknown[]>(
        `SELECT TOP (20) ${select.join(', ')} FROM ${from}${where}${order}`,
        query,
        id,
        signal,
        true,
        true,
      )
      const sample: QueryResult = {
        requestId: id,
        columns: names.map((name, index) => ({
          key: `c${index}`,
          name,
          type: 'preview · first 512 characters',
        })),
        rows: rows.map((row) =>
          Object.fromEntries(
            names.map((_, index) => [`c${index}`, serializeCell(row[index])]),
          ),
        ),
        rowCount: rows.length,
        durationMs: 0,
        truncated: false,
      }
      const affectedRows = Number(counted[0]?.count ?? 0)
      sample.truncated = affectedRows > rows.length
      return {
        kind: query.kind,
        target: `${query.table.schema}.${query.table.table}`,
        affectedRows,
        sample,
      }
    }
    return stages.length ? this.imports!.isolated(read) : read()
  }
  async preview(
    query: MutationQuery,
    id: string,
    signal: AbortSignal,
    locked: boolean,
  ): Promise<MutationSnapshot> {
    if (locked && !this.inTransaction())
      throw new Error('Locked preview requires a transaction')
    this.gate()
    const stages = this.stages(query)
    if (!stages.length) return this.read(query, id, signal, locked)
    // #temp tables are session-scoped, so they are loaded into the same transaction that reads them.
    const read = async (): Promise<MutationSnapshot> => {
      await this.imports!.load(stages, id, signal)
      return this.read(query, id, signal, locked)
    }
    return locked ? read() : this.imports!.isolated(read)
  }
  private async read(
    query: MutationQuery,
    id: string,
    signal: AbortSignal,
    locked: boolean,
  ): Promise<MutationSnapshot> {
    const target = await this.target(query, id, signal)
    const join = query.join
    const insert = query.kind === 'insert'
    const lock = locked ? ' WITH (UPDLOCK,HOLDLOCK)' : ''
    const where = query.predicateSql ? ` WHERE ${query.predicateSql}` : ''
    const failed = join?.checks.length
      ? `, CASE WHEN ${join.checks.join(' OR ')} THEN 1 ELSE 0 END AS [failed]`
      : ''
    const values = join?.values ?? []
    const shown = insert
      ? []
      : target.columns
          .filter((column) => column.systemType !== 189)
          .slice(0, 16)
    const column = (name: string): string =>
      join ? `${q(join.alias!)}.${q(name)}` : q(name)
    // INSERT rows: [values..., failed?]. UPDATE/DELETE rows: [version, shown..., new values..., failed?].
    const text = insert
      ? `SELECT TOP (${mutationRowLimit + 1}) ${values.map((value, index) => `CONVERT(nvarchar(max),${value}) AS ${q(`v${index}`)}`).join(', ')}${failed} FROM ${join!.stage}${join!.target ? ` LEFT JOIN ${join!.target}${lock} ON ${join!.on}` : ''}${where}`
      : `SELECT TOP (${mutationRowLimit + 1}) ${this.identity(target, join ? `${q(join.alias!)}.` : '')} AS [version], ${shown.map((item) => `CONVERT(nvarchar(512),${column(item.name)}) AS ${q(item.name)}`).join(', ')}${values.map((value, index) => `, CONVERT(nvarchar(512),${value}) AS ${q(`v${index}`)}`).join('')}${failed} FROM ${join ? `${join.target}${lock} INNER JOIN ${join.stage} ON ${join.on}` : `${q(query.table.schema)}.${q(query.table.table)}${lock}`}${where} ORDER BY ${target.keys.map((item) => column(item.name)).join(', ')}`
    const rows = await this.query<unknown[]>(text, query, id, signal, true)
    if (rows.length === 0 || rows.length > mutationRowLimit)
      throw new Error(
        `Preview must match between 1 and ${mutationRowLimit} rows; narrow the WHERE clause`,
      )
    const offset = insert ? 0 : 1
    const width = shown.length + values.length
    const bad = failed
      ? rows.filter((row) => Number(row[offset + width]) === 1).length
      : 0
    if (bad)
      throw new Error(
        `엑셀 ${bad}행의 값 또는 JOIN 키가 비어 있거나 TRY_CONVERT 변환에 실패했습니다. WHERE로 제외하거나 원본을 수정하세요.`,
      )
    const versions = insert
      ? []
      : rows.map((row) => snapshotValue(row[0], !!target.version)).sort()
    if (new Set(versions).size !== versions.length)
      throw new Error(
        join
          ? '대상 행 하나가 엑셀 행 여러 개와 일치합니다. JOIN 조건이 행을 하나씩만 연결하도록 지정하세요.'
          : 'Ambiguous rowversion snapshot',
      )
    // Informational only, so it is skipped under locks to avoid range-locking the whole target.
    let importRows: MutationSnapshot['importRows']
    if (join && !locked) {
      const total = this.stages(query)[0]!.rows.length
      const unmatched = insert
        ? undefined
        : (
            await this.query<{ count: number }>(
              `SELECT COUNT(*) AS [count] FROM ${join.stage} WHERE NOT EXISTS (SELECT 1 FROM ${join.target} WHERE ${join.on})`,
              query,
              id,
              signal,
            )
          )[0]!.count
      importRows = { total, unmatched }
    }
    const after = await this.target(query, id, signal)
    if (after.hash !== target.hash)
      throw new Error('Table metadata changed during preview')
    const names = [
      ...shown.map((item) => item.name),
      ...query.assignedColumns
        .slice(0, values.length)
        .map((name) => (insert ? name : `→ ${name}`)),
    ]
    const sample: QueryResult = {
      requestId: id,
      columns: names.map((name, index) => ({
        key: `c${index}`,
        name,
        type: 'preview · first 512 characters',
      })),
      rows: [],
      rowCount: rows.length,
      durationMs: 0,
      truncated:
        (!insert &&
          target.columns.length - (target.version ? 1 : 0) > shown.length) ||
        rows.length > 20,
    }
    for (const row of rows.slice(0, 20)) {
      const value = Object.fromEntries(
        names.map((_, index) => [
          `c${index}`,
          serializeCell(row[offset + index]),
        ]),
      )
      if (Buffer.byteLength(JSON.stringify([...sample.rows, value])) > 65536) {
        sample.truncated = true
        break
      }
      sample.rows.push(value)
    }
    return {
      versions,
      count: rows.length,
      rowsDigest: insert
        ? digest(
            rows
              .map((row) => JSON.stringify(row.slice(0, values.length)))
              .sort(),
          )
        : '',
      metadataHash: target.hash,
      executionSql: this.execution(query, target, versions),
      sample,
      importRows,
    }
  }
  async apply(
    query: MutationQuery,
    snapshot: MutationSnapshot,
    id: string,
    signal: AbortSignal,
  ): Promise<number> {
    if (!this.inTransaction())
      throw new Error('Mutation requires a transaction')
    const target = await this.target(query, id, signal)
    const text = this.execution(query, target, snapshot.versions)
    if (target.hash !== snapshot.metadataHash || text !== snapshot.executionSql)
      throw new Error('Mutation policy or target metadata changed')
    const changed = await this.query<unknown[]>(text, query, id, signal, true)
    if (query.kind === 'insert') {
      if (changed.length !== snapshot.count)
        throw new Error(
          'Affected rows differ from the approved snapshot; rollback required',
        )
      return changed.length
    }
    const versions = changed
      .map((row) => snapshotValue(row[0], !!target.version))
      .sort()
    if (JSON.stringify(versions) !== JSON.stringify(snapshot.versions))
      throw new Error(
        'Affected rows differ from the approved snapshot; rollback required',
      )
    return changed.length
  }
}
