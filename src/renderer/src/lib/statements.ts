/**
 * The statement under the cursor, DBeaver-style: statements end at `;` (outside
 * strings, [names], "names" and comments) or at a blank line. On a separator or
 * blank line the statement just before it is used.
 */
function split(sql: string): [number, number][] {
  const ranges: [number, number][] = []
  let start = 0
  let i = 0
  const cut = (end: number, next: number): void => {
    const text = sql.slice(start, end)
    // Leading blank lines belong to the gap, not to the next statement.
    if (text.trim())
      ranges.push([start + text.length - text.trimStart().length, end])
    start = next
  }
  while (i < sql.length) {
    const ch = sql[i]!
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? sql.length : end
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 2
    } else if (ch === "'" || ch === '"' || ch === '[') {
      const close = ch === '[' ? ']' : ch
      i++
      while (i < sql.length) {
        if (sql[i] === close) {
          // Doubled quote/bracket is an escaped character.
          if (sql[i + 1] === close) i += 2
          else break
        } else i++
      }
      i++
    } else if (ch === ';') {
      cut(i, i + 1)
      i++
    } else if (ch === '\n') {
      const blank = /^\n[ \t\r]*\n/.exec(sql.slice(i))
      if (blank) {
        cut(i, i + blank[0].length - 1)
        i += blank[0].length - 1
      } else i++
    } else i++
  }
  cut(sql.length, sql.length)
  return ranges
}

/** Every statement, trimmed, in order (전체 실행). */
export const statements = (sql: string): string[] =>
  split(sql).map(([from, to]) => sql.slice(from, to).trim())

export function statementAt(sql: string, offset: number): string {
  const ranges = split(sql)
  if (ranges.length <= 1) return sql
  const hit =
    ranges.find(([from, to]) => offset >= from && offset <= to) ??
    ranges.filter(([from]) => from <= offset).at(-1) ??
    ranges[0]!
  return sql.slice(hit[0], hit[1]).trim()
}
