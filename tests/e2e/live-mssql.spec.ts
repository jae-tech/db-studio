import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { formatSql } from '@shared/sqlFormatting'

test('live MSSQL UI: direct SELECT run (no approval dialog), real grid and query history', async () => {
  test.skip(
    ![
      'AI_DB_TEST_HOST',
      'AI_DB_TEST_DATABASE',
      'AI_DB_TEST_USER',
      'AI_DB_TEST_PASSWORD',
    ].every((name) => !!process.env[name]),
    'No explicit live MSSQL test account configured',
  )
  const profileDir = await mkdtemp(join(tmpdir(), 'ai-db-studio-live-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profileDir}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.evaluate(
      async (input) => {
        await window.desktop!.db.saveConnection({
          profile: {
            id: crypto.randomUUID(),
            name: 'Live SQL Server',
            driver: 'mssql',
            host: input.host,
            port: input.port,
            database: input.database,
            username: input.user,
            environment: 'development',
            readOnly: true,
            encrypt: true,
            trustServerCertificate: input.trust,
            maxRows: 10,
            timeoutSeconds: 10,
          },
          password: input.password,
        })
      },
      {
        host: process.env.AI_DB_TEST_HOST!,
        port: Number(process.env.AI_DB_TEST_PORT ?? 1433),
        database: process.env.AI_DB_TEST_DATABASE!,
        user: process.env.AI_DB_TEST_USER!,
        password: process.env.AI_DB_TEST_PASSWORD!,
        trust: process.env.AI_DB_TEST_TRUST_CERT === 'true',
      },
    )
    await page.getByRole('button', { name: '연결', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '연결 해제', exact: true }),
    ).toBeVisible({ timeout: 20000 })
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('SELECT 42 AS answer;')
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^42$/ }),
    ).toBeVisible()
    await expect(page.getByLabel('결과 페이지 이동')).toBeVisible()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.db.getHistory()))[0]
            ?.status,
      )
      .toBe('success')
    await page.getByRole('button', { name: /^실행 이력/ }).click()
    await expect(page.locator('.history-entry')).toContainText('성공')
    await expect(page.locator('.history-entry')).toContainText('1행')
    // Save the tab's SELECT under a name + alias, replace the editor, then run it by alias.
    const savedName = page.getByLabel('저장 쿼리 이름 또는 별칭')
    await savedName.fill('정답 조회, answer')
    await page
      .getByRole('button', { name: '현재 SQL 저장', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText('저장했습니다')
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('SELECT 7 AS other;')
    await savedName.fill('없는 이름')
    await page
      .getByRole('button', { name: '저장 쿼리 실행', exact: true })
      .click()
    await expect(page.getByRole('status')).toContainText('저장 쿼리가 없습니다')
    await savedName.fill('ANSWER')
    await page
      .getByRole('button', { name: '저장 쿼리 실행', exact: true })
      .click()
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.desktop!.db.getHistory())).map(
          (entry) => entry.status,
        ),
      )
      .toEqual(['success', 'success'])
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^42$/ }),
    ).toBeVisible()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
            ?.sql,
      )
      // Saved SQL opens in the current SQL format style.
      .toBe(formatSql('SELECT 42 AS answer;'))
    // Local AI-panel invocation: real SELECT path, with CLI deliberately unused.
    const message = page.getByLabel('AI 메시지', { exact: true })
    const send = page.getByRole('button', { name: '메시지 보내기' })
    await message.fill('answer 조회해줘')
    await send.click()
    await expect(page.getByRole('log').locator('article').last()).toContainText(
      '조회 완료',
    )
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.db.getHistory())).length,
      )
      .toBe(3)
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^42$/ }),
    ).toBeVisible()
    await expect(page.locator('.agent-offline')).toContainText('AI 전송 없음')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Main still rejects stored writes: no mutation preview/apply/COMMIT path.
    await page.evaluate(async () => {
      const [query] = await window.desktop!.db.listSavedQueries()
      await window.desktop!.db.saveQuery({
        connectionId: query!.connectionId,
        database: query!.database,
        name: '위험 수정',
        aliases: [],
        sql: 'UPDATE dbo.must_not_exist SET amount = 999 WHERE id = 1;',
      })
      await window.desktop!.db.saveQuery({
        connectionId: query!.connectionId,
        database: 'other',
        name: '다른DB',
        aliases: [],
        sql: 'SELECT 999 AS answer;',
      })
    })
    await message.fill('/조회 위험 수정')
    await send.click()
    await expect(page.getByRole('log').locator('article').last()).toContainText(
      '실행하지 못했습니다',
    )
    expect(
      (await page.evaluate(() => window.desktop!.db.getHistory())).length,
    ).toBe(3)
    await message.fill('/조회 다른DB')
    await send.click()
    await expect(page.locator('.agent-footer [role="alert"]')).toContainText(
      '없습니다',
    )
    expect(
      (await page.evaluate(() => window.desktop!.db.getHistory())).length,
    ).toBe(3)
    await page.getByRole('button', { name: '연결 해제', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '연결', exact: true }),
    ).toBeVisible()
  } finally {
    await app.close()
    await rm(profileDir, { recursive: true, force: true })
  }
})
