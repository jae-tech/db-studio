import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import { parseReadQuery } from '@main/database/policy'
import { connectionSchema } from '@shared/database'

// Opt in with a dedicated read-only test account. Never provision or modify a database here.
const enabled = [
  'AI_DB_TEST_HOST',
  'AI_DB_TEST_DATABASE',
  'AI_DB_TEST_USER',
  'AI_DB_TEST_PASSWORD',
].every((name) => !!process.env[name])
describe.skipIf(!enabled)(
  'live SQL Server (requires explicit environment)',
  () => {
    const adapter = new MssqlAdapter()
    afterAll(() => adapter.disconnect())
    it('connects, discovers metadata and executes a parsed SELECT', async () => {
      const profile = connectionSchema.parse({
        id: randomUUID(),
        name: 'Live integration',
        host: process.env.AI_DB_TEST_HOST,
        port: Number(process.env.AI_DB_TEST_PORT ?? 1433),
        database: process.env.AI_DB_TEST_DATABASE,
        username: process.env.AI_DB_TEST_USER,
        trustServerCertificate: process.env.AI_DB_TEST_TRUST_CERT === 'true',
        maxRows: 10,
      })
      await adapter.connect(profile, process.env.AI_DB_TEST_PASSWORD!)
      expect(adapter.isConnected()).toBe(true)
      const databases = await adapter.listDatabases()
      expect(databases).toContain(profile.database)
      const tables = await adapter.listTables()
      await adapter.listSchemas()
      // Qualified catalog reads use the same pool and do not switch its database.
      expect(await adapter.listTables(profile.database)).toEqual(
        expect.arrayContaining(tables),
      )
      await adapter.listSchemas(profile.database)
      if (tables[0]) {
        await adapter.getColumns(tables[0].schema, tables[0].name)
        await adapter.getIndexes(tables[0].schema, tables[0].name)
        await adapter.getForeignKeys(tables[0].schema, tables[0].name)
        await adapter.getColumns(
          tables[0].schema,
          tables[0].name,
          profile.database,
        )
        await adapter.getIndexes(
          tables[0].schema,
          tables[0].name,
          profile.database,
        )
        await adapter.getForeignKeys(
          tables[0].schema,
          tables[0].name,
          profile.database,
        )
      }
      if (databases.some((database) => database.toLowerCase() === 'master')) {
        await adapter.listSchemas('master')
        await adapter.listTables('master')
      }
      const result = await adapter.executeQuery(
        parseReadQuery('SELECT 42 AS answer', 10),
        randomUUID(),
        new AbortController().signal,
      )
      expect(result.rows).toEqual([{ c0: 42 }])
      expect(result.truncated).toBe(false)
    })
  },
)
