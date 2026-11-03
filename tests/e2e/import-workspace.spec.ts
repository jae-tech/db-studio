import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { ImportTable } from '@shared/imports'

test('generic Excel UI handler doubles: cancellation, refusal, text staging, scoped registration, explicit AI preparation and deletion (no DB or AI)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-import-ui-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const fixture = {
    connectionId: randomUUID(),
    workbookId: randomUUID(),
    stageId: randomUUID(),
  }
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ ipcMain }, fixture) => {
      // Main-handler doubles only: no workbook parser, SQL Server or AI is called.
      const stats = {
        opened: 0,
        staged: 0,
        loaded: 0,
        discarded: [] as string[],
        agentStarts: 0,
      }
      Reflect.set(globalThis, 'importUiFixtureStats', stats)
      let tables: ImportTable[] = []
      const set = (
        channel: string,
        handler: (input: unknown) => unknown,
      ): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, input: unknown) => handler(input))
      }
      set('db:connections', () => [
        {
          id: fixture.connectionId,
          name: '엑셀 UI 대역 — 실제 DB 아님',
          driver: 'mssql',
          host: 'not-used',
          port: 1,
          database: 'import_ui_not_live',
          username: 'fixture',
          environment: 'development',
          readOnly: true,
          encrypt: true,
          trustServerCertificate: false,
          timeoutSeconds: 30,
          maxRows: 100,
          hasPassword: false,
          status: 'connected',
          currentDatabase: 'import_ui_not_live',
          permissionVerified: false,
        },
      ])
      set('db:explorer', () => ({
        database: 'import_ui_not_live',
        databases: ['import_ui_not_live'],
        schemas: [],
        tables: [],
      }))
      set('import:open', () => {
        if (stats.opened++ === 0) return null
        return {
          id: fixture.workbookId,
          fileName: '일반_업로드_대역.xlsx',
          sheets: [
            {
              name: '상품 목록',
              rowCount: 21,
              columns: ['상품코드', '수량', '비고'],
            },
          ],
        }
      })
      set('import:stage', (input) => {
        if ((input as { sheetName: string }).sheetName !== '상품 목록')
          throw new Error('Wrong fixture worksheet')
        stats.staged++
        return {
          id: fixture.stageId,
          workbookId: fixture.workbookId,
          sheetName: '상품 목록',
          tableName: 'stage_fixture',
          columns: ['상품코드', '수량', '비고'],
          rowCount: 21,
          sample: Array.from({ length: 21 }, (_, index) => ({
            rowNumber: index + 2,
            values:
              index === 20
                ? ['숨겨진21행', '0', '샘플상한']
                : ['00123', '0007', `비공개고객값-${index}`],
          })),
        }
      })
      set('import:list', (input) => {
        if (input !== fixture.connectionId)
          throw new Error('Wrong fixture connection')
        return tables
      })
      set('import:load', (input) => {
        const request = input as { stageId: string; connectionId: string }
        if (
          request.stageId !== fixture.stageId ||
          request.connectionId !== fixture.connectionId
        )
          throw new Error('Wrong fixture scope')
        if (stats.loaded++ === 0)
          throw new Error('대역: 연결 범위가 변경되어 등록을 거부했습니다.')
        const table: ImportTable = {
          stageId: fixture.stageId,
          connectionId: fixture.connectionId,
          database: 'import_ui_not_live',
          schema: 'import',
          tableName: 'stage_fixture',
          columns: ['상품코드', '수량', '비고'],
          rowCount: 21,
        }
        tables = [table]
        return table
      })
      set('import:discard', (input) => {
        const { id } = input as { id: string }
        stats.discarded.push(id)
        if (id !== fixture.stageId && id !== fixture.workbookId)
          throw new Error('Wrong discard identifier')
        tables = []
      })
      set('agent:start', () => {
        stats.agentStarts++
        throw new Error('This UI test must not start AI')
      })
    }, fixture)
    await page.reload()
    await page
      .getByLabel('SQL 연결', { exact: true })
      .selectOption(fixture.connectionId)
    await page
      .getByRole('button', { name: '엑셀 가져오기', exact: true })
      .click()
    const workspace = page.getByRole('region', {
      name: '엑셀 가져오기',
      exact: true,
    })
    const open = workspace.getByRole('button', {
      name: '엑셀 파일 선택',
      exact: true,
    })
    await open.click()
    await expect(
      workspace.getByText('선택한 파일 없음', { exact: true }),
    ).toBeVisible()
    await open.click()
    await expect(workspace.getByLabel('엑셀 워크시트')).toHaveValue('상품 목록')
    await workspace
      .getByRole('button', { name: '로컬 임시 데이터로 적재', exact: true })
      .click()
    const sample = workspace.getByLabel('엑셀 원본 샘플', { exact: true })
    await expect(sample.locator('tbody tr')).toHaveCount(20)
    await expect(sample).toContainText('00123')
    await expect(sample).toContainText('0007')
    await expect(sample).not.toContainText('숨겨진21행')
    await expect(workspace).not.toContainText('정산')
    await expect(workspace.getByRole('combobox')).toHaveCount(1)
    const load = workspace.getByRole('button', {
      name: '선택한 연결에 임시 테이블 등록',
      exact: true,
    })
    await expect(load).toBeEnabled() // Read-only profiles can use SELECT-scoped temporary data.
    await load.click()
    await expect(workspace.getByRole('alert')).toContainText(
      '연결 범위가 변경되어 등록을 거부',
    )
    await expect(
      workspace.getByRole('button', {
        name: 'AI에 이 테이블 활용 요청',
        exact: true,
      }),
    ).toHaveCount(0)
    await load.click()
    const table = workspace.getByRole('article', {
      name: '임시 테이블 stage_fixture',
      exact: true,
    })
    await expect(table).toContainText('[import].[stage_fixture]')
    await expect(table).toContainText('[상품코드] nvarchar')
    await expect(table).toContainText('SELECT TOP (100)')
    await expect(table).not.toContainText('비공개고객값')
    const stats = () =>
      app.evaluate(() => Reflect.get(globalThis, 'importUiFixtureStats'))
    expect(await stats()).toMatchObject({
      opened: 2,
      staged: 1,
      loaded: 2,
      agentStarts: 0,
    })
    await table
      .getByRole('button', { name: 'AI에 이 테이블 활용 요청', exact: true })
      .click()
    expect(await stats()).toMatchObject({ agentStarts: 0 })
    const aiPrompt = page.getByLabel('AI 메시지', { exact: true })
    await expect(aiPrompt).toHaveValue(/stage_fixture/)
    await expect(aiPrompt).not.toHaveValue(/00123|0007|비공개고객값/)
    // Preparing the request alone never contacts AI; metadata is attached on send.
    await expect(
      page.locator('.agent-panel').getByRole('checkbox'),
    ).toHaveCount(0)
    await expect(page.locator('.title-center')).toContainText(
      'import_ui_not_live',
    )
    await page
      .getByRole('button', { name: '엑셀 가져오기', exact: true })
      .click()
    await table
      .getByRole('button', { name: '이 임시 테이블 삭제', exact: true })
      .click()
    await expect(table).toHaveCount(0)
    await expect(
      workspace.getByLabel('엑셀 원본 샘플', { exact: true }),
    ).toHaveCount(0)
    await workspace
      .getByRole('button', { name: '파일 및 임시 데이터 삭제', exact: true })
      .click()
    await expect(
      workspace.getByText('선택한 파일 없음', { exact: true }),
    ).toBeVisible()
    expect(await stats()).toMatchObject({
      discarded: [fixture.stageId, fixture.workbookId],
      agentStarts: 0,
    })
  } finally {
    await app.close()
    const target = resolve(directory)
    if (
      target.startsWith(resolve(tmpdir())) &&
      basename(target).startsWith('ai-db-import-ui-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
