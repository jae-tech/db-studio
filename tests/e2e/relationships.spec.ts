import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

test('virtual relationship editor validates columns, edits composite keys, persists, scopes and deletes without SQL execution (metadata handler doubles)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-relations-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const connectionId = randomUUID()
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.getByRole('button', { name: '가상 관계 설정 열기' }).click()
    await expect(
      page.getByText('SQL 탭에서 데이터베이스를 연결하세요.'),
    ).toBeVisible()
    await page.evaluate(async (id) => {
      const settings = await window.desktop!.getSettings()
      settings.tabs[0]!.connectionId = id
      await window.desktop!.saveSettings(settings)
    }, connectionId)
    await app.evaluate(({ ipcMain }, id) => {
      const state = { database: 'business', missing: false, reads: 0 }
      Reflect.set(globalThis, 'relationFixture', state)
      const set = (channel: string, handler: (input: unknown) => unknown) => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, input) => handler(input))
      }
      set('db:connections', () => [
        {
          id,
          name: 'Test',
          driver: 'mssql',
          status: 'connected',
          currentDatabase: state.database,
          readOnly: true,
        },
      ])
      set('db:explorer', () => ({
        database: state.database,
        databases: ['business', 'other'],
        schemas: ['dbo'],
        tables: [
          { schema: 'dbo', name: 'Customers' },
          { schema: 'dbo', name: 'Services' },
        ],
      }))
      set('db:describe', () => {
        state.reads++
        return {
          columns: (state.missing ? [] : ['id', 'customerId', 'region']).map(
            (name, index) => ({
              name,
              type: 'int',
              nullable: false,
              ordinal: index + 1,
              primaryKey: name === 'id',
            }),
          ),
          indexes: [],
          foreignKeys: [],
        }
      })
    }, connectionId)
    await page.reload()
    await page.getByRole('button', { name: '가상 관계 설정 열기' }).click()
    const editor = page.getByRole('region', { name: '가상 관계 설정' })
    await editor.getByLabel('업무명', { exact: true }).fill('부가서비스 밴')
    await editor.getByLabel('관계 별칭').fill('VAN, 밴 서비스')
    await editor
      .getByLabel('기준 테이블', { exact: true })
      .selectOption({ label: 'dbo.Customers' })
    await editor
      .getByLabel('연결 테이블', { exact: true })
      .selectOption({ label: 'dbo.Services' })
    await editor.getByLabel('기준 열 1', { exact: true }).selectOption('id')
    await editor
      .getByLabel('연결 열 1', { exact: true })
      .selectOption('customerId')
    await editor
      .getByRole('button', { name: '연결 열 추가', exact: true })
      .click()
    await editor.getByLabel('기준 열 2', { exact: true }).selectOption('region')
    await editor.getByLabel('연결 열 2', { exact: true }).selectOption('region')
    await editor.getByLabel('관계 유형').selectOption('one-to-many')
    await editor.getByLabel('관계 설명').fill('고객의 밴 서비스 조회')
    await editor.getByRole('button', { name: '관계 검증 후 저장' }).click()
    await expect(editor.getByRole('status')).toContainText(
      '관계를 저장했습니다',
    )
    const saved = () =>
      page.evaluate(
        async () => (await window.desktop!.getSettings()).virtualRelationships,
      )
    await expect.poll(saved).toHaveLength(1)
    expect((await saved())[0]).toMatchObject({
      name: '부가서비스 밴',
      aliases: ['VAN', '밴 서비스'],
      columns: [
        { source: 'id', target: 'customerId' },
        { source: 'region', target: 'region' },
      ],
      joinType: 'LEFT',
      cardinality: 'one-to-many',
    })
    await mkdir('.omx/relationships', { recursive: true })
    await page.screenshot({ path: '.omx/relationships/editor-dark.png' })
    await page.setViewportSize({ width: 1080, height: 720 })
    await page.getByRole('button', { name: '테마 전환' }).click()
    await expect(
      editor.getByRole('button', { name: '관계 검증 후 저장' }),
    ).toBeEnabled()
    expect(
      await editor.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: '.omx/relationships/editor-light-minimum.png',
    })
    // Recheck Main metadata at save time, not only stale query UI options.
    await app.evaluate(() => {
      Reflect.get(globalThis, 'relationFixture').missing = true
    })
    await editor.getByLabel('업무명', { exact: true }).fill('잘못된 관계')
    await editor.getByRole('button', { name: '관계 검증 후 저장' }).click()
    await expect(editor.getByRole('status')).toContainText('존재하는 연결 열')
    expect((await saved())[0]!.name).toBe('부가서비스 밴')
    await app.evaluate(() => {
      Reflect.get(globalThis, 'relationFixture').missing = false
    })
    // App acknowledges its existing 350ms preference debounce before reload.
    await page.waitForTimeout(650)
    await page.reload()
    await page.getByRole('button', { name: '가상 관계 설정 열기' }).click()
    await editor
      .getByRole('button', { name: '부가서비스 밴', exact: true })
      .click()
    await expect(editor.getByLabel('기준 열 2', { exact: true })).toHaveValue(
      'region',
    )
    await editor
      .getByRole('button', { name: '연결 열 2 삭제', exact: true })
      .click()
    await editor.getByLabel('JOIN 방식').selectOption('INNER')
    await editor.getByRole('button', { name: '관계 검증 후 저장' }).click()
    await expect.poll(async () => (await saved())[0]!.joinType).toBe('INNER')
    expect((await saved())[0]!.columns).toHaveLength(1)
    await app.evaluate(() => {
      Reflect.get(globalThis, 'relationFixture').database = 'other'
    })
    await expect(editor.locator('.relationship-card')).toHaveCount(0, {
      timeout: 8000,
    })
    expect(await saved()).toHaveLength(1)
    await app.evaluate(() => {
      Reflect.get(globalThis, 'relationFixture').database = 'business'
    })
    await expect(
      editor.getByRole('button', { name: '부가서비스 밴', exact: true }),
    ).toBeVisible({ timeout: 8000 })
    await editor
      .getByRole('button', { name: '부가서비스 밴 관계 삭제' })
      .click()
    await expect.poll(saved).toEqual([])
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
  } finally {
    await app.close()
    const target = resolve(directory)
    if (
      target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith('ai-db-relations-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
