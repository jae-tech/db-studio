import { tw } from '@/lib/styleClasses'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import {
  displayMessage,
  connectionStatusLabels,
  historyStatusLabels,
} from '../lib/locale'
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  type Ref,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Editor from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor/editor/editor.api.js'
import { ResultGrid, type ResultGridHandle } from './ResultGrid'
import {
  Clock3,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Download,
  FileCode2,
  List,
  Plus,
  ShieldCheck,
  Square,
  SquareTerminal,
  Table2,
  X,
  WandSparkles,
  Settings2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import {
  resolveSavedQuery,
  type ConnectionSummary,
  type QueryResult,
  type CellValue,
} from '@shared/database'
import { useWorkspace } from '../store'
import { desktop } from '../lib/desktop'
import { Button } from './ui/button'
import { MutationPanel } from './MutationPanel'
import { registerSqlCompletion } from '../lib/sqlCompletion'
import { sqlEditorTheme } from '../lib/themePalettes'
import { Splitter } from './Splitter'
import { savedQueryRequest } from '../lib/savedQueryRequest'
import { dedentSql, formatSql } from '@shared/sqlFormatting'
import { statementAt, statements } from '../lib/statements'
import { SqlFormattingDialog } from './SqlFormattingDialog'
import {
  applyWrite,
  editableKeys,
  updateStatements,
  type RowEdits,
} from '../lib/gridEdit'

// Renderer memory bound for appended pages; each page is still capped by Main.
const maxLoadedRows = 100_000
// First meaningful SQL line, used to tell tabs apart in tooltips and the tab list.
const preview = (sql: string): string =>
  sql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('--'))
    ?.slice(0, 120) ?? '(빈 SQL)'
