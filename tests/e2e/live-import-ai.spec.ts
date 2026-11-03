import { test, expect, _electron as electron } from '@playwright/test'
import { formatSql } from '@shared/sqlFormatting'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@shared/agent'
import { liveFixture, liveWriteEnabled } from '../helpers/live-mssql'
import { xlsxFixtureBytes } from '../helpers/xlsx-fixture'

test('real XLSX → Main SQLite → readonly SQL Server → official Codex MCP discovery → approved SELECT and nonexecuting UPDATE/JOIN draft', async () => {
  test.skip(
    process.platform !== 'win32' ||
      !liveWriteEnabled ||
      process.env.AI_DB_TEST_IMPORT_AGENT !== '1' ||
      !process.env.AI_DB_TEST_READ_USER ||
      !process.env.AI_DB_TEST_READ_PASSWORD,
    'Requires Windows, dedicated fixture opt-in, SELECT-only account and explicit live import subscription turns.',
  )
  test.setTimeout(360000)
  const fixture = await liveFixture()
  let directory: string | undefined
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  const metric = `excel_metric_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const value = `EXCEL_CELL_ONLY_${randomUUID()}`
  const privateNote = `NEVER_SHARE_NOTE_${randomUUID()}`
  try {
    directory = await mkdtemp(join(tmpdir(), 'ai-db-import-ai-live-'))
    const filePath = join(directory, '모델에_값을_공유하지_않는_업로드.xlsx')
    await writeFile(
      filePath,
      xlsxFixtureBytes({
        sheetName: '모델 탐색 검증',
        columns: ['excel_key', metric, 'private_note'],
        rows: [['0001', value, privateNote]],
      }),
    )
    app = await electron.launch({
      args: ['.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ dialog }, path) => {
      // Only the native file picker is deterministic. All IPC/parser/SQLite/DB/AI paths are real.
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
    }, filePath)
    await page
      .getByRole('button', { name: '새 연결', exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('연결 이름')
      .fill('Actual Excel metadata AI acceptance')
    await dialog
      .getByLabel('호스트', { exact: true })
      .fill(fixture.profile.host)
    await dialog
      .getByLabel('포트', { exact: true })
      .fill(String(fixture.profile.port))
    await dialog
      .getByLabel('데이터베이스', { exact: true })
      .fill(fixture.profile.database)
    await dialog
      .getByLabel('사용자 이름')
      .fill(process.env.AI_DB_TEST_READ_USER!)
    await dialog
      .getByLabel('비밀번호', { exact: true })
      .fill(process.env.AI_DB_TEST_READ_PASSWORD!)
    await expect(dialog.getByLabel('제한 쓰기 허용')).not.toBeChecked()
    if (fixture.profile.trustServerCertificate)
      await dialog.getByLabel('서버 인증서 신뢰').check()
    await dialog.getByRole('button', { name: '연결 저장', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await page.getByRole('button', { name: '연결', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '연결 해제', exact: true }),
    ).toBeVisible({ timeout: 20000 })
    const connections = await page.evaluate(() =>
      window.desktop!.db.listConnections(),
    )
    expect(connections).toHaveLength(1)
    const connection = connections[0]!
    expect(connection).toMatchObject({
      readOnly: true,
      permissionVerified: true,
      status: 'connected',
    })
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    const originalSql = 'SELECT 777 AS keep_original;'
    await page.keyboard.type(originalSql)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
            ?.sql,
      )
      .toBe(originalSql)
    await page
      .getByRole('button', { name: '엑셀 가져오기', exact: true })
      .click()
    const workspace = page.getByRole('region', {
      name: '엑셀 가져오기',
      exact: true,
    })
    await workspace
      .getByRole('button', { name: '엑셀 파일 선택', exact: true })
      .click()
    await expect(workspace.getByLabel('엑셀 워크시트')).toHaveValue(
      '모델 탐색 검증',
    )
    await workspace
      .getByRole('button', { name: '로컬 임시 데이터로 적재', exact: true })
      .click()
    await expect(workspace.getByLabel('엑셀 원본 샘플')).toContainText(value)
    await workspace
      .getByRole('button', {
        name: '선택한 연결에 임시 테이블 등록',
        exact: true,
      })
      .click()
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (id) => window.desktop!.db.imports.list(id),
              connection.id,
            )
          ).length,
      )
      .toBe(1)
    const [table] = await page.evaluate(
      (id) => window.desktop!.db.imports.list(id),
      connection.id,
    )
    expect(table).toMatchObject({
      connectionId: connection.id,
      database: fixture.profile.database,
      schema: 'import',
      columns: ['excel_key', metric, 'private_note'],
      rowCount: 1,
    })
    expect(table!.tableName).toMatch(/^stage_[a-f0-9]{32}$/)
    expect(JSON.stringify(table)).not.toContain(value)
    expect(JSON.stringify(table)).not.toContain(privateNote)
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
    await page.evaluate(() => {
      const events: AgentEvent[] = []
      Reflect.set(window, 'importAiLiveEvents', events)
      Reflect.set(
        window,
        'importAiLiveUnsubscribe',
        window.desktop!.agent.onEvent((event) => events.push(event)),
      )
    })
    const events = () =>
      page.evaluate(
        () => Reflect.get(window, 'importAiLiveEvents') as AgentEvent[],
      )
    await page
      .getByRole('button', { name: 'CLI 상태 확인', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'CLI 상태 확인' }),
    ).toHaveAttribute('title', /ChatGPT 로그인 확인 완료/, { timeout: 35000 })
    await expect(
      page.locator('.agent-panel').getByRole('checkbox'),
    ).toHaveCount(0)
    const scope = page.locator('.title-center')
    await expect(scope).toContainText(fixture.profile.database)
    const firstPrompt =
      'This is an explicitly approved metadata-only acceptance test. Call ai_db db_list_tables with schema="import" to discover the uploaded Excel table, then call db_describe_table for that exact table. ' +
      'Find the column whose name starts excel_metric_. The exact uploaded table and full column names are deliberately omitted: obtain both from tool results, never guess them. ' +
      'Call ai_db db_propose_sql exactly once with a restricted SELECT of e.[the discovered metric column] AS observed FROM [import].[the discovered table] AS e. Do not set draft=true for this SELECT. ' +
      'Use only that uploaded table; do not select private_note or excel_key, do not execute SQL, and do not request or invent cell values. Reply briefly when the proposal is ready.'
    for (const hidden of [metric, table!.tableName, value, privateNote])
      expect(firstPrompt).not.toContain(hidden)
    await page.getByLabel('AI 메시지', { exact: true }).fill(firstPrompt)
    await page
      .getByRole('button', { name: '메시지 보내기', exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (await events()).filter((event) => event.type === 'done').length,
        { timeout: 125000 },
      )
      .toBe(1)
    const first = await events()
    expect(
      first.find((event) => event.type === 'done'),
      JSON.stringify(first),
    ).toMatchObject({ outcome: 'completed' })
    for (const name of [
      'db_list_tables',
      'db_describe_table',
      'db_propose_sql',
    ])
      expect(first).toContainEqual(
        expect.objectContaining({ type: 'tool', name, status: 'completed' }),
      )
    const selectEvent = first.find((event) => event.type === 'proposal')
    if (selectEvent?.type !== 'proposal')
      throw new Error('No actual uploaded-table SELECT proposal event')
    expect(selectEvent.proposal).toMatchObject({
      connectionId: connection.id,
      database: fixture.profile.database,
    })
    expect(selectEvent.proposal.draft).toBeUndefined()
    expect(selectEvent.proposal.sql).toContain(metric)
    expect(selectEvent.proposal.sql).toContain(table!.tableName)
    for (const hidden of [value, privateNote])
      expect(JSON.stringify(first)).not.toContain(hidden)
    const selectCard = page.getByLabel('SQL 제안').locator('article').first()
    await expect(selectCard.locator('pre')).toContainText(metric)
    // ADR-028: no open/run click; the SELECT runs in a new SQL tab right away.
    await expect(page.locator('.sql-view')).toBeVisible()
    await expect(workspace).not.toBeVisible()
    await expect(
      page
        .locator('.result-grid-cell')
        .filter({ hasText: new RegExp(`^${value}$`) }),
    ).toBeVisible({ timeout: 30000 })
    const settings = await page.evaluate(() => window.desktop!.getSettings())
    expect(settings.tabs[0]?.sql).toBe(originalSql)
    expect(
      settings.tabs.find((tab) => tab.id === settings.activeTabId),
    ).toMatchObject({
      sql: formatSql(selectEvent.proposal.sql, settings.sqlFormatting),
      connectionId: connection.id,
    })
    const history = await page.evaluate(() => window.desktop!.db.getHistory())
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      status: 'success',
      rowCount: 1,
      database: fixture.profile.database,
    })
    // A second real turn discovers the business target, but can only deliver a display-only draft.
    const secondPrompt =
      'Now create a DISPLAY-ONLY UPDATE/JOIN SQL draft; never execute it. Use metadata tools to rediscover the uploaded import table and to find/describe the dbo fixture table whose name starts aidb_write_fixture_ and has id and amount columns. ' +
      'Call ai_db db_propose_sql exactly once with draft=true. Draft an UPDATE of the dbo target amount to target.amount + 1 with a FROM/JOIN to the uploaded import table, matching target.id to TRY_CONVERT(int, uploaded.excel_key). ' +
      'Use the exact identifiers obtained from metadata; include the uploaded table in the JOIN, do not embed any uploaded cell values, and explain that this draft is not validated or executable automatically. Do not use SQL execution or write tools.'
    for (const hidden of [fixture.table, table!.tableName, value, privateNote])
      expect(secondPrompt).not.toContain(hidden)
    await page.getByLabel('AI 메시지', { exact: true }).fill(secondPrompt)
    await page
      .getByRole('button', { name: '메시지 보내기', exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (await events()).filter((event) => event.type === 'done').length,
        { timeout: 125000 },
      )
      .toBe(2)
    const all = await events()
    expect(
      all.filter((event) => event.type === 'done'),
      JSON.stringify(all),
    ).toEqual([
      expect.objectContaining({ outcome: 'completed' }),
      expect.objectContaining({ outcome: 'completed' }),
    ])
    const proposals = all.filter((event) => event.type === 'proposal')
    expect(proposals).toHaveLength(2)
    const draftRequestId = proposals[1]!.requestId
    const draftEvents = all.filter(
      (event) => event.requestId === draftRequestId,
    )
    for (const name of [
      'db_list_tables',
      'db_describe_table',
      'db_propose_sql',
    ])
      expect(draftEvents).toContainEqual(
        expect.objectContaining({ type: 'tool', name, status: 'completed' }),
      )
    const draft = proposals[1]!.proposal
    expect(draft).toMatchObject({
      draft: true,
      connectionId: connection.id,
      database: fixture.profile.database,
    })
    expect(draft.sql).toMatch(/\bUPDATE\b/i)
    expect(draft.sql).toMatch(/\bJOIN\b/i)
    expect(draft.sql).toContain(fixture.table)
    expect(draft.sql).toContain(table!.tableName)
    for (const hidden of [value, privateNote])
      expect(JSON.stringify(all)).not.toContain(hidden)
    const draftCard = page.getByLabel('SQL 제안').locator('article').last()
    await expect(draftCard).toContainText('AI 변경 SQL')
    // The draft opens by itself (ADR-033): a read-only connection may inspect it
    // but can never apply it.
    const mutationPanel = page.getByLabel('제한 쓰기 트랜잭션')
    await expect(mutationPanel).toContainText(
      /실행할 수 없음|변경 미리보기를 만들지 못했습니다/,
      { timeout: 20000 },
    )
    await expect(
      mutationPanel.getByRole('button', { name: '실행', exact: true }),
    ).toHaveCount(0)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings())).tabs
            .length,
      )
      .toBe(3)
    const afterDraft = await page.evaluate(() => window.desktop!.getSettings())
    expect(
      afterDraft.tabs.find((tab) => tab.id === afterDraft.activeTabId)?.sql,
    ).toBe(formatSql(draft.sql, afterDraft.sqlFormatting))
    expect(afterDraft.tabs[0]?.sql).toBe(originalSql)
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      history,
    )
    // The actual business row is unchanged: no UPDATE was executed through the draft flow.
    const unchanged = await fixture.setup
      .request()
      .query(`SELECT amount FROM ${fixture.target} WHERE id=1`)
    expect(unchanged.recordset[0]?.amount).toBe(10)
    await page.evaluate(() =>
      (Reflect.get(window, 'importAiLiveUnsubscribe') as () => void)(),
    )
    await page.getByRole('button', { name: '연결 해제', exact: true }).click()
    await expect(page.locator('.statusbar')).toContainText('연결 안 됨')
  } finally {
    try {
      await app?.close()
    } finally {
      try {
        await fixture.close()
      } finally {
        if (directory) {
          const target = resolve(directory)
          if (
            target.startsWith(resolve(tmpdir()) + sep) &&
            basename(target).startsWith('ai-db-import-ai-live-')
          )
            await rm(target, { recursive: true, force: true })
        }
      }
    }
  }
})
