import process from 'node:process'
import console from 'node:console'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import sql from 'mssql'

// Read credentials only from this process's environment. Never write them to files or logs.
const host = process.env.AI_DB_TEST_HOST
const user = process.env.AI_DB_TEST_USER
const password = process.env.AI_DB_TEST_PASSWORD
if (!host || !user || !password)
  throw new Error('Missing live test credentials')
const port = Number(process.env.AI_DB_TEST_PORT ?? 1433)
let trust = process.env.AI_DB_TEST_TRUST_CERT === 'true'
const configuration = () => ({
  server: host,
  port,
  user,
  password,
  database: process.env.AI_DB_TEST_DATABASE ?? 'master',
  connectionTimeout: 10000,
  requestTimeout: 10000,
  pool: { min: 0, max: 1 },
  options: {
    encrypt: true,
    trustServerCertificate: trust,
    appName: 'AI DB Studio read-only validation',
  },
})

async function discover() {
  const pool = new sql.ConnectionPool(configuration())
  pool.on('error', () => undefined)
  try {
    await pool.connect()
    const result = await pool
      .request()
      .query(
        `SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY name`,
      )
    const database =
      process.env.AI_DB_TEST_DATABASE ?? result.recordset[0]?.name ?? 'master'
    console.log(
      `Connected with encrypted TLS. Accessible user databases: ${result.recordset.length}. Selected database: ${database}. Certificate validation: ${trust ? 'development override' : 'strict'}.`,
    )
    return database
  } finally {
    await pool.close().catch(() => undefined)
  }
}

async function run(file, args, environment) {
  const child = spawn(process.execPath, [resolve(file), ...args], {
    env: environment,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  })
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolveExit(code ?? 1))
  })
  return exitCode
}

try {
  let database
  try {
    database = await discover()
  } catch (error) {
    // This runner can retry an explicitly designated development endpoint only when requested.
    if (
      process.env.AI_DB_ALLOW_DEV_CERT_RETRY === 'true' &&
      !trust &&
      /certificate|self.signed|unable to verify/i.test(String(error))
    ) {
      console.log(
        'Strict certificate validation failed. Retrying this development endpoint with TLS encryption and the explicit certificate override.',
      )
      trust = true
      database = await discover()
    } else throw error
  }
  const environment = {
    ...process.env,
    AI_DB_TEST_DATABASE: database,
    AI_DB_TEST_TRUST_CERT: String(trust),
  }
  const integration = await run(
    'node_modules/vitest/vitest.mjs',
    ['run', '--config', 'vitest.integration.config.ts'],
    environment,
  )
  // Run the real UI path as a separate check even if the backend test exposes a failure.
  const ui = await run(
    'node_modules/@playwright/test/cli.js',
    ['test', 'live-mssql.spec.ts'],
    environment,
  )
  process.exitCode = integration || ui
} catch (error) {
  // Do not print config/driver error objects: they may hold connection credentials.
  console.error(
    `Live MSSQL validation failed: ${error instanceof Error ? error.message.replaceAll(password, '[redacted]') : 'unknown error'}`,
  )
  process.exitCode = 1
}