// Short name for a batch result tab: the first FROM/INTO/UPDATE target, else the statement keyword.
const batchLabel = (sql: string): string => {
  const match =
    /\b(?:FROM|INTO|UPDATE)\s+([\w.[\]"#@]+)/i.exec(sql) ??
    /^\s*(\w+)/.exec(preview(sql))
  return (match?.[1] ?? '').replace(/[[\]"]/g, '')
}
type Running = { requestId: string; tabId: string; connectionId: string }
// First keyword after leading comments decides whether this is a write statement.
const writeStatement = (sql: string): boolean =>
  /^(UPDATE|DELETE|INSERT)\b/i.test(
    sql.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, ''),
  )
type LoadedResult = QueryResult & { pagingError?: string }
export type SqlWorkspaceHandle = {
  runSavedQuery: (text: string) => Promise<string | undefined>
  // AI SQL (ADR-028): SELECT runs as soon as its new tab is shown; writes open the preview.
  openAiSql: (sql: string, connectionId: string, write: boolean) => void
}
export function SqlWorkspace({
  connections,
  ref,
  onSavedQueryOpened,
}: {
  connections: ConnectionSummary[]
  ref?: Ref<SqlWorkspaceHandle>
  onSavedQueryOpened?: () => void
}) {
  const {
    settings,
    hydrated,
    notice,
    update,
    newTab,
    closeTab,
    renameTab,
    openProposal,
    edit,
    bindConnection,
    notify,
  } = useWorkspace()
  const [bottomTab, setBottomTab] = useState<'history' | 'logs'>('logs')
  // History/output stay folded to the tab strip until asked for; the latest notice shows inline.
  const [bottomOpen, setBottomOpen] = useState(false)
  const openBottom = (tab: 'history' | 'logs'): void => {
    setBottomOpen(bottomTab !== tab || !bottomOpen)
    setBottomTab(tab)
  }
  const [results, setResults] = useState<Record<string, LoadedResult>>({})
  const [sources, setSources] = useState<Record<string, string>>({})
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  // 전체 실행: one entry per statement; picking one shows its result in the grid.
  type BatchItem = {
    sql: string
    output?: LoadedResult
    source?: string
    origin?: (typeof origins.current)[string]
  }
  const [batches, setBatches] = useState<
    Record<string, { items: BatchItem[]; selected: number }>
  >({})
  const batching = useRef(false)
  const lastRun = useRef<BatchItem | undefined>(undefined)
  // Ctrl+Enter / 쿼리 실행: the selection, else the statement at the cursor (DBeaver-style).
  const currentSql = (): string | undefined => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const selection = editor?.getSelection()
    if (!editor || !model || !selection) return undefined
    if (!selection.isEmpty()) return model.getValueInRange(selection)
    return statementAt(
      model.getValue(),
      model.getOffsetAt(selection.getPosition()),
    )
  }
  const [running, setRunning] = useState<Running | null>(null)
  const runningRef = useRef<Running | null>(null)
  const cancelled = useRef(false)
  const gridHandle = useRef<ResultGridHandle | null>(null)
  const pendingPage = useRef<number | null>(null)
  const filtered = useRef(false)
  const [pager, setPager] = useState({ page: 0, pages: 0, rows: 0 })
  const pageSize = settings.resultPageSize
  useEffect(() => {
    pendingPage.current = null
    setPager((state) => ({ ...state, page: 0 }))
  }, [pageSize])
  const syncPager = useCallback((rows: number, pages: number): void => {
    setPager((previous) =>
      previous.pages === pages && previous.rows === rows
        ? previous
        : { ...previous, pages, rows },
    )
  }, [])
  const syncFilter = useCallback((value: boolean): void => {
    filtered.current = value
  }, [])
  const client = useQueryClient()
  const history = useQuery({
    queryKey: ['history'],
    queryFn: () => desktop().db.getHistory(),
  })
  const savedQueries = useQuery({
    queryKey: ['saved-queries'],
    queryFn: () => desktop().db.listSavedQueries(),
  })
  const [savedName, setSavedName] = useState('')
  const [formatDialog, setFormatDialog] = useState(false)
  // Saved SQL opens in the current style (e.g. no needless []); unsupported SQL stays as stored.
  const tidy = (sql: string): string => {
    try {
      return formatSql(sql, useWorkspace.getState().settings.sqlFormatting)
    } catch {
      return sql
    }
  }
  const formatCurrent = (): void => {
    try {
      edit(formatSql(active.sql, settings.sqlFormatting))
      notify('SQL을 정리했습니다. 실행하지 않았습니다.')
    } catch (cause) {
      notify(displayMessage(cause))
    }
  }
  // Connection that produced each tab's result, for continuing pages after the tab is rebound.
  const origins = useRef<
    Record<string, { connectionId: string; database: string; sql: string }>
  >({})
  const currentConnections = useRef(connections)
  currentConnections.current = connections
  const stripRef = useRef<HTMLDivElement>(null)
  const [tabMenu, setTabMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  // AI tabs waiting to run (SELECT) or to preview (write) once they are the active tab.
  const pendingRun = useRef(new Set<string>())
  const [pendingPreview, setPendingPreview] = useState<string>()
  // The write statement to preview when the editor holds several statements.
  const [previewSql, setPreviewSql] = useState<Record<string, string>>({})
  // Session-only editor height; undefined keeps the CSS default share.
  const [editorHeight, setEditorHeight] = useState<number>()
  useEffect(() => {
    stripRef.current
      ?.querySelector('.sql-tab.selected')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [settings.activeTabId, settings.tabs.length])
  const active = settings.tabs.find((tab) => tab.id === settings.activeTabId)!
  const connection = connections.find((item) => item.id === active.connectionId)
  const result = results[active.id]
  useEffect(() => {
    pendingPage.current = null
    setPager((state) => ({ ...state, page: 0 }))
  }, [active.id])
  // Grid edits (ADR-037): edited row → column key → original value, until 저장 or 취소.
  const edits = useRef<RowEdits>(new Map())
  const [editCount, setEditCount] = useState(0)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    edits.current = new Map()
    setEditCount(0)
  }, [result])
  const editable =
    result && connection?.status === 'connected' && !connection.readOnly
      ? editableKeys(result)
      : new Set<string>()
  const revertEdits = (): void => {
    for (const [row, cells] of edits.current)
      for (const [key, original] of cells) row[key] = original
    edits.current = new Map()
    setEditCount(0)
    gridHandle.current?.refresh()
  }
  const saveEdits = async (): Promise<void> => {
    if (!result || !connection || saving) return
    setSaving(true)
    let saved = 0
    try {
      gridHandle.current?.stopEditing()
      for (const [row, cells] of [...edits.current]) {
        const [sql] = updateStatements(result, new Map([[row, cells]]))
        const state = await applyWrite(connection.id, sql!)
        if (state.stage !== 'committed')
          throw new Error(
            state.detail ?? `저장이 완료되지 않았습니다(${state.stage}).`,
          )
        edits.current.delete(row)
        saved++
      }
      notify(`${saved}행을 저장했습니다(COMMIT).`)
    } catch (cause) {
      notify(
        `${saved ? `${saved}행 저장 후 ` : ''}중단: ${displayMessage(cause)}`,
      )
    } finally {
      setEditCount(edits.current.size)
      setSaving(false)
      gridHandle.current?.refresh()
    }
  }
  // Read by the shared Monaco completion provider (schema/table/column suggestions).
  const completionSource = useRef<
    { connectionId: string; database: string } | undefined
  >(undefined)
  completionSource.current =
    connection?.status === 'connected'
      ? { connectionId: connection.id, database: connection.currentDatabase }
      : undefined
  const run = useCallback(
    async (sql = active.sql, expectedDatabase?: string): Promise<boolean> => {
      if (runningRef.current) return false
      if (!connection || connection.status !== 'connected') {
        notify(
          '연결된 데이터베이스가 없습니다. 저장된 연결을 선택하고 접속하세요.',
        )
        return false
      }
      // Writes never run directly: with the toggle on they open the read-only change
      // preview, whose 실행 button takes the guarded apply/COMMIT path (ADR-033).
      if (writeStatement(sql)) {
        if (!useWorkspace.getState().settings.writePreview) {
          notify(
            'UPDATE·DELETE·INSERT는 "변경 미리보기"를 켜야 실행할 수 있습니다.',
          )
          return false
        }
        setPreviewSql((state) => ({ ...state, [active.id]: sql }))
        setPendingPreview(active.id)
        notify('바뀔 데이터를 확인한 뒤 실행 또는 취소를 누르세요.')
        return false
      }
      // SELECT runs without a separate approval dialog (ADR-017); Main still
      // parses, binds the one-time token to this session and enforces budgets.
      const request = {
        requestId: crypto.randomUUID(),
        tabId: active.id,
        connectionId: connection.id,
      }
      const connectionName = connection.name
      cancelled.current = false
      pendingPage.current = null
      setPager((state) => ({ ...state, page: 0 }))
      runningRef.current = request
      setRunning(request)
      lastRun.current = undefined
      // A single run replaces any earlier 전체 실행 result tabs of this tab.
      if (!batching.current)
        setBatches((state) => {
          const next = { ...state }
          delete next[request.tabId]
          return next
        })
      setResults((state) => {
        const next = { ...state }
        delete next[request.tabId]
        return next
      })
      try {
        const checked = await desktop().db.reviewQuery({
          connectionId: request.connectionId,
          sql,
        })
        if (expectedDatabase && checked.database !== expectedDatabase)
          throw new Error(
            '데이터베이스가 바뀌었습니다. 저장 쿼리를 다시 호출하세요.',
          )
        notify(
          `${connectionName} / ${checked.database}에서 SELECT를 실행하는 중…`,
        )
        const output = await desktop().db.executeQuery({
          connectionId: request.connectionId,
          requestId: request.requestId,
          approvalToken: checked.token,
        })
        setResults((state) => {
          const next = { ...state, [request.tabId]: output }
          const keys = Object.keys(next)
          while (keys.length > 5) delete next[keys.shift()!]
          return next
        })
        setSources((state) => ({
          ...state,
          [request.tabId]: `${connectionName}/${checked.database}`,
        }))
        origins.current[request.tabId] = {
          connectionId: request.connectionId,
          database: checked.database,
          sql,
        }
        lastRun.current = {
          sql,
          output,
          source: `${connectionName}/${checked.database}`,
          origin: origins.current[request.tabId],
        }
        notify(
          `${output.rowCount}행 · ${output.durationMs} ms${output.truncated ? ' · 결과 상한에 도달해 일부만 표시합니다.' : ''}`,
        )
        return true
      } catch (cause) {
        notify(displayMessage(cause))
        return false
      } finally {
        runningRef.current = null
        setRunning(null)
        setBottomTab('logs')
        void client.invalidateQueries({ queryKey: ['history'] })
        void client.invalidateQueries({ queryKey: ['connections'] })
      }
    },
    [connection, active.id, active.sql, notify, client],
  )
  // 전체 실행 (Alt+X): every statement in order, each with its own result tab.
  // A write stops the batch and opens its change preview, as a single run would.
  const runAll = async (): Promise<void> => {
    const list = statements(active.sql)
    if (!list.length || runningRef.current) return
    if (list.length === 1) {
      await run(list[0])
      return
    }
    const tabId = active.id
    const items: BatchItem[] = []
    batching.current = true
    setBatches((state) => ({ ...state, [tabId]: { items, selected: 0 } }))
    try {
      for (const sql of list) {
        if (writeStatement(sql)) {
          await run(sql)
          break
        }
        const ok = await run(sql)
        items.push(ok && lastRun.current ? lastRun.current : { sql })
        setBatches((state) => ({
          ...state,
          [tabId]: { items: [...items], selected: items.length - 1 },
        }))
        if (cancelled.current || !ok) break
      }
    } finally {
      batching.current = false
    }
  }
  const showBatch = (index: number): void => {
    const batch = batches[active.id]
    const item = batch?.items[index]
    if (!batch || !item) return
    setBatches((state) => ({
      ...state,
      [active.id]: { ...batch, selected: index },
    }))
    setResults((state) => {
      const next = { ...state }
      if (item.output) next[active.id] = item.output
      else delete next[active.id]
      return next
    })
    if (item.source)
      setSources((state) => ({ ...state, [active.id]: item.source! }))
    if (item.origin) origins.current[active.id] = item.origin
  }
  useEffect(() => {
    if (running || !pendingRun.current.has(active.id)) return
    pendingRun.current.delete(active.id)
    void run()
  }, [active.id, running, run])
  useImperativeHandle(ref, () => ({
    openAiSql(sql, connectionId, write) {
      const before = useWorkspace.getState().settings.activeTabId
      openProposal(sql, connectionId, write ? 'AI 변경 · 확인 필요' : 'AI 조회')
      const id = useWorkspace.getState().settings.activeTabId
      if (id === before) return
      if (write) setPendingPreview(id)
      else pendingRun.current.add(id)
    },
    async runSavedQuery(text) {
      const queries = await desktop().db.listSavedQueries()
      const query = savedQueryRequest(
        queries,
        connection?.status === 'connected'
          ? {
              connectionId: connection.id,
              database: connection.currentDatabase,
            }
          : undefined,
        text,
      )
      if (!query) return undefined
      const current = useWorkspace.getState().settings
      const tab = current.tabs.find((item) => item.id === active.id)
      if (
        current.activeTabId !== active.id ||
        tab?.connectionId !== query.connectionId ||
        tab.sql !== active.sql
      )
        throw new Error('작업 탭이 바뀌었습니다. 저장 쿼리를 다시 호출하세요.')
      if (runningRef.current)
        throw new Error('진행 중인 조회가 있습니다. 완료 후 다시 호출하세요.')
      // Main review remains the SELECT-only authority. Writes never reach
      // mutation preview/apply/commit from the chat command.
      const sql = tidy(query.sql)
      edit(sql)
      onSavedQueryOpened?.()
      const success = await run(sql, query.database)
      return success
        ? `저장 쿼리 '${query.name}' 조회 완료 · ${query.database}. 결과는 SQL 작업 공간에 표시했습니다.`
        : `저장 쿼리 '${query.name}'을(를) 실행하지 못했습니다. SQL 작업 공간의 출력을 확인하세요. 쓰기는 미리보기·승인이 필요합니다.`
    },
  }))
  // Saved queries are scoped to the tab's connection and its current database.
  const scope = connection
    ? { connectionId: connection.id, database: connection.currentDatabase }
    : undefined
  const scoped = (savedQueries.data ?? []).filter(
    (query) =>
      query.connectionId === scope?.connectionId &&
      query.database === scope?.database,
  )
  const savedAction = async (
    action: 'run' | 'save' | 'delete',
  ): Promise<void> => {
    try {
      if (!scope)
        throw new Error('저장 쿼리를 쓰려면 이 탭에 연결을 선택하세요.')
      const data = savedQueries.data ?? []
      if (action === 'save') {
        const [name = '', ...aliases] = savedName
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
        await desktop().db.saveQuery({
          ...scope,
          name,
          aliases,
          sql: active.sql,
        })
        notify(`저장 쿼리 '${name}'을(를) 저장했습니다.`)
      } else {
        const query = resolveSavedQuery(data, scope, savedName)
        if (action === 'delete') {
          await desktop().db.deleteSavedQuery(query.id)
          notify(`저장 쿼리 '${query.name}'을(를) 삭제했습니다.`)
        } else {
          const sql = tidy(query.sql)
          edit(sql)
          // Values are never interpolated; the saved SQL runs through the SELECT path.
          if (/^select\b/i.test(sql.replace(/^(\s*--[^\n]*\n)*\s*/, '')))
            await run(sql)
          else
            notify(
              `'${query.name}'을(를) 불러왔습니다. 쓰기 SQL은 미리보기로 검토해 실행하세요.`,
            )
        }
      }
      setSavedName('')
    } catch (cause) {
      notify(displayMessage(cause))
    } finally {
      setBottomTab('logs')
      void client.invalidateQueries({ queryKey: ['saved-queries'] })
    }
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (formatDialog) return
      // Alt+X: 전체 실행 (every statement), as in DBeaver.
      if (event.altKey && !event.ctrlKey && event.code === 'KeyX') {
        event.preventDefault()
        if (hydrated) void runAll()
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        if (hydrated) newTab()
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (hydrated) void run(currentSql())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hydrated, newTab, run, runAll, formatDialog])
  // Appends the next server page to this tab's grid; the token is one-time and session-bound in Main.
  const loadMore = async (page: number): Promise<void> => {
    const tabId = active.id
    const previous = results[tabId]
    const origin = origins.current[tabId]
    if (runningRef.current || !previous?.continuation || !origin) return
    const { connectionId } = origin
    let loaded = previous
    let fetched = false
    cancelled.current = false
    pendingPage.current = null
    try {
      const needed = (page + 1) * pageSize
      const hasFilter = filtered.current
      // Fill only the requested screen page, never drain the whole query.
      // Filters are local to loaded rows; one click fetches one batch under a filter.
      while (loaded.continuation && (!fetched || loaded.rows.length < needed)) {
        const settings = useWorkspace.getState().settings
        if (settings.activeTabId !== tabId || cancelled.current) break
        const tab = settings.tabs.find((item) => item.id === tabId)
        const source = currentConnections.current.find(
          (item) => item.id === connectionId,
        )
        if (
          tab?.connectionId !== connectionId ||
          source?.status !== 'connected' ||
          source.currentDatabase !== origin.database
        )
          throw new Error(
            '결과의 연결 또는 DB가 바뀌었습니다. 쿼리를 다시 실행하세요.',
          )
        const request = { requestId: crypto.randomUUID(), tabId, connectionId }
        runningRef.current = request
        setRunning(request)
        const output = await desktop().db.fetchMore({
          connectionId,
          requestId: request.requestId,
          continuation: loaded.continuation,
        })
        if (JSON.stringify(output.columns) !== JSON.stringify(previous.columns))
          throw new Error('결과 열이 바뀌었습니다. 쿼리를 다시 실행하세요.')
        if (!output.rows.length && output.continuation)
          throw new Error('조회가 진행되지 않았습니다. 쿼리를 다시 실행하세요.')
        const rows = [...loaded.rows, ...output.rows].slice(0, maxLoadedRows)
        loaded = {
          ...output,
          columns: previous.columns,
          source: previous.source,
          rows,
          rowCount: rows.length,
          durationMs: loaded.durationMs + output.durationMs,
          continuation:
            rows.length >= maxLoadedRows ? undefined : output.continuation,
        }
        fetched = true
        if (hasFilter) break
      }
      if (
        !cancelled.current &&
        useWorkspace.getState().settings.activeTabId === tabId
      )
        pendingPage.current = page
      notify(
        loaded.rows.length >= maxLoadedRows
          ? `화면에는 최대 ${maxLoadedRows.toLocaleString()}행까지 불러옵니다.`
          : `${loaded.rowCount - previous.rowCount}행을 더 불러왔습니다 · 총 ${loaded.rowCount}행`,
      )
    } catch (cause) {
      pendingPage.current = null
      const message = `${displayMessage(cause)} 이어서 조회하려면 쿼리를 다시 실행하세요.`
      // Main consumes each continuation before execution. Never retry a spent
      // token after an error/cancellation, but keep already loaded rows usable.
      loaded = { ...loaded, continuation: undefined, pagingError: message }
      notify(message)
    } finally {
      setResults((state) =>
        state[tabId] === previous ? { ...state, [tabId]: loaded } : state,
      )
      runningRef.current = null
      setRunning(null)
      setBottomTab('logs')
      void client.invalidateQueries({ queryKey: ['history'] })
    }
  }
  const nextPage = (): void => {
    if (runningRef.current || !result) return
    const page = pager.page + 1
    const cached =
      page < pager.pages &&
      (filtered.current ||
        (page + 1) * pageSize <= result.rowCount ||
        !result.continuation)
    if (cached) setPager((state) => ({ ...state, page }))
    else if (result.continuation) void loadMore(page)
  }
  // Re-runs the SQL that produced this tab's result and streams every row to a file in Main.
  const exportResult = async (format: 'csv' | 'xlsx'): Promise<void> => {
    const origin = origins.current[active.id]
    if (!origin || runningRef.current) return
    const source = currentConnections.current.find(
      (item) => item.id === origin.connectionId,
    )
    if (
      source?.status !== 'connected' ||
      source.currentDatabase !== origin.database
    ) {
      notify('결과를 만든 연결이 바뀌었습니다. 쿼리를 다시 실행하세요.')
      return
    }
    const request = {
      requestId: crypto.randomUUID(),
      tabId: active.id,
      connectionId: origin.connectionId,
    }
    cancelled.current = false
    runningRef.current = request
    setRunning(request)
    try {
      const checked = await desktop().db.reviewQuery({
        connectionId: request.connectionId,
        sql: origin.sql,
      })
      if (checked.database !== origin.database)
        throw new Error('데이터베이스가 바뀌었습니다. 쿼리를 다시 실행하세요.')
      notify('저장할 위치를 선택하세요. 선택하면 전체 결과를 다시 조회합니다.')
      const saved = await desktop().db.exportQuery({
        connectionId: request.connectionId,
        requestId: request.requestId,
        approvalToken: checked.token,
        format,
      })
      notify(
        saved
          ? `${saved.fileName}에 ${saved.rowCount.toLocaleString()}행을 저장했습니다 · ${saved.durationMs} ms${saved.truncatedCells ? ` · Excel 셀 한도(32,767자)로 ${saved.truncatedCells}개 셀을 잘랐습니다` : ''}`
          : '내보내기를 취소했습니다.',
      )
    } catch (cause) {
      notify(displayMessage(cause))
    } finally {
      runningRef.current = null
      setRunning(null)
      setBottomTab('logs')
      void client.invalidateQueries({ queryKey: ['history'] })
    }
  }
  const cancel = async (): Promise<void> => {
    const request = runningRef.current
    if (!request) return
    cancelled.current = true
    try {
      const accepted = await desktop().db.cancelQuery({
        connectionId: request.connectionId,
        requestId: request.requestId,
      })
      if (accepted) notify('취소를 요청했습니다…')
    } catch (cause) {
      notify(displayMessage(cause))
    }
  }
  useEffect(() => {
    const requested = pendingPage.current
    if (requested === null || !result) return
    if (requested < pager.pages || !result.continuation) {
      setPager((state) => ({
        ...state,
        page: Math.min(requested, Math.max(0, state.pages - 1)),
      }))
      pendingPage.current = null
    }
  }, [result, pager.pages])
  const onGridEdit = (
    row: Record<string, CellValue>,
    key: string,
    oldValue: CellValue,
    newValue: CellValue,
  ): void => {
    row[key] = newValue
    const cells = edits.current.get(row) ?? new Map<string, CellValue>()
    if (!cells.has(key)) cells.set(key, oldValue)
    if (cells.get(key) === newValue) cells.delete(key)
    if (cells.size) edits.current.set(row, cells)
    else edits.current.delete(row)
    setEditCount(edits.current.size)
  }
  return (
    <section className={tw('sql-workspace')} aria-label="SQL 작업 공간">
      <div className={tw('tabbar')}>
        <div
          className={tw('tab-strip')}
          role="tablist"
          aria-label="SQL 탭"
          ref={stripRef}
          onWheel={(event) => {
            // The strip has no visible scrollbar: a vertical wheel scrolls tabs sideways.
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
              event.currentTarget.scrollLeft += event.deltaY
          }}
        >
          {settings.tabs.map((tab) => (
            <div
              className={tw(
                `sql-tab ${active.id === tab.id ? 'selected' : ''}`,
              )}
              key={tab.id}
            >
              {renaming === tab.id ? (
                <Input
                  className={tw('tab-rename')}
                  aria-label="SQL 탭 이름"
                  defaultValue={tab.title}
                  maxLength={80}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => {
                    renameTab(tab.id, event.currentTarget.value)
                    setRenaming(null)
                  }}
                  onKeyDown={(event) => {
                    // Escape restores the old title before the shared blur commit.
                    if (event.key === 'Escape')
                      event.currentTarget.value = tab.title
                    if (event.key === 'Enter' || event.key === 'Escape')
                      event.currentTarget.blur()
                  }}
                />
              ) : (
                <button
                  role="tab"
                  aria-selected={active.id === tab.id}
                  onClick={() => update({ activeTabId: tab.id })}
                  onDoubleClick={() => hydrated && setRenaming(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'F2' && hydrated) setRenaming(tab.id)
                  }}
                >
                  <FileCode2 size={14} />
                  <span
                    className={tw('tab-title')}
                    title={`${tab.title}\n${preview(tab.sql)}\n두 번 클릭 또는 F2: 이름 바꾸기`}
                  >
                    {tab.title}
                  </span>
                  <span className={tw('tab-dot')} />
                </button>
              )}
              <button
                className={tw('tab-close')}
                aria-label={`${tab.title} 닫기`}
                disabled={
                  !hydrated ||
                  settings.tabs.length === 1 ||
                  running?.tabId === tab.id
                }
                onClick={() => {
                  closeTab(tab.id)
                  setResults((state) => {
                    const next = { ...state }
                    delete next[tab.id]
                    return next
                  })
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="새 SQL 탭"
          disabled={!hydrated}
          onClick={newTab}
        >
          <Plus size={17} />
        </Button>
        <div
          className={tw('tab-menu-anchor')}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setTabMenu(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setTabMenu(false)
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="탭 목록"
            aria-expanded={tabMenu}
            onClick={() => setTabMenu((open) => !open)}
          >
            <List size={16} />
          </Button>
          {tabMenu && (
            <div
              className={tw('tab-menu')}
              role="menu"
              aria-label="열린 SQL 탭"
            >
              {settings.tabs.map((tab) => (
                <button
                  key={tab.id}
                  role="menuitem"
                  className={tw(active.id === tab.id ? 'selected' : '')}
                  onClick={() => {
                    update({ activeTabId: tab.id })
                    setTabMenu(false)
                  }}
                >
                  <strong>{tab.title}</strong>
                  <code>{preview(tab.sql)}</code>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={tw('query-toolbar')}>
        {running && (
          <>
            <Button
              size="small"
              variant="outline"
              onClick={() => {
                void cancel()
              }}
            >
              <Square size={12} />
              쿼리 취소{' '}
            </Button>
            <span className={tw('toolbar-divider')} />
          </>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label="SQL 정리"
          title="SQL 정리 (Alt+Shift+F)"
          disabled={!hydrated || !!running}
          onClick={formatCurrent}
        >
          <WandSparkles size={14} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="SQL 포맷 설정"
          title="SQL 포맷 설정"
          disabled={!hydrated}
          onClick={() => setFormatDialog(true)}
        >
          <Settings2 size={15} />
        </Button>
        <label className={tw('connection-select')}>
          <Database size={13} />
          <NativeSelect
            aria-label="SQL 연결"
            value={active.connectionId ?? ''}
            onChange={(event) =>
              bindConnection(event.target.value || undefined)
            }
          >
            <option value=""> 연결 없음 </option>
            {connections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.currentDatabase} (
                {connectionStatusLabels[item.status]})
              </option>
            ))}
          </NativeSelect>
        </label>
        <span className={tw('toolbar-spacer')} />
        <span className={tw('readonly')}>
          <ShieldCheck size={12} />
          {connection?.readOnly === false ? '제한 쓰기' : '읽기 전용'}
        </span>
      </div>
      {formatDialog && (
        <SqlFormattingDialog onClose={() => setFormatDialog(false)} />
      )}
      <form
        className={tw('saved-queries')}
        aria-label="저장 쿼리"
        onSubmit={(event) => {
          event.preventDefault()
          void savedAction('run')
        }}
      >
        <Input
          aria-label="저장 쿼리 이름 또는 별칭"
          list="saved-query-names"
          placeholder={`저장 쿼리 이름 · 별칭은 쉼표로 구분 (${scoped.length}개)`}
          value={savedName}
          maxLength={600}
          onChange={(event) => setSavedName(event.target.value)}
        />
        <datalist id="saved-query-names">
          {scoped.flatMap((query) =>
            [query.name, ...query.aliases].map((label) => (
              <option key={`${query.id}:${label}`} value={label} />
            )),
          )}
        </datalist>
        <Button
          type="submit"
          size="small"
          variant="outline"
          aria-label="저장 쿼리 실행"
          disabled={!hydrated || !!running || !savedName.trim()}
        >
          실행
        </Button>
        <Button
          type="button"
          size="small"
          variant="ghost"
          aria-label="현재 SQL 저장"
          disabled={!hydrated || !savedName.trim()}
          onClick={() => {
            void savedAction('save')
          }}
        >
          저장
        </Button>
        <Button
          type="button"
          size="small"
          variant="ghost"
          aria-label="저장 쿼리 삭제"
          disabled={!hydrated || !savedName.trim()}
          onClick={() => {
            void savedAction('delete')
          }}
        >
          삭제
        </Button>
      </form>
      <MutationPanel
        connection={connection}
        sql={
          previewSql[active.id] && active.sql.includes(previewSql[active.id]!)
            ? previewSql[active.id]!
            : active.sql
        }
        autoPreview={pendingPreview === active.id}
        onAutoPreview={() => setPendingPreview(undefined)}
      />
      <div
        className={tw('editor-region')}
        style={editorHeight ? { height: editorHeight } : undefined}
      >
        <Editor
          key={active.id}
          language="sql"
          onMount={(editor, monaco) => {
            editorRef.current = editor
            editor.onDidDispose(() => {
              if (editorRef.current === editor) editorRef.current = null
            })
            editor.addAction({
              id: 'studio.formatSql',
              label: 'SQL 정리',
              keybindings: [
                monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
              ],
              run: () => {
                const model = editor.getModel()
                if (!model) return
                try {
                  const text = formatSql(
                    model.getValue(),
                    useWorkspace.getState().settings.sqlFormatting,
                  )
                  editor.pushUndoStop()
                  editor.executeEdits('studio.formatSql', [
                    { range: model.getFullModelRange(), text },
                  ])
                  editor.pushUndoStop()
                  useWorkspace
                    .getState()
                    .notify('SQL을 정리했습니다. 실행하지 않았습니다.')
                } catch (cause) {
                  useWorkspace.getState().notify(displayMessage(cause))
                }
              },
            })
            const formatter =
              monaco.languages.registerDocumentFormattingEditProvider('sql', {
                provideDocumentFormattingEdits: (
                  model: MonacoEditor.ITextModel,
                ) => {
                  try {
                    return [
                      {
                        range: model.getFullModelRange(),
                        text: formatSql(
                          model.getValue(),
                          useWorkspace.getState().settings.sqlFormatting,
                        ),
                      },
                    ]
                  } catch (cause) {
                    useWorkspace.getState().notify(displayMessage(cause))
                    return []
                  }
                },
              })
            editor.onDidDispose(() => formatter.dispose())
            // Without a connection only keywords can be suggested; say why.
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
              () => {
                if (!completionSource.current)
                  useWorkspace
                    .getState()
                    .notify(
                      'DB가 연결되지 않아 테이블·열 자동완성을 할 수 없습니다. 먼저 DB를 연결하세요.',
                    )
                editor.trigger('keyboard', 'editor.action.triggerSuggest', {})
              },
            )
            // Code copied from mid-line keeps the source file's indent on every
            // line but the first; drop it so the pasted SQL keeps its shape.
            editor.onDidPaste(({ range }) => {
              const model = editor.getModel()
              if (!model || range.startLineNumber === range.endLineNumber)
                return
              const text = model.getValueInRange(
                range,
                monaco.editor.EndOfLinePreference.LF,
              )
              const fixed = dedentSql(text)
              if (fixed !== text)
                editor.executeEdits('studio.pasteDedent', [
                  { range, text: fixed },
                ])
            })
          }}
          theme={sqlEditorTheme(
            settings.theme,
            settings.themePalettes[settings.theme],
          )}
          value={active.sql}
          onChange={(value) => edit(value ?? '')}
          beforeMount={(monaco) =>
            registerSqlCompletion(
              monaco,
              () => completionSource.current,
              client,
            )
          }
          loading={
            <div className={tw('editor-loading')}>
              {' '}
              SQL 편집기 불러오는 중…{' '}
            </div>
          }
          options={{
            readOnly: !hydrated,
            automaticLayout: true,
            // Suggestions/hover render above the page so a short editor never clips them.
            fixedOverflowWidgets: true,
            minimap: { enabled: false },
            fontSize: settings.editorFontSize,
            fontFamily: 'Cascadia Code, Consolas, "Noto Sans KR", monospace',
            lineHeight: Math.round(settings.editorFontSize * 1.7),
            padding: { top: 22 },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            renderLineHighlight: 'line',
            ariaLabel: 'SQL 편집기',
          }}
        />
      </div>
      <Splitter
        label="편집기 높이"
        axis="y"
        value={editorHeight ?? 0}
        min={96}
        max={1200}
        current={() =>
          document.querySelector('.editor-region')?.getBoundingClientRect()
            .height ?? 0
        }
        onChange={setEditorHeight}
      />
      <section className={tw('results-region')} aria-label="쿼리 결과">
        <div className={tw('results-header')}>
          <span className={tw('results-active')}>
            <Table2 size={14} />
            결과{' '}
          </span>
          {batches[active.id] && (
            <span
              className={tw('result-batch')}
              role="tablist"
              aria-label="전체 실행 결과"
            >
              {batches[active.id]!.items.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={batches[active.id]!.selected === index}
                  title={item.sql}
                  aria-label={`결과 ${index + 1}`}
                  className={tw(item.output ? undefined : 'failed')}
                  onClick={() => showBatch(index)}
                >
                  <b>{index + 1}</b>
                  {batchLabel(item.sql)}
                  {item.output && (
                    <small>{item.output.rowCount.toLocaleString()}행</small>
                  )}
                </button>
              ))}
            </span>
          )}
          {/* Batch tabs already show each result's row count. */}
          {!batches[active.id] && (
            <span className={tw('result-count')}>
              {(result?.rowCount ?? 0).toLocaleString()} 행{' '}
            </span>
          )}
          {result?.pagingError && (
            <small className={tw('result-hint')}>
              이어서 조회 중단 · 쿼리를 다시 실행하세요
            </small>
          )}
          {result?.truncated && !result.continuation && !result.pagingError && (
            <small className={tw('result-hint')}>
              {result.rowCount >= maxLoadedRows
                ? '화면 최대 행 수에 도달했습니다'
                : 'ORDER BY를 추가하면 이어서 불러올 수 있습니다'}
            </small>
          )}
          <span className={tw('toolbar-spacer')} />
          {editCount > 0 && (
            <>
              <span className={tw('result-edits')}>변경 {editCount}행</span>
              <Button
                size="small"
                aria-label="편집 저장"
                disabled={saving || !!running}
                onClick={() => {
                  void saveEdits()
                }}
              >
                저장
              </Button>
              <Button
                size="small"
                variant="ghost"
                aria-label="편집 취소"
                disabled={saving}
                onClick={revertEdits}
              >
                취소
              </Button>
            </>
          )}
          {result && (
            <>
              <Button
                size="small"
                variant="ghost"
                aria-label="결과 전체 CSV로 내보내기"
                title="결과 전체를 CSV(UTF-8)로 저장합니다. 쿼리를 다시 실행합니다."
                disabled={!hydrated || !!running}
                onClick={() => {
                  void exportResult('csv')
                }}
              >
                <Download size={13} />
                CSV
              </Button>
              <Button
                size="small"
                variant="ghost"
                aria-label="결과 전체 XLSX로 내보내기"
                title="결과 전체를 Excel 통합 문서로 저장합니다. 쿼리를 다시 실행합니다."
                disabled={!hydrated || !!running}
                onClick={() => {
                  void exportResult('xlsx')
                }}
              >
                <Download size={13} />
                XLSX
              </Button>
            </>
          )}
          <span>
            {result
              ? `${sources[active.id] ?? ''} · ${result.durationMs} ms${result.truncated ? ' · 일부 결과' : ''}`
              : running?.tabId === active.id
                ? '실행 중…'
                : ''}
          </span>
        </div>
        <div className={tw('result-grid-host')}>
          <ResultGrid
            key={`${active.id}:${result ? 'result' : 'empty'}`}
            handle={gridHandle}
            columns={result?.columns}
            rows={result?.rows}
            page={pager.page}
            pageSize={pageSize}
            fontSize={settings.gridFontSize}
            editable={editable}
            isEdited={(row, key) => !!edits.current.get(row)?.has(key)}
            onEdit={onGridEdit}
            onStats={syncPager}
            onFilterChange={syncFilter}
            onPageReset={() => setPager((state) => ({ ...state, page: 0 }))}
            onNotice={notify}
          />
        </div>
        {result && (
          <nav
            className={tw('result-pager')}
            aria-label="결과 페이지 이동"
            aria-busy={!!running}
          >
            <span aria-live="polite">
              {running?.tabId === active.id
                ? '페이지 조회 중…'
                : `${pager.rows ? pager.page * pageSize + 1 : 0}–${Math.min((pager.page + 1) * pageSize, pager.rows)} / ${pager.rows.toLocaleString()}행${result.continuation ? '+' : ''}`}
            </span>
            <span className={tw('toolbar-spacer')} />
            <Button
              size="icon"
              variant="ghost"
              aria-label="첫 페이지"
              disabled={!!running || pager.page === 0}
              onClick={() => setPager((state) => ({ ...state, page: 0 }))}
            >
              <ChevronsLeft size={16} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="이전 페이지"
              disabled={!!running || pager.page === 0}
              onClick={() =>
                setPager((state) => ({
                  ...state,
                  page: Math.max(0, state.page - 1),
                }))
              }
            >
              <ChevronLeft size={16} />
            </Button>
            <span aria-label="현재 페이지">
              {pager.rows ? pager.page + 1 : 0} / {pager.pages}
              {result.continuation ? '+' : ''}
            </span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="다음 페이지"
              disabled={
                !!running ||
                (pager.page + 1 >= pager.pages && !result.continuation)
              }
              onClick={nextPage}
            >
              <ChevronRight size={16} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="마지막 페이지"
              title={
                result.continuation
                  ? '전체 행 수는 아직 확인되지 않았습니다'
                  : '마지막 페이지'
              }
              disabled={
                !!running ||
                !!result.continuation ||
                pager.page + 1 >= pager.pages
              }
              onClick={() =>
                setPager((state) => ({
                  ...state,
                  page: Math.max(0, state.pages - 1),
                }))
              }
            >
              <ChevronsRight size={16} />
            </Button>
          </nav>
        )}
      </section>
      <section className={tw(`bottom-panel${bottomOpen ? ' open' : ''}`)}>
        <div className={tw('bottom-tabs')}>
          <button
            className={tw(
              bottomOpen && bottomTab === 'history' ? 'active' : '',
            )}
            aria-expanded={bottomOpen && bottomTab === 'history'}
            onClick={() => openBottom('history')}
          >
            <Clock3 size={13} />
            실행 이력 <span>{history.data?.length ?? 0}</span>
          </button>
          <button
            className={tw(bottomOpen && bottomTab === 'logs' ? 'active' : '')}
            aria-expanded={bottomOpen && bottomTab === 'logs'}
            onClick={() => openBottom('logs')}
          >
            <SquareTerminal size={13} />
            출력{' '}
          </button>
          {bottomOpen ? (
            <span className={tw('toolbar-spacer')} />
          ) : (
            <small
              className={tw('bottom-notice')}
              role="status"
              title={displayMessage(notice)}
            >
              {displayMessage(notice)}
            </small>
          )}
          <Button
            size="icon"
            variant="ghost"
            aria-label={
              bottomOpen
                ? '하단 이력·출력 패널 접기'
                : '하단 이력·출력 패널 펼치기'
            }
            onClick={() => setBottomOpen(!bottomOpen)}
          >
            {bottomOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </Button>
        </div>
        {!bottomOpen ? null : bottomTab === 'logs' ? (
          <div className={tw('output-line')} role="status">
            <span className={tw('log-level')}> 정보 </span>
            {displayMessage(notice)}
          </div>
        ) : (
          <div className={tw('history-list')}>
            {history.error && (
              <p role="alert">{displayMessage(history.error)}</p>
            )}
            {history.data?.length === 0 && (
              <p> 아직 실행한 쿼리가 없습니다. </p>
            )}
            {history.data?.map((entry) => (
              <div
                key={entry.id}
                className={tw(`history-entry ${entry.status}`)}
              >
                <span>
                  {historyStatusLabels[entry.status]} · {entry.connectionName}/
                  {entry.database} · {entry.rowCount}행 · {entry.durationMs} ms
                </span>
                <code title={entry.sql}>{entry.sql.slice(0, 120)}</code>
                <small>{displayMessage(entry.message)}</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
