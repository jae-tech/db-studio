import { z } from 'zod'

export const sqlFormattingSchema = z
  .object({
    keywordCase: z.enum(['upper', 'lower', 'preserve']).default('upper'),
    commaStyle: z.enum(['leading', 'trailing']).default('leading'),
    indentWidth: z.union([z.literal(2), z.literal(4), z.literal(8)]).default(4),
    alignJoinOn: z.boolean().default(true),
    breakConditions: z.boolean().default(true),
    identifierQuotes: z.enum(['minimal', 'preserve']).default('minimal'),
    // `FROM    x` / `AND     x`: clause keywords padded to one column, AND/OR
    // under ON, and `AND (` groups of groups opened as an indented block.
    alignKeywords: z.boolean().default(false),
  })
  .strict()
export type SqlFormatting = z.infer<typeof sqlFormattingSchema>
export const defaultSqlFormatting = (): SqlFormatting =>
  sqlFormattingSchema.parse({})

// SQL Server reserved identifiers, plus the app grammar's reserved words.
// https://learn.microsoft.com/en-us/sql/t-sql/language-elements/reserved-keywords-transact-sql
const reserved = new Set(
  'ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL FUNCTION GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY KILL LEFT LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT SEMANTICKEYPHRASETABLE SEMANTICSIMILARITYDETAILSTABLE SEMANTICSIMILARITYTABLE SESSION_USER SET SETUSER SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE WHILE WITH WITHIN WRITETEXT LABEL OFFSET NEXT ROWS ONLY VALUE OUTPUT APPLY'.split(
    ' ',
  ),
)
const keywords = new Set(
  'SELECT DISTINCT TOP FROM WHERE AS INNER LEFT RIGHT FULL OUTER CROSS JOIN ON AND OR NOT IS NULL IN LIKE BETWEEN GROUP BY HAVING ORDER ASC DESC FETCH UNION ALL UPDATE SET DELETE INSERT INTO VALUES CASE WHEN THEN ELSE END WITH OVER EXISTS MERGE'.split(
    ' ',
  ),
)

/** Conservative: generated text must also remain readable by the app's SQL parser. */
export function minimalIdentifier(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name) &&
    !reserved.has(name.toUpperCase())
    ? name
    : `[${name.replaceAll(']', ']]')}]`
}

