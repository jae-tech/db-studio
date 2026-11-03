import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  assertUniqueQueryNames,
  connectionSchema,
  idSchema,
  saveQuerySchema,
  type ConnectionProfile,
  type HistoryEntry,
  type SavedQuery,
} from '@shared/database'
import type { CredentialCipher } from '../security/credentials'

type ConnectionRow = { id: string; profile: Buffer; password: Buffer }
export type DatabaseRepositoryPort = Pick<
  DatabaseRepository,
  'list' | 'save' | 'load' | 'delete' | 'history' | 'addHistory'
>
export class DatabaseRepository {
  private readonly db: Database.Database
  private readonly profiles = new Map<
    string,
    { profile: ConnectionProfile; hasPassword: boolean }
  >()
  constructor(
    path: string,
    private readonly cipher: CredentialCipher,
  ) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, profile BLOB NOT NULL, password BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS query_history (id TEXT PRIMARY KEY, entry TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS saved_queries (id TEXT PRIMARY KEY, entry TEXT NOT NULL);`)
  }
  async initialize(): Promise<void> {
    const rows = this.db
      .prepare('SELECT id, profile, password FROM connections ORDER BY rowid')
      .all() as ConnectionRow[]
    for (const row of rows) {
      const profile = connectionSchema.parse(
        JSON.parse(await this.cipher.decrypt(row.profile)) as unknown,
      )
      if (profile.id !== row.id)
        throw new Error('Connection storage ID mismatch')
      this.profiles.set(row.id, {
        profile,
        hasPassword: row.password.length > 0,
      })
    }
  }
  list(): { profile: ConnectionProfile; hasPassword: boolean }[] {
    return [...this.profiles.values()].map((item) => ({
      profile: { ...item.profile },
      hasPassword: item.hasPassword,
    }))
  }
  async save(profile: ConnectionProfile, password?: string): Promise<void> {
    const existing = this.db
      .prepare('SELECT password FROM connections WHERE id = ?')
      .get(profile.id) as { password: Buffer } | undefined
    const encrypted =
      password === undefined
        ? existing?.password
        : await this.cipher.encrypt(password)
    if (!encrypted)
      throw new Error('A password is required for a new connection')
    const encryptedProfile = await this.cipher.encrypt(JSON.stringify(profile))
    this.db
      .prepare(
        'INSERT INTO connections(id, profile, password) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET profile = excluded.profile, password = excluded.password',
      )
      .run(profile.id, encryptedProfile, encrypted)
    this.profiles.set(profile.id, {
      profile: { ...profile },
      hasPassword: encrypted.length > 0,
    })
  }
  async load(
    id: string,
  ): Promise<{ profile: ConnectionProfile; password: string }> {
    const row = this.db
      .prepare('SELECT id, profile, password FROM connections WHERE id = ?')
      .get(id) as ConnectionRow | undefined
    if (!row) throw new Error('Connection not found')
    return {
      profile: connectionSchema.parse(
        JSON.parse(await this.cipher.decrypt(row.profile)) as unknown,
      ),
      password: await this.cipher.decrypt(row.password),
    }
  }
  delete(id: string): void {
    this.db.prepare('DELETE FROM connections WHERE id = ?').run(id)
    this.profiles.delete(id)
  }
  history(): HistoryEntry[] {
    return (
      this.db
        .prepare(
          'SELECT entry FROM query_history ORDER BY created_at DESC, rowid DESC LIMIT 100',
        )
        .all() as { entry: string }[]
    ).map((row) => JSON.parse(row.entry) as HistoryEntry)
  }
  addHistory(entry: HistoryEntry): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO query_history(id, entry, created_at) VALUES(?, ?, ?)',
        )
        .run(entry.id, JSON.stringify(entry), entry.startedAt)
      this.db
        .prepare(
          'DELETE FROM query_history WHERE id NOT IN (SELECT id FROM query_history ORDER BY created_at DESC, rowid DESC LIMIT 100)',
        )
        .run()
    })()
  }
  // Plain text like SQL tabs/history: never put secrets in saved SQL.
  savedQueries(): SavedQuery[] {
    return (
      this.db
        .prepare('SELECT entry FROM saved_queries ORDER BY rowid')
        .all() as {
        entry: string
      }[]
    ).map((row) => JSON.parse(row.entry) as SavedQuery)
  }
  saveQuery(input: unknown): SavedQuery {
    const query = { ...saveQuerySchema.parse(input), id: randomUUID() }
    const existing = this.savedQueries()
    if (existing.length >= 200)
      throw new Error(
        '저장 쿼리는 최대 200개입니다. 먼저 기존 쿼리를 삭제하세요.',
      )
    assertUniqueQueryNames(existing, query)
    this.db
      .prepare('INSERT INTO saved_queries(id, entry) VALUES(?, ?)')
      .run(query.id, JSON.stringify(query))
    return query
  }
  deleteSavedQuery(input: unknown): void {
    this.db
      .prepare('DELETE FROM saved_queries WHERE id = ?')
      .run(idSchema.parse(input))
  }
  close(): void {
    this.db.close()
  }
}
