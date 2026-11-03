import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('result grid shows many compact rows, sizes columns to content and exposes full values (handler doubles, no DB)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-grid-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  const connectionId = randomUUID()
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ ipcMain, BrowserWindow }, connectionId) => {
      // Main-handler doubles only: no SQL Server is called.
      const set = (channel: string, handler: () => unknown): void => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
      }
      set('db:connections', () => [
        {
          id: connectionId,
          name: '그리드 대역',
          driver: 'mssql',
          host: 'not-used',
          port: 1,
          database: 'grid_not_live',
          username: 'fixture',
          environment: 'development',
          readOnly: true,
          encrypt: true,
          trustServerCertificate: false,
          timeoutSeconds: 30,
          maxRows: 100,
          hasPassword: false,
          status: 'connected',
          currentDatabase: 'grid_not_live',
          permissionVerified: true,
        },
      ])
      set('db:explorer', () => ({
        database: 'grid_not_live',
        databases: ['grid_not_live'],
        schemas: [],
        tables: [],
      }))
      set('db:review', () => ({
        token: '00000000-0000-4000-8000-000000000001',
        sql: 'SELECT 1',
        database: 'grid_not_live',
        expiresAt: Date.now() + 60000,
        maxRows: 100,
        timeoutSeconds: 30,
      }))
      const names = ['id', 'telno', 'yadmNm', 'addr']
      set('db:execute', () => ({
        requestId: '00000000-0000-4000-8000-000000000002',
        columns: names.map((name, index) => ({
          key: `c${index}`,
          name,
          type: 'nvarchar',
        })),
        rows: Array.from({ length: 100 }, (_, n) => ({
          c0: 4100 + n,
          c1: '051-715-7575',
          c2: `기장제일안과의원 ${n}`,
          c3: '부산광역시 기장군 기장읍 차성로 123, 2층 (대라리)',
        })),
        durationMs: 1,
        truncated: false,
        rowCount: 100,
      }))
      BrowserWindow.getAllWindows()[0]!.setContentSize(1500, 960)
    }, connectionId)
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    // This test covers the right-hand column layout (bottom is the default).
    await page.evaluate(async () => {
      const settings = await window.desktop!.getSettings()
      await window.desktop!.saveSettings({ ...settings, agentDock: 'right' })
    })
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page
      .getByLabel('SQL 연결')
      .selectOption({ label: '그리드 대역 · grid_not_live (연결됨)' })
    await page.keyboard.press('Control+Enter')
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^4100$/ }),
    ).toBeVisible()
    await page.screenshot({ path: '.omx/readability/grid-1500x960.png' })
    const metrics = await page.evaluate(() => {
      const top = document
        .querySelector('.result-grid-host .result-grid-head')!
        .getBoundingClientRect().bottom
      const bottom = document
        .querySelector('.result-pager')!
        .getBoundingClientRect().top
      const visible = new Set(
        [...document.querySelectorAll('.result-grid-host .result-grid-row')]
          .filter((row) => {
            const box = row.getBoundingClientRect()
            return (
              box.height > 0 && box.top >= top - 1 && box.bottom <= bottom + 1
            )
          })
          .map((row) => row.getAttribute('data-row-index')),
      ).size
      const name = [...document.querySelectorAll('.result-grid-cell')].find(
        (cell) => cell.textContent?.startsWith('기장제일안과의원'),
      ) as HTMLElement
      return { visible, nameClipped: name.scrollWidth > name.clientWidth }
    })
    // Before: ~4 rows at this size with 42px rows and a 31% results pane.
    expect(metrics.visible).toBeGreaterThanOrEqual(9)
    expect(metrics.nameClipped).toBe(false)
    // Right-click copies a cell, a whole column, or the column as an IN list.
    // Record what the grid writes instead of touching the real system clipboard.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (value: string) =>
            Reflect.set(globalThis, 'copiedText', value),
        },
      })
    })
    const clipboard = () =>
      page.evaluate(() => String(Reflect.get(globalThis, 'copiedText') ?? ''))
    await page
      .locator('.result-grid-cell')
      .filter({ hasText: /^4100$/ })
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: '셀 값 복사' }).click()
    await expect.poll(clipboard).toBe('4100')
    await page
      .locator('.result-grid-cell')
      .filter({ hasText: /^기장제일안과의원 0$/ })
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: '열 값 복사 (줄바꿈)' }).click()
    await expect
      .poll(async () => (await clipboard()).split('\n').length)
      .toBe(100)
    await page
      .locator('.result-grid-head th')
      .first()
      .click({ button: 'right' })
    await page
      .getByRole('menuitem', { name: '열 값을 IN (...) 목록으로 복사' })
      .click()
    await expect
      .poll(clipboard)
      .toBe(`(${Array.from({ length: 100 }, (_, n) => 4100 + n).join(', ')})`)
    await page
      .locator('.result-grid-cell')
      .filter({ hasText: /^기장제일안과의원 0$/ })
      .click({ button: 'right' })
    await page
      .getByRole('menuitem', { name: '열 값을 IN (...) 목록으로 복사' })
      .click()
    await expect
      .poll(clipboard)
      .toMatch(/^\(N'기장제일안과의원 0', N'기장제일안과의원 1', /)
    const idFilter = page.getByRole('textbox', { name: 'id 필터' })
    await idFilter.fill('4199')
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^4199$/ }),
    ).toBeVisible()
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^4100$/ }),
    ).toHaveCount(0)
    await idFilter.fill('')
    await page.getByRole('button', { name: 'id 정렬' }).click()
    await page.getByRole('button', { name: 'id 정렬' }).click()
    await expect(
      page.locator('.result-grid-cell').filter({ hasText: /^4199$/ }),
    ).toBeVisible()
    const separator = page.locator('.result-grid-resizer').first()
    const column = page.locator('.result-grid-head th').first()
    const beforeWidth = await column.evaluate((element) => element.clientWidth)
    const box = await separator.boundingBox()
    if (!box) throw new Error('결과 열 크기 조절 핸들이 없습니다.')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2)
    await page.mouse.up()
    await expect
      .poll(() => column.evaluate((element) => element.clientWidth))
      .toBeGreaterThan(beforeWidth)
    const draggedWidth = await column.evaluate((element) => element.clientWidth)
    await separator.focus()
    await page.keyboard.press('ArrowRight')
    await expect
      .poll(() => column.evaluate((element) => element.clientWidth))
      .toBeGreaterThan(draggedWidth)
    // The tab bar must not grow a vertical scrollbar (1px tab overflow regression).
    expect(
      await page
        .locator('.tabbar')
        .evaluate((bar) => bar.scrollHeight - bar.clientHeight),
    ).toBe(0)
    // Many tabs in a narrow window: tabs shrink, no scrollbar covers them,
    // the + button stays visible and the new active tab is scrolled into view.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1080, 720),
    )
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1080)
    // Wide results scroll inside the grid instead of stretching the pane.
    const wide = await page
      .locator('.result-grid-scroll')
      .evaluate((element: HTMLElement) => ({
        overflow: element.scrollWidth > element.clientWidth,
        contained:
          element.getBoundingClientRect().width <=
          element.closest('.results-region')!.clientWidth,
      }))
    expect(wide).toEqual({ overflow: true, contained: true })
    const add = page.getByRole('button', { name: '새 SQL 탭' })
    for (let index = 0; index < 11; index += 1) await add.click()
    await expect(page.getByRole('tab')).toHaveCount(12)
    await page.screenshot({ path: '.omx/readability/tabs-1080x720.png' })
    const strip = await page
      .locator('.tab-strip')
      .evaluate((element: HTMLElement) => {
        const box = element.getBoundingClientRect()
        const selected = element
          .querySelector('.sql-tab.selected')!
          .getBoundingClientRect()
        const plus = document
          .querySelector('[aria-label="새 SQL 탭"]')!
          .getBoundingClientRect()
        const tabs = [...element.querySelectorAll('.sql-tab')].map(
          (tab) => tab.getBoundingClientRect().width,
        )
        return {
          scrollbar: element.offsetHeight - element.clientHeight,
          activeVisible:
            selected.left >= box.left - 1 && selected.right <= box.right + 1,
          plusVisible: plus.right <= innerWidth && plus.left >= box.right - 1,
          narrowest: Math.min(...tabs),
          widest: Math.max(...tabs),
        }
      })
    expect(strip.scrollbar).toBe(0)
    expect(strip.activeVisible).toBe(true)
    expect(strip.plusVisible).toBe(true)
    expect(strip.narrowest).toBeGreaterThanOrEqual(119)
    expect(strip.widest).toBeLessThan(180)
    // Tab list shows every tab with an SQL preview and switches the active tab.
    await page.getByRole('button', { name: '탭 목록' }).click()
    const menu = page.getByRole('menu', { name: '열린 SQL 탭' })
    await expect(menu.getByRole('menuitem')).toHaveCount(12)
    await expect(menu.getByRole('menuitem').first()).toContainText(
      'SELECT 1 AS hello;',
    )
    await page.screenshot({ path: '.omx/readability/tab-menu-1080x720.png' })
    await menu.getByRole('menuitem').first().click()
    await expect(menu).toHaveCount(0)
    await expect(page.getByRole('tab').first()).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect
      .poll(() =>
        page.locator('.tab-strip').evaluate((element) => {
          const box = element.getBoundingClientRect()
          const tab = element
            .querySelector('.sql-tab.selected')!
            .getBoundingClientRect()
          return tab.left >= box.left - 1 && tab.right <= box.right + 1
        }),
      )
      .toBe(true)
    await page.getByRole('button', { name: '탭 목록' }).click()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
