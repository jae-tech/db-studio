import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

test('next screen page fetches only missing rows, caches backwards, bounds duplicates and preserves rows after failure/cancel/tab switch (handler doubles)', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ai-db-auto-page-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const connectionId = randomUUID()
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.evaluate(async (id) => {
      const settings = await window.desktop!.getSettings()
      settings.tabs[0]!.connectionId = id
      await window.desktop!.saveSettings(settings)
    }, connectionId)
    await app.evaluate(({ ipcMain }, id) => {
      // Explicit Main-handler doubles: no database or agent is called.
      const state = {
        fetched: 0,
        executed: 0,
        cursor: 0,
        total: 2500,
        batch: 1000,
        fail: false,
        hold: false,
        cancelled: 0,
        used: [] as string[],
      }
      Reflect.set(globalThis, 'autoPagingFixture', state)
      let token: string | undefined
      let rejectPending: ((reason: Error) => void) | undefined
      const set = (name: string, handler: (input: unknown) => unknown) => {
        ipcMain.removeHandler(name)
        ipcMain.handle(name, (_event, input: unknown) => handler(input))
      }
      const result = () => {
        const start = state.cursor
        state.cursor = Math.min(state.total, start + state.batch)
        token = state.cursor < state.total ? crypto.randomUUID() : undefined
        return {
          requestId: crypto.randomUUID(),
          columns: [{ key: 'c0', name: 'id', type: 'int' }],
          rows: Array.from({ length: state.cursor - start }, (_, n) => ({
            c0: start + n + 1,
          })),
          rowCount: state.cursor - start,
          durationMs: 1,
          truncated: !!token,
          continuation: token,
        }
      }
      set('db:connections', () => [
        {
          id,
          name: 'Paging double',
          driver: 'mssql',
          status: 'connected',
          currentDatabase: 'paging_fixture',
          readOnly: true,
          maxRows: 1000,
        },
      ])
      set('db:explorer', () => ({
        database: 'paging_fixture',
        databases: ['paging_fixture'],
        schemas: [],
        tables: [],
      }))
      set('db:review', () => ({
        token: crypto.randomUUID(),
        database: 'paging_fixture',
        sql: 'SELECT id FROM dbo.fixture ORDER BY id',
        expiresAt: Date.now() + 60000,
        maxRows: 1000,
        timeoutSeconds: 10,
      }))
      set('db:execute', () => {
        state.executed++
        state.cursor = 0
        return result()
      })
      set('db:fetch-more', async (input) => {
        const value = (input as { continuation: string }).continuation
        if (value !== token || state.used.includes(value))
          throw new Error('Spent fixture token')
        state.used.push(value)
        state.fetched++
        if (state.hold)
          await new Promise<void>((resolve, reject) => {
            rejectPending = reject
            setTimeout(() => {
              rejectPending = undefined
              resolve()
            }, 600)
          })
        if (state.fail) throw new Error('Deliberate paging failure')
        return result()
      })
      set('db:cancel', () => {
        state.cancelled++
        rejectPending?.(new Error('Deliberate paging cancellation'))
        return true
      })
    }, connectionId)
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    const next = page.getByRole('button', { name: '다음 페이지', exact: true })
    const previous = page.getByRole('button', {
      name: '이전 페이지',
      exact: true,
    })
    const first = page.getByRole('button', { name: '첫 페이지', exact: true })
    const last = page.getByRole('button', {
      name: '마지막 페이지',
      exact: true,
    })
    const pager = page.getByLabel('결과 페이지 이동', { exact: true })
    const stats = () =>
      app.evaluate(
        () =>
          Reflect.get(globalThis, 'autoPagingFixture') as {
            fetched: number
            executed: number
            cancelled: number
            used: string[]
          },
      )
    const cell = (value: number) =>
      page
        .locator('.result-grid-cell')
        .filter({ hasText: new RegExp(`^${value}$`) })
    const run = async () => {
      await page.keyboard.press('Control+Enter')
      await expect(cell(1)).toBeVisible()
    }
    await run()
    await expect(page.getByRole('button', { name: /행 불러오기/ })).toHaveCount(
      0,
    )
    await page.getByRole('button', { name: '설정 열기', exact: true }).click()
    await page
      .getByRole('region', { name: '설정' })
      .getByLabel('페이지당 행 수', { exact: true })
      .selectOption('500')
    await page.getByRole('button', { name: 'SQL 작업 공간 열기' }).click()
    await next.click()
    await expect(cell(501)).toBeVisible()
    expect((await stats()).fetched).toBe(0)
    await expect(last).toBeDisabled() // The full result size is not known yet.
    await app.evaluate(() => {
      Reflect.get(globalThis, 'autoPagingFixture').hold = true
    })
    await next.evaluate((button: HTMLButtonElement) => {
      button.click()
      button.click()
    })
    await expect(next).toBeDisabled()
    await expect(cell(1001)).toBeVisible()
    expect((await stats()).fetched).toBe(1)
    await previous.click()
    await expect(cell(501)).toBeVisible()
    await next.click()
    await expect(cell(1001)).toBeVisible()
    await next.click()
    await expect(cell(1501)).toBeVisible()
    expect((await stats()).fetched).toBe(1)
    await next.click()
    await expect(cell(2001)).toBeVisible()
    await expect(next).toBeDisabled()
    await expect(pager).toContainText('2,500행')
    expect((await stats()).fetched).toBe(2)
    await first.click()
    await expect(cell(1)).toBeVisible()
    await last.click()
    await expect(cell(2001)).toBeVisible()
    expect((await stats()).fetched).toBe(2)

    // A failed one-time continuation is not retried or misrepresented as EOF.
    await run()
    await next.click()
    await app.evaluate(() => {
      Reflect.get(globalThis, 'autoPagingFixture').fail = true
    })
    await next.click()
    await expect(page.getByRole('status')).toContainText(
      'Deliberate paging failure',
    )
    await expect(page.locator('.results-header')).toContainText('조회 중단')
    await expect(next).toBeDisabled()
    await previous.click()
    await expect(cell(1)).toBeVisible()
    expect((await stats()).fetched).toBe(3)

    await app.evaluate(() => {
      Reflect.get(globalThis, 'autoPagingFixture').fail = false
    })
    await run()
    await next.click()
    await next.click()
    await page.getByRole('button', { name: '쿼리 취소', exact: true }).click()
    await expect(next).toBeDisabled()
    await expect(page.locator('.results-header')).toContainText('조회 중단')
    expect((await stats()).cancelled).toBe(1)

    // A late result is cached in its original tab, never shown in a different tab.
    await run()
    await next.click()
    await next.click()
    await page.getByRole('button', { name: '새 SQL 탭', exact: true }).click()
    await expect(page.locator('.results-header .result-count')).toContainText(
      '0',
    )
    await expect
      .poll(async () =>
        page.getByRole('button', { name: '쿼리 취소', exact: true }).count(),
      )
      .toBe(0)
    await expect(cell(1001)).toHaveCount(0)
    await page.getByRole('tab', { name: '쿼리 1', exact: true }).click()
    await expect(cell(1)).toBeVisible()
    await expect(page.locator('.results-header .result-count')).toContainText(
      '2,000',
    )

    // Small server batches are combined to fill the requested screen page.
    await app.evaluate(() => {
      const state = Reflect.get(globalThis, 'autoPagingFixture')
      state.batch = 20
      state.total = 140
      state.hold = false
    })
    await page.getByRole('button', { name: '설정 열기', exact: true }).click()
    await page
      .getByRole('region', { name: '설정' })
      .getByLabel('페이지당 행 수', { exact: true })
      .selectOption('50')
    await page.getByRole('button', { name: 'SQL 작업 공간 열기' }).click()
    await run()
    const before = (await stats()).fetched
    await next.click()
    await expect(cell(51)).toBeVisible()
    expect((await stats()).fetched - before).toBe(4)
    await next.click()
    await expect(cell(101)).toBeVisible()
    await expect(next).toBeDisabled()
    const used = (await stats()).used
    expect(new Set(used).size).toBe(used.length)
  } finally {
    await app.close()
    const target = resolve(profile)
    if (
      target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith('ai-db-auto-page-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
