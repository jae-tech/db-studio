import { z } from 'zod'
import type { QueryResult } from './database'

const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const mutationPreviewSchema = z
  .object({
    connectionId: z.string().uuid(),
    sql: z.string().trim().min(1).max(16000),
  })
  .strict()
export const mutationApplySchema = z
  .object({ id: z.string().uuid(), approvalHash: hash })
  .strict()
export const mutationCommitSchema = mutationApplySchema
  .extend({
    commitToken: z.string().uuid(),
    databaseConfirmation: z.string().min(1).max(128),
  })
  .strict()
export const mutationIdSchema = z.object({ id: z.string().uuid() }).strict()
export type MutationState = {
  id: string
  connectionId: string
  database: string
  kind: 'update' | 'delete' | 'insert'
  sql: string
  approvalHash: string
  policyVersion: string
  stage:
    | 'previewing'
    | 'preview'
    | 'applying'
    | 'applied'
    | 'committing'
    | 'rolling-back'
    | 'committed'
    | 'rolled-back'
    | 'cancelled'
    | 'error'
    | 'unknown'
  expiresAt: number
  affectedRows: number
  preview?: QueryResult
  // Excel JOIN: total stage rows; unmatched = UPDATE rows with no target row under ON.
  importRows?: { total: number; unmatched?: number }
  commitToken?: string
  message: string
  // Specific refusal/driver reason for the last failure, shown under message.
  detail?: string
}
// Read-only "what would change" view; available without the write opt-in.
export type MutationInspection = {
  kind: 'update' | 'delete' | 'insert'
  database: string
  target: string
  affectedRows: number
  // First rows: key/context columns, current values and "→ column" new values.
  sample: QueryResult
  // Why applying is not possible right now; absent when it can be applied.
  applyBlocked?: string
}
export interface MutationApi {
  inspect(
    input: z.infer<typeof mutationPreviewSchema>,
  ): Promise<MutationInspection>
  preview(input: z.infer<typeof mutationPreviewSchema>): Promise<MutationState>
  apply(input: z.infer<typeof mutationApplySchema>): Promise<MutationState>
  commit(input: z.infer<typeof mutationCommitSchema>): Promise<MutationState>
  rollback(input: z.infer<typeof mutationIdSchema>): Promise<MutationState>
  state(connectionId: string): Promise<MutationState | null>
}
