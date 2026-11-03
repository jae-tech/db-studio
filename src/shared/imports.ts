import { z } from 'zod'
const id = z.string().uuid()
const name = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !value.includes('\0'))
export type ImportWorkbook = {
  id: string
  fileName: string
  sheets: { name: string; rowCount: number; columns: string[] }[]
}
export type ImportStage = {
  id: string
  workbookId: string
  sheetName: string
  tableName: string
  columns: string[]
  rowCount: number
  sample: { rowNumber: number; values: string[] }[]
}
export type ImportTable = {
  stageId: string
  connectionId: string
  database: string
  schema: 'import'
  tableName: string
  columns: string[]
  rowCount: number
}
export const importStageSchema = z
  .object({ workbookId: id, sheetName: name })
  .strict()
export const importLoadSchema = z
  .object({ stageId: id, connectionId: id })
  .strict()
export const importIdSchema = z.object({ id }).strict()
export interface ImportApi {
  open(): Promise<ImportWorkbook | null>
  stage(input: z.infer<typeof importStageSchema>): Promise<ImportStage>
  load(input: z.infer<typeof importLoadSchema>): Promise<ImportTable>
  list(connectionId: string): Promise<ImportTable[]>
  discard(input: { id: string }): Promise<void>
}
