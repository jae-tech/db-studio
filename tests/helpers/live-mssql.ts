import sql from 'mssql'
import { randomUUID } from 'node:crypto'
import { connectionSchema } from '@shared/database'

export const liveWriteEnabled =
  process.env.AI_DB_TEST_ALLOW_WRITES === 'dedicated-fixture-only' &&
  [
    'AI_DB_TEST_HOST',
    'AI_DB_TEST_DATABASE',
    'AI_DB_TEST_USER',
    'AI_DB_TEST_PASSWORD',
  ].every((key) => !!process.env[key])

export const identifier = (value: string): string =>
  `[${value.replaceAll(']', ']]')}]`

// Setup owns only fixture DDL; the product account needs no ownership or DDL.
// rowversion=false: an ordinary PK table (ADR-035 key-guarded writes).
export async function liveFixture({ rowversion = true } = {}) {
  if (!liveWriteEnabled) throw new Error('Dedicated fixture opt-in is required')
  const database = process.env.AI_DB_TEST_DATABASE!
  if (!/^aidb_write_test_[A-Za-z0-9_]+$/.test(database))
    throw new Error('Writes require a dedicated aidb_write_test_<suffix> DB')
  if (
    !!process.env.AI_DB_TEST_SETUP_USER !==
    !!process.env.AI_DB_TEST_SETUP_PASSWORD
  )
    throw new Error('Both setup account environment variables are required')
  const profile = connectionSchema.parse({
    id: randomUUID(),
    name: 'Dedicated live write fixture',
    host: process.env.AI_DB_TEST_HOST,
    port: Number(process.env.AI_DB_TEST_PORT ?? 1433),
    database,
    username: process.env.AI_DB_TEST_USER,
    environment: 'development',
    readOnly: false,
    trustServerCertificate: process.env.AI_DB_TEST_TRUST_CERT === 'true',
    timeoutSeconds: 5,
  })
  const setup = new sql.ConnectionPool({
    server: profile.host,
    port: profile.port,
    database,
    user: process.env.AI_DB_TEST_SETUP_USER ?? profile.username,
    password:
      process.env.AI_DB_TEST_SETUP_PASSWORD ?? process.env.AI_DB_TEST_PASSWORD!,
    connectionTimeout: 10000,
    requestTimeout: 10000,
    options: {
      encrypt: true,
      trustServerCertificate: profile.trustServerCertificate,
    },
  })
  const table = `aidb_write_fixture_${randomUUID().replaceAll('-', '')}`
  const target = `[dbo].${identifier(table)}`
  let owned = false
  const close = async (): Promise<void> => {
    try {
      if (owned) await setup.request().query(`DROP TABLE ${target}`)
    } finally {
      await setup.close()
    }
  }
  try {
    await setup.connect()
    await setup
      .request()
      .query(
        `CREATE TABLE ${target} ([id] int NOT NULL PRIMARY KEY, [amount] int NOT NULL${rowversion ? ', [rv] rowversion NOT NULL' : ''})`,
      )
    owned = true
    await setup
      .request()
      .query(`INSERT INTO ${target} (id,amount) VALUES (1,10)`)
    if (process.env.AI_DB_TEST_SETUP_USER)
      await setup
        .request()
        .query(
          `GRANT SELECT, UPDATE, DELETE ON OBJECT::${target} TO ${identifier(profile.username)}`,
        )
    return { profile, setup, table, target, close }
  } catch (error) {
    await close()
    throw error
  }
}
