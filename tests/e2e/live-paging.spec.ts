import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { liveFixture, liveWriteEnabled } from '../helpers/live-mssql'

test('real SQL Server pagination automatically fetches 1000/1000/500 only when entering the missing page', async () => {
  test.skip(
    !liveWriteEnabled,
    'Requires an explicitly approved dedicated SQL Server fixture',
  )
  const fixture = await liveFixture()
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-live-paging-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await fixture.setup
      .request()
      .query(
        `DELETE FROM ${fixture.target}; WITH n AS (SELECT TOP (2500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS id FROM sys.all_objects a CROSS JOIN sys.all_objects b) INSERT INTO ${fixture.target} (id, amount) SELECT id, id * 2 FROM n`,
      )
    app = await electron.launch({
      args: ['.', `--user-data-dir=${directory}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.evaluate(
      async (input) => {
        await window.desktop!.db.saveConnection({
          profile: input.profile,
          password: input.password,
        })
        await window.desktop!.db.connect({ connectionId: input.profile.id })
        const settings = await window.desktop!.getSettings()
        settings.tabs[0]!.connectionId = input.profile.id
        settings.tabs[0]!.sql = input.sql
        await window.desktop!.saveSettings(settings)
      },
      {
        profile: { ...fixture.profile, readOnly: true, maxRows: 1000 },
        password: process.env.AI_DB_TEST_PASSWORD!,
        sql: `SELECT id, amount FROM ${fixture.target} ORDER BY id`,
      },
    )
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.keyboard.press('Control+Enter')
    const ids = page.locator('.result-grid-cell[data-col-id="c0"]')
    await expect(ids.filter({ hasText: /^1$/ })).toBeVisible()
    await page.getByRole('button', { name: '설정 열기', exact: true }).click()
    await page
      .getByRole('region', { name: '설정' })
      .getByLabel('페이지당 행 수', { exact: true })
      .selectOption('500')
    await page.getByRole('button', { name: 'SQL 작업 공간 열기' }).click()
    const next = page.getByRole('button', { name: '다음 페이지', exact: true })
    const history = () => page.evaluate(() => window.desktop!.db.getHistory())
    await next.click()
    await expect(ids.filter({ hasText: /^501$/ })).toBeVisible()
    expect(await history()).toHaveLength(1)
    await next.click()
    await expect(ids.filter({ hasText: /^1001$/ })).toBeVisible()
    expect(await history()).toHaveLength(2)
    await next.click()
    await expect(ids.filter({ hasText: /^1501$/ })).toBeVisible()
    expect(await history()).toHaveLength(2)
    await next.click()
    await expect(ids.filter({ hasText: /^2001$/ })).toBeVisible()
    await expect(next).toBeDisabled()
    await expect(
      page.getByLabel('결과 페이지 이동', { exact: true }),
    ).toContainText('2,500행')
    expect((await history()).map((entry) => entry.rowCount)).toEqual([
      500, 1000, 1000,
    ])
    await page.getByRole('button', { name: '첫 페이지', exact: true }).click()
    await expect(ids.filter({ hasText: /^1$/ })).toBeVisible()
    expect(await history()).toHaveLength(3)
  } finally {
    try {
      await app?.close()
    } finally {
      await fixture.close()
      const target = resolve(directory)
      if (
        target.startsWith(resolve(tmpdir()) + sep) &&
        basename(target).startsWith('ai-db-live-paging-')
      )
        await rm(target, { recursive: true, force: true })
    }
  }
})
