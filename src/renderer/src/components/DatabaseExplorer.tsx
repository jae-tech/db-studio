import { tw } from '@/lib/styleClasses'
import { NativeSelect } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { displayMessage } from '../lib/locale'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  Database,
  FolderPlus,
  ChevronsLeft,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
} from 'lucide-react'
import type { ConnectionSummary } from '@shared/database'
import { desktop } from '../lib/desktop'
import { useWorkspace } from '../store'
import { Button } from './ui/button'
import { ConnectionDialog } from './ConnectionDialog'
import type { OpenTable } from './TableView'

export function DatabaseExplorer({
  connections,
  selected,
  onSelect,
  onOpenTable,
  openTable,
}: {
  connections: ConnectionSummary[]
  selected?: string
  onSelect: (id: string) => void
  onOpenTable: (table: OpenTable) => void
  openTable?: OpenTable
}) {
  const client = useQueryClient()
  const { settings, update, notify } = useWorkspace()
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ConnectionSummary | 'new' | null>(null)
  const [filter, setFilter] = useState('')
  const [tableFilter, setTableFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const connection = connections.find((item) => item.id === selected)
  const explorer = useQuery({
    queryKey: ['explorer', selected, connection?.currentDatabase],
    queryFn: () => desktop().db.getExplorer(selected!),
    enabled: connection?.status === 'connected',
    retry: false,
  })
  const query = tableFilter.trim().toLowerCase()
  // `Athena.dbo.x` also matches tables of the connected database Athena.
  const matches = (explorer.data?.tables ?? []).filter((table) =>
    `${explorer.data!.database}.${table.schema}.${table.name}`
      .toLowerCase()
      .includes(query),
  )
  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['connections'] })
    void client.invalidateQueries({ queryKey: ['explorer'] })
    void client.invalidateQueries({ queryKey: ['table'] })
  }
  const action = async (
    id: string,
    task: () => Promise<unknown>,
  ): Promise<void> => {
    setBusy(id)
    setError('')
    try {
      await task()
      notify('연결 상태를 갱신했습니다.')
    } catch (cause) {
      setError(displayMessage(cause))
      notify(displayMessage(cause))
    } finally {
      setBusy(null)
      invalidate()
    }
  }
  const groups = settings.connectionGroups
  const isOpen = (key: string): boolean =>
    !!filter.trim() || !settings.collapsed.includes(key)
  const toggle = (key: string): void =>
    update({
      collapsed: settings.collapsed.includes(key)
        ? settings.collapsed.filter((item) => item !== key)
        : [...settings.collapsed, key].slice(-60),
    })
  const groupOf = (id: string): string =>
    groups.find((group) => group.connectionIds.includes(id))?.id ?? ''
  const moveTo = (id: string, groupId: string): void =>
    update({
      connectionGroups: groups.map((group) => ({
        ...group,
        connectionIds: [
          ...group.connectionIds.filter((item) => item !== id),
          ...(group.id === groupId ? [id] : []),
        ],
      })),
    })
  const addGroup = (): void => {
    const name = (newGroup ?? '').trim().slice(0, 40)
    setNewGroup(null)
    if (!name) return
    if (groups.some((group) => group.name === name))
      return notify(`'${name}' 그룹이 이미 있습니다.`)
    if (groups.length >= 20) return notify('연결 그룹은 최대 20개입니다.')
    update({
      connectionGroups: [
        ...groups,
        { id: crypto.randomUUID(), name, connectionIds: [] },
      ],
    })
  }
  const visible = connections.filter(
    (item) =>
      item.name.toLowerCase().includes(filter.toLowerCase()) ||
      item.id === selected,
  )
  const buckets = [
    ...groups.map((group) => ({
      key: group.id,
      name: group.name,
      group,
      items: visible.filter((item) => group.connectionIds.includes(item.id)),
    })),
    {
      key: 'ungrouped',
      name: '미분류',
      group: undefined,
      items: visible.filter((item) => !groupOf(item.id)),
    },
  ]
  const card = (item: ConnectionSummary) => (
    <div
      className={tw(
        `connection-card ${selected === item.id ? 'selected' : ''}`,
      )}
      key={item.id}
    >
      <button
        className={tw('connection-name')}
        title={`${item.host}:${item.port} · ${item.currentDatabase}`}
        onClick={() => onSelect(item.id)}
      >
        <span
          className={tw(
            `status-dot ${item.status === 'connected' ? '' : 'muted'}`,
          )}
        />
        <span>
          {item.name}
          <small>
            {item.host}:{item.port} · {item.currentDatabase}
          </small>
        </span>
      </button>
      <div className={tw('connection-actions')}>
        <Button
          size="small"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => {
            onSelect(item.id)
            void action(item.id, () =>
              item.status === 'connected'
                ? desktop().db.disconnect(item.id)
                : desktop().db.connect({ connectionId: item.id }),
            )
          }}
        >
          {busy === item.id
            ? '처리 중…'
            : item.status === 'connected'
              ? '연결 해제'
              : '연결'}
        </Button>
        <Button
          size="small"
          variant="ghost"
          disabled={busy !== null || item.status !== 'disconnected'}
          onClick={() => setDialog(item)}
        >
          편집{' '}
        </Button>
        <Button
          size="small"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => setDeleting(item.id)}
        >
          삭제{' '}
        </Button>
        {groups.length > 0 && (
          <NativeSelect
            aria-label={`${item.name} 그룹`}
            value={groupOf(item.id)}
            onChange={(event) => moveTo(item.id, event.target.value)}
          >
            <option value="">미분류</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {deleting === item.id && (
        <div className={tw('delete-confirm')}>
          저장된 연결을 삭제할까요?{' '}
          <Button
            size="small"
            variant="outline"
            onClick={() => {
              setDeleting(null)
              void action(item.id, () => desktop().db.deleteConnection(item.id))
            }}
          >
            삭제 확인{' '}
          </Button>
          <button onClick={() => setDeleting(null)}> 유지 </button>
        </div>
      )}
      {item.warning && (
        <p className={tw('connection-warning')}>
          {displayMessage(item.warning)}
        </p>
      )}
    </div>
  )
  // Section header that folds its body; the state is saved with the other preferences.
  const section = (key: string, label: string, count?: number) => (
    <button
      className={tw('section-label section-toggle')}
      aria-expanded={isOpen(key)}
      onClick={() => toggle(key)}
    >
      {isOpen(key) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      {label}
      {count !== undefined && <span>{count}</span>}
    </button>
  )
  return (
    <aside className={tw('explorer')}>
      <div className={tw('panel-title')}>
        탐색기
        <span className={tw('toolbar-spacer')} />
        <Button
          variant="ghost"
          size="icon"
          aria-label="새 연결"
          onClick={() => setDialog('new')}
        >
          <Plus size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="탐색기 접기"
          title="탐색기 접기"
          onClick={() => update({ explorerCollapsed: true })}
        >
          <ChevronsLeft size={16} />
        </Button>
      </div>
      <div className={tw('explorer-tools')}>
        <Input
          aria-label="연결 필터"
          placeholder="연결 검색…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className={tw('section-row')}>
        {section('section:connections', '연결 목록', connections.length)}
        <Button
          variant="ghost"
          size="icon"
          aria-label="새 연결 그룹"
          title="연결 그룹 추가"
          onClick={() => setNewGroup('')}
        >
          <FolderPlus size={15} />
        </Button>
      </div>
      {newGroup !== null && (
        <Input
          className={tw('group-name-input')}
          aria-label="새 그룹 이름"
          placeholder="그룹 이름 (예: 운영, 개발) · Enter"
          maxLength={40}
          autoFocus
          value={newGroup}
          onChange={(event) => setNewGroup(event.target.value)}
          onBlur={addGroup}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setNewGroup(null)
          }}
        />
      )}
      {!connections.length && (
        <div className={tw('connection-empty')}>
          <Database size={28} />
          <h3> 데이터베이스에 연결해 시작하세요 </h3>
          <p>
            SQL Server 연결을 추가하면 테이블을 탐색하고 검토한 SELECT 쿼리를
            실행할 수 있습니다.{' '}
          </p>
          <Button
            size="small"
            variant="outline"
            onClick={() => setDialog('new')}
          >
            새 연결{' '}
          </Button>
        </div>
      )}
      {isOpen('section:connections') && (
        <div className={tw('connections-list')}>
          {buckets.map(
            (bucket) =>
              (bucket.group || bucket.items.length > 0) && (
                <div className={tw('connection-group')} key={bucket.key}>
                  <div className={tw('connection-group-header')}>
                    <button
                      aria-expanded={isOpen(bucket.key)}
                      aria-label={`${bucket.name} 그룹 ${isOpen(bucket.key) ? '접기' : '펼치기'}`}
                      onClick={() => toggle(bucket.key)}
                    >
                      {isOpen(bucket.key) ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                      {bucket.name} <span>{bucket.items.length}</span>
                    </button>
                    {bucket.group && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`${bucket.name} 그룹 삭제`}
                        title="그룹만 삭제합니다. 연결은 미분류로 옮겨집니다."
                        onClick={() =>
                          update({
                            connectionGroups: groups.filter(
                              (group) => group.id !== bucket.key,
                            ),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                  {isOpen(bucket.key) && bucket.items.map(card)}
                </div>
              ),
          )}
        </div>
      )}
      {error && (
        <div role="alert" className={tw('inline-error')}>
          {error}
        </div>
      )}
      <div className={tw('explorer-divider')} />
      <div className={tw('section-row')}>
        {section('section:objects', '데이터베이스 객체')}
        <Button
          size="icon"
          variant="ghost"
          aria-label="새로고침"
          title="새로고침"
          disabled={connection?.status !== 'connected'}
          onClick={() => {
            void explorer.refetch()
          }}
        >
          <RefreshCw size={13} />
        </Button>
      </div>
      {!isOpen('section:objects') ? null : connection?.status ===
        'connected' ? (
        <div className={tw('database-tree')}>
          {explorer.isPending && <p> 메타데이터 불러오는 중… </p>}
          {explorer.error && (
            <p role="alert">{displayMessage(explorer.error)}</p>
          )}
          {explorer.data && (
            <>
              <label>
                데이터베이스{' '}
                <NativeSelect
                  aria-label="현재 데이터베이스"
                  value={explorer.data.database}
                  disabled={busy !== null}
                  onChange={(event) => {
                    const database = event.target.value
                    void action(connection.id, async () => {
                      await desktop().db.disconnect(connection.id)
                      await desktop().db.connect({
                        connectionId: connection.id,
                        database,
                      })
                    })
                  }}
                >
                  {[
                    ...new Set([
                      explorer.data.database,
                      ...explorer.data.databases,
                    ]),
                  ].map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </NativeSelect>
              </label>
              <Input
                className={tw('table-search')}
                aria-label="테이블 검색"
                placeholder="테이블 검색 (예: dbo.고객, order)…"
                value={tableFilter}
                onChange={(event) => setTableFilter(event.target.value)}
              />
              {tableFilter.trim() && (
                <small className={tw('table-search-count')} role="status">
                  {matches.length}개 테이블
                </small>
              )}
              {explorer.data.schemas.map((schema) => {
                const tables = matches.filter(
                  (table) => table.schema === schema,
                )
                if (!tables.length) return null
                return (
                  <details open key={schema}>
                    <summary>
                      {schema} <span>{tables.length}</span>
                    </summary>
                    {tables.map((table) => {
                      const active =
                        openTable?.connectionId === connection.id &&
                        openTable.database === explorer.data.database &&
                        openTable.schema === table.schema &&
                        openTable.name === table.name
                      return (
                        <button
                          key={`${schema}.${table.name}`}
                          className={tw(
                            `tree-button table-node ${active ? 'selected' : ''}`,
                          )}
                          aria-current={active ? 'true' : undefined}
                          title={`${table.schema}.${table.name}`}
                          onClick={() =>
                            onOpenTable({
                              connectionId: connection.id,
                              database: explorer.data.database,
                              schema: table.schema,
                              name: table.name,
                            })
                          }
                        >
                          <Table2 size={13} />
                          <span>{table.name}</span>
                        </button>
                      )
                    })}
                  </details>
                )
              })}
              {tableFilter.trim() && !matches.length && (
                <p> 일치하는 테이블이 없습니다. </p>
              )}
              {explorer.data.tables.length === 0 && (
                <p>
                  조회 가능한 사용자 테이블이 없습니다. SELECT 및 메타데이터
                  권한을 확인하세요.{' '}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className={tw('object-placeholder')}>
          {' '}
          연결된 데이터베이스 없음{' '}
        </div>
      )}
      {dialog && (
        <ConnectionDialog
          existing={dialog === 'new' ? undefined : dialog}
          onClose={() => setDialog(null)}
          onSaved={invalidate}
        />
      )}
    </aside>
  )
}
