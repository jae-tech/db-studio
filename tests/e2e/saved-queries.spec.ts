import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('saved queries persist in real SQLite, refuse invalid or reused names and survive restart (no DB)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-saved-queries-'))
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${profile}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
  const connectionId = randomUUID()
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const save = (input: unknown) =>
      page.evaluate(
        (value) =>
          window
            .desktop!.db.saveQuery(value as never)
            .then((query) => query.id)
            .catch((error: Error) => `error:${error.message}`),
        input,
      )
    const base = {
      connectionId,
      database: 'sales',
      name: '월별 매출',
      aliases: ['매출'],
      sql: 'SELECT 1 AS answer',
    }
    const id = await save(base)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(
      await save({ ...base, name: '다른 이름', aliases: [' 매출 '] }),
    ).toMatch(/이미 사용 중/)
    expect(await save({ ...base, name: '' })).toMatch(/^error:/)
    expect(await save({ ...base, extra: true })).toMatch(/^error:/)
    expect(await save({ ...base, database: 'other' })).toMatch(
      /^[0-9a-f-]{36}$/,
    )
    await expect(
      page.getByRole('button', { name: '저장 쿼리 실행', exact: true }),
    ).toBeDisabled()
    await app.close()

    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const listed = await page.evaluate(() =>
      window.desktop!.db.listSavedQueries(),
    )
    expect(listed.map((query) => [query.database, query.name])).toEqual([
      ['sales', '월별 매출'],
      ['other', '월별 매출'],
    ])
    await page.evaluate(
      (value) => window.desktop!.db.deleteSavedQuery(value),
      id,
    )
    expect(
      (await page.evaluate(() => window.desktop!.db.listSavedQueries())).map(
        (query) => query.database,
      ),
    ).toEqual(['other'])
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
