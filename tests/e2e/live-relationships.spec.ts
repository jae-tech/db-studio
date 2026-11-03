import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { randomInt, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import type { AgentEvent } from '@shared/agent'
import {
  identifier,
  liveFixture,
  liveWriteEnabled,
} from '../helpers/live-mssql'

test('real FK-free tables → saved business relation → official Codex JOIN proposal → SELECT (no metadata doubles)', async () => {
  test.skip(
    !liveWriteEnabled ||
      process.env.AI_DB_TEST_AGENT !== '1' ||
      !process.env.AI_DB_TEST_READ_USER ||
      !process.env.AI_DB_TEST_READ_PASSWORD,
    'Requires dedicated fixture, SELECT-only account and subscription turns',
  )
  test.setTimeout(240000)
  const fixture = await liveFixture()
  const child = `relation_${randomUUID().replaceAll('-', '')}`
  const childTarget = `[dbo].${identifier(child)}`
  const value = randomInt(100000, 999999)
  const rowOnly = `PRIVATE_${randomUUID()}`
  let created = false
  let directory: string | undefined
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    await fixture.setup
      .request()
      .query(
        `CREATE TABLE ${childTarget} (id int NOT NULL PRIMARY KEY, customerId int NOT NULL, serviceMetric int NOT NULL, private_note nvarchar(100) NULL)`,
      )
    created = true
    await fixture.setup
      .request()
      .input('value', value)
      .input('note', rowOnly)
      .query(`INSERT INTO ${childTarget} VALUES (1,1,@value,@note)`)
    directory = await mkdtemp(join(tmpdir(), 'ai-db-live-relations-'))
    app = await electron.launch({
      args: ['.', `--user-data-dir=${directory}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: '' },
    })
    const page = await app.firstWindow()
    await expect(page.getByText('설정 · SQLite')).toBeVisible()
    await page.evaluate(
      async ({ profile, user, password }) => {
        await window.desktop!.db.saveConnection({
          profile: { ...profile, readOnly: true, username: user },
          password,
        })
        await window.desktop!.db.connect({ connectionId: profile.id })
        const settings = await window.desktop!.getSettings()
        settings.tabs[0]!.connectionId = profile.id
        await window.desktop!.saveSettings(settings)
      },
      {
        profile: fixture.profile,
        user: process.env.AI_DB_TEST_READ_USER!,
        password: process.env.AI_DB_TEST_READ_PASSWORD!,
      },
    )
    await page.reload()
    await expect(page.locator('.title-center')).toContainText(
      fixture.profile.database,
    )
    await page.getByRole('button', { name: '가상 관계 설정 열기' }).click()
    const editor = page.getByRole('region', { name: '가상 관계 설정' })
    await editor.getByLabel('업무명', { exact: true }).fill('부가서비스 밴')
    await editor.getByLabel('관계 별칭').fill('VAN')
    await editor
      .getByLabel('기준 테이블', { exact: true })
      .selectOption({ label: `dbo.${fixture.table}` })
    await editor
      .getByLabel('연결 테이블', { exact: true })
      .selectOption({ label: `dbo.${child}` })
    await editor.getByLabel('기준 열 1', { exact: true }).selectOption('id')
    await editor
      .getByLabel('연결 열 1', { exact: true })
      .selectOption('customerId')
    await editor.getByLabel('관계 유형').selectOption('one-to-many')
    await editor.getByRole('button', { name: '관계 검증 후 저장' }).click()
    await expect(editor.getByRole('status')).toContainText(
      '관계를 저장했습니다',
    )
    expect(await page.evaluate(() => window.desktop!.db.getHistory())).toEqual(
      [],
    )
    await page.evaluate(() => {
      const events: AgentEvent[] = []
      Reflect.set(window, 'relationLiveEvents', events)
      window.desktop!.agent.onEvent((event) => events.push(event))
    })
    await page.getByRole('button', { name: 'CLI 상태 확인' }).click()
    await expect(
      page.getByRole('button', { name: 'CLI 상태 확인' }),
    ).toHaveAttribute('title', /ChatGPT 로그인 확인 완료/, { timeout: 35000 })
    const prompt =
      '부가서비스 밴 조회해줘. 등록된 가상 관계를 활용해 기준 테이블의 id와 연결 테이블의 serviceMetric을 JOIN해서 보여주는 SELECT를 만들어줘. ' +
      '전용 로컬 테스트 DB의 메타데이터 수용 테스트야. db_list_tables로 업무 관계를 찾고 db_get_foreign_keys로 양쪽 연결 열을 확인해. ' +
      'SELECT 열은 기준 id AS customerId와 연결 serviceMetric AS observed 두 개만, 조건은 기준 id=1이야. ' +
      '등록된 JOIN 방식을 유지하고 테이블 별칭은 AS를 써. db_propose_sql을 정확히 한 번 호출해. 제안한 SELECT는 앱이 사용자 화면에서 실행하고 행 데이터는 너에게 전달되지 않아.'
    expect(prompt).not.toContain(fixture.table)
    expect(prompt).not.toContain(child)
    await page.getByLabel('AI 메시지', { exact: true }).fill(prompt)
    await page.getByRole('button', { name: '메시지 보내기' }).click()
    const events = () =>
      page.evaluate(
        () => Reflect.get(window, 'relationLiveEvents') as AgentEvent[],
      )
    await expect
      .poll(
        async () => (await events()).filter((e) => e.type === 'done').length,
        { timeout: 130000 },
      )
      .toBe(1)
    const all = await events()
    expect(
      all.find((e) => e.type === 'done'),
      JSON.stringify(all),
    ).toMatchObject({ outcome: 'completed' })
    for (const name of [
      'db_list_tables',
      'db_get_foreign_keys',
      'db_propose_sql',
    ])
      expect(all).toContainEqual(
        expect.objectContaining({ type: 'tool', name, status: 'completed' }),
      )
    const proposal = all.find((e) => e.type === 'proposal')
    if (proposal?.type !== 'proposal') throw new Error('No JOIN proposal')
    expect(proposal.proposal.draft).toBeUndefined()
    expect(proposal.proposal.sql).toContain(fixture.table)
    expect(proposal.proposal.sql).toContain(child)
    expect(proposal.proposal.sql).toMatch(/LEFT\s+(?:OUTER\s+)?JOIN/i)
    expect(JSON.stringify(all)).not.toContain(rowOnly)
    // ADR-028: the JOIN SELECT runs by itself; its rows never go back to the AI.
    await expect(
      page
        .locator('.result-grid-cell')
        .filter({ hasText: new RegExp(`^${value}$`) }),
    ).toBeVisible({ timeout: 30000 })
    expect(JSON.stringify(await events())).not.toContain(String(value))
    const history = await page.evaluate(() => window.desktop!.db.getHistory())
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ status: 'success', rowCount: 1 })
    const fk = await fixture.setup
      .request()
      .query(
        `SELECT COUNT(*) AS count FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.${child}')`,
      )
    expect(fk.recordset[0].count).toBe(0)
  } finally {
    try {
      await app?.close()
    } finally {
      try {
        if (created)
          await fixture.setup.request().query(`DROP TABLE ${childTarget}`)
      } finally {
        await fixture.close()
        if (directory) {
          const target = resolve(directory)
          if (
            target.startsWith(resolve(tmpdir()) + sep) &&
            basename(target).startsWith('ai-db-live-relations-')
          )
            await rm(target, { recursive: true, force: true })
        }
      }
    }
  }
})
