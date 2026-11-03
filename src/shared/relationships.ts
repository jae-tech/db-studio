import { z } from 'zod'

const name = z
  .string()
  .min(1)
  .max(128)
  .refine((v) => !v.includes('\0'))
const endpoint = z.object({ schema: name, table: name }).strict()
export const virtualRelationshipSchema = z
  .object({
    id: z.string().uuid(),
    connectionId: z.string().uuid(),
    database: name,
    name: z.string().trim().min(1).max(64),
    aliases: z.array(z.string().trim().min(1).max(64)).max(8),
    description: z.string().trim().max(500),
    source: endpoint,
    target: endpoint,
    columns: z
      .array(z.object({ source: name, target: name }).strict())
      .min(1)
      .max(8),
    joinType: z.enum(['LEFT', 'INNER']),
    cardinality: z.enum([
      'many-to-one',
      'one-to-one',
      'one-to-many',
      'many-to-many',
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.columns.map((c) => c.source)).size !==
        value.columns.length ||
      new Set(value.columns.map((c) => c.target)).size !== value.columns.length
    )
      ctx.addIssue({ code: 'custom', message: '연결 열은 중복할 수 없습니다.' })
  })
export type VirtualRelationship = z.infer<typeof virtualRelationshipSchema>
export const virtualRelationshipsSchema = z
  .array(virtualRelationshipSchema)
  .max(100)
  .superRefine((values, ctx) => {
    const counts = new Map<string, number>()
    const ids = new Set<string>()
    for (const value of values) {
      const key = JSON.stringify([value.connectionId, value.database])
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      if (ids.has(value.id) || count > 20)
        ctx.addIssue({
          code: 'custom',
          message: '관계 ID는 고유해야 하며 DB별 관계는 최대 20개입니다.',
        })
      ids.add(value.id)
    }
  })

export function scopedRelationships(
  values: VirtualRelationship[],
  connectionId: string,
  database: string,
) {
  return values.filter(
    (value) =>
      value.connectionId === connectionId && value.database === database,
  )
}
