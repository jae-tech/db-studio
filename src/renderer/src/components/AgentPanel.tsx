import { tw } from '@/lib/styleClasses'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { displayMessage, agentOutcomeLabels, toolLabels } from '../lib/locale'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Bug,
  ChevronsDown,
  ChevronsRight,
  History,
  PanelBottom,
  PanelRight,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react'
import { create } from 'zustand'
import { Markdown } from '../lib/markdown'
import type { AgentProvider } from '@shared/agent'
import { modelOptions, providerNames, useAgentStatus } from '../lib/agentModels'
import { desktop } from '../lib/desktop'
import { useWorkspace } from '../store'
import { Button } from './ui/button'
import type { ConnectionSummary } from '@shared/database'
import type { SqlProposal, ToolName } from '@shared/mcp'
import type { ImportTable } from '@shared/imports'
import { formatSql } from '@shared/sqlFormatting'

type Message = { id: string; role: 'You' | 'Assistant'; text: string }
type Past = {
  id: string
  provider: AgentProvider
  at: number
  messages: Message[]
}
type Updater<T> = T | ((previous: T) => T)
// Chat state outlives the panel so moving it (bottom ↔ right) keeps the conversation.
const useChat = create<{
  messages: Record<AgentProvider, Message[]>
  sessions: Record<AgentProvider, boolean>
}>(() => ({
  messages: { codex: [], copilot: [] },
  sessions: { codex: false, copilot: false },
}))
const setMessages = (next: Updater<Record<AgentProvider, Message[]>>): void =>
  useChat.setState((state) => ({
    messages: typeof next === 'function' ? next(state.messages) : next,
  }))
const setSessions = (next: Updater<Record<AgentProvider, boolean>>): void =>
  useChat.setState((state) => ({
    sessions: typeof next === 'function' ? next(state.sessions) : next,
  }))
// Past conversations stay on this machine only (renderer storage), newest first.
// ponytail: 30 conversations in localStorage; move to SQLite if longer history is needed.
const historyKey = 'ai-db-chat-history'
const loadHistory = (): Past[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(historyKey) ?? '[]')
    return Array.isArray(value) ? (value as Past[]) : []
  } catch {
    return []
  }
}
const archive = (provider: AgentProvider, messages: Message[]): void => {
  if (!messages.some((message) => message.role === 'You')) return
  try {
    const entry = {
      id: crypto.randomUUID(),
      provider,
      at: Date.now(),
      messages,
    }
    localStorage.setItem(
      historyKey,
      JSON.stringify([entry, ...loadHistory()].slice(0, 30)),
    )
  } catch {
    // Storage full or unavailable: the live chat is unaffected.
  }
}
const titleOf = (past: Past): string =>
  past.messages.find((message) => message.role === 'You')?.text.slice(0, 60) ??
  '대화'
