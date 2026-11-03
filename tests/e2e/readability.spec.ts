import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

function contrast(first: string, second: string): number {
  const luminance = (hex: string): number => {
    const digits = hex.replace('#', '')
    const expanded =
      digits.length === 3
        ? [...digits].map((value) => value + value).join('')
        : digits
    const channels = expanded.match(/../g)!.map((value) => {
      const channel = parseInt(value, 16) / 255
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    })
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

test('Korean text stays readable in both themes and at desktop/minimum window sizes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-readability-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    await mkdir('.omx/readability', { recursive: true })
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    for (const theme of ['dark', 'light'] as const) {
      if (theme === 'light')
        await page.getByRole('button', { name: '테마 전환' }).click()
      for (const size of [
        { width: 1500, height: 960 },
        { width: 1500, height: 800 },
        { width: 1080, height: 720 },
      ]) {
        await app.evaluate(
          ({ BrowserWindow }, size) =>
            BrowserWindow.getAllWindows()[0]!.setContentSize(
              size.width,
              size.height,
            ),
          size,
        )
        await expect
          .poll(() => page.evaluate(() => innerWidth))
          .toBe(size.width)
        await page.screenshot({
          path: `.omx/readability/${theme}-${size.width}x${size.height}.png`,
        })
        const metrics = await page.evaluate(() => {
          const root = getComputedStyle(document.documentElement)
          const selectors = [
            '.agent-inspection',
            '.sidebar-note p',
            '.statusbar',
            '.button-small',
            '.bottom-notice',
          ]
          return {
            family: root.fontFamily,
            body: parseFloat(root.fontSize),
            text: selectors.flatMap((selector) =>
              [...document.querySelectorAll(selector)].map((element) => ({
                selector,
                size: parseFloat(getComputedStyle(element).fontSize),
              })),
            ),
            colors: Object.fromEntries(
              ['--sub', '--muted', '--bg', '--panel', '--raised'].map((key) => [
                key,
                root.getPropertyValue(key).trim(),
              ]),
            ),
            width: document.documentElement.scrollWidth,
          }
        })
        expect(metrics.body).toBeGreaterThanOrEqual(14)
        expect(metrics.family).toContain('Noto Sans KR')
        expect(metrics.family.indexOf('Noto Sans KR')).toBeLessThan(
          metrics.family.indexOf('Segoe UI'),
        )
        for (const item of metrics.text)
          expect(item.size, item.selector).toBeGreaterThanOrEqual(12)
        for (const text of ['--sub', '--muted'])
          for (const background of ['--bg', '--panel', '--raised'])
            expect(
              contrast(metrics.colors[text]!, metrics.colors[background]!),
              `${theme}: ${text}/${background}`,
            ).toBeGreaterThanOrEqual(4.5)
        expect(metrics.width).toBeLessThanOrEqual(size.width)
        await page
          .getByRole('button', { name: '메시지 보내기' })
          .scrollIntoViewIfNeeded()
        await expect(
          page.getByRole('button', { name: '메시지 보내기' }),
        ).toBeVisible()
        await page
          .getByRole('button', { name: '새 연결', exact: true })
          .first()
          .click()
        const dialog = page.getByRole('dialog')
        await expect(
          dialog.getByRole('button', { name: '연결 저장' }),
        ).toBeVisible()
        expect(
          await dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true)
        await dialog.getByRole('button', { name: '취소', exact: true }).click()
      }
    }
  } finally {
    await app.close()
    const target = resolve(directory)
    if (
      target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith('ai-db-readability-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