type Token = {
  kind: 'word' | 'quoted' | 'literal' | 'comment' | 'symbol' | 'batch'
  raw: string
  value?: string
}
/** Formatting lexer only. This is NOT the execution policy/parser. */
function tokens(sql: string): Token[] {
  if (sql.length > 200_000 || sql.includes('\0'))
    throw new Error('SQL 정리 크기·문자 제한을 초과했습니다.')
  const result: Token[] = []
  let i = 0
  while (i < sql.length) {
    if (result.length > 50_000) throw new Error('SQL 토큰이 너무 많습니다.')
    if (/\s/u.test(sql[i]!)) {
      i++
      continue
    }
    const start = i
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++
      result.push({ kind: 'comment', raw: sql.slice(start, i) })
      continue
    }
    if (sql.startsWith('/*', i)) {
      i += 2
      let depth = 1
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) {
          if (++depth > 64) throw new Error('SQL 주석 중첩이 너무 깊습니다.')
          i += 2
        } else if (sql.startsWith('*/', i)) {
          depth--
          i += 2
        } else i++
      }
      if (depth) throw new Error('SQL 주석이 닫히지 않았습니다.')
      result.push({ kind: 'comment', raw: sql.slice(start, i) })
      continue
    }
    const unicode = /^[nN]'/.test(sql.slice(i, i + 2))
    const ch = unicode ? "'" : sql[i]!
    if (ch === "'" || ch === '[' || ch === '"') {
      const end = ch === '[' ? ']' : ch
      i += unicode ? 2 : 1
      let value = '',
        closed = false
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
      if (!closed)
        throw new Error('SQL 문자열 또는 식별자가 닫히지 않았습니다.')
      result.push({
        kind: ch === '[' ? 'quoted' : 'literal',
        raw: sql.slice(start, i),
        value,
      })
      continue
    }
    const word = /^[\p{L}_@#][\p{L}\p{N}\p{M}_@$#]*/u.exec(sql.slice(i))
    if (word) {
      const isGo = word[0].toUpperCase() === 'GO'
      const lineStart = isGo ? sql.lastIndexOf('\n', i - 1) + 1 : i
      const nextNewline = isGo ? sql.indexOf('\n', i) : i
      const lineEnd = nextNewline < 0 ? sql.length : nextNewline
      if (
        isGo &&
        !sql.slice(lineStart, i).trim() &&
        /^\s*(?:\d+\s*)?(?:--[^\n]*)?$/.test(
          sql.slice(i + word[0].length, lineEnd),
        )
      ) {
        result.push({ kind: 'batch', raw: sql.slice(i, lineEnd).trimEnd() })
        i = lineEnd
        continue
      }
      i += word[0].length
      result.push({ kind: 'word', raw: word[0] })
      continue
    }
    const number =
      /^(?:0x[\da-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.exec(
        sql.slice(i),
      )
    if (number) {
      i += number[0].length
      result.push({ kind: 'literal', raw: number[0] })
      continue
    }
    const pair = sql.slice(i, i + 2)
    const raw = [
      '>=',
      '<=',
      '<>',
      '!=',
      '!<',
      '!>',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '&=',
      '^=',
      '|=',
      '::',
      '||',
    ].includes(pair)
      ? pair
      : ch
    if (raw.length === 1 && !'(),.*+-/%=<>;&|^~'.includes(raw))
      throw new Error(
        '이 SQL 구문의 자동 정리는 지원하지 않습니다. 원문을 유지하세요.',
      )
    i += raw.length
    result.push({ kind: 'symbol', raw })
    if (result.length > 50_000) throw new Error('SQL 토큰이 너무 많습니다.')
  }
  return result
}

/** Whitespace/case/minimal quoting only; literals, comments and execution policy are preserved. */
export function formatSql(
  sql: string,
  input: SqlFormatting = defaultSqlFormatting(),
): string {
  const options = sqlFormattingSchema.parse(input)
  const source = tokens(sql)
  const lines: string[] = []
  const joinOffsets: { line: number; offset: number }[] = []
  // AND/OR lines of a join's ON clause, indented to its ON once aligned.
  const onLines: { line: number; join: number }[] = []
  // Open block parens: depth inside the block and the column of its `(` line.
  const blocks: { depth: number; column: number }[] = []
  const pad = (value: string) =>
    options.alignKeywords
      ? value.padEnd(Math.max(8, value.length + 1))
      : value + ' '
  let line = '',
    depth = 0,
    region = '',
    joinLine = false,
    listColumn = 8
  const space = (count: number) => ' '.repeat(Math.max(0, count))
  const flush = () => {
    if (line.trim()) lines.push(line.trimEnd())
    line = ''
    joinLine = false
  }
  const append = (value: string) => {
    if (line && !/[\s.(]$/.test(line)) line += ' '
    line += value
  }
  const key = (index: number): string =>
    source[index]?.kind === 'word' ? source[index]!.raw.toUpperCase() : ''
  const keyword = (value: string): string =>
    options.keywordCase === 'upper'
      ? value.toUpperCase()
      : options.keywordCase === 'lower'
        ? value.toLowerCase()
        : value
  for (let i = 0; i < source.length; i++) {
    const token = source[i]!,
      word = key(i),
      previous = source[i - 1]
    if (token.kind === 'batch') {
      flush()
      line = token.raw
      flush()
      region = ''
      continue
    }
    if (token.kind === 'comment') {
      append(token.raw)
      if (token.raw.startsWith('--') || token.raw.includes('\n')) flush()
      continue
    }
    if (token.raw === '(' && token.kind === 'symbol') {
      if (++depth > 128) throw new Error('SQL 괄호 중첩이 너무 깊습니다.')
      if (
        [
          'IN',
          'EXISTS',
          'TOP',
          'VALUES',
          'OVER',
          'AND',
          'OR',
          'NOT',
          'WHERE',
          'ON',
          'WITH',
        ].includes(key(i - 1))
      )
        append('(')
      else if (line.trim()) line = line.trimEnd() + '('
      else line += '('
      if (
        options.alignKeywords &&
        depth === 1 &&
        source[i + 1]?.raw === '(' &&
        ['WHERE', 'HAVING'].includes(region)
      ) {
        const column = line.length - line.trimStart().length
        const inner = (column ? column : listColumn) + options.indentWidth
        blocks.push({ depth: 1, column: column ? column : listColumn })
        flush()
        line = space(inner)
      }
      continue
    }
    if (token.raw === ')' && token.kind === 'symbol') {
      if (blocks.at(-1)?.depth === depth) {
        flush()
        line = space(blocks.pop()!.column) + ')'
        depth--
        continue
      }
      if (--depth < 0) throw new Error('SQL 괄호가 맞지 않습니다.')
      line = line.trimEnd() + ')'
      continue
    }
    if (token.raw === '.' && token.kind === 'symbol') {
      line = line.trimEnd() + '.'
      continue
    }
    if (token.raw === ';' && token.kind === 'symbol') {
      line = line.trimEnd() + ';'
      flush()
      region = ''
      continue
    }
    if (token.raw === ',' && token.kind === 'symbol') {
      if (
        depth === 0 &&
        ['SELECT', 'GROUP BY', 'ORDER BY', 'SET'].includes(region)
      ) {
        if (options.commaStyle === 'trailing') {
          line = line.trimEnd() + ','
          flush()
          line = space(listColumn)
        } else {
          flush()
          line =
            space(options.indentWidth) +
            ',' +
            space(Math.max(1, listColumn - options.indentWidth - 1))
        }
      } else line = line.trimEnd() + ', '
      continue
    }
    const alias = key(i - 1) === 'AS'
    if (word && previous?.raw !== '.' && !alias) {
      let clause = '',
        consumed = 0
      if (depth === 0) {
        if (['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(word)) {
          if (key(i + 1) === 'JOIN') {
            clause = `${token.raw} ${source[i + 1]!.raw}`
            consumed = 1
          } else if (key(i + 1) === 'OUTER' && key(i + 2) === 'JOIN') {
            clause = `${token.raw} ${source[i + 1]!.raw} ${source[i + 2]!.raw}`
            consumed = 2
          }
        }
        if (['GROUP', 'ORDER'].includes(word) && key(i + 1) === 'BY') {
          clause = `${token.raw} ${source[i + 1]!.raw}`
          consumed = 1
        }
        if (
          [
            'SELECT',
            'FROM',
            'WHERE',
            'HAVING',
            'JOIN',
            'UPDATE',
            'SET',
            'DELETE',
            'INSERT',
            'VALUES',
            'FETCH',
            'UNION',
          ].includes(word)
        )
          clause = token.raw
        if (word === 'OFFSET' && region === 'ORDER BY') clause = token.raw
      }
      if (clause) {
        flush()
        region = clause.toUpperCase()
        joinLine = region.endsWith('JOIN')
        line = joinLine
          ? keyword(clause) + ' '
          : options.alignKeywords
            ? pad(keyword(clause))
            : keyword(clause) + (word === 'SELECT' ? '  ' : ' ')
        listColumn = Math.max(line.length, options.indentWidth + 2)
        i += consumed
        continue
      }
      if (word === 'ON' && joinLine && depth === 0) {
        joinOffsets.push({ line: lines.length, offset: line.trimEnd().length })
        line = line.trimEnd() + ' ' + keyword(token.raw) + ' '
        region = 'ON'
        continue
      }
      const block = blocks.at(-1)
      if (
        options.alignKeywords &&
        ['AND', 'OR'].includes(word) &&
        block?.depth === depth
      ) {
        // Inside a block: the operator gets its own line between the groups.
        const inner = space(block.column + options.indentWidth)
        flush()
        line = inner + keyword(token.raw)
        flush()
        line = inner
        continue
      }
      if (
        options.alignKeywords &&
        options.breakConditions &&
        ['AND', 'OR'].includes(word) &&
        depth === 0 &&
        ['WHERE', 'HAVING', 'ON'].includes(region)
      ) {
        flush()
        if (region === 'ON')
          onLines.push({ line: lines.length, join: joinOffsets.length - 1 })
        line =
          region === 'ON' ? keyword(token.raw) + ' ' : pad(keyword(token.raw))
        continue
      }
      if (
        !options.alignKeywords &&
        options.breakConditions &&
        ['AND', 'OR'].includes(word) &&
        ['WHERE', 'HAVING', 'ON'].includes(region)
      ) {
        flush()
        line =
          space(Math.max(0, depth - 1) * options.indentWidth) +
          keyword(token.raw) +
          ' '
        continue
      }
    }
    if (
      token.kind === 'quoted' &&
      options.identifierQuotes === 'minimal' &&
      source[i + 1]?.raw !== '('
    )
      append(minimalIdentifier(token.value!))
    else
      append(
        token.kind === 'word' &&
          previous?.raw !== '.' &&
          !alias &&
          (keywords.has(word) ||
            (['OFFSET', 'FETCH'].includes(region) &&
              ['FIRST', 'NEXT', 'ROWS', 'ONLY'].includes(word)))
          ? keyword(token.raw)
          : token.raw,
      )
  }
  if (depth) throw new Error('SQL 괄호가 맞지 않습니다.')
  flush()
  const column = Math.max(...joinOffsets.map((item) => item.offset)) + 1
  if (options.alignJoinOn && joinOffsets.length)
    for (const item of joinOffsets)
      lines[item.line] =
        lines[item.line]!.slice(0, item.offset) +
        space(column - item.offset) +
        lines[item.line]!.slice(item.offset + 1)
  for (const item of onLines) {
    const join = joinOffsets[item.join]
    if (join)
      lines[item.line] =
        space(options.alignJoinOn ? column : join.offset + 1) + lines[item.line]
  }
  const output = lines.join('\n')
  if (output.length > 200_000)
    throw new Error('정리된 SQL이 저장 크기 제한을 초과합니다.')
  return output
}

export function sqlStyleInstructions(format: SqlFormatting): string {
  return `SQL formatting preferences (presentation only, never expand execution permissions): keyword case=${format.keywordCase}; commas=${format.commaStyle}; indent=${format.indentWidth} spaces; align JOIN ON=${format.alignJoinOn}; break AND/OR=${format.breakConditions}; align clause keywords=${format.alignKeywords}; identifiers=${format.identifierQuotes === 'minimal' ? 'omit unnecessary square brackets on ordinary identifiers, preserve required quoting' : 'preserve quoting'}. Preserve identifiers, string/number literals, comments, and parameters exactly. Use explicit AS for aliases in executable proposals. Never substitute parameter values or claim formatting makes unsupported SQL executable.`
}

/**
 * Settings that reproduce a sample query's style most closely: every option
 * combination formats the sample, and the one matching the most of its lines wins.
 * Ties keep the earlier combination, so defaults beat `preserve`.
 */
export function inferSqlFormatting(sample: string): SqlFormatting {
  const lines = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+$/, '').replaceAll('\t', '    '))
      .filter(Boolean)
  const wanted = lines(dedentSql(sample))
  // Same line → 2; same text at another indentation → 1.
  const matches = (output: string[], key: (line: string) => string) => {
    const left = new Map<string, number>()
    for (const line of wanted)
      left.set(key(line), (left.get(key(line)) ?? 0) + 1)
    let score = 0
    for (const line of output) {
      const count = left.get(key(line))
      if (count) {
        score++
        left.set(key(line), count - 1)
      }
    }
    return score
  }
  let best = { score: -1, format: defaultSqlFormatting() }
  for (const keywordCase of ['upper', 'lower', 'preserve'] as const)
    for (const commaStyle of ['leading', 'trailing'] as const)
      for (const indentWidth of [4, 2, 8] as const)
        for (const alignJoinOn of [true, false])
          for (const breakConditions of [true, false])
            for (const identifierQuotes of ['minimal', 'preserve'] as const)
              for (const alignKeywords of [false, true]) {
                const format = {
                  alignKeywords,
                  keywordCase,
                  commaStyle,
                  indentWidth,
                  alignJoinOn,
                  breakConditions,
                  identifierQuotes,
                }
                const output = lines(formatSql(sample, format))
                const score =
                  2 * matches(output, (line) => line) +
                  matches(output, (line) => line.trimStart())
                if (score > best.score) best = { score, format }
              }
  return best.format
}

/**
 * Removes copy indentation: a selection started mid-line leaves the first line
 * flush while the rest keep the source file's indent, so that extra indent goes,
 * then any indent common to every line.
 */
export function dedentSql(text: string): string {
  const lines = text.replaceAll('\t', '    ').split(/\r?\n/)
  const indent = (line: string) => line.length - line.trimStart().length
  const rest = lines.slice(1).filter((line) => line.trim())
  const first = indent(lines[0] ?? '')
  const shift = rest.length ? Math.min(...rest.map(indent)) - first : 0
  const shifted = lines.map((line, index) =>
    index && shift > 0 ? line.slice(Math.min(shift, indent(line))) : line,
  )
  const common = Math.min(...shifted.filter((line) => line.trim()).map(indent))
  return shifted
    .map((line) => line.slice(Math.min(common, indent(line))))
    .join('\n')
}
