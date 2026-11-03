import type { QueryResult } from '@shared/database'
import type { MutationInspection } from '@shared/mutation'
import type { MutationQuery } from './policy'

export type MutationSnapshot = {
  // Target rowversions for UPDATE/DELETE; empty for INSERT.
  versions: string[]
  count: number
  // INSERT: digest of the exact rows to insert, rechecked under locks.
  rowsDigest: string
  metadataHash: string
  executionSql: string
  sample: QueryResult
  // Excel JOIN only (unlocked preview): stage rows, and UPDATE rows matching no target by ON.
  importRows?: { total: number; unmatched?: number }
}
export interface MutationAdapter {
  // Read-only and ungated: shows what the statement would change.
  inspect(
    query: MutationQuery,
    requestId: string,
    signal: AbortSignal,
  ): Promise<Omit<MutationInspection, 'database' | 'applyBlocked'>>
  // Throws the reason the target cannot be written by the guarded apply path.
  checkTarget(
    query: MutationQuery,
    requestId: string,
    signal: AbortSignal,
  ): Promise<void>
  preview(
    query: MutationQuery,
    requestId: string,
    signal: AbortSignal,
    locked: boolean,
  ): Promise<MutationSnapshot>
  apply(
    query: MutationQuery,
    snapshot: MutationSnapshot,
    requestId: string,
    signal: AbortSignal,
  ): Promise<number>
}
