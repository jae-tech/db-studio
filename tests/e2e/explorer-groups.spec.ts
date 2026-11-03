import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('explorer groups connections into folders and folds groups, sections, the explorer and the AI panel (handler doubles, no DB)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-explorer-groups-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const ids = [randomUUID(), randomUUID()]
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ ipcMain }, ids) => {
      ipcMain.removeHandler('db:connections')
      ipcMain.handle('db:connections', () =>
        ['운영 서버', '개발 서버'].map((name, index) => ({
          id: ids[index],
          name,
          driver: 'mssql',
          host: 'not-used',
          port: 1,
          database: 'fixture',
          username: 'fixture',
          environment: 'development',
          readOnly: true,
          encrypt: true,
          trustServerCertificate: false,
          timeoutSeconds: 30,
          maxRows: 100,
          hasPassword: false,
          status: 'disconnected',
          currentDatabase: 'fixture',
          permissionVerified: false,
        })),
      )
    }, ids)
    await page.reload()
    const explorer = page.locator('aside.explorer')
    const ungrouped = explorer.getByRole('button', { name: '미분류 그룹 접기' })
    await expect(ungrouped).toContainText('2')

    // New folder, then move one connection into it.
    await explorer.getByRole('button', { name: '새 연결 그룹' }).click()
    await explorer.getByLabel('새 그룹 이름', { exact: true }).fill('운영')
    await explorer.getByLabel('새 그룹 이름', { exact: true }).press('Enter')
    await explorer.getByLabel('운영 서버 그룹').selectOption({ label: '운영' })
    const prod = explorer.getByRole('button', { name: '운영 그룹 접기' })
    await expect(prod).toContainText('1')
    await expect(ungrouped).toContainText('1')

    // Fold the folder: its connection hides, the other stays.
    await prod.click()
    await expect(explorer.getByText('운영 서버')).toHaveCount(0)
    await expect(explorer.getByText('개발 서버')).toBeVisible()
    // Searching shows matches even inside folded folders.
    await explorer.getByLabel('연결 필터').fill('운영')
    await expect(explorer.getByText('운영 서버')).toBeVisible()
    await explorer.getByLabel('연결 필터').fill('')

    // Fold whole sections.
    await explorer.getByRole('button', { name: /연결 목록/ }).click()
    await expect(explorer.getByText('개발 서버')).toHaveCount(0)
    await explorer.screenshot({ path: '.omx/readability/explorer-folded.png' })
    await explorer.getByRole('button', { name: /데이터베이스 객체/ }).click()
    await expect(explorer.getByText('연결된 데이터베이스 없음')).toHaveCount(0)
    await explorer.getByRole('button', { name: /연결 목록/ }).click()
    await expect(explorer.getByText('개발 서버')).toBeVisible()
    await page.screenshot({ path: '.omx/readability/explorer-groups.png' })

    // Collapse the whole panel; state survives a reload.
    await explorer.getByRole('button', { name: '탐색기 접기' }).click()
    await expect(explorer).toHaveCount(0)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings()))
            .explorerCollapsed,
      )
      .toBe(true)
    const saved = await page.evaluate(() => window.desktop!.getSettings())
    expect(saved.connectionGroups).toEqual([
      { id: expect.any(String), name: '운영', connectionIds: [ids[0]] },
    ])
    expect(saved.collapsed).toEqual(
      expect.arrayContaining([
        saved.connectionGroups[0]!.id,
        'section:objects',
      ]),
    )
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await expect(page.locator('aside.explorer')).toHaveCount(0)
    await page.getByRole('button', { name: '탐색기 펼치기' }).click()
    await expect(page.locator('aside.explorer')).toBeVisible()
    await expect(
      page.locator('aside.explorer').getByText('운영 서버'),
    ).toHaveCount(0)

    // The AI panel folds the same way and stays folded after a reload.
    const agent = page.locator('aside.agent-panel')
    await agent.getByRole('button', { name: 'AI 패널 접기' }).click()
    await expect(agent).toBeHidden()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings()))
            .agentCollapsed,
      )
      .toBe(true)
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await expect(page.locator('aside.agent-panel')).toBeHidden()
    await page.getByRole('button', { name: 'AI 패널 펼치기' }).click()
    await expect(page.locator('aside.agent-panel')).toBeVisible()

    // Deleting a folder keeps the connection, now under 미분류.
    await page
      .locator('aside.explorer')
      .getByRole('button', { name: '운영 그룹 삭제' })
      .click()
    await expect(
      page.locator('aside.explorer').getByText('운영 서버'),
    ).toBeVisible()
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
