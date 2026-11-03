import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('AI chat sits under the work area with bubbles, rendered Markdown and past conversations; one settings view holds display options (agent handler double, no AI or DB)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-db-chat-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${directory}`],
    env: { ...process.env, ELECTRON_RENDERER_URL: '' },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await app.evaluate(({ ipcMain }) => {
      // Agent handler doubles only: no CLI is started.
      ipcMain.removeHandler('agent:status')
      ipcMain.handle('agent:status', () => [
        {
          provider: 'codex',
          available: true,
          installed: true,
          auth: 'subscription',
          reason: 'Handler double',
          version: 'fixture',
        },
      ])
      ipcMain.removeHandler('agent:reset')
      ipcMain.handle('agent:reset', () => undefined)
      ipcMain.removeHandler('agent:start')
      ipcMain.handle('agent:start', (event, request) => {
        const send = (payload: object) =>
          event.sender.send('agent:event', {
            requestId: request.requestId,
            provider: 'codex',
            ...payload,
          })
        send({
          type: 'text',
          text: '메타데이터를 확인했습니다.\n\n- 엑셀: `CustID`, `[CAT ID]`\n- **custId 컬럼은 없습니다.**\n\n```sql\nSELECT 1\n```',
        })
        send({ type: 'done', outcome: 'completed' })
      })
    })
    await page.reload()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    // Bottom dock by default: the chat is below the SQL work area, not beside it.
    const panel = page.locator('.agent-panel')
    const box = await panel.boundingBox()
    const editor = await page.locator('.sql-view').boundingBox()
    expect(box!.y).toBeGreaterThan(editor!.y + editor!.height - 2)
    await page.getByLabel('AI 메시지', { exact: true }).fill('custId 연결해줘')
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    const reply = panel.getByRole('article', { name: 'AI 답변' })
    await expect(reply.locator('li')).toHaveCount(2)
    await expect(reply.locator('strong')).toHaveText('custId 컬럼은 없습니다.')
    await expect(reply.locator('code').first()).toHaveText('CustID')
    await expect(reply.locator('pre')).toHaveText('SELECT 1')
    await expect(reply).not.toContainText('**')
    await expect(
      panel.getByRole('article', { name: '보낸 메시지' }),
    ).toHaveText('custId 연결해줘')
    await expect(panel.getByText('AI 도우미', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: '.omx/readability/chat-bottom.png' })
    // 새 대화 keeps the old one under 지난 대화.
    await page.getByRole('button', { name: '새 대화' }).click()
    await expect(panel.getByRole('article')).toHaveCount(0)
    await page.getByRole('button', { name: '지난 대화' }).click()
    await panel.getByRole('button', { name: /custId 연결해줘/ }).click()
    await expect(
      panel.getByRole('article', { name: 'AI 답변' }).locator('li'),
    ).toHaveCount(2)
    // The dock moves to the right without losing anything.
    await page.getByRole('button', { name: '지난 대화' }).click()
    await page.getByRole('button', { name: 'AI 패널 오른쪽에 두기' }).click()
    await expect(
      page.getByRole('separator', { name: 'AI 패널 너비' }),
    ).toBeVisible()
    // One settings view: sizes and the dock persist.
    await page.getByRole('button', { name: '설정 열기', exact: true }).click()
    const view = page.getByRole('region', { name: '설정' })
    await view.getByLabel('AI 패널 위치').selectOption('bottom')
    await view.getByLabel('SQL 편집기 글자 크기').selectOption('16')
    await view.getByLabel('전체 글자 크기').selectOption('110')
    await expect
      .poll(() => page.evaluate(() => devicePixelRatio))
      .toBeGreaterThan(1.05)
    await expect
      .poll(async () => {
        const settings = await page.evaluate(() =>
          window.desktop!.getSettings(),
        )
        return [settings.agentDock, settings.editorFontSize, settings.uiZoom]
      })
      .toEqual(['bottom', 16, 110])
    await page.screenshot({ path: '.omx/readability/settings-view.png' })
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
