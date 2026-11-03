import { test, expect, _electron as electron } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { xlsxFixtureBytes } from '../helpers/xlsx-fixture'

test('native XLSX selection uses actual Main parser and SQLite staging without DB or AI', async () => {
  test.skip(process.platform !== 'win32', 'Native XLSX reader is Windows-only.')
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-import-file-'))
  const profile = join(directory, 'profile')
  const workbookPath = join(directory, "가져오기'; no-execution.xlsx")
  await writeFile(workbookPath, xlsxFixtureBytes())
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ dialog, ipcMain }, path) => {
      // Only the OS picker is stubbed. Import IPC, parser, staging and SQLite are real.
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
      const observed: string[] = []
      Reflect.set(globalThis, 'importFileObservedInvokes', observed)
      // Forward every invocation to the original production handler, with observation only.
      // ipcMain.on does not see invoke(), so assert the pinned runtime dispatch map.
      const handlers = Reflect.get(ipcMain, '_invokeHandlers') as Map<
        string,
        unknown
      >
      if (!(handlers instanceof Map))
        throw new Error('Electron invoke observer is unavailable.')
      for (const [channel, handler] of handlers) {
        const original = handler as (...args: unknown[]) => unknown
        handlers.set(channel, function (this: unknown, ...args: unknown[]) {
          observed.push(channel)
          return Reflect.apply(original, this, args)
        })
      }
    }, workbookPath)
    await page
      .getByRole('button', { name: '엑셀 가져오기', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: '엑셀 가져오기', exact: true }),
    ).toBeVisible()
    const workbook = await page.evaluate(() =>
      window.desktop!.db.imports.open(),
    )
    expect(workbook).not.toBeNull()
    expect(workbook!.fileName).toBe(basename(workbookPath))
    expect(workbook!.sheets).toEqual([
      { name: '수입 내역', rowCount: 2, columns: ['결제번호', '금액', '이름'] },
    ])
    expect(JSON.stringify(workbook)).not.toContain(directory)
    expect(workbook).not.toHaveProperty('path')
    const stage = await page.evaluate(
      (workbookId) =>
        window.desktop!.db.imports.stage({
          workbookId,
          sheetName: '수입 내역',
        }),
      workbook!.id,
    )
    expect(stage.rowCount).toBe(2)
    expect(stage.tableName).toMatch(/^stage_[a-f0-9]{32}$/)
    expect(stage.sample).toEqual([
      { rowNumber: 2, values: ['00001234', '1234567890.12345', '김민수 한글'] },
      { rowNumber: 3, values: ['00000009', '12.3400', '최유니코드 & <확인>'] },
    ])
    expect(JSON.stringify(stage)).not.toContain(directory)
    expect(stage).not.toHaveProperty('path')
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
    const connectionId = randomUUID()
    // Without a connected DB this fails explicitly; there is no network or fake DB.
    expect(
      await page.evaluate(
        async (input) => {
          try {
            await window.desktop!.db.imports.load(input)
            return false
          } catch {
            return true
          }
        },
        { stageId: stage.id, connectionId },
      ),
    ).toBe(true)
    await page.evaluate(
      (id) => window.desktop!.db.imports.discard({ id }),
      workbook!.id,
    )
    const deleted = await page.evaluate(
      async ({ workbookId, stageId, connectionId }) => {
        const attempts = [
          () =>
            window.desktop!.db.imports.stage({
              workbookId,
              sheetName: '수입 내역',
            }),
          () => window.desktop!.db.imports.load({ stageId, connectionId }),
        ]
        return Promise.all(
          attempts.map(async (attempt) => {
            try {
              await attempt()
              return false
            } catch {
              return true
            }
          }),
        )
      },
      { workbookId: workbook!.id, stageId: stage.id, connectionId },
    )
    expect(deleted).toEqual([true, true])
    const invokes = await app.evaluate(
      () => Reflect.get(globalThis, 'importFileObservedInvokes') as string[],
    )
    // Also prove the passive observer actually saw this workflow.
    expect(invokes).toContain('import:open')
    expect(invokes).toContain('import:stage')
    expect(invokes).not.toContain('agent:start')
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('opt-in real XLSX → SQLite → logical import SELECT uses actual SQL Server and stale-approval cleanup', async () => {
  test.skip(
    process.platform !== 'win32' ||
      ![
        'AI_DB_TEST_HOST',
        'AI_DB_TEST_DATABASE',
        'AI_DB_TEST_USER',
        'AI_DB_TEST_PASSWORD',
      ].every((name) => !!process.env[name]),
    'Requires Windows and an explicitly configured live MSSQL test account.',
  )
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-import-live-'))
  const path = join(directory, '실제 가져오기.xlsx')
  await writeFile(path, xlsxFixtureBytes())
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ dialog }, filePath) => {
      // No DB, parser, SQLite, preload or IPC doubles: only deterministic file selection.
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      })
    }, path)
    const result = await page.evaluate(
      async (input) => {
        const db = window.desktop!.db
        const connectionId = crypto.randomUUID()
        await db.saveConnection({
          profile: {
            id: connectionId,
            name: 'Actual XLSX to SQL read-only acceptance',
            driver: 'mssql',
            host: input.host,
            port: input.port,
            database: input.database,
            username: input.username,
            environment: 'development',
            readOnly: true,
            encrypt: true,
            trustServerCertificate: input.trust,
            maxRows: 10,
            timeoutSeconds: 10,
          },
          password: input.password,
        })
        const connection = await db.connect({ connectionId })
        try {
          const workbook = await db.imports.open()
          if (!workbook) throw new Error('File picker returned no workbook.')
          const stage = await db.imports.stage({
            workbookId: workbook.id,
            sheetName: '수입 내역',
          })
          const table = await db.imports.load({
            stageId: stage.id,
            connectionId,
          })
          const listed = await db.imports.list(connectionId)
          const explorer = await db.getExplorer(connectionId)
          const details = await db.describeTable({
            connectionId,
            schema: 'import',
            table: table.tableName,
          })
          const historyBefore = await db.getHistory()
          const sql = `SELECT [결제번호], [금액], [이름] FROM [import].[${table.tableName}] ORDER BY [결제번호]`
          const executions = []
          // Two independent review/execute cycles prove per-execution temp data remains usable.
          for (let repeat = 0; repeat < 2; repeat++) {
            const review = await db.reviewQuery({ connectionId, sql })
            executions.push(
              await db.executeQuery({
                connectionId,
                requestId: crypto.randomUUID(),
                approvalToken: review.token,
              }),
            )
          }
          const stale = await db.reviewQuery({ connectionId, sql })
          await db.imports.discard({ id: workbook.id })
          let staleRejected = false
          try {
            await db.executeQuery({
              connectionId,
              requestId: crypto.randomUUID(),
              approvalToken: stale.token,
            })
          } catch {
            staleRejected = true
          }
          return {
            connection,
            table,
            listed,
            explorer,
            details,
            historyBefore,
            executions,
            staleRejected,
            afterDiscard: await db.imports.list(connectionId),
            explorerAfter: await db.getExplorer(connectionId),
          }
        } finally {
          await db.disconnect(connectionId)
        }
      },
      {
        host: process.env.AI_DB_TEST_HOST!,
        port: Number(process.env.AI_DB_TEST_PORT ?? 1433),
        database: process.env.AI_DB_TEST_DATABASE!,
        username:
          process.env.AI_DB_TEST_READ_USER ?? process.env.AI_DB_TEST_USER!,
        password:
          process.env.AI_DB_TEST_READ_PASSWORD ??
          process.env.AI_DB_TEST_PASSWORD!,
        trust: process.env.AI_DB_TEST_TRUST_CERT === 'true',
      },
    )
    expect(result.connection.readOnly).toBe(true)
    expect(result.table).toMatchObject({ schema: 'import', rowCount: 2 })
    expect(result.listed).toHaveLength(1)
    expect(result.explorer.tables).toContainEqual({
      schema: 'import',
      name: result.table.tableName,
    })
    expect(result.details.columns.map((column) => column.name)).toEqual([
      '결제번호',
      '금액',
      '이름',
    ])
    const metadata = JSON.stringify({
      listed: result.listed,
      explorer: result.explorer,
      details: result.details,
    })
    for (const value of ['00001234', '1234567890.12345', '김민수 한글'])
      expect(metadata).not.toContain(value)
    expect(result.historyBefore).toEqual([])
    for (const execution of result.executions) {
      expect(execution.rows).toEqual([
        { c0: '00000009', c1: '12.3400', c2: '최유니코드 & <확인>' },
        { c0: '00001234', c1: '1234567890.12345', c2: '김민수 한글' },
      ])
      expect(execution.truncated).toBe(false)
    }
    expect(result.staleRejected).toBe(true)
    expect(result.afterDiscard).toEqual([])
    expect(result.explorerAfter.tables).not.toContainEqual({
      schema: 'import',
      name: result.table.tableName,
    })
    expect(
      (await page.evaluate(() => window.desktop!.db.listConnections()))[0]
        ?.status,
    ).toBe('disconnected')
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
