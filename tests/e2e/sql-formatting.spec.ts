import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { defaultSqlFormatting, formatSql } from '@shared/sqlFormatting'

test('SQL formatter matches the requested style, has persistent options/preview/shortcut, never runs SQL and formats generated proposals (no DB/AI)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-sql-format-'))
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${profile}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const raw =
      'select [fp].[presetId], [fp].[userId] from [Athena].[dbo].[FilterPreset] fp inner join Athena.dbo.Users u on u.id=fp.userId inner join Athena.dbo.Users currentUser on currentUser.id=@userId where fp.isShared=1 and (fp.userId=@userId or u.agentId=currentUser.agentId) order by fp.createdAt desc;'
    const write = async (sql: string) => {
      await page.locator('.monaco-editor').click()
      await page.keyboard.press('Control+a')
      await page.keyboard.insertText(sql)
      await expect
        .poll(async () => {
          const settings = await page.evaluate(() =>
            window.desktop!.getSettings(),
          )
          return settings.tabs.find((tab) => tab.id === settings.activeTabId)!
            .sql
        })
        .toBe(sql)
    }
    const sql = () =>
      page.evaluate(async () => {
        const settings = await window.desktop!.getSettings()
        return settings.tabs.find((tab) => tab.id === settings.activeTabId)!.sql
      })
    await write(raw)
    await page.getByRole('button', { name: 'SQL 정리', exact: true }).click()
    await expect.poll(sql).toBe(formatSql(raw))
    await write(raw)
    await page.keyboard.press('Alt+Shift+f')
    await expect.poll(sql).toBe(formatSql(raw))
    await page.keyboard.press('Control+z')
    await expect.poll(sql).toBe(raw)
    await page
      .getByRole('button', { name: 'SQL 포맷 설정', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: 'SQL 포맷 설정',
      exact: true,
    })
    await expect(dialog).toBeVisible()
    // A pasted sample in the user's style picks the matching options.
    await dialog
      .getByLabel('내 스타일 예시 쿼리')
      .fill('select a,\n       b\nfrom dbo.t\nwhere a = 1 and b = 2;')
    await dialog.getByRole('button', { name: '예시에서 설정 추론' }).click()
    await expect(dialog.getByLabel('키워드 대소문자')).toHaveValue('lower')
    await expect(dialog.getByLabel('쉼표 위치')).toHaveValue('trailing')
    await expect(dialog.getByLabel('AND / OR 줄바꿈')).not.toBeChecked()
    await dialog.getByLabel('내 스타일 예시 쿼리').fill('')
    await dialog.getByLabel('키워드 대소문자').selectOption('lower')
    await dialog.getByLabel('쉼표 위치').selectOption('trailing')
    await dialog.getByLabel('들여쓰기', { exact: true }).selectOption('2')
    await dialog.getByLabel('식별자 대괄호').selectOption('preserve')
    await dialog.getByLabel('JOIN의 ON 위치 정렬').uncheck()
    await dialog.getByLabel('AND / OR 줄바꿈').uncheck()
    await expect(dialog.getByLabel('SQL 포맷 미리보기')).toContainText(
      'select  [fp].[presetId],',
    )
    await page.keyboard.press('Control+Enter')
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
    await expect.poll(sql).toBe(raw)
    await mkdir('.omx/sql-formatting', { recursive: true })
    await page.screenshot({ path: '.omx/sql-formatting/settings-dark.png' })
    await dialog.getByRole('button', { name: '설정 저장', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const options = {
      ...defaultSqlFormatting(),
      keywordCase: 'lower' as const,
      commaStyle: 'trailing' as const,
      indentWidth: 2 as const,
      alignJoinOn: false,
      breakConditions: false,
      identifierQuotes: 'preserve' as const,
    }
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings()))
            .sqlFormatting,
      )
      .toEqual(options)
    await expect.poll(sql).toBe(raw) // Preferences do not rewrite user tabs.
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).sqlFormatting,
    ).toEqual(options)
    await page.getByRole('button', { name: 'SQL 정리', exact: true }).click()
    await expect.poll(sql).toBe(formatSql(raw, options))
    await page.getByRole('button', { name: '테마 전환' }).click()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1080, 720),
    )
    await page
      .getByRole('button', { name: 'SQL 포맷 설정', exact: true })
      .click()
    const smallDialog = page.getByRole('dialog', { name: 'SQL 포맷 설정' })
    await expect(smallDialog).toBeVisible()
    expect(
      await smallDialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true)
    const box = await smallDialog.boundingBox()
    expect(Math.abs(box!.x + box!.width / 2 - 540)).toBeLessThan(2)
    await smallDialog
      .getByRole('button', { name: '설정 저장', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      smallDialog.getByRole('button', { name: '설정 저장', exact: true }),
    ).toBeInViewport()
    await page.screenshot({
      path: '.omx/sql-formatting/settings-light-minimum.png',
    })
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '기본값', exact: true })
      .click()
    await page.keyboard.press('Escape')
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).sqlFormatting,
    ).toEqual(options)
    // Monaco auto-closes quotes on insertion; remove the closing quote explicitly.
    await write("SELECT 'unclosed'")
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Backspace')
    await expect.poll(sql).toBe("SELECT 'unclosed")
    await page.getByRole('button', { name: 'SQL 정리', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('닫히지 않았습니다')
    await expect.poll(sql).toBe("SELECT 'unclosed")
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )

    const connectionId = randomUUID()
    await page.evaluate(async (id) => {
      const settings = await window.desktop!.getSettings()
      settings.tabs[0]!.connectionId = id
      await window.desktop!.saveSettings(settings)
    }, connectionId)
    await app.evaluate(({ ipcMain }, id) => {
      const set = (name: string, handler: () => unknown) => {
        ipcMain.removeHandler(name)
        ipcMain.handle(name, handler)
      }
      set('db:connections', () => [
        {
          id,
          name: 'Format fixture',
          driver: 'mssql',
          status: 'connected',
          currentDatabase: 'format_fixture',
          readOnly: true,
        },
      ])
      set('db:explorer', () => ({ databases: [], schemas: [], tables: [] }))
      set('agent:status', () => [
        {
          provider: 'codex',
          available: true,
          installed: true,
          auth: 'subscription',
          reason: 'Handler double',
          version: 'fixture',
        },
      ])
      ipcMain.removeHandler('agent:start')
      ipcMain.handle('agent:start', (event, request) => {
        Reflect.set(globalThis, 'sqlFormatRequest', request)
        event.sender.send('agent:event', {
          requestId: request.requestId,
          provider: 'codex',
          type: 'proposal',
          proposal: {
            id: crypto.randomUUID(),
            connectionId: id,
            database: 'format_fixture',
            sql: 'SELECT [fp].[id], [fp].[name] FROM [dbo].[items] AS [fp]',
            explanation: 'Fixture SQL only, never executed',
          },
        })
        event.sender.send('agent:event', {
          requestId: request.requestId,
          provider: 'codex',
          type: 'done',
          outcome: 'completed',
        })
      })
    }, connectionId)
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    await page.getByLabel('AI 메시지', { exact: true }).fill('쿼리 만들어줘')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    const expected = formatSql(
      'SELECT [fp].[id], [fp].[name] FROM [dbo].[items] AS [fp]',
      options,
    )
    await expect(page.getByLabel('SQL 제안').locator('pre')).toHaveText(
      expected,
    )
    expect(
      await app.evaluate(
        () => Reflect.get(globalThis, 'sqlFormatRequest').context.sqlFormatting,
      ),
    ).toEqual(options)
    await page
      .getByRole('button', { name: 'SQL 다시 열기', exact: true })
      .click()
    await expect.poll(sql).toBe(expected)
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
  } finally {
    await app.close()
    const target = resolve(profile)
    if (
      target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith('ai-db-sql-format-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
