/** Intentionally small T-SQL grammar. Unsupported syntax fails closed, never falls back to text execution. */
type Token = {
  kind: 'word' | 'identifier' | 'string' | 'number' | 'symbol'
  value: string
}
type ConversionType =
  | { name: 'INT' | 'BIGINT' | 'DATE' }
  | { name: 'DECIMAL' | 'NUMERIC'; precision: number; scale: number }
type Expr =
  | { kind: 'literal'; sql: string }
  | { kind: 'reference'; parts: string[] }
  | { kind: 'call'; name: string; args: Expr[]; distinct: boolean }
  | { kind: 'convert'; type: ConversionType; value: Expr; style?: number }
  | { kind: 'unary'; op: string; value: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'list'; items: Expr[] }
export type TableReference = {
  schema: string
  table: string
  alias?: string
  // Set only for another database on the same server (user SELECTs, ADR-034).
  database?: string
}
// Main-only name resolution. Resolved names are still identifier-quoted; this is not a raw SQL hook.
export type TableResolver = (
  table: TableReference,
) => { schema?: string; table: string } | undefined
export type ReadQuery = {
  kind: 'select'
  sql: string
  tables: TableReference[]
  // What Main needs to decide whether "load more" pages are well defined.
  shape: {
    ordered: boolean
    // Set when there is exactly one FROM table and no JOIN.
    single?: TableReference
    aggregate: boolean
    top?: number
    userOffset: boolean
    // A select-list `*` or `alias.*` (COUNT(*) is a call, not a star).
    star: boolean
    // Every item is `*` or a column reference whose output name is the column's own name.
    plain: boolean
  }
}
/** Main-built page: offset plus a fallback ORDER BY (reference parts) when the SQL has none. */
export type ReadPage = { offset: number; order?: string[][] }
const aggregates = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'])
const hasAggregate = (expr: Expr): boolean => {
  switch (expr.kind) {
    case 'call':
      return aggregates.has(expr.name) || expr.args.some(hasAggregate)
    case 'convert':
    case 'unary':
      return hasAggregate(expr.value)
    case 'binary':
      return hasAggregate(expr.left) || hasAggregate(expr.right)
    case 'list':
      return expr.items.some(hasAggregate)
    default:
      return false
  }
}
export const mutationPolicyVersion = 'mssql-mutation-v2'
export const mutationRowLimit = 1000
// File export streams rows without the grid's row cap; XLSX holds 1,048,576 rows including the header.
// ponytail: one cap for CSV and XLSX; give CSV its own limit if larger exports are needed.
export const exportRowLimit = 1_048_575
export type MutationQuery = {
  kind: 'update' | 'delete' | 'insert'
  sql: string
  table: { schema: string; table: string }
  predicateSql: string
  setSql?: string
  assignedColumns: string[]
  predicateColumns: string[]
  // Simple UPDATE only: rendered SET values in assignedColumns order (previews).
  newValues?: string[]
  // Excel-staging forms only. Stage tables render as session #temp names that
  // exist only after the adapter loads them into the same transaction.
  join?: {
    alias?: string
    target?: string
    stage: string
    on?: string
    imports: string[]
    importColumns: string[]
    // Target columns assigned raw stage text (string columns only).
    rawColumns: string[]
    // Rendered new values in assignedColumns order.
    values: string[]
    // True when a TRY_CONVERT value failed or its source is blank.
    checks: string[]
  }
}
const stageName = /^stage_[a-f0-9]{32}$/
const joinError =
  '엑셀 JOIN 쓰기는 UPDATE 별칭 SET 열 = 값 FROM 스키마.테이블 AS 별칭 JOIN [import].[stage_...] AS 별칭 ON ... 또는 INSERT INTO 스키마.테이블 (열, ...) SELECT 값, ... FROM [import].[stage_...] AS 별칭 [LEFT JOIN 같은 테이블 AS 별칭 ON ...] 형식만 지원합니다.'
const functions = new Set([
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COALESCE',
  'ISNULL',
  'NULLIF',
  'LOWER',
  'UPPER',
  'LEN',
  'ABS',
  'ROUND',
  'GETDATE',
  'GETUTCDATE',
])
const reserved = new Set(
  'SELECT FROM WHERE JOIN INNER LEFT RIGHT FULL OUTER CROSS ON AS GROUP BY HAVING ORDER ASC DESC DISTINCT TOP AND OR NOT IS NULL LIKE IN UNION ALL INTO UPDATE DELETE INSERT DROP TRUNCATE EXEC EXECUTE WITH OPTION OFFSET FETCH FOR USE SET CREATE ALTER MERGE GRANT DENY REVOKE WAITFOR BACKUP RESTORE OUTPUT OVER PIVOT UNPIVOT APPLY COLLATE NEXT VALUE CASE WHEN THEN ELSE END'.split(
    ' ',
  ),
)
const quote = (value: string): string => `[${value.replaceAll(']', ']]')}]`

