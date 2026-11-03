import type * as Monaco from 'monaco-editor/editor/editor.api.js'
import type { QueryClient } from '@tanstack/react-query'
import type { ExplorerData, TableDetails } from '@shared/database'
import { desktop } from './desktop'
import { minimalIdentifier } from '@shared/sqlFormatting'

export type TableRef = { database?: string; schema?: string; table: string }
const keywords =
  'SELECT FROM WHERE JOIN INNER LEFT OUTER ON AS AND OR NOT NULL IS IN LIKE GROUP BY HAVING ORDER ASC DESC TOP DISTINCT COUNT SUM AVG MIN MAX COALESCE ISNULL TRY_CONVERT UPDATE SET DELETE INSERT INTO'.split(
    ' ',
  )
const functions = new Set([
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COALESCE',
  'ISNULL',
  'TRY_CONVERT',
])
const reserved = new Set(keywords.concat(['CROSS', 'FULL', 'RIGHT', 'UNION']))
const part = String.raw`(?:\[((?:[^\]]|\]\])+)\]|([\p{L}_][\p{L}\p{N}_$]*))`
const unquote = (match: RegExpExecArray, index: number): string | undefined =>
  match[index]?.replaceAll(']]', ']') ?? match[index + 1]

/** The app parser only accepts ASCII words unquoted, so Korean or reserved names get brackets. */
export const identifier = minimalIdentifier

/** Alias/table name (lower case) → table, from FROM/JOIN/UPDATE/INTO references. */
export function tableAliases(sql: string): Map<string, TableRef> {
  const found = new Map<string, TableRef>()
  const pattern = new RegExp(
    String.raw`\b(?:FROM|JOIN|UPDATE|INTO)\s+${part}(?:\s*\.\s*${part})?(?:\s*\.\s*${part})?(?:\s+(?:AS\s+)?${part})?`,
    'giu',
  )
  for (const match of sql.matchAll(pattern)) {
    // Keep the catalog in three-part names so aliases can complete remote columns.
    const first = unquote(match, 1)!
    const second = unquote(match, 3)
    const third = unquote(match, 5)
    const ref: TableRef = third
      ? { database: first, schema: second!, table: third }
      : second
        ? { schema: first, table: second }
        : { table: first }
    found.set(ref.table.toLowerCase(), ref)
    const alias = unquote(match, 7)
    if (
      alias &&
      !reserved.has(alias.toUpperCase()) &&
      !/^(WHERE|SET)$/i.test(alias)
    )
      found.set(alias.toLowerCase(), ref)
  }
  return found
}

/** The two identifiers before the final dot of `database.schema.partial`. */
export function databaseSchemaContext(
  before: string,
): { database: string; schema: string } | undefined {
  const match = new RegExp(
    String.raw`${part}\s*\.\s*${part}\s*\.(?:\[[^\]]*|[\p{L}\p{N}_$]*)$`,
    'u',
  ).exec(before)
  if (!match) return undefined
  return { database: unquote(match, 1)!, schema: unquote(match, 3)! }
}

/** `qualifier.partial` right before the cursor, e.g. `t.am` or `[s].[금`. */
export function memberContext(
  before: string,
): { qualifier: string; partial: string; bracket: boolean } | undefined {
  // Spaces are only part of a name inside an open bracket.
  const match = new RegExp(
    String.raw`${part}\s*\.(?:\[([^\]]*)|([\p{L}\p{N}_$]*))$`,
    'u',
  ).exec(before)
  if (!match) return undefined
  return {
    qualifier: unquote(match, 1)!,
    bracket: match[3] !== undefined,
    partial: match[3] ?? match[4] ?? '',
  }
}

/** Only a bare table reference (or a leading FROM) can become a new SELECT. */
export function tableQueryPrefix(
  before: string,
): { text: string; offset: number; bare: boolean } | undefined {
  const blankLines = [...before.matchAll(/\r?\n[ \t]*\r?\n/g)]
  const lastBlank = blankLines.at(-1)
  const start = Math.max(
    before.lastIndexOf(';') + 1,
    lastBlank ? lastBlank.index + lastBlank[0].length : 0,
  )
  const fragment = before.slice(start)
  const leading = /^\s*/u.exec(fragment)![0].length
  const body = fragment.slice(leading)
  const name = String.raw`(?:\[(?:[^\]]|\]\])*\]|[\p{L}_][\p{L}\p{N}_$]*)`
  const table = new RegExp(
    `^${name}(?:\\s*\\.\\s*${name})?(?:\\s*\\.\\s*(?:${name})?)?$`,
    'u',
  )
  const from = /^FROM\s+/iu.exec(body)
  if (
    from &&
    (body.length === from[0].length || table.test(body.slice(from[0].length)))
  )
    return { text: 'SELECT * ', offset: start + leading, bare: false }
  if (body === '' || (table.test(body) && !reserved.has(body.toUpperCase())))
    return { text: 'SELECT * FROM ', offset: start + leading, bare: true }
  return undefined
}

