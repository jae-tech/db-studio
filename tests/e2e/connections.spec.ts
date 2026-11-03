import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('encrypted connection CRUD, validation and real driver failure are explicit', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-studio-connections-'))
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${profile}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page
      .getByRole('button', { name: '새 연결', exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('연결 이름').fill('Local test')
    await dialog.getByLabel('호스트', { exact: true }).fill('127.0.0.1')
    await dialog.getByLabel('포트', { exact: true }).fill('1')
    await dialog.getByLabel('데이터베이스', { exact: true }).fill('app_test')
    await dialog.getByLabel('사용자 이름').fill('reader')
    const secret = 'e2e-only-password-do-not-store-plaintext-84219'
    await dialog.getByLabel('비밀번호', { exact: true }).fill(secret)
    await dialog.getByRole('button', { name: '연결 저장', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect(
      page.getByRole('button', { name: '연결', exact: true }),
    ).toBeVisible()
    const saved = await page.evaluate(() =>
      window.desktop!.db.listConnections(),
    )
    expect(saved).toHaveLength(1)
    expect(saved[0]?.hasPassword).toBe(true)
    expect(JSON.stringify(saved)).not.toContain(secret)
    const id = saved[0]!.id
    for (const name of (await readdir(profile)).filter((name) =>
      name.startsWith('database.db'),
    )) {
      const contents = await readFile(join(profile, name))
      expect(contents.includes(Buffer.from(secret))).toBe(false)
      expect(contents.includes(Buffer.from(secret, 'utf16le'))).toBe(false)
      expect(contents.includes(Buffer.from('127.0.0.1'))).toBe(false)
      expect(contents.includes(Buffer.from('"username":"reader"'))).toBe(false)
    }
    const unauthorized = await page.evaluate(async (connectionId) => {
      try {
        await window.desktop!.db.executeQuery({
          connectionId,
          requestId: crypto.randomUUID(),
          approvalToken: crypto.randomUUID(),
        })
        return false
      } catch {
        return true
      }
    }, id)
    expect(unauthorized).toBe(true)
    await page.getByRole('button', { name: '연결', exact: true }).click()
    await expect(page.locator('.explorer').getByRole('alert')).toContainText(
      /네트워크|제한 시간|연결|실패/,
      { timeout: 20000 },
    )
    await expect(
      page.getByRole('button', { name: '연결', exact: true }),
    ).toBeEnabled()
    expect(
      (await page.evaluate(() => window.desktop!.db.listConnections()))[0]
        ?.status,
    ).toBe('disconnected')
    await page.getByRole('button', { name: '편집', exact: true }).click()
    await page.getByLabel('연결 이름').fill('Renamed test')
    await page.getByRole('button', { name: '연결 저장', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(
      page.getByRole('button', { name: /Renamed test/ }),
    ).toBeVisible()
    expect(
      (await page.evaluate(() => window.desktop!.db.listConnections()))[0]
        ?.hasPassword,
    ).toBe(true)
    await page.getByRole('button', { name: '삭제', exact: true }).click()
    await page.getByRole('button', { name: '삭제 확인' }).click()
    await expect(
      page.getByText('데이터베이스에 연결해 시작하세요'),
    ).toBeVisible()
    expect(
      await page.evaluate(() => window.desktop!.db.listConnections()),
    ).toEqual([])
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
