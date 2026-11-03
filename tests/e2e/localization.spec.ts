import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

test('Korean UI, bundled Monaco locale, validation and Unicode SQL preserve fixed IPC behavior', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-korean-ui-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await expect(page.getByText('쿼리 결과를 확인하세요')).toBeVisible()
    await expect(
      page.getByRole('button', { name: '메시지 보내기' }),
    ).toBeDisabled()
    expect(
      (await page.evaluate(() => window.desktop!.getSettings())).writePreview,
    ).toBe(true)
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+a')
    const sql = "SELECT N'한글 테스트' AS label;"
    await page.keyboard.insertText(sql)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop!.getSettings())).tabs[0]
            ?.sql,
      )
      .toBe(sql)
    // The API-only editor does not enable the find contribution. Check its
    // bundled NLS bootstrap without adding unrelated editor features.
    expect(
      await page.evaluate(() =>
        Reflect.get(globalThis, '_VSCODE_NLS_LANGUAGE'),
      ),
    ).toBe('ko')
    expect(
      await page.evaluate(() =>
        (Reflect.get(globalThis, '_VSCODE_NLS_MESSAGES') as string[]).includes(
          '찾기',
        ),
      ),
    ).toBe(true)
    await page
      .getByRole('button', { name: '새 연결', exact: true })
      .first()
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('새 MSSQL 연결')
    await dialog.getByLabel('연결 이름').fill('한글 연결 테스트')
    await dialog.getByLabel('호스트', { exact: true }).fill('invalid;host')
    await dialog
      .getByLabel('데이터베이스', { exact: true })
      .fill('not_connected')
    await dialog.getByLabel('사용자 이름').fill('fixture')
    await dialog
      .getByLabel('비밀번호', { exact: true })
      .fill('localization-test-only')
    await expect(dialog.getByLabel('제한 쓰기 허용')).not.toBeChecked()
    await dialog.getByRole('button', { name: '연결 저장', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('호스트 이름 또는 IP')
    expect(
      await page.evaluate(() => window.desktop!.db.listConnections()),
    ).toEqual([])
    await dialog.getByRole('button', { name: '취소', exact: true }).click()
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('status')).toContainText(
      '연결된 데이터베이스가 없습니다',
    )
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
    await page.screenshot({ path: 'test-results/workspace-korean.png' })
  } finally {
    await app.close()
    const target = resolve(directory)
    if (
      target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith('ai-db-korean-ui-')
    )
      await rm(target, { recursive: true, force: true })
  }
})
