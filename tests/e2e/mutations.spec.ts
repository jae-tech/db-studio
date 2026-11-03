import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

test('write UI defaults off and fixed mutation IPC cannot bypass profile, SQL policy or approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-write-e2e-'))
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${directory}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).writePreview,
    ).toBe(true)
    expect(
      await page.evaluate(() =>
        Object.keys(window.desktop!.db.mutations).sort(),
      ),
    ).toEqual(['apply', 'commit', 'inspect', 'preview', 'rollback', 'state'])
    await page.getByLabel('새 연결', { exact: true }).click()
    const dialog = page.getByRole('dialog')
    const allow = dialog.getByLabel('제한 쓰기 허용')
    await expect(allow).not.toBeChecked()
    await dialog
      .getByLabel('연결 환경', { exact: true })
      .selectOption('production')
    await expect(allow).toBeEnabled()
    await dialog
      .getByLabel('연결 환경', { exact: true })
      .selectOption('development')
    await allow.check()
    await expect(allow).toBeChecked()
    await dialog
      .getByLabel('연결 이름', { exact: true })
      .fill('Explicit write opt-in fixture')
    await dialog.getByLabel('호스트', { exact: true }).fill('127.0.0.1')
    await dialog.getByLabel('포트', { exact: true }).fill('1')
    await dialog
      .getByLabel('데이터베이스', { exact: true })
      .fill('no_live_database')
    await dialog.getByLabel('사용자 이름', { exact: true }).fill('fixture')
    await dialog
      .getByLabel('비밀번호', { exact: true })
      .fill('fake-password-not-a-credential')
    await dialog.getByRole('button', { name: '연결 저장', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const results = await page.evaluate(async () => {
      const db = window.desktop!.db
      const summary = (await db.listConnections())[0]!
      const id = summary.id
      const rejected = async (
        job: () => Promise<unknown>,
      ): Promise<boolean> => {
        try {
          await job()
          return false
        } catch {
          return true
        }
      }
      return {
        optedIn: !summary.readOnly,
        status: summary.status,
        noConnection: await rejected(() =>
          db.mutations.preview({
            connectionId: id,
            sql: 'UPDATE dbo.items SET amount=2 WHERE id=1',
          }),
        ),
        drop: await rejected(() =>
          db.mutations.preview({
            connectionId: id,
            sql: 'DROP TABLE dbo.items',
          }),
        ),
        missingWhere: await rejected(() =>
          db.mutations.preview({
            connectionId: id,
            sql: 'DELETE FROM dbo.items',
          }),
        ),
        fakeApproval: await rejected(() =>
          db.mutations.apply({
            id: crypto.randomUUID(),
            approvalHash: 'a'.repeat(64),
          }),
        ),
        mutation: await db.mutations.state(id),
        history: await db.getHistory(),
      }
    })
    expect(results).toEqual({
      optedIn: true,
      status: 'disconnected',
      noConnection: true,
      drop: true,
      missingWhere: true,
      fakeApproval: true,
      mutation: null,
      history: [],
    })
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    expect(
      (await page.evaluate(() => window.desktop!.db.listConnections()))[0]
        ?.readOnly,
    ).toBe(false)
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).writePreview,
    ).toBe(true)
  } finally {
    await app.close()
    const target = resolve(directory)
    if (
      target.startsWith(resolve(tmpdir())) &&
      basename(target).startsWith('ai-db-write-e2e-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
