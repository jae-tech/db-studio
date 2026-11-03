import type { TableDetails, TableInfo } from '@shared/database'
import type { VirtualRelationship } from '@shared/relationships'

export interface MetadataScope {
  key: string
  connectionId: string
  database: string
  maxRows: number
  virtualRelationships?: VirtualRelationship[]
  assertCurrent(): void
  tables(): Promise<TableInfo[]>
  describe(schema: string, table: string): Promise<TableDetails>
}

// Main-only, generation-keyed, no disk persistence. Recheck scope even for hits.
export class MetadataCache {
  private entries = new Map<string, { expires: number; json: string }>()
  private bytes = 0
  constructor(private readonly now: () => number = Date.now) {}
  async get<T>(
    scope: MetadataScope,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    scope.assertCurrent()
    const id = JSON.stringify([scope.key, key])
    const cached = this.entries.get(id)
    if (cached && cached.expires > this.now())
      return JSON.parse(cached.json) as T
    const value = await load()
    scope.assertCurrent()
    const json = JSON.stringify(value)
    const size = Buffer.byteLength(json)
    if (size <= 65536) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.expires <= this.now() || entryKey === id) {
          this.bytes -= Buffer.byteLength(entry.json)
          this.entries.delete(entryKey)
        }
      }
      while (this.entries.size >= 64 || this.bytes + size > 1048576) {
        const oldest = this.entries.entries().next().value
        if (!oldest) break
        this.bytes -= Buffer.byteLength(oldest[1].json)
        this.entries.delete(oldest[0])
      }
      this.entries.set(id, { expires: this.now() + 30000, json })
      this.bytes += size
    }
    return JSON.parse(json) as T
  }
  clear(): void {
    this.entries.clear()
    this.bytes = 0
  }
}
