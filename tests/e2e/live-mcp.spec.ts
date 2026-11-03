import { test, expect, _electron as electron } from '@playwright/test'
import { formatSql } from '@shared/sqlFormatting'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomInt, randomUUID } from 'node:crypto'
import sql from 'mssql'
import type { AgentEvent } from '@shared/agent'
import {
  identifier,
  liveFixture,
  liveWriteEnabled,
} from '../helpers/live-mssql'

// AI_DB_TEST_AGENT_PROVIDER=copilot runs the same flow on the official Copilot CLI.
const provider =
  process.env.AI_DB_TEST_AGENT_PROVIDER === 'copilot'
    ? ('copilot' as const)
    : ('codex' as const)

test(`real DB → Electron Main → MCP → official ${provider} CLI → proposal UI → separately approved SELECT`, async () => {
  test.skip(
    !liveWriteEnabled ||
      process.env.AI_DB_TEST_AGENT !== '1' ||
      !process.env.AI_DB_TEST_READ_USER ||
      !process.env.AI_DB_TEST_READ_PASSWORD,
    'Requires explicit subscription turns, dedicated fixture and SELECT-only account',
  )
  test.setTimeout(300000)
  const fixture = await liveFixture()
  let directory: string | undefined
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  const metric = `mcp_metric_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const value = randomInt(100000, 999999)
  const rowOnly = `LOCAL_ROW_ONLY_${randomUUID()}`
  try {
    await fixture.setup
      .request()
      .query(
        `ALTER TABLE ${fixture.target} ADD ${identifier(metric)} int NULL, private_note nvarchar(80) NULL`,
      )
    await fixture.setup
      .request()
      .input('value', sql.Int, value)
      .input('note', sql.NVarChar(80), rowOnly)
      .query(
        `UPDATE ${fixture.target} SET ${identifier(metric)}=@value, private_note=@note WHERE id=1`,
      )
    directory = await mkdtemp(join(tmpdir(), 'ai-db-mcp-real-ui-'))
    app = await electron.launch({
      args: ['.', `--user-data-dir=${directory}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.evaluate(async (value) => {
      const settings = await window.desktop!.getSettings()
      await window.desktop!.saveSettings({ ...settings, provider: value })
    }, provider)
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page
      .getByRole('button', { name: '새 연결', exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('연결 이름').fill('Real DB metadata MCP acceptance')
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
    expect(connections[0]).toMatchObject({
      readOnly: true,
      permissionVerified: true,
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

    // Subscribe through the real fixed preload API. No IPC replacement or mocks.
    await page.evaluate(() => {
      const events: AgentEvent[] = []
      Reflect.set(window, 'mcpLiveEvents', events)
      Reflect.set(
        window,
        'mcpLiveUnsubscribe',
        window.desktop!.agent.onEvent((event) => events.push(event)),
      )
    })
    const events = () =>
      page.evaluate(() => Reflect.get(window, 'mcpLiveEvents') as AgentEvent[])
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    await expect(
      page.getByRole('button', { name: 'CLI 상태 확인' }),
    ).toHaveAttribute(
      'title',
      provider === 'copilot'
        ? /GitHub Copilot 로그인 확인 완료/
        : /ChatGPT 로그인 확인 완료/,
      { timeout: 35000 },
    )
    await expect(
      page.locator('.agent-panel').getByRole('checkbox'),
    ).toHaveCount(0)
    const scope = page.locator('.title-center')
    await expect(scope).toContainText(fixture.profile.database)
    const prompt =
      'This is an explicitly approved metadata-only acceptance test on a dedicated local fixture database. ' +
      'Call ai_db db_get_schema with {} to discover the actual schema. Find the fixture table and the integer column whose name starts with mcp_metric_. ' +
      'The exact table and column names are intentionally not provided here: obtain them from the metadata tool result. ' +
      'Then call ai_db db_propose_sql exactly once with a restricted SELECT of that discovered column AS observed FROM its dbo table WHERE id = 1, and a short explanation. ' +
      'Do not select private_note. Do not use any other tools. Finally reply briefly that the proposal is ready.'
    expect(prompt).not.toContain(metric)
    expect(prompt).not.toContain(fixture.table)
    await page.getByLabel('AI 메시지', { exact: true }).fill(prompt)
    await page.getByRole('button', { name: '메시지 보내기' }).click()
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
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool',
          name: 'db_get_schema',
          status: 'completed',
        }),
        expect.objectContaining({
          type: 'tool',
          name: 'db_propose_sql',
          status: 'completed',
        }),
      ]),
    )
    expect(JSON.stringify(first)).not.toContain(rowOnly)
    const proposal = first.find((event) => event.type === 'proposal')
    if (proposal?.type !== 'proposal')
      throw new Error('No actual MCP proposal event')
    expect(proposal.proposal).toMatchObject({
      connectionId: connections[0]!.id,
      database: fixture.profile.database,
    })
    expect(proposal.proposal.sql).toContain(metric)
    expect(proposal.proposal.sql).toContain(fixture.table)
    const card = page.getByLabel('SQL 제안').locator('article')
    await expect(card).toHaveCount(1)
    await expect(card.locator('pre')).toContainText(metric)
    // ADR-028: the proposed SELECT runs at once in its own tab, with no open/run click.
    await expect(
      page
        .locator('.result-grid-cell')
        .filter({ hasText: new RegExp(`^${value}$`) }),
    ).toBeVisible({ timeout: 30000 })
    const settings = await page.evaluate(() => window.desktop!.getSettings())
    expect(settings.tabs).toHaveLength(2)
    expect(settings.tabs[0]?.sql).toBe(originalSql)
    expect(
      settings.tabs.find((tab) => tab.id === settings.activeTabId),
    ).toMatchObject({
      sql: formatSql(proposal.proposal.sql, settings.sqlFormatting),
      connectionId: connections[0]!.id,
    })
    const history = await page.evaluate(() => window.desktop!.db.getHistory())
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      status: 'success',
      rowCount: 1,
      database: fixture.profile.database,
    })

    // A real resumed turn must make another MCP call after the first scope closes.
    await page
      .getByLabel('AI 메시지', { exact: true })
      .fill(
        'Now call ai_db db_list_databases exactly once and report only the authorized database name. Do not propose or execute SQL. Do not use any other tools.',
      )
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    await expect
      .poll(
        async () =>
          (await events()).filter((event) => event.type === 'done').length,
        { timeout: 125000 },
      )
      .toBe(2)
    const resumed = await events()
    expect(
      resumed.filter((event) => event.type === 'done'),
      JSON.stringify(resumed),
    ).toEqual([
      expect.objectContaining({ outcome: 'completed' }),
      expect.objectContaining({ outcome: 'completed' }),
    ])
    const sessions = resumed.filter((event) => event.type === 'session')
    expect(sessions).toHaveLength(2)
    expect(sessions[0]!.sessionId).toBe(sessions[1]!.sessionId)
    expect(resumed).toContainEqual(
      expect.objectContaining({
        type: 'tool',
        name: 'db_list_databases',
        status: 'completed',
      }),
    )
    await expect(page.getByRole('log').locator('article').last()).toContainText(
      fixture.profile.database,
    )
    // Result rows stay local: the resumed turn sees no row value, and no extra run happened.
    expect(JSON.stringify(resumed)).not.toContain(rowOnly)
    expect(JSON.stringify(resumed)).not.toContain(String(value))
    expect(
      await page.evaluate(() => window.desktop!.db.getHistory()),
    ).toHaveLength(1)
    await page.getByRole('button', { name: '연결 해제', exact: true }).click()
    await expect(page.locator('.statusbar')).toContainText('연결 안 됨')
    await expect(page.getByLabel('SQL 제안')).toHaveCount(0)
    await page.evaluate(() =>
      (Reflect.get(window, 'mcpLiveUnsubscribe') as () => void)(),
    )
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
            basename(target).startsWith('ai-db-mcp-real-ui-')
          )
            await rm(target, { recursive: true, force: true })
        }
      }
    }
  }
})
