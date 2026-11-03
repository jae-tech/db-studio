import { tw } from '@/lib/styleClasses'
import { displayMessage } from './lib/locale'
import { TableView, type OpenTable } from './components/TableView'
import { Splitter } from './components/Splitter'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Database,
  FileCode2,
  FileSpreadsheet,
  Moon,
  ShieldCheck,
  Sun,
  Network,
  Bot,
  FolderTree,
  Sparkles,
  Settings,
} from 'lucide-react'
import { SettingsView } from './components/SettingsView'
import { Button } from './components/ui/button'
import { useWorkspace } from './store'
import { DatabaseExplorer } from './components/DatabaseExplorer'
import { AiSettingsView } from './components/AiSettingsView'
import {
  SqlWorkspace,
  type SqlWorkspaceHandle,
} from './components/SqlWorkspace'
import { desktop } from './lib/desktop'
import { AgentPanel } from './components/AgentPanel'
import { ImportWorkspace } from './components/ImportWorkspace'
import type { ImportTable } from '@shared/imports'
import { formatSql } from '@shared/sqlFormatting'
import { RelationshipWorkspace } from './components/RelationshipWorkspace'
import { themePalettes } from './lib/themePalettes'

const reconnectKey = 'reconnect-connections'

export function App() {
  const { settings, hydrated, hydrate, update, bindConnection, edit, notify } =
    useWorkspace()
  const [saveError, setSaveError] = useState('')
  const [view, setView] = useState<
    'sql' | 'import' | 'table' | 'relationships' | 'ai' | 'settings'
  >('sql')
  const [openTable, setOpenTable] = useState<OpenTable>()
  const [hasOpenedImport, setHasOpenedImport] = useState(false)
  const [importRequest, setImportRequest] = useState<{
    table: ImportTable
    nonce: number
  }>()
  const saved = useRef('')
  const sqlWorkspace = useRef<SqlWorkspaceHandle>(null)
  const api = window.desktop
  const preferences = useQuery({
    queryKey: ['preferences'],
    queryFn: () => desktop().getSettings(),
  })
  const info = useQuery({
    queryKey: ['app-info'],
    queryFn: () => desktop().getInfo(),
  })
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: () => desktop().db.listConnections(),
    refetchInterval: 3000,
  })
  // Startup: reconnect what was open at last exit, then keep the list in sync with the live one.
  // localStorage, not settings: it is written on every change and must not delay window close.
  const [restored, setRestored] = useState(false)
  const restoring = useRef(false)
  useEffect(() => {
    if (!connections.data || restoring.current) return
    restoring.current = true
    let open: { id: string; database: string }[] = []
    try {
      open = JSON.parse(localStorage.getItem(reconnectKey) ?? '[]') as {
        id: string
        database: string
      }[]
    } catch {
      // Unreadable storage only skips the reconnect.
    }
    const pending = open.filter(({ id }) =>
      connections.data.some(
        (item) => item.id === id && item.status === 'disconnected',
      ),
    )
    // Reopen the database last used on each connection, not just its default.
    void Promise.allSettled(
      pending.map(({ id, database }) =>
        desktop().db.connect({ connectionId: id, database }),
      ),
    ).then((results) => {
      const failed = results.filter((result) => result.status === 'rejected')
      if (failed.length)
        notify(
          `이전 연결 ${failed.length}개를 다시 연결하지 못했습니다. 연결 목록에서 직접 연결하세요.`,
        )
      void connections.refetch()
      setRestored(true)
    })
  }, [connections, notify])
  useEffect(() => {
    if (!restored || !connections.data) return
    try {
      localStorage.setItem(
        reconnectKey,
        JSON.stringify(
          connections.data
            .filter((item) => item.status === 'connected')
            .map((item) => ({ id: item.id, database: item.currentDatabase })),
        ),
      )
    } catch {
      // Storage unavailable: the next start simply does not reconnect.
    }
  }, [restored, connections.data])
  useEffect(() => {
    if (preferences.data && !hydrated) {
      saved.current = JSON.stringify(preferences.data)
      hydrate(preferences.data)
    }
  }, [preferences.data, hydrate, hydrated])
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    const palette = settings.themePalettes[settings.theme]
    document.documentElement.dataset.palette = palette
    document.documentElement.className = tw('__root')
    for (const [name, value] of Object.entries(
      themePalettes[settings.theme][palette],
    ))
      document.documentElement.style.setProperty(name, value)
    document.documentElement.style.colorScheme = settings.theme
    document.documentElement.style.setProperty(
      '--font-sans',
      "'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif",
    )
    api?.setZoom(settings.uiZoom)
    if (!hydrated || !api || JSON.stringify(settings) === saved.current) return
    const snapshot = JSON.stringify(settings)
    const timer = setTimeout(() => {
      void api
        .saveSettings(settings)
        .then(() => {
          saved.current = snapshot
          setSaveError('')
        })
        .catch((error: unknown) =>
          setSaveError(`설정을 저장하지 못했습니다: ${displayMessage(error)}`),
        )
    }, 350)
    return () => clearTimeout(timer)
  }, [settings, hydrated, api])
  useEffect(() => {
    // Blocking save so both close and reload keep pending edits and proceed.
    const flushBeforeClose = () => {
      const snapshot = JSON.stringify(settings)
      if (!hydrated || !api || saved.current === snapshot) return
      try {
        api.saveSettingsSync(settings)
        saved.current = snapshot
      } catch {
        // The page is going away; nothing left to show the error on.
      }
    }
    window.addEventListener('beforeunload', flushBeforeClose)
    return () => window.removeEventListener('beforeunload', flushBeforeClose)
  }, [settings, hydrated, api])
  const active = settings.tabs.find((tab) => tab.id === settings.activeTabId)!
  const connection = connections.data?.find(
    (item) => item.id === active.connectionId,
  )
  const width = (selector: string): number =>
    document.querySelector(selector)?.getBoundingClientRect().width ?? 0
  const layout = {
    '--explorer-width': `${settings.explorerWidth}px`,
    '--agent-width': `${settings.agentWidth}px`,
    '--agent-height': `${settings.agentHeight}px`,
  } as CSSProperties
  const agentPanel = (
    <AgentPanel
      connection={connection}
      importRequest={importRequest}
      onProposalOpened={() => setView('sql')}
      onProposal={(proposal) => {
        setView('sql')
        sqlWorkspace.current?.openAiSql(
          proposal.sql,
          proposal.connectionId,
          !!proposal.draft,
        )
      }}
      onRunSavedQuery={(text) => {
        if (!sqlWorkspace.current)
          return Promise.reject(new Error('SQL 작업 공간을 불러오는 중입니다.'))
        return sqlWorkspace.current.runSavedQuery(text)
      }}
    />
  )
  return (
    <div className={tw('app')} style={layout}>
      <header className={tw('titlebar')}>
        <div className={tw('brand')}>
          <span className={tw('brand-mark')}>
            <Database size={19} />
          </span>
          AI DB <strong>Studio</strong>
          <span className={tw('version')}> 미리 보기 </span>
        </div>
        <div className={tw('title-center')}>
          <span
            className={tw(
              `status-dot ${connection?.status === 'connected' ? '' : 'muted'}`,
            )}
          />
          로컬 작업 공간 <span className={tw('slash')}>/</span>
          {view === 'import'
            ? `엑셀 가져오기 · ${connection?.currentDatabase ?? '연결을 선택하세요'}`
            : connection
              ? `${connection.name} · ${connection.currentDatabase}`
              : '연결된 데이터베이스 없음'}
        </div>
        <div className={tw('header-actions')}>
          <span className={tw('local-badge')}>
            <ShieldCheck size={13} />
            로컬 우선{' '}
          </span>
          <Button
            variant={settings.agentCollapsed ? 'ghost' : 'outline'}
            size="small"
            className={tw('ai-toggle')}
            aria-label={
              settings.agentCollapsed ? 'AI 패널 펼치기' : 'AI 패널 접기'
            }
            title={settings.agentCollapsed ? 'AI 패널 펼치기' : 'AI 패널 접기'}
            aria-pressed={!settings.agentCollapsed}
            onClick={() => update({ agentCollapsed: !settings.agentCollapsed })}
          >
            <Sparkles size={14} />
            AI
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="테마 전환"
            onClick={() =>
              update({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
            }
          >
            {settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
        </div>
      </header>
      {(preferences.error || saveError || info.error || connections.error) && (
        <div className={tw('error-banner')} role="alert">
          {saveError ||
            displayMessage(
              preferences.error || info.error || connections.error,
            )}
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              if (saveError && api && hydrated) {
                const snapshot = JSON.stringify(settings)
                void api
                  .saveSettings(settings)
                  .then(() => {
                    saved.current = snapshot
                    setSaveError('')
                  })
                  .catch((error: unknown) =>
                    setSaveError(
                      `설정을 저장하지 못했습니다: ${displayMessage(error)}`,
                    ),
                  )
                return
              }
              void preferences.refetch()
              void info.refetch()
              void connections.refetch()
            }}
          >
            다시 시도{' '}
          </Button>
        </div>
      )}
      <main className={tw('workspace')}>
        <nav className={tw('activitybar')} aria-label="작업 공간 메뉴">
          <button
            className={tw(
              `activity ${settings.explorerCollapsed ? '' : 'active'}`,
            )}
            aria-label={
              settings.explorerCollapsed ? '탐색기 펼치기' : '탐색기 접기'
            }
            title={settings.explorerCollapsed ? '탐색기 펼치기' : '탐색기 접기'}
            aria-pressed={!settings.explorerCollapsed}
            onClick={() =>
              update({ explorerCollapsed: !settings.explorerCollapsed })
            }
          >
            <FolderTree size={20} />
          </button>
          <button
            className={tw(`activity ${view === 'sql' ? 'active' : ''}`)}
            aria-label="SQL 작업 공간 열기"
            aria-pressed={view === 'sql'}
            onClick={() => setView('sql')}
          >
            <Database size={21} />
          </button>
          <button
            className={tw(`activity ${view === 'import' ? 'active' : ''}`)}
            aria-label="엑셀 가져오기"
            title="엑셀 가져오기"
            aria-pressed={view === 'import'}
            onClick={() => {
              setHasOpenedImport(true)
              setView('import')
            }}
          >
            <FileSpreadsheet size={21} />
          </button>
          <span className={tw('activity')} title="SQL 작업 공간">
            <FileCode2 size={21} />
          </span>
          <button
            className={tw(`activity ${view === 'ai' ? 'active' : ''}`)}
            aria-label="AI 설정 열기"
            title="AI 설정"
            aria-pressed={view === 'ai'}
            onClick={() => setView('ai')}
          >
            <Bot size={21} />
          </button>
          <button
            className={tw(
              `activity ${view === 'relationships' ? 'active' : ''}`,
            )}
            aria-label="가상 관계 설정 열기"
            title="가상 관계"
            aria-pressed={view === 'relationships'}
            onClick={() => setView('relationships')}
          >
            <Network size={21} />
          </button>
          <div className={tw('activity-spacer')} />
          <button
            className={tw(`activity ${view === 'settings' ? 'active' : ''}`)}
            aria-label="설정 열기"
            title="설정"
            aria-pressed={view === 'settings'}
            onClick={() => setView('settings')}
          >
            <Settings size={20} />
          </button>
        </nav>
        {!settings.explorerCollapsed && (
          <>
            <DatabaseExplorer
              connections={connections.data ?? []}
              selected={active.connectionId}
              onSelect={bindConnection}
              openTable={view === 'table' ? openTable : undefined}
              onOpenTable={(table) => {
                setOpenTable(table)
                setView('table')
              }}
            />
            <Splitter
              label="탐색기 너비"
              value={settings.explorerWidth}
              min={200}
              max={600}
              current={() => width('.explorer')}
              onChange={(explorerWidth) => update({ explorerWidth })}
            />
          </>
        )}
        <div className={tw('center')}>
          {view === 'table' && openTable && (
            <div className={tw('table-view')}>
              <TableView
                key={`${openTable.connectionId}:${openTable.database}:${openTable.schema}.${openTable.name}`}
                table={openTable}
                connection={(connections.data ?? []).find(
                  (item) =>
                    item.id === openTable.connectionId &&
                    item.status === 'connected' &&
                    item.currentDatabase === openTable.database,
                )}
                onSql={(sql) => {
                  edit(formatSql(sql, settings.sqlFormatting))
                  notify('SELECT를 편집기에 열었습니다. 실행 전에 검토하세요.')
                  setView('sql')
                }}
              />
            </div>
          )}
          <div className={tw('sql-view')} hidden={view !== 'sql'}>
            <SqlWorkspace
              ref={sqlWorkspace}
              connections={connections.data ?? []}
              onSavedQueryOpened={() => setView('sql')}
            />
          </div>
          {view === 'ai' && <AiSettingsView />}
          {view === 'relationships' && (
            <RelationshipWorkspace connection={connection} />
          )}
          {hasOpenedImport && (
            <div className={tw('import-view')} hidden={view !== 'import'}>
              <ImportWorkspace
                connection={connection}
                onUseInAi={(table) =>
                  setImportRequest({ table, nonce: Date.now() })
                }
              />
            </div>
          )}
          {view === 'settings' && <SettingsView />}
          {settings.agentDock === 'bottom' && (
            <>
              {!settings.agentCollapsed && (
                <Splitter
                  label="AI 패널 높이"
                  axis="y"
                  value={settings.agentHeight}
                  min={140}
                  max={900}
                  invert
                  current={() =>
                    document
                      .querySelector('.agent-panel')
                      ?.getBoundingClientRect().height ?? 0
                  }
                  onChange={(agentHeight) => update({ agentHeight })}
                />
              )}
              {agentPanel}
            </>
          )}
        </div>
        {settings.agentDock === 'right' && (
          <>
            {!settings.agentCollapsed && (
              <Splitter
                label="AI 패널 너비"
                value={settings.agentWidth}
                min={280}
                max={800}
                invert
                current={() => width('.agent-panel')}
                onChange={(agentWidth) => update({ agentWidth })}
              />
            )}
            {agentPanel}
          </>
        )}
      </main>
      <footer className={tw('statusbar')}>
        <span>
          <span
            className={tw(
              `status-dot ${connection?.status === 'connected' ? '' : 'muted'}`,
            )}
          />
          {connection?.status === 'connected'
            ? `연결됨 · ${connection.currentDatabase}`
            : '연결 안 됨'}
        </span>
        <span>
          <ShieldCheck size={12} />
          {view === 'import'
            ? '엑셀 임시 테이블 · 업무 테이블 변경 없음'
            : connection?.readOnly === false
              ? '제한 쓰기 · 별도 COMMIT 필요'
              : 'SELECT 전용 · 검증 후 바로 실행'}
        </span>
        <span className={tw('toolbar-spacer')} />
        <span>
          {saveError
            ? '설정 저장 실패'
            : hydrated
              ? '설정 · SQLite'
              : '설정 불러오는 중…'}
        </span>
        <span>UTF-8</span>
        <span>
          {info.data ? `v${info.data.version}` : '데스크톱 미리 보기'}
        </span>
      </footer>
    </div>
  )
}
