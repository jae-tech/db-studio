import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('dark and light keep independent color combinations after reload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-palettes-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    await mkdir('.omx/theme-palettes', { recursive: true })
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.getByRole('button', { name: '설정 열기', exact: true }).click()
    const view = page.getByRole('region', { name: '설정' })
    const root = page.locator('html')
    const accent = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--accent')
          .trim(),
      )

    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect(root).toHaveAttribute('data-palette', 'emerald')
    await expect(
      view.getByRole('group', { name: '색 조합' }).getByRole('button'),
    ).toHaveCount(4)
    await view.getByRole('button', { name: '오션 색 조합' }).click()
    await expect(root).toHaveAttribute('data-palette', 'ocean')
    await expect.poll(accent).toBe('#75c7f0')
    await expect
      .poll(() =>
        view
          .getByRole('button', { name: '오션 색 조합' })
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe('rgb(18, 33, 49)')
    await page.screenshot({ path: '.omx/theme-palettes/dark-ocean.png' })

    await view.getByLabel('테마', { exact: true }).selectOption('light')
    await expect(root).toHaveAttribute('data-palette', 'emerald')
    await view.getByRole('button', { name: '바이올렛 색 조합' }).click()
    await expect(root).toHaveAttribute('data-palette', 'violet')
    await expect.poll(accent).toBe('#7645a6')
    await expect
      .poll(() =>
        view
          .getByRole('button', { name: '바이올렛 색 조합' })
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe('rgb(243, 238, 251)')
    await page.screenshot({ path: '.omx/theme-palettes/light-violet.png' })

    await page.getByRole('button', { name: '테마 전환' }).click()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect(root).toHaveAttribute('data-palette', 'ocean')
    await expect(
      view.getByRole('button', { name: '오션 색 조합' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.desktop!.getSettings()).themePalettes,
        ),
      )
      .toEqual({ dark: 'ocean', light: 'violet' })

    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect(root).toHaveAttribute('data-palette', 'ocean')
    await page.getByRole('button', { name: 'SQL 작업 공간 열기' }).click()
    await expect
      .poll(() =>
        page
          .locator('.monaco-editor')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe('rgb(18, 32, 45)')
    await page.getByRole('button', { name: '테마 전환' }).click()
    await expect(root).toHaveAttribute('data-palette', 'violet')
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