type Source = { connectionId: string; database: string } | undefined
let registered = false
let current: { source: () => Source; client: QueryClient } | undefined

/** One provider for every editor; it always reads the active tab's connection. */
export function registerSqlCompletion(
  monaco: typeof Monaco,
  source: () => Source,
  client: QueryClient,
): void {
  current = { source, client }
  if (registered) return
  registered = true
  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.'],
    async provideCompletionItems(model, position) {
      const scope = current?.source()
      const before = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })
      const member = memberContext(before)
      const tablePrefix = tableQueryPrefix(before)
      const prefixPosition = tablePrefix
        ? model.getPositionAt(tablePrefix.offset)
        : undefined
      const prefixEdit =
        tablePrefix && prefixPosition
          ? {
              range: {
                startLineNumber: prefixPosition.lineNumber,
                startColumn: prefixPosition.column,
                endLineNumber: prefixPosition.lineNumber,
                endColumn: prefixPosition.column,
              },
              text: tablePrefix.text,
            }
          : undefined
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: member
          ? position.column - member.partial.length - (member.bracket ? 1 : 0)
          : word.startColumn,
        endColumn: position.column,
      }
      const kinds = monaco.languages.CompletionItemKind
      // Keywords end with a space (unless one follows); functions open `(` with the cursor inside.
      const spaced = /\s/.test(
        model.getLineContent(position.lineNumber)[position.column - 1] ?? '',
      )
      const keyword = (label: string) =>
        functions.has(label)
          ? {
              insertText: `${label}($0)`,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            }
          : { insertText: spaced ? label : `${label} ` }
      if (!scope || !current) {
        if (member) return { suggestions: [] }
        return {
          suggestions: keywords.map((label) => ({
            label,
            kind: kinds.Keyword,
            ...keyword(label),
            range,
          })),
        }
      }
      const { client } = current
      const explorer = await client
        .fetchQuery({
          queryKey: ['explorer', scope.connectionId, scope.database],
          queryFn: () => desktop().db.getExplorer(scope.connectionId),
          staleTime: 30_000,
        })
        .catch((): ExplorerData | undefined => undefined)
      const tables = explorer?.tables ?? []
      const databases = explorer?.databases ?? []
      const catalog = (name: string | undefined): string | undefined =>
        !name || name.toLowerCase() === scope.database.toLowerCase()
          ? scope.database
          : databases.find(
              (database) => database.toLowerCase() === name.toLowerCase(),
            )
      const explorerFor = async (
        name: string | undefined,
      ): Promise<ExplorerData | undefined> => {
        const database = catalog(name)
        if (!database) return undefined
        if (database.toLowerCase() === scope.database.toLowerCase())
          return explorer
        const remote = await client
          .fetchQuery({
            queryKey: ['explorer', scope.connectionId, database],
            queryFn: () =>
              desktop().db.getExplorer({
                connectionId: scope.connectionId,
                database,
              }),
            staleTime: 30_000,
          })
          .catch((): ExplorerData | undefined => undefined)
        return remote?.database.toLowerCase() === database.toLowerCase()
          ? remote
          : undefined
      }
      const resolve = async (ref: TableRef) => {
        const data = await explorerFor(ref.database)
        const table = data?.tables.find(
          (table) =>
            table.name.toLowerCase() === ref.table.toLowerCase() &&
            (!ref.schema ||
              table.schema.toLowerCase() === ref.schema.toLowerCase()),
        )
        return table ? { table, database: data!.database } : undefined
      }
      const columns = async (ref: TableRef) => {
        const found = await resolve(ref)
        if (!found) return []
        const { table, database } = found
        const details = await client
          .fetchQuery({
            queryKey: [
              'table',
              scope.connectionId,
              database,
              table.schema,
              table.name,
            ],
            queryFn: () =>
              desktop().db.describeTable({
                connectionId: scope.connectionId,
                ...(database.toLowerCase() === scope.database.toLowerCase()
                  ? {}
                  : { database }),
                schema: table.schema,
                table: table.name,
              }),
            staleTime: 30_000,
          })
          .catch((): TableDetails | undefined => undefined)
        return (details?.columns ?? []).map((column) => ({
          label: column.name,
          kind: kinds.Field,
          detail: `${column.type}${column.primaryKey ? ' · PK' : ''} · ${database === scope.database ? '' : `${database}.`}${table.schema}.${table.name}`,
          insertText: identifier(column.name),
          filterText: column.name,
          sortText: `0${String(column.ordinal).padStart(4, '0')}`,
          range,
        }))
      }
      const aliases = tableAliases(model.getValue())
      if (member) {
        const key = member.qualifier.toLowerCase()
        const qualified = databaseSchemaContext(before)
        if (qualified) {
          const data = await explorerFor(qualified.database)
          return {
            suggestions: (data?.tables ?? [])
              .filter(
                (table) =>
                  table.schema.toLowerCase() === qualified.schema.toLowerCase(),
              )
              .map((table) => ({
                label: table.name,
                kind: kinds.Class,
                detail: `${data!.database}.${table.schema} 테이블`,
                insertText: identifier(table.name),
                filterText: table.name,
                additionalTextEdits: prefixEdit ? [prefixEdit] : undefined,
                range,
              })),
          }
        }
        const ref = aliases.get(key)
        // While typing `FROM dbo.` the unfinished `dbo` also looks like a table reference,
        // so an alias only wins when it names a real table.
        if (ref && (await resolve(ref)))
          return { suggestions: await columns(ref) }
        const namedDatabase = catalog(member.qualifier)
        // Any accessible database can precede a schema in a three-part name.
        if (namedDatabase)
          return {
            suggestions:
              (await explorerFor(namedDatabase))?.schemas.map((schema) => ({
                label: schema,
                kind: kinds.Module,
                detail: '스키마',
                insertText: identifier(schema),
                range,
              })) ?? [],
          }
        if (explorer?.schemas.some((schema) => schema.toLowerCase() === key))
          return {
            suggestions: tables
              .filter((table) => table.schema.toLowerCase() === key)
              .map((table) => ({
                label: table.name,
                kind: kinds.Class,
                detail: `${table.schema} 테이블`,
                insertText: identifier(table.name),
                filterText: table.name,
                additionalTextEdits: prefixEdit ? [prefixEdit] : undefined,
                range,
              })),
          }
        const named = tables.filter((table) => table.name.toLowerCase() === key)
        return {
          suggestions:
            named.length === 1
              ? await columns({
                  table: named[0]!.name,
                  schema: named[0]!.schema,
                })
              : [],
        }
      }
      // Columns of tables already referenced in this SQL, then all tables, then keywords.
      const referenced = [
        ...new Map(
          [...aliases.values()].map((ref) => [
            `${ref.database ?? scope.database}.${ref.schema ?? ''}.${ref.table}`.toLowerCase(),
            ref,
          ]),
        ).values(),
      ].slice(0, 8)
      const fields = (await Promise.all(referenced.map(columns))).flat()
      return {
        suggestions: [
          ...fields,
          ...databases
            .filter(
              (database) =>
                database.toLowerCase() !== scope.database.toLowerCase(),
            )
            .map((database) => ({
              label: database,
              kind: kinds.Module,
              detail: '데이터베이스',
              insertText: `${identifier(database)}.`,
              sortText: `1${database}`,
              command: {
                id: 'editor.action.triggerSuggest',
                title: '스키마 자동완성',
              },
              range,
            })),
          ...tables.map((table) => ({
            label: `${table.schema}.${table.name}`,
            kind: kinds.Class,
            detail: '테이블',
            insertText: `${tablePrefix?.bare ? tablePrefix.text : ''}${identifier(table.schema)}.${identifier(table.name)}`,
            additionalTextEdits:
              prefixEdit && !tablePrefix?.bare ? [prefixEdit] : undefined,
            sortText: `2${table.schema}.${table.name}`,
            range,
          })),
          ...keywords.map((label) => ({
            label,
            kind: kinds.Keyword,
            ...keyword(label),
            sortText: `3${label}`,
            range,
          })),
        ],
      }
    },
  })
}
