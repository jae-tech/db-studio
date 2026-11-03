import Database from 'better-sqlite3'
import {
  defaultSettings,
  settingsSchema,
  type Settings,
} from '../shared/contracts'

/** Non-secret preferences only. Connection credentials live in the encrypted DatabaseRepository. */
export class SettingsStore {
  private readonly db: Database.Database
  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)',
    )
  }
  get(): Settings {
    const row = this.db
      .prepare('SELECT value FROM preferences WHERE id = 1')
      .get() as { value: string } | undefined
    if (!row) return defaultSettings()
    return settingsSchema.parse(JSON.parse(row.value) as unknown)
  }
  save(input: unknown): Settings {
    const settings = settingsSchema.parse(input)
    this.db
      .prepare(
        'INSERT INTO preferences(id, value) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
      )
      .run(JSON.stringify(settings))
    return settings
  }
  close(): void {
    this.db.close()
  }
}