function tokenize(sql: string): Token[] {
  if (sql.length > 200_000) throw new Error('SQL exceeds 200 KB')
  const tokens: Token[] = []
  let i = 0
  const push = (kind: Token['kind'], value: string): void => {
    tokens.push({ kind, value })
    if (tokens.length > 2000) throw new Error('SQL is too complex')
  }
  while (i < sql.length) {
    const ch = sql[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++
      continue
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) {
          depth++
          i += 2
          if (depth > 8) throw new Error('Comment nesting limit')
        } else if (sql.startsWith('*/', i)) {
          depth--
          i += 2
        } else i++
      }
      if (depth) throw new Error('Unclosed comment')
      continue
    }
    if (ch === "'" || ((ch === 'N' || ch === 'n') && sql[i + 1] === "'")) {
      if (ch !== "'") i++
      i++
      let value = ''
      let closed = false
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            value += "'"
            i += 2
            continue
          }
          i++
          closed = true
          break
        }
        value += sql[i++]!
      }
      if (!closed) throw new Error('Unclosed string')
      push('string', value)
      continue
    }
    if (ch === '[' || ch === '"') {
      const end = ch === '[' ? ']' : '"'
      i++
      let value = ''
      let closed = false
      while (i < sql.length) {
        if (sql[i] === end) {
          if (sql[i + 1] === end) {
            value += end
            i += 2
            continue
          }
          i++
          closed = true
          break
        }
        value += sql[i++]!
      }
      if (!closed || !value || value.includes('\0') || value.length > 128)
        throw new Error('Invalid quoted identifier')
      push('identifier', value)
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i++
      while (i < sql.length && /[A-Za-z_0-9$]/.test(sql[i]!)) i++
      push('word', sql.slice(start, i))
      continue
    }
    if (/[0-9]/.test(ch)) {
      const start = i++
      while (i < sql.length && /[0-9]/.test(sql[i]!)) i++
      if (sql[i] === '.' && /[0-9]/.test(sql[i + 1] ?? '')) {
        i++
        while (i < sql.length && /[0-9]/.test(sql[i]!)) i++
      }
      push('number', sql.slice(start, i))
      continue
    }
    const pair = sql.slice(i, i + 2)
    if (['<=', '>=', '<>', '!='].includes(pair)) {
      push('symbol', pair)
      i += 2
      continue
    }
    if ('(),.*+-/%=<>;'.includes(ch)) {
      push('symbol', ch)
      i++
      continue
    }
    throw new Error(`Unsupported SQL character at ${i + 1}`)
  }
  return tokens
}

function render(expr: Expr): string {
  switch (expr.kind) {
    case 'literal':
      return expr.sql
    case 'reference':
      return expr.parts
        .map((part) => (part === '*' ? '*' : quote(part)))
        .join('.')
    case 'call':
      return `${expr.name}(${expr.distinct ? 'DISTINCT ' : ''}${expr.args.map(render).join(', ')})`
    case 'convert': {
      const type =
        'precision' in expr.type
          ? `${expr.type.name}(${expr.type.precision}, ${expr.type.scale})`
          : expr.type.name
      return `TRY_CONVERT(${type}, ${render(expr.value)}${expr.style === undefined ? '' : `, ${expr.style}`})`
    }
    case 'unary':
      return `(${expr.op} ${render(expr.value)})`
    case 'binary':
      return `(${render(expr.left)} ${expr.op} ${render(expr.right)})`
    case 'list':
      return `(${expr.items.map(render).join(', ')})`
  }
}