function Transcript({ messages }: { messages: Message[] }) {
  return messages.map((message) =>
    message.role === 'You' ? (
      <article
        key={message.id}
        className={tw('chat-user')}
        aria-label="보낸 메시지"
      >
        <p>{message.text}</p>
      </article>
    ) : (
      <article key={message.id} className={tw('chat-ai')} aria-label="AI 답변">
        <Markdown text={message.text} />
      </article>
    ),
  )
}
export function AgentPanel({
  connection,
  importRequest,
  onProposalOpened,
  onProposal,
  onRunSavedQuery,
}: {
  connection?: ConnectionSummary
  importRequest?: { table: ImportTable; nonce: number }
  onProposalOpened?: () => void
  // Runs a SELECT right away or opens a write preview (ADR-028).
  onProposal?: (proposal: SqlProposal) => void
  onRunSavedQuery: (text: string) => Promise<string | undefined>
}) {
  const { settings, hydrated, update, openProposal } = useWorkspace()
  const [proposals, setProposals] = useState<SqlProposal[]>([])
  const provider = settings.provider
  const statusQuery = useAgentStatus()
  const statuses = statusQuery.data ?? []
  const [checking, setChecking] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const messages = useChat((state) => state.messages)
  const sessions = useChat((state) => state.sessions)
  // undefined = live chat, 'list' = past conversations, otherwise one past conversation.
  const [viewing, setViewing] = useState<string>()
  const [past, setPast] = useState<Past[]>([])
  const bottom = settings.agentDock === 'bottom'
  // Closing the app keeps the open conversation in the history.
  useEffect(() => {
    const save = (): void => {
      const { messages } = useChat.getState()
      archive('codex', messages.codex)
      archive('copilot', messages.copilot)
    }
    window.addEventListener('beforeunload', save)
    return () => window.removeEventListener('beforeunload', save)
  }, [])
  const transcript = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = transcript.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, provider, viewing])
  const [usage, setUsage] = useState('')
  const active = useRef<{ id: string; provider: AgentProvider } | undefined>(
    undefined,
  )
  const sending = useRef(false)
  // The event listener is registered once; these refs give it the latest props.
  const scopeRef = useRef(connection)
  scopeRef.current = connection
  const onProposalRef = useRef(onProposal)
  onProposalRef.current = onProposal
  const scopeRevision = useRef(0)
  const status = statuses.find((item) => item.provider === provider)
  const handledImport = useRef<number | undefined>(undefined)
  useEffect(() => {
    scopeRevision.current++
    setProposals([])
    const requestId = active.current?.id
    if (requestId)
      void desktop()
        .agent.cancel({ requestId })
        .catch(() =>
          setError('이전 데이터베이스 범위의 요청을 취소하지 못했습니다.'),
        )
  }, [connection?.id, connection?.currentDatabase, connection?.status])
  useEffect(() => {
    if (!importRequest || handledImport.current === importRequest.nonce) return
    handledImport.current = importRequest.nonce
    if (
      importRequest.table.connectionId !== connection?.id ||
      importRequest.table.database !== connection.currentDatabase ||
      connection.status !== 'connected'
    )
      return
    const table = importRequest.table
    setPrompt(
      `엑셀 임시 테이블 [import].[${table.tableName}]을 활용해서 쿼리를 작성해줘.\n컬럼은 메타데이터 도구로 확인하고 실제 셀 값은 추측하지 마.\n작업 요청: `,
    )
    setProposals([])
    setError(
      '작업 요청을 입력하세요. 임시 테이블 구조는 자동 공유하며 엑셀 행은 전송하지 않습니다.',
    )
  }, [
    importRequest,
    connection?.id,
    connection?.currentDatabase,
    connection?.status,
  ])
  useEffect(
    () =>
      desktop().agent.onEvent((event) => {
        if (
          event.requestId !== active.current?.id ||
          event.provider !== active.current.provider
        )
          return
        if (event.type === 'text' || event.type === 'error') {
          const text =
            event.type === 'text'
              ? event.text
              : `\n${displayMessage(event.message)} (${event.code})`
          setMessages((previous) => {
            const list = [...previous[event.provider]]
            const last = list.at(-1)
            if (last?.id === event.requestId)
              list[list.length - 1] = {
                ...last,
                text: (last.text + text).slice(0, 128_000),
              }
            else
              list.push({
                id: event.requestId,
                role: 'Assistant',
                text: text.slice(0, 128_000),
              })
            return { ...previous, [event.provider]: list.slice(-20) }
          })
        }
        if (event.type === 'usage')
          setUsage(
            `입력 ${event.inputTokens} / 출력 ${event.outputTokens} 토큰`,
          )
        if (event.type === 'tool')
          setUsage(
            `${toolLabels[event.name as ToolName] ?? event.name} · ${event.status === 'started' ? '호출 중' : '완료'}`,
          )
        if (event.type === 'proposal') {
          let proposal = event.proposal
          try {
            proposal = {
              ...proposal,
              sql: formatSql(
                proposal.sql,
                useWorkspace.getState().settings.sqlFormatting,
              ),
            }
          } catch {
            setError(
              'SQL 제안을 정리하지 못해 원문을 표시합니다. 구문을 확인하세요.',
            )
          }
          setProposals((previous) => [...previous, proposal].slice(-5))
          // Same scope guard as the manual button: only the connection/DB the turn was asked on.
          const current = scopeRef.current
          if (
            current?.status === 'connected' &&
            current.id === proposal.connectionId &&
            current.currentDatabase === proposal.database
          )
            onProposalRef.current?.(proposal)
        }
        if (event.type === 'done') {
          setSessions((previous) => ({
            ...previous,
            [event.provider]: event.outcome === 'completed',
          }))
          setUsage(
            (previous) =>
              `${agentOutcomeLabels[event.outcome]}${previous ? ` · ${previous}` : ''}`,
          )
          active.current = undefined
          setBusy(false)
        }
      }),
    [],
  )
  const inspect = async (): Promise<void> => {
    setChecking(true)
    setError('')
    const result = await statusQuery.refetch()
    if (result.error) setError('CLI 상태를 확인하지 못했습니다.')
    setChecking(false)
  }
  // The check is local only (install, version, sign-in; no model call), so it runs by itself at startup.
  useEffect(() => {
    if (!statusQuery.data && !statusQuery.isFetching) void inspect()
  }, [])
  // Provider and model are one choice at the bottom of the chat.
  const chooseModel = async (value: string): Promise<void> => {
    const [next, model] = value.split('|') as [AgentProvider, string]
    if (next !== provider) await changeProvider(next)
    const models = { ...useWorkspace.getState().settings.agentModels }
    if (model) models[next] = model
    else delete models[next]
    update({ agentModels: models })
  }
  // The AI settings view can switch providers too; stop a turn for the old one.
  useEffect(() => {
    const requestId = active.current?.id
    if (requestId && active.current?.provider !== provider)
      void desktop().agent.cancel({ requestId })
  }, [provider])
  const cancel = async (): Promise<void> => {
    const requestId = active.current?.id
    if (requestId) await desktop().agent.cancel({ requestId })
  }
  const changeProvider = async (next: AgentProvider): Promise<void> => {
    try {
      await cancel()
      update({ provider: next })
      setPrompt('')
      setError('')
      setUsage('')
      setProposals([])
    } catch {
      setError('진행 중인 CLI 요청을 중지하지 못했습니다.')
    }
  }
  const send = async (): Promise<void> => {
    if (active.current || sending.current || !prompt.trim()) return
    setViewing(undefined)
    sending.current = true
    setBusy(true)
    setError('')
    const text = prompt.trim()
    const revision = scopeRevision.current
    try {
      const result = await onRunSavedQuery(text)
      if (result !== undefined) {
        const id = crypto.randomUUID()
        setMessages((previous) => ({
          ...previous,
          [provider]: [
            ...previous[provider],
            { id: `local-user-${id}`, role: 'You' as const, text },
            { id: `local-${id}`, role: 'Assistant' as const, text: result },
          ].slice(-20),
        }))
        setPrompt('')
        setUsage('저장 쿼리 · 로컬 실행 · AI 전송 없음')
        return
      }
      if (revision !== scopeRevision.current)
        throw new Error(
          '데이터베이스 범위가 바뀌었습니다. 메시지를 다시 보내세요.',
        )
      // Normally already checked at startup; otherwise check now instead of asking the user.
      const current =
        status ??
        (await statusQuery.refetch()).data?.find(
          (item) => item.provider === provider,
        )
      if (!current?.available) {
        setError(
          current
            ? displayMessage(current.reason)
            : 'CLI 상태를 확인하지 못했습니다.',
        )
        return
      }
      await sendToAgent(text)
    } catch (cause) {
      setError(displayMessage(cause))
    } finally {
      sending.current = false
      if (!active.current) setBusy(false)
    }
  }
  const sendToAgent = async (text: string): Promise<void> => {
    const requestId = crypto.randomUUID()
    active.current = { id: requestId, provider }
    setBusy(true)
    setError('')
    setUsage('')
    setPrompt('')
    setMessages((previous) => ({
      ...previous,
      [provider]: [
        ...previous[provider],
        { id: `user-${requestId}`, role: 'You' as const, text },
      ].slice(-20),
    }))
    try {
      await desktop().agent.start({
        requestId,
        provider,
        prompt: text,
        resume: sessions[provider],
        ...(settings.agentModels[provider]
          ? { model: settings.agentModels[provider] }
          : {}),
        ...(connection?.status === 'connected'
          ? {
              context: {
                connectionId: connection.id,
                shareSchema: true as const,
                sqlFormatting: settings.sqlFormatting,
              },
            }
          : {}),
      })
    } catch {
      if (active.current?.id === requestId) {
        active.current = undefined
        setBusy(false)
      }
      setSessions((previous) => ({ ...previous, [provider]: false }))
      setError('요청이 거부되었습니다. CLI 상태를 확인한 뒤 다시 시도하세요.')
    }
  }
  const analyzeLastError = (): void => {
    void desktop()
      .db.getHistory()
      .then((entries) => {
        const last = entries.find(
          (entry) =>
            entry.connectionId === connection?.id && entry.status === 'error',
        )
        if (!last) {
          setError('선택한 연결에 실패한 쿼리가 없습니다.')
          return
        }
        setPrompt(
          `SQL을 실행하지 말고 이 오류를 분석하세요. 사람이 검토할 수 있도록 제한된 SELECT 수정안을 제안하세요.\nSQL:\n${last.sql.slice(0, 6000)}\n오류:\n${displayMessage(last.message).slice(0, 1000)}`,
        )
        setError(
          '민감한 값이 포함될 수 있으므로 복사된 SQL과 오류를 검토한 뒤 전송하세요.',
        )
      })
      .catch(() => setError('쿼리 오류를 불러오지 못했습니다.'))
  }
  const newConversation = (): void => {
    void desktop()
      .agent.reset(provider)
      .then(() => {
        archive(provider, useChat.getState().messages[provider])
        setMessages((previous) => ({ ...previous, [provider]: [] }))
        setSessions((previous) => ({ ...previous, [provider]: false }))
        setUsage('')
        setProposals([])
      })
      .catch(() => setError('대화를 초기화하지 못했습니다.'))
  }
  const statusText = status
    ? status.available
      ? provider === 'codex'
        ? 'ChatGPT 로그인 확인 완료'
        : 'GitHub Copilot 로그인 확인 완료'
      : displayMessage(status.reason)
    : checking
      ? 'CLI 확인 중…'
      : 'CLI 확인 전'
  return (
    <aside
      className={tw(`agent-panel ${bottom ? 'docked-bottom' : ''}`)}
      hidden={settings.agentCollapsed}
    >
      <div className={tw('panel-title')}>
        <span>
          <span
            className={tw('agent-mark')}
            role="img"
            aria-label="AI 도우미"
            title="AI 도우미"
          >
            <Sparkles size={15} />
          </span>
        </span>
        <span className={tw('agent-tools')}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="새 대화"
            title="새 대화"
            disabled={busy}
            onClick={newConversation}
          >
            <Plus size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="최근 SQL 오류 분석"
            title="최근 SQL 오류 분석 (질문으로 채움, 바로 보내지 않음)"
            disabled={busy || connection?.status !== 'connected'}
            onClick={analyzeLastError}
          >
            <Bug size={15} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="CLI 상태 확인"
            title={`${statusText} · 다시 확인 (설치·로그인만 검사, AI 호출 없음)`}
            disabled={checking || busy}
            onClick={() => {
              void inspect()
            }}
          >
            <RefreshCw
              size={14}
              className={tw(checking ? 'spin' : undefined)}
            />
          </Button>
          <Button
            variant={viewing ? 'outline' : 'ghost'}
            size="icon"
            aria-label="지난 대화"
            title="지난 대화"
            aria-pressed={!!viewing}
            onClick={() => {
              setPast(loadHistory())
              setViewing(viewing ? undefined : 'list')
            }}
          >
            <History size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              bottom ? 'AI 패널 오른쪽에 두기' : 'AI 패널 아래에 두기'
            }
            title={bottom ? '오른쪽에 두기' : '아래에 두기'}
            disabled={busy}
            onClick={() => update({ agentDock: bottom ? 'right' : 'bottom' })}
          >
            {bottom ? <PanelRight size={15} /> : <PanelBottom size={15} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="AI 패널 접기"
            title="AI 패널 접기"
            onClick={() => update({ agentCollapsed: true })}
          >
            {bottom ? <ChevronsDown size={16} /> : <ChevronsRight size={16} />}
          </Button>
        </span>
      </div>
      {/* Only a problem is worth a line; a working sign-in stays in the refresh tooltip. */}
      {status && !status.available && (
        <p role="note" className={tw('agent-status-problem')}>
          {statusText}
        </p>
      )}
      {proposals.length > 0 && (
        <div className={tw('agent-proposals')} aria-label="SQL 제안">
          {proposals.map((proposal) => (
            <article key={proposal.id}>
              <strong>
                {' '}
                {proposal.draft ? 'AI 변경 SQL' : 'AI 조회'} ·{' '}
                {proposal.database}
              </strong>
              <p>{proposal.explanation}</p>
              <pre>{proposal.sql}</pre>
              <Button
                size="small"
                variant="outline"
                disabled={
                  connection?.status !== 'connected' ||
                  connection.id !== proposal.connectionId ||
                  connection.currentDatabase !== proposal.database
                }
                onClick={() => {
                  if (
                    connection?.status === 'connected' &&
                    connection.id === proposal.connectionId &&
                    connection.currentDatabase === proposal.database
                  ) {
                    openProposal(proposal.sql, proposal.connectionId)
                    onProposalOpened?.()
                  }
                }}
              >
                SQL 다시 열기{' '}
              </Button>
            </article>
          ))}
        </div>
      )}
      {viewing === 'list' ? (
        <div className={tw('agent-history')} aria-label="지난 대화 목록">
          {past.length === 0 && <p>지난 대화가 없습니다.</p>}
          {past.map((item) => (
            <div key={item.id} className={tw('agent-history-item')}>
              <button type="button" onClick={() => setViewing(item.id)}>
                <span>{titleOf(item)}</span>
                <small>
                  {new Date(item.at).toLocaleString()} ·{' '}
                  {providerNames[item.provider]}
                </small>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="이 대화 삭제"
                title="삭제"
                onClick={() => {
                  const next = past.filter((entry) => entry.id !== item.id)
                  try {
                    localStorage.setItem(historyKey, JSON.stringify(next))
                  } catch {
                    // Unavailable storage leaves the list as it was.
                  }
                  setPast(next)
                }}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div
          ref={transcript}
          className={tw('agent-transcript')}
          role="log"
          aria-label="AI 대화"
          aria-live="polite"
        >
          {viewing && (
            <Button
              size="small"
              variant="ghost"
              className={tw('agent-back')}
              onClick={() => setViewing('list')}
            >
              <ArrowLeft size={13} /> 목록
            </Button>
          )}
          <Transcript
            messages={
              viewing
                ? (past.find((item) => item.id === viewing)?.messages ?? [])
                : messages[provider]
            }
          />
        </div>
      )}
      <div className={tw('agent-footer')}>
        {error && <p role="alert">{error}</p>}
        {(busy || usage) && (
          <div className={tw('agent-offline')}>
            {busy ? 'CLI 응답을 기다리는 중…' : usage}
          </div>
        )}
        <div className={tw('chat-composer')}>
          <Textarea
            className="min-h-0 border-0 bg-transparent px-1 leading-5 shadow-none [scrollbar-width:none] focus-visible:ring-0"
            disabled={!hydrated || busy}
            aria-label="AI 메시지"
            maxLength={16000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="질문 또는 /조회 저장쿼리이름"
          />
          <div className={tw('composer-bar')}>
            <NativeSelect
              className={tw('model-select')}
              aria-label="AI 모델"
              title="AI와 모델 선택"
              disabled={!hydrated || busy}
              value={`${provider}|${settings.agentModels[provider] ?? ''}`}
              onChange={(event) => {
                void chooseModel(event.target.value)
              }}
            >
              {(['codex', 'copilot'] as const).map((item) => (
                <optgroup key={item} label={providerNames[item]}>
                  <option value={`${item}|`}>
                    {item === 'codex' ? 'Codex' : 'Copilot'} · 기본 모델
                  </option>
                  {modelOptions(
                    statuses.find((entry) => entry.provider === item)?.models,
                    settings.agentModels[item],
                  ).map((model) => (
                    <option key={model} value={`${item}|${model}`}>
                      {item === 'codex' ? 'Codex' : 'Copilot'} · {model}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
            {/* While a reply is streaming the send button becomes the stop button. */}
            {busy ? (
              <Button
                size="icon"
                variant="outline"
                aria-label="응답 중지"
                title="응답 중지"
                disabled={!active.current}
                onClick={() => {
                  void cancel().catch(() => setError('취소하지 못했습니다.'))
                }}
              >
                <Square size={13} fill="currentColor" />
              </Button>
            ) : (
              <Button
                size="icon"
                disabled={!hydrated || !prompt.trim()}
                aria-label="메시지 보내기"
                onClick={() => {
                  void send()
                }}
              >
                <ArrowUp size={16} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
