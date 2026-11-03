import { z } from 'zod'
import type { DatabaseApi } from './database'
import type { AgentApi } from './agent'
import { sqlFormattingSchema } from './sqlFormatting'
import { virtualRelationshipsSchema } from './relationships'
import { agentModelSchema } from './agent'

export const tabSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().max(80),
    sql: z.string().max(200_000),
    connectionId: z.string().uuid().optional(),
  })
  .strict()
const columnName = z.string().min(1).max(128)
// Saved column order per `connectionId:database:schema.table`; hidden = unchecked columns.
export const columnLayoutSchema = z
  .object({
    order: z.array(columnName).max(1024),
    hidden: z.array(columnName).max(1024),
  })
  .strict()
export type ColumnLayout = z.infer<typeof columnLayoutSchema>
export const paletteIdSchema = z.enum(['emerald', 'ocean', 'violet', 'amber'])
export type PaletteId = z.infer<typeof paletteIdSchema>
export const settingsSchema = z
  .object({
    theme: z.enum(['dark', 'light']).default('dark'),
    // Dark and light remember their own color combination. Old settings use emerald.
    themePalettes: z
      .object({
        dark: paletteIdSchema,
        light: paletteIdSchema,
      })
      .strict()
      .default({ dark: 'emerald', light: 'emerald' }),
    // A saved provider that no longer exists (e.g. the removed 'claude') falls back to Codex.
    provider: z.enum(['codex', 'copilot']).catch('codex'),
    tabs: z
      .array(tabSchema)
      .min(1)
      .max(30)
      .default([
        {
          id: 'query-1',
          title: '쿼리 1',
          sql: '-- 데이터베이스에 연결한 뒤 시작하세요.\nSELECT 1 AS hello;',
        },
      ]),
    activeTabId: z.string().max(100).default('query-1'),
    explorerWidth: z.number().int().min(200).max(600).default(248),
    agentWidth: z.number().int().min(280).max(800).default(328),
    // AI chat under the center work area (default) or as a right column.
    agentDock: z.enum(['bottom', 'right']).default('bottom'),
    agentHeight: z.number().int().min(140).max(900).default(300),
    // Whole-window text scale (%) and SQL editor text size (px).
    uiZoom: z.number().int().min(80).max(150).default(100),
    editorFontSize: z.number().int().min(10).max(24).default(14),
    columnLayouts: z
      .record(z.string().min(1).max(600), columnLayoutSchema)
      .refine((value) => Object.keys(value).length <= 200, {
        message: '저장된 열 순서는 최대 200개 테이블입니다.',
      })
      .default({}),
    sqlFormatting: sqlFormattingSchema.default(() =>
      sqlFormattingSchema.parse({}),
    ),
    virtualRelationships: virtualRelationshipsSchema.default([]),
    // Explorer folders for saved connections; unlisted connections show under 미분류.
    connectionGroups: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string().trim().min(1).max(40),
            connectionIds: z.array(z.string().uuid()).max(30),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    explorerCollapsed: z.boolean().default(false),
    agentCollapsed: z.boolean().default(false),
    // Running UPDATE/DELETE/INSERT shows the affected data and asks before applying.
    writePreview: z.boolean().default(true),
    // Result grid text size (px); rows scale with it.
    gridFontSize: z.number().int().min(10).max(18).default(12),
    resultPageSize: z
      .union([z.literal(50), z.literal(100), z.literal(500)])
      .default(100),
    // Per-provider model choice; missing = CLI default.
    agentModels: z
      .object({
        codex: agentModelSchema.optional(),
        copilot: agentModelSchema.optional(),
      })
      .default({}),
    // Collapsed explorer keys: group ids, 'ungrouped' and 'section:*'.
    collapsed: z.array(z.string().min(1).max(60)).max(60).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !value.tabs.some((tab) => tab.id === value.activeTabId) ||
      new Set(value.tabs.map((tab) => tab.id)).size !== value.tabs.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid tab selection or duplicate IDs',
      })
    }
  })
export type Settings = z.infer<typeof settingsSchema>
export const defaultSettings = (): Settings => settingsSchema.parse({})
export type AppInfo = {
  name: string
  version: string
  platform: string
  storage: 'sqlite'
}
export interface DesktopApi {
  agent: AgentApi
  db: DatabaseApi
  getInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  // Blocking save used only while the page unloads.
  saveSettingsSync(settings: Settings): void
  // Renderer-local page zoom (percent); no IPC.
  setZoom(percent: number): void
}
