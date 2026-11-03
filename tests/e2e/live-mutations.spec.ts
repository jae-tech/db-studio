import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { liveFixture, liveWriteEnabled } from '../helpers/live-mssql'

test('live SQL Server UI: 변경 미리보기 shows real affected rows, 취소 changes nothing, 실행 commits, quit with an open preview changes nothing', async () => {
  test.skip(
    !liveWriteEnabled,
    'Requires an approved dedicated SQL Server fixture',
  )
  test.setTimeout(90000)
  const fixture = await liveFixture()
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-write-live-'))
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${directory}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page
      .getByRole('button', { name: '새 연결', exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('연결 이름').fill('Live guarded writes')
    await dialog
      .getByLabel('호스트', { exact: true })
      .fill(fixture.profile.host)
    await dialog
      .getByLabel('포트', { exact: true })
      .fill(String(fixture.profile.port))
    await dialog
      .getByLabel('데이터베이스', { exact: true })
      .fill(fixture.profile.database)
    await dialog.getByLabel('사용자 이름').fill(fixture.profile.username)
    await dialog
      .getByLabel('비밀번호', { exact: true })
      .fill(process.env.AI_DB_TEST_PASSWORD!)
    await dialog.getByLabel('제한 쓰기 허용').check()
    if (fixture.profile.trustServerCertificate)
      await dialog.getByLabel('서버 인증서 신뢰').check()
    await dialog.getByRole('button', { name: '연결 저장', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const connect = async () => {
      await page.getByRole('button', { name: '연결', exact: true }).click()
      await expect(
        page.getByRole('button', { name: '연결 해제', exact: true }),
      ).toBeVisible({ timeout: 20000 })
      // Connection availability precedes the initial explorer metadata read.
      // Main correctly refuses a write lease until that read has finished.
      await expect(
        page.getByLabel('현재 데이터베이스', { exact: true }),
      ).toHaveValue(fixture.profile.database)
    }
    await connect()
    const edit = async (text: string) => {
      await page.locator('.monaco-editor').click()
      await page.keyboard.press('Control+a')
      await page.keyboard.type(text)
    }
    const view = page.locator('[aria-label="변경 미리보기"].mutation-state')
    // Running the write opens the read-only preview of the real affected rows.
    const previewRun = async (expectedAmount: number) => {
      await page.keyboard.press('Control+Enter')
      await expect(view).toContainText('실행할까요?', { timeout: 20000 })
      expect(await amount()).toBe(expectedAmount)
    }
    const amount = async () =>
      (
        await fixture.setup
          .request()
          .query<{ amount: number }>(
            `SELECT amount FROM ${fixture.target} WHERE id=1`,
          )
      ).recordset[0]?.amount

    await edit(`UPDATE dbo.${fixture.table} SET amount=20 WHERE id=1`)
    await previewRun(10)
    await expect(view.locator('th')).toContainText(['amount', '→ amount'])
    await expect(view.locator('td.next')).toHaveText('20')
    await view.getByRole('button', { name: '취소', exact: true }).click()
    await expect(view).toHaveCount(0)
    expect(await amount()).toBe(10)

    await previewRun(10)
    await view.getByRole('button', { name: '실행', exact: true }).click()
    await expect(page.locator('.mutation-state')).toContainText('COMMIT 완료')
    expect(await amount()).toBe(20)
    const history = await page.evaluate(() => window.desktop!.db.getHistory())
    expect(history.map((entry) => entry.status)).toEqual(['committed'])

    await connect()
    await edit(`DELETE FROM dbo.${fixture.table} WHERE id=1`)
    await previewRun(20)
    await expect(view).toContainText('1행을 삭제합니다. 실행할까요?')
    await view.getByRole('button', { name: '실행', exact: true }).click()
    // The earlier UPDATE's "COMMIT 완료" may still be on screen; wait on the real row.
    await expect.poll(amount, { timeout: 20000 }).toBeUndefined()
    await expect(page.locator('.mutation-state')).toContainText('COMMIT 완료')
    await fixture.setup
      .request()
      .query(`INSERT INTO ${fixture.target} (id,amount) VALUES (1,10)`)
    await connect()
    await edit(`UPDATE dbo.${fixture.table} SET amount=40 WHERE id=1`)
    await previewRun(10)
    const closing = app
    app = undefined
    await closing.close()
    expect(await amount()).toBe(10)
  } finally {
    try {
      await app?.close()
    } finally {
      try {
        await fixture.close()
      } finally {
        const target = resolve(directory)
        if (
          target.startsWith(resolve(tmpdir()) + sep) &&
          basename(target).startsWith('ai-db-write-live-')
        )
          await rm(target, { recursive: true, force: true })
      }
    }
  }
})