class SqlParser {
  private pos = 0
  private depth = 0
  constructor(
    private readonly tokens: Token[],
    // The connected database: `database.schema.table` naming it is the local table.
    private readonly database?: string,
    // User SELECTs may also name another database on the server; writes and AI tools may not.
    private readonly otherDatabases = false,
  ) {}
  private at(value: string): boolean {
    const token = this.tokens[this.pos]
    return (
      !!token &&
      (token.kind === 'word' || token.kind === 'symbol') &&
      token.value.toUpperCase() === value
    )
  }
  private take(value: string): boolean {
    if (!this.at(value)) return false
    this.pos++
    return true
  }
  private expect(value: string): void {
    if (!this.take(value))
      throw new Error(
        `Expected ${value}. Only the documented read-only SELECT subset is supported.`,
      )
  }
  private identifier(allowKeyword = false): string {
    const token = this.tokens[this.pos++]
    if (
      !token ||
      !(
        token.kind === 'identifier' ||
        (token.kind === 'word' &&
          (allowKeyword || !reserved.has(token.value.toUpperCase())))
      ) ||
      token.value.length > 128
    )
      throw new Error('Expected an identifier; unsupported SQL is blocked')
    return token.value
  }
  private integer(min: number, max: number): number {
    const token = this.tokens[this.pos++]
    if (token?.kind !== 'number' || !/^\d+$/.test(token.value))
      throw new Error(
        'TRY_CONVERT requires literal integer type parameters and style',
      )
    const value = Number(token.value)
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(
        'TRY_CONVERT type parameter or style is outside the supported range',
      )
    return value
  }
  private conversion(): Expr {
    let type: ConversionType
    if (this.take('INT')) type = { name: 'INT' }
    else if (this.take('BIGINT')) type = { name: 'BIGINT' }
    else if (this.take('DATE')) type = { name: 'DATE' }
    else {
      const name = this.take('DECIMAL')
        ? 'DECIMAL'
        : this.take('NUMERIC')
          ? 'NUMERIC'
          : undefined
      if (!name)
        throw new Error(
          'TRY_CONVERT supports only int, bigint, decimal(p,s), numeric(p,s), and date',
        )
      this.expect('(')
      const precision = this.integer(1, 38)
      this.expect(',')
      const scale = this.integer(0, precision)
      this.expect(')')
      type = { name, precision, scale }
    }
    this.expect(',')
    const value = this.expr()
    let style: number | undefined
    if (this.take(',')) {
      style = this.integer(23, 126)
      if (![23, 112, 126].includes(style))
        throw new Error('TRY_CONVERT supports only styles 23, 112, and 126')
    }
    this.expect(')')
    return {
      kind: 'convert',
      type,
      value,
      ...(style === undefined ? {} : { style }),
    }
  }
  private expr(minPrecedence = 0): Expr {
    if (++this.depth > 40) throw new Error('Expression nesting limit')
    let left: Expr
    if (this.take('NOT'))
      left = { kind: 'unary', op: 'NOT', value: this.expr(3) }
    else if (this.take('-'))
      left = { kind: 'unary', op: '-', value: this.expr(6) }
    else if (this.take('+'))
      left = { kind: 'unary', op: '+', value: this.expr(6) }
    else if (this.take('(')) {
      left = this.expr()
      this.expect(')')
    } else if (this.take('*')) left = { kind: 'reference', parts: ['*'] }
    else if (this.take('NULL')) left = { kind: 'literal', sql: 'NULL' }
    else {
      const token = this.tokens[this.pos]
      if (token?.kind === 'number' || token?.kind === 'string') {
        this.pos++
        left = {
          kind: 'literal',
          sql:
            token.kind === 'string'
              ? `N'${token.value.replaceAll("'", "''")}'`
              : token.value,
        }
      } else {
        const first = this.identifier()
        if (this.take('(')) {
          if (first.toUpperCase() === 'TRY_CONVERT') left = this.conversion()
          else {
            if (!functions.has(first.toUpperCase()))
              throw new Error(
                'Only allowlisted built-in scalar/aggregate functions are supported',
              )
            const distinct = this.take('DISTINCT')
            const args: Expr[] = []
            if (!this.take(')')) {
              do {
                args.push(this.expr())
              } while (this.take(','))
              this.expect(')')
            }
            left = { kind: 'call', name: first.toUpperCase(), args, distinct }
          }
        } else {
          const parts = [first]
          if (this.take('.'))
            parts.push(this.take('*') ? '*' : this.identifier())
          left = { kind: 'reference', parts }
        }
      }
    }
    const precedence: Record<string, number> = {
      OR: 1,
      AND: 2,
      '=': 3,
      '<>': 3,
      '!=': 3,
      '<': 3,
      '>': 3,
      '<=': 3,
      '>=': 3,
      LIKE: 3,
      IN: 3,
      IS: 3,
      '+': 4,
      '-': 4,
      '*': 5,
      '/': 5,
      '%': 5,
    }
    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos]!
      const op =
        token.kind === 'word' || token.kind === 'symbol'
          ? token.value.toUpperCase()
          : ''
      const priority = precedence[op]
      if (priority === undefined || priority < minPrecedence) break
      this.pos++
      let right: Expr
      let effectiveOp = op
      if (op === 'IS') {
        effectiveOp = this.take('NOT') ? 'IS NOT' : 'IS'
        this.expect('NULL')
        right = { kind: 'literal', sql: 'NULL' }
      } else if (op === 'IN') {
        this.expect('(')
        const items: Expr[] = []
        do {
          items.push(this.expr())
        } while (this.take(','))
        this.expect(')')
        right = { kind: 'list', items }
      } else right = this.expr(priority + 1)
      left = { kind: 'binary', op: effectiveOp, left, right }
    }
    this.depth--
    return left
  }
  private alias(): string | undefined {
    return this.take('AS') ? this.identifier(true) : undefined
  }
  private qualifiedName(): {
    schema: string
    table: string
    database?: string
  } {
    let schema = this.identifier()
    this.expect('.')
    let table = this.identifier()
    // Three-part name: the connected database's prefix is dropped; another
    // database is kept only where the caller allows it.
    if (this.take('.')) {
      const database = schema
      schema = table
      table = this.identifier()
      if (
        this.database &&
        database.toLowerCase() === this.database.toLowerCase()
      )
        return { schema, table }
      if (!this.otherDatabases)
        throw new Error(
          'Only current-database user tables are allowed by the Phase 2 execution policy',
        )
      return { schema, table, database }
    }
    return { schema, table }
  }
  private table(): TableReference {
    return { ...this.qualifiedName(), alias: this.alias() }
  }
  private end(): void {
    this.take(';')
    if (this.pos !== this.tokens.length) throw new Error(joinError)
  }
  private stageTable(): TableReference & { alias: string } {
    const table = this.table()
    if (
      table.schema.toLowerCase() !== 'import' ||
      !stageName.test(table.table) ||
      !table.alias
    )
      throw new Error(joinError)
    return { ...table, alias: table.alias }
  }
  /** Shared validation for UPDATE ... JOIN stage and INSERT ... SELECT FROM stage. */
  private joinScope(stageAlias: string, targetAlias?: string) {
    if (targetAlias && targetAlias.toLowerCase() === stageAlias.toLowerCase())
      throw new Error('대상과 엑셀 테이블 별칭은 달라야 합니다.')
    const targetColumns = new Set<string>()
    const importColumns = new Set<string>()
    const checks: string[] = []
    const side = (value: Expr): 'target' | 'stage' | undefined => {
      if (
        value.kind !== 'reference' ||
        value.parts.length !== 2 ||
        value.parts[1] === '*'
      )
        return undefined
      const [alias, column] = value.parts as [string, string]
      if (alias.toLowerCase() === stageAlias.toLowerCase()) {
        importColumns.add(column)
        return 'stage'
      }
      if (targetAlias && alias.toLowerCase() === targetAlias.toLowerCase()) {
        targetColumns.add(column)
        return 'target'
      }
      return undefined
    }
    const stageValue = (value: Expr): boolean =>
      side(value) === 'stage' ||
      (value.kind === 'convert' && side(value.value) === 'stage')
    const literal = (value: Expr): boolean =>
      value.kind === 'literal' ||
      (value.kind === 'unary' &&
        ['+', '-'].includes(value.op) &&
        value.value.kind === 'literal' &&
        /^\d+(\.\d+)?$/.test(value.value.sql))
    const newValue = (value: Expr): boolean => {
      if (literal(value) || side(value) === 'stage') return true
      if (value.kind !== 'convert' || side(value.value) !== 'stage')
        return false
      const source = render(value.value)
      // TRY_CONVERT returns NULL on failure, and blank text converts to 0 or 1900-01-01.
      checks.push(
        `(${source} IS NOT NULL AND (${render(value)} IS NULL OR LTRIM(RTRIM(${source})) = N''))`,
      )
      return true
    }
    const on = (value: Expr): boolean => {
      if (value.kind !== 'binary') return false
      if (value.op === 'AND') return on(value.left) && on(value.right)
      if (value.op !== '=') return false
      const key =
        side(value.left) === 'target' && stageValue(value.right)
          ? value.right
          : side(value.right) === 'target' && stageValue(value.left)
            ? value.left
            : undefined
      if (!key) return false
      // A blank/unconvertible key never matches; under INSERT ... LEFT JOIN ... IS NULL
      // it would look "missing" and insert a duplicate, so it fails the preview instead.
      const source = render(key.kind === 'convert' ? key.value : key)
      checks.push(
        `(${source} IS NULL OR LTRIM(RTRIM(${source})) = N''${key.kind === 'convert' ? ` OR ${render(key)} IS NULL` : ''})`,
      )
      return true
    }
    const where = (value: Expr): boolean => {
      if (value.kind === 'unary' && value.op === 'NOT')
        return where(value.value)
      if (value.kind !== 'binary') return false
      if (value.op === 'AND' || value.op === 'OR')
        return where(value.left) && where(value.right)
      if (!side(value.left) && !stageValue(value.left)) return false
      if (value.op === 'IN')
        return (
          value.right.kind === 'list' &&
          value.right.items.length <= 100 &&
          value.right.items.every(literal)
        )
      return (
        [
          '=',
          '<>',
          '!=',
          '<',
          '>',
          '<=',
          '>=',
          'IS',
          'IS NOT',
          'LIKE',
        ].includes(value.op) && literal(value.right)
      )
    }
    return { targetColumns, importColumns, checks, newValue, on, where, side }
  }
  private columnName(alias?: string): string {
    const first = this.identifier()
    if (!this.take('.')) return first
    if (!alias || first.toLowerCase() !== alias.toLowerCase())
      throw new Error(joinError)
    return this.identifier()
  }
  private joinedUpdate(): MutationQuery {
    const alias = this.identifier()
    this.expect('SET')
    const pending: { column: string; value: Expr }[] = []
    do {
      const column = this.columnName(alias)
      if (
        pending.some(
          (item) => item.column.toLowerCase() === column.toLowerCase(),
        ) ||
        pending.length >= 32
      )
        throw new Error('Duplicate assignment or too many columns')
      this.expect('=')
      pending.push({ column, value: this.expr() })
    } while (this.take(','))
    this.expect('FROM')
    const target = this.table()
    if (
      !target.alias ||
      target.alias.toLowerCase() !== alias.toLowerCase() ||
      target.schema.toLowerCase() === 'import'
    )
      throw new Error(joinError)
    this.take('INNER')
    this.expect('JOIN')
    const stage = this.stageTable()
    this.expect('ON')
    const condition = this.expr()
    const filter = this.take('WHERE') ? this.expr() : undefined
    this.end()
    const scope = this.joinScope(stage.alias, alias)
    for (const item of pending)
      if (!scope.newValue(item.value))
        throw new Error(
          'SET 값은 리터럴, 엑셀 열 또는 TRY_CONVERT(형식, 엑셀 열)만 사용할 수 있습니다.',
        )
    if (!scope.on(condition))
      throw new Error(
        'ON은 대상 열 = 엑셀 열(또는 TRY_CONVERT) 비교를 AND로만 연결할 수 있습니다.',
      )
    if (filter && !scope.where(filter))
      throw new Error('WHERE는 열과 리터럴 비교만 지원합니다.')
    const values = pending.map((item) => render(item.value))
    const setSql = pending
      .map((item, index) => `${quote(item.column)} = ${values[index]}`)
      .join(', ')
    const targetSql = `${quote(target.schema)}.${quote(target.table)} AS ${quote(alias)}`
    const onSql = render(condition)
    const predicateSql = filter ? render(filter) : ''
    return {
      kind: 'update',
      table: { schema: target.schema, table: target.table },
      predicateSql,
      setSql,
      assignedColumns: pending.map((item) => item.column),
      predicateColumns: [...scope.targetColumns],
      join: {
        alias,
        target: targetSql,
        stage: `${quote(`#${stage.table}`)} AS ${quote(stage.alias)}`,
        on: onSql,
        imports: [stage.table],
        importColumns: [...scope.importColumns],
        rawColumns: pending
          .filter((item) => scope.side(item.value) === 'stage')
          .map((item) => item.column),
        values,
        checks: scope.checks,
      },
      sql: `UPDATE ${quote(alias)} SET ${setSql}\nFROM ${targetSql}\nINNER JOIN ${quote(stage.schema)}.${quote(stage.table)} AS ${quote(stage.alias)} ON ${onSql}${predicateSql ? `\nWHERE ${predicateSql}` : ''}`,
    }
  }
  private insert(): MutationQuery {
    this.expect('INTO')
    const { schema, table } = this.qualifiedName()
    if (schema.toLowerCase() === 'import') throw new Error(joinError)
    this.expect('(')
    const columns: string[] = []
    do {
      const column = this.identifier()
      if (
        columns.some((name) => name.toLowerCase() === column.toLowerCase()) ||
        columns.length >= 64
      )
        throw new Error('Duplicate assignment or too many columns')
      columns.push(column)
    } while (this.take(','))
    this.expect(')')
    this.expect('SELECT')
    const items: Expr[] = []
    do {
      items.push(this.expr())
    } while (this.take(','))
    if (items.length !== columns.length)
      throw new Error('INSERT 열 수와 SELECT 값 수가 같아야 합니다.')
    this.expect('FROM')
    const stage = this.stageTable()
    let target: TableReference | undefined
    let condition: Expr | undefined
    if (this.take('LEFT')) {
      this.take('OUTER')
      this.expect('JOIN')
      target = this.table()
      if (
        !target.alias ||
        target.schema.toLowerCase() !== schema.toLowerCase() ||
        target.table.toLowerCase() !== table.toLowerCase()
      )
        throw new Error(
          'INSERT의 LEFT JOIN은 별칭이 있는 같은 대상 테이블만 사용할 수 있습니다.',
        )
      this.expect('ON')
      condition = this.expr()
    }
    const filter = this.take('WHERE') ? this.expr() : undefined
    this.end()
    const scope = this.joinScope(stage.alias, target?.alias)
    for (const item of items)
      if (!scope.newValue(item))
        throw new Error(
          'INSERT 값은 리터럴, 엑셀 열 또는 TRY_CONVERT(형식, 엑셀 열)만 사용할 수 있습니다.',
        )
    if (condition && !scope.on(condition))
      throw new Error(
        'ON은 대상 열 = 엑셀 열(또는 TRY_CONVERT) 비교를 AND로만 연결할 수 있습니다.',
      )
    if (filter && !scope.where(filter))
      throw new Error('WHERE는 열과 리터럴 비교만 지원합니다.')
    const values = items.map(render)
    const name = `${quote(schema)}.${quote(table)}`
    const targetSql = target ? `${name} AS ${quote(target.alias!)}` : undefined
    const onSql = condition ? render(condition) : undefined
    const predicateSql = filter ? render(filter) : ''
    return {
      kind: 'insert',
      table: { schema, table },
      predicateSql,
      assignedColumns: columns,
      predicateColumns: [...scope.targetColumns],
      join: {
        alias: target?.alias,
        target: targetSql,
        stage: `${quote(`#${stage.table}`)} AS ${quote(stage.alias)}`,
        on: onSql,
        imports: [stage.table],
        importColumns: [...scope.importColumns],
        rawColumns: columns.filter(
          (_, index) => scope.side(items[index]!) === 'stage',
        ),
        values,
        checks: scope.checks,
      },
      sql: `INSERT INTO ${name} (${columns.map(quote).join(', ')})\nSELECT ${values.join(', ')}\nFROM ${quote(stage.schema)}.${quote(stage.table)} AS ${quote(stage.alias)}${targetSql ? `\nLEFT JOIN ${targetSql} ON ${onSql}` : ''}${predicateSql ? `\nWHERE ${predicateSql}` : ''}`,
    }
  }
  mutation(): MutationQuery {
    if (this.at('DROP') || this.at('TRUNCATE'))
      throw new Error('DROP and TRUNCATE are always blocked')
    if (this.take('INSERT')) return this.insert()
    const kind = this.take('UPDATE')
      ? 'update'
      : this.take('DELETE')
        ? 'delete'
        : undefined
    if (!kind)
      throw new Error(
        'Only restricted UPDATE/DELETE/INSERT are supported; DDL, MERGE and batches are blocked',
      )
    if (kind === 'update' && this.tokens[this.pos + 1]?.value !== '.')
      return this.joinedUpdate()
    if (kind === 'delete') this.expect('FROM')
    const { schema, table } = this.qualifiedName()
    const assignedColumns: string[] = []
    const assignments: string[] = []
    const newValues: string[] = []
    const literal = (value: Expr): boolean =>
      value.kind === 'literal' ||
      (value.kind === 'unary' &&
        ['+', '-'].includes(value.op) &&
        value.value.kind === 'literal' &&
        /^\d+(\.\d+)?$/.test(value.value.sql))
    if (kind === 'update') {
      this.expect('SET')
      do {
        const column = this.identifier()
        if (
          assignedColumns.some(
            (name) => name.toLowerCase() === column.toLowerCase(),
          ) ||
          assignedColumns.length >= 32
        )
          throw new Error('Duplicate assignment or too many columns')
        this.expect('=')
        const value = this.expr()
        if (!literal(value))
          throw new Error(
            'SET values must be literals; expressions, functions and DEFAULT are blocked',
          )
        assignedColumns.push(column)
        newValues.push(render(value))
        assignments.push(`${quote(column)} = ${render(value)}`)
      } while (this.take(','))
    }
    if (!this.take('WHERE'))
      throw new Error('WHERE is required: full-table UPDATE/DELETE is blocked')
    const predicate = this.expr()
    const predicateColumns = new Set<string>()
    const reference = (value: Expr): boolean => {
      if (
        value.kind !== 'reference' ||
        value.parts.length !== 1 ||
        value.parts[0] === '*'
      )
        return false
      predicateColumns.add(value.parts[0]!)
      return true
    }
    const validate = (value: Expr): boolean => {
      if (value.kind === 'unary' && value.op === 'NOT')
        return validate(value.value)
      if (value.kind !== 'binary') return false
      if (value.op === 'AND' || value.op === 'OR')
        return validate(value.left) && validate(value.right)
      if (!reference(value.left)) return false
      if (value.op === 'IN')
        return (
          value.right.kind === 'list' &&
          value.right.items.length <= 100 &&
          value.right.items.every(literal)
        )
      return (
        [
          '=',
          '<>',
          '!=',
          '<',
          '>',
          '<=',
          '>=',
          'IS',
          'IS NOT',
          'LIKE',
        ].includes(value.op) && literal(value.right)
      )
    }
    if (!validate(predicate) || predicateColumns.size === 0)
      throw new Error(
        'WHERE must compare local columns with literals; constant predicates, functions and subqueries are blocked',
      )
    this.take(';')
    if (this.pos !== this.tokens.length)
      throw new Error(
        'Unsupported write syntax: joins, aliases, hints, OUTPUT and batches are blocked',
      )
    const target = `${quote(schema)}.${quote(table)}`
    const predicateSql = render(predicate)
    const setSql = kind === 'update' ? assignments.join(', ') : undefined
    return {
      kind,
      table: { schema, table },
      predicateSql,
      setSql,
      assignedColumns,
      predicateColumns: [...predicateColumns],
      ...(kind === 'update' ? { newValues } : {}),
      sql: `${kind === 'update' ? `UPDATE ${target} SET ${setSql}` : `DELETE FROM ${target}`}\nWHERE ${predicateSql}`,
    }
  }
  private count(): number {
    const token = this.tokens[this.pos++]
    if (
      token?.kind !== 'number' ||
      !/^\d+$/.test(token.value) ||
      !Number.isSafeInteger(Number(token.value))
    )
      throw new Error('OFFSET/FETCH requires non-negative integers')
    return Number(token.value)
  }
  private rows(): void {
    if (!this.take('ROWS')) this.expect('ROW')
  }
  parse(
    maxRows: number,
    resolveTable?: TableResolver,
    page?: ReadPage,
  ): ReadQuery {
    this.expect('SELECT')
    const distinct = this.take('DISTINCT')
    let top = maxRows + 1
    let userTop: number | undefined
    if (this.take('TOP')) {
      const parenthesized = this.take('(')
      const value = this.tokens[this.pos++]
      if (
        value?.kind !== 'number' ||
        !/^\d+$/.test(value.value) ||
        !Number.isSafeInteger(Number(value.value)) ||
        Number(value.value) < 1
      )
        throw new Error('TOP requires a positive integer')
      userTop = Number(value.value)
      top = Math.min(top, userTop)
      if (parenthesized) this.expect(')')
    }
    const columns: { expression: Expr; alias?: string }[] = []
    do {
      columns.push({ expression: this.expr(), alias: this.alias() })
    } while (this.take(','))
    const tables: TableReference[] = []
    const joins: { kind: string; table: TableReference; on: Expr }[] = []
    if (this.take('FROM')) {
      tables.push(this.table())
      while (
        this.at('JOIN') ||
        this.at('INNER') ||
        this.at('LEFT') ||
        this.at('RIGHT') ||
        this.at('FULL')
      ) {
        let kind = 'INNER'
        if (!this.at('JOIN')) {
          kind = this.tokens[this.pos++]!.value.toUpperCase()
          this.take('OUTER')
        }
        this.expect('JOIN')
        const table = this.table()
        tables.push(table)
        this.expect('ON')
        joins.push({ kind, table, on: this.expr() })
      }
    }
    const where = this.take('WHERE') ? this.expr() : undefined
    const group: Expr[] = []
    if (this.take('GROUP')) {
      this.expect('BY')
      do {
        group.push(this.expr())
      } while (this.take(','))
    }
    const having = this.take('HAVING') ? this.expr() : undefined
    const order: { expression: Expr; direction: string }[] = []
    if (this.take('ORDER')) {
      this.expect('BY')
      do {
        const expression = this.expr()
        const direction = this.take('DESC') ? 'DESC' : (this.take('ASC'), 'ASC')
        order.push({ expression, direction })
      } while (this.take(','))
    }
    let offset: number | undefined
    let fetch = maxRows + 1
    if (this.take('OFFSET')) {
      if (!order.length) throw new Error('OFFSET requires ORDER BY')
      if (userTop !== undefined)
        throw new Error('TOP cannot be combined with OFFSET/FETCH')
      offset = this.count()
      this.rows()
      if (this.take('FETCH')) {
        if (!this.take('NEXT')) this.expect('FIRST')
        fetch = Math.min(fetch, this.count())
        this.rows()
        this.expect('ONLY')
      }
    }
    this.take(';')
    if (this.pos !== this.tokens.length)
      throw new Error(
        'Unsupported SQL. Writes, batches, CTEs, subqueries, variables, hints and cross-database queries are blocked in Phase 2.',
      )
    const tableSql = (table: TableReference): string => {
      const resolved = resolveTable?.(table)
      const name = resolved
        ? `${resolved.schema ? `${quote(resolved.schema)}.` : ''}${quote(resolved.table)}`
        : `${table.database ? `${quote(table.database)}.` : ''}${quote(table.schema)}.${quote(table.table)}`
      const alias = table.alias ?? (resolved ? table.table : undefined)
      return `${name}${alias ? ` AS ${quote(alias)}` : ''}`
    }
    const aggregate =
      distinct ||
      group.length > 0 ||
      !!having ||
      columns.some((item) => hasAggregate(item.expression))
    let orderSql = order.map(
      (item) => `${render(item.expression)} ${item.direction}`,
    )
    if (page) {
      if (offset !== undefined)
        throw new Error('Queries with their own OFFSET cannot load more rows')
      if (!orderSql.length && (aggregate || !page.order?.length))
        throw new Error(
          'Add ORDER BY to load more rows; automatic primary-key order needs a single table without aggregates',
        )
      if (!orderSql.length)
        orderSql = page.order!.map(
          (parts) => `${parts.map(quote).join('.')} ASC`,
        )
      const remaining = userTop === undefined ? Infinity : userTop - page.offset
      if (remaining < 1) throw new Error('No more rows within TOP')
      offset = page.offset
      fetch = Math.min(maxRows + 1, remaining)
    }
    const sql = [
      `SELECT ${distinct ? 'DISTINCT ' : ''}${offset === undefined ? `TOP (${top}) ` : ''}${columns.map((item) => `${render(item.expression)}${item.alias ? ` AS ${quote(item.alias)}` : ''}`).join(', ')}`,
      tables[0] ? `FROM ${tableSql(tables[0])}` : '',
      ...joins.map(
        (join) =>
          `${join.kind} JOIN ${tableSql(join.table)} ON ${render(join.on)}`,
      ),
      where ? `WHERE ${render(where)}` : '',
      group.length ? `GROUP BY ${group.map(render).join(', ')}` : '',
      having ? `HAVING ${render(having)}` : '',
      orderSql.length ? `ORDER BY ${orderSql.join(', ')}` : '',
      offset === undefined
        ? ''
        : `OFFSET ${offset} ROWS FETCH NEXT ${fetch} ROWS ONLY`,
    ]
      .filter(Boolean)
      .join('\n')
    return {
      kind: 'select',
      sql,
      tables,
      shape: {
        ordered: order.length > 0,
        single: tables.length === 1 ? tables[0] : undefined,
        aggregate,
        top: userTop,
        userOffset: offset !== undefined && !page,
        star: columns.some(
          ({ expression }) =>
            expression.kind === 'reference' && expression.parts.at(-1) === '*',
        ),
        plain: columns.every(
          ({ expression, alias }) =>
            expression.kind === 'reference' &&
            (!alias ||
              alias.toLowerCase() === expression.parts.at(-1)!.toLowerCase()),
        ),
      },
    }
  }
}

export function parseReadQuery(
  sql: string,
  maxRows: number,
  resolveTable?: TableResolver,
  page?: ReadPage,
  database?: string,
  otherDatabases = false,
): ReadQuery {
  if (
    !Number.isInteger(maxRows) ||
    maxRows < 1 ||
    (maxRows > 5000 && maxRows !== exportRowLimit)
  )
    throw new Error('Invalid row limit')
  if (
    page &&
    (!Number.isSafeInteger(page.offset) ||
      page.offset < 0 ||
      (page.order?.length ?? 0) > 8)
  )
    throw new Error('Invalid page request')
  return new SqlParser(tokenize(sql), database, otherDatabases).parse(
    maxRows,
    resolveTable,
    page,
  )
}
export function parseMutation(sql: string, database?: string): MutationQuery {
  if (sql.includes('\0')) throw new Error('NUL is not allowed in mutation SQL')
  if (sql.length > 16000)
    throw new Error('Mutation SQL exceeds 16000 characters')
  return new SqlParser(tokenize(sql), database).mutation()
}
