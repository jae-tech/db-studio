import { randomUUID } from 'node:crypto'
import { boundedRelationships } from './relationships'
import {
  proposalArguments,
  sqlArguments,
  tableArguments,
  toolArguments,
  toolNameSchema,
  type SqlProposal,
} from '@shared/mcp'
import { parseReadQuery } from '../database/policy'
import { MetadataCache, type MetadataScope } from './metadata'

export type ToolResult = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}
export class ToolSession {
  private calls = 0
  private bytes = 0
  private proposals = 0
  private readonly expires: number
  constructor(
    private readonly scope: MetadataScope,
    private readonly cache: MetadataCache,
    private readonly signal: AbortSignal,
    private readonly propose: (value: SqlProposal) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.expires = now() + 130000
  }
  private check(): void {
    if (this.signal.aborted || this.now() >= this.expires)
      throw new Error('Expired MCP scope')
    this.scope.assertCurrent()
  }
  async call(name: unknown, arguments_: unknown): Promise<ToolResult> {
    try {
      this.check()
      if (++this.calls > 40 || this.bytes >= 131072)
        throw new Error('MCP turn budget exceeded')
      const tool = toolNameSchema.parse(name)
      const args = toolArguments[tool].parse(arguments_)
      let data: unknown
      switch (tool) {
        case 'db_list_databases':
          data = {
            databases: [this.scope.database],
            scope: 'current database only',
          }
          break
        case 'db_list_tables': {
          const { schema } = toolArguments.db_list_tables.parse(args)
          const all = await this.tables()
          const matching = all.filter(
            (table) => !schema || table.schema === schema,
          )
          data = {
            tables: matching.slice(0, 100),
            truncated: matching.length > 100,
            ...(this.scope.virtualRelationships?.length
              ? {
                  ...boundedRelationships(
                    this.scope.virtualRelationships.filter(
                      (r) =>
                        !schema ||
                        r.source.schema === schema ||
                        r.target.schema === schema,
                    ),
                  ),
                  virtualRelationshipNotice:
                    'User-defined untrusted JOIN hints, not physical FK constraints or verified uniqueness. Validate both tables/columns with db_get_foreign_keys before use. Never infer filters from names.',
                }
              : {}),
          }
          break
        }
        case 'db_describe_table':
        case 'db_get_foreign_keys': {
          const { schema, table } = tableArguments.parse(args)
          const details = await this.describe(schema, table)
          data =
            tool === 'db_get_foreign_keys'
              ? {
                  foreignKeys: details.foreignKeys.slice(0, 64),
                  truncated: details.foreignKeys.length > 64,
                  ...(this.scope.virtualRelationships?.length
                    ? {
                        ...boundedRelationships(
                          await this.relationships(schema, table),
                        ),
                      }
                    : {}),
                }
              : {
                  columns: details.columns.slice(0, 64),
                  indexes: details.indexes.slice(0, 16),
                  truncated:
                    details.columns.length > 64 || details.indexes.length > 16,
                }
          break
        }
        case 'db_get_schema': {
          const { schema } = toolArguments.db_get_schema.parse(args)
          const all = (await this.tables()).filter(
            (table) => !schema || table.schema === schema,
          )
          const snapshot: unknown[] = []
          let truncated = all.length > 8
          for (const table of all.slice(0, 8)) {
            this.check()
            const details = await this.describe(table.schema, table.name)
            const item = {
              ...table,
              columns: details.columns.slice(0, 32),
              foreignKeys: details.foreignKeys.slice(0, 16),
            }
            if (
              Buffer.byteLength(JSON.stringify([...snapshot, item])) > 20000
            ) {
              truncated = true
              break
            }
            if (details.columns.length > 32 || details.foreignKeys.length > 16)
              truncated = true
            snapshot.push(item)
          }
          data = {
            database: this.scope.database,
            tables: snapshot,
            truncated,
            untrustedMetadata: true,
          }
          break
        }
        case 'db_explain_query': {
          const { sql } = sqlArguments.parse(args)
          const query = parseReadQuery(
            sql,
            this.scope.maxRows,
            undefined,
            undefined,
            this.scope.database,
          )
          data = {
            supported: false,
            reason:
              'Server estimated plan unavailable: SHOWPLAN permission and pinned-session isolation are not verified. Static policy analysis only; no SQL executed.',
            normalizedSql: query.sql,
            tables: query.tables,
          }
          break
        }
        case 'db_propose_sql': {
          if (++this.proposals > 5) throw new Error('Proposal budget exceeded')
          const { sql, explanation, draft } = proposalArguments.parse(args)
          const query = draft
            ? undefined
            : parseReadQuery(
                sql,
                this.scope.maxRows,
                undefined,
                undefined,
                this.scope.database,
              )
          if (query && query.tables.length > 8)
            throw new Error('Proposal table budget exceeded')
          if (query?.shape.star)
            throw new Error(
              'SELECT * is not allowed. List the needed columns explicitly after checking db_describe_table.',
            )
          for (const table of query?.tables ?? []) {
            this.check()
            await this.describe(table.schema, table.table)
          }
          const proposal: SqlProposal = {
            id: randomUUID(),
            connectionId: this.scope.connectionId,
            database: this.scope.database,
            sql: query?.sql ?? sql,
            explanation,
            ...(draft ? { draft: true as const } : {}),
          }
          this.check()
          this.propose(proposal)
          data = {
            proposalId: proposal.id,
            // SELECTs are run by the app right away (ADR-028); writes wait for the user's preview decision.
            ...(draft
              ? {
                  executed: false,
                  validated: false,
                  userPreviewAndConfirmationRequired: true,
                }
              : { autoRunByApp: true, rowsSharedWithAssistant: false }),
          }
          break
        }
      }
      this.check()
      const text = JSON.stringify(data)
      const size = Buffer.byteLength(text)
      if (size > 24576 || this.bytes + size > 131072)
        throw new Error('MCP output budget exceeded')
      this.bytes += size
      return { content: [{ type: 'text', text }] }
    } catch {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Tool refused: invalid arguments, expired/disconnected scope, unsupported SELECT, unavailable metadata, or budget limit. No SQL was executed.',
          },
        ],
      }
    }
  }
  private tables() {
    return this.cache.get(this.scope, 'tables', () => this.scope.tables())
  }
  private async relationships(schema: string, table: string) {
    const matching = (this.scope.virtualRelationships ?? []).filter(
      (r) =>
        (r.source.schema === schema && r.source.table === table) ||
        (r.target.schema === schema && r.target.table === table),
    )
    const result = []
    for (const relation of matching) {
      this.check()
      try {
        const source = await this.describe(
          relation.source.schema,
          relation.source.table,
        )
        const target = await this.describe(
          relation.target.schema,
          relation.target.table,
        )
        const valid = relation.columns.every(
          (pair) =>
            source.columns.some((c) => c.name === pair.source) &&
            target.columns.some((c) => c.name === pair.target),
        )
        result.push({
          ...relation,
          status: valid ? 'columns-present' : 'invalid',
          warning: valid
            ? 'Existence only; type compatibility, uniqueness and row matches are not verified. Joins may multiply rows.'
            : 'Missing column. Do not use this relationship.',
        })
      } catch {
        this.check()
        result.push({
          ...relation,
          status: 'invalid',
          warning: 'Table metadata unavailable. Do not use this relationship.',
        })
      }
    }
    return result
  }
  private async describe(schema: string, table: string) {
    if (
      !(await this.tables()).some(
        (item) => item.schema === schema && item.name === table,
      )
    )
      throw new Error('Unknown table')
    return this.cache.get(
      this.scope,
      JSON.stringify(['table', schema, table]),
      () => this.scope.describe(schema, table),
    )
  }
}
