import { tw } from '@/lib/styleClasses'
import { NativeSelect } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  ConnectionSummary,
  TableDetails,
  TableInfo,
} from '@shared/database'
import {
  scopedRelationships,
  virtualRelationshipsSchema,
  virtualRelationshipSchema,
  type VirtualRelationship,
} from '@shared/relationships'
import { useWorkspace } from '../store'
import { desktop } from '../lib/desktop'
import { displayMessage } from '../lib/locale'
import { Button } from './ui/button'

export function RelationshipWorkspace({
  connection,
}: {
  connection?: ConnectionSummary
}) {
  if (!connection || connection.status !== 'connected')
    return (
      <section className={tw('relationship-workspace')}>
        <h2>가상 관계</h2>
        <p>SQL 탭에서 데이터베이스를 연결하세요.</p>
      </section>
    )
  return (
    <RelationshipEditor
      key={`${connection.id}:${connection.currentDatabase}`}
      connection={connection}
    />
  )
}

type Endpoint = VirtualRelationship['source']
// With `fixedSource` (table detail view) the clicked table is always the base table.
export function RelationshipEditor({
  connection,
  fixedSource,
}: {
  connection: ConnectionSummary
  fixedSource?: Endpoint
}) {
  const { settings, update } = useWorkspace()
  const blank = (): VirtualRelationship => ({
    id: crypto.randomUUID(),
    connectionId: connection.id,
    database: connection.currentDatabase,
    name: '',
    aliases: [],
    description: '',
    source: fixedSource ?? { schema: '', table: '' },
    target: { schema: '', table: '' },
    columns: [{ source: '', target: '' }],
    joinType: 'LEFT',
    cardinality: 'many-to-one',
  })
  const [draft, setDraft] = useState(blank)
  const [aliases, setAliases] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const patch = (value: Partial<VirtualRelationship>) =>
    setDraft((old) => ({ ...old, ...value }))
  const same = (a: Endpoint, b: Endpoint) =>
    a.schema === b.schema && a.table === b.table
  const relations = scopedRelationships(
    settings.virtualRelationships,
    connection.id,
    connection.currentDatabase,
  ).filter(
    (r) =>
      !fixedSource ||
      same(r.source, fixedSource) ||
      same(r.target, fixedSource),
  )
  const explorer = useQuery({
    queryKey: [
      'relationship-tables',
      connection.id,
      connection.currentDatabase,
    ],
    queryFn: () => desktop().db.getExplorer(connection.id),
  })
  const details = (side: 'source' | 'target') => ({
    queryKey: [
      'relationship-columns',
      connection.id,
      connection.currentDatabase,
      draft[side].schema,
      draft[side].table,
    ],
    queryFn: () =>
      desktop().db.describeTable({
        connectionId: connection.id,
        schema: draft[side].schema,
        table: draft[side].table,
      }),
    enabled: !!draft[side].table,
  })
  const source = useQuery(details('source'))
  const target = useQuery(details('target'))
  // Pre-fill the first pair with a same-named column, preferring the target's PK.
  useEffect(() => {
    if (!source.data || !target.data) return
    if (draft.columns.some((pair) => pair.source || pair.target)) return
    const keys = target.data.columns.filter((column) => column.primaryKey)
    for (const candidate of [...keys, ...target.data.columns]) {
      const match = source.data.columns.find(
        (column) => column.name.toLowerCase() === candidate.name.toLowerCase(),
      )
      if (match) {
        patch({ columns: [{ source: match.name, target: candidate.name }] })
        return
      }
    }
    // Only a newly loaded table pair should trigger the suggestion.
  }, [source.data, target.data])
  const checkScope = async () => {
    const current = (await desktop().db.listConnections()).find(
      (c) => c.id === connection.id,
    )
    if (
      current?.status !== 'connected' ||
      current.currentDatabase !== connection.currentDatabase
    )
      throw new Error('연결 또는 DB가 변경되었습니다. 관계 화면을 다시 여세요.')
  }
  const persist = async (next: VirtualRelationship[]) => {
    virtualRelationshipsSchema.parse(next)
    await desktop().saveSettings({
      ...useWorkspace.getState().settings,
      virtualRelationships: next,
    })
    update({ virtualRelationships: next })
  }
  const save = async () => {
    setBusy(true)
    setMessage('')
    try {
      const value = virtualRelationshipSchema.parse({
        ...draft,
        // A blank business name falls back to the linked table's name.
        name: draft.name.trim() || draft.target.table.slice(0, 64),
        aliases: aliases
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      })
      await checkScope()
      const tables = await desktop().db.getExplorer(connection.id)
      if (tables.database !== connection.currentDatabase)
        throw new Error('DB가 변경되었습니다.')
      for (const side of ['source', 'target'] as const) {
        const endpoint = value[side]
        if (
          !tables.tables.some(
            (t) => t.schema === endpoint.schema && t.name === endpoint.table,
          )
        )
          throw new Error('존재하는 테이블을 선택하세요.')
        const info = await desktop().db.describeTable({
          connectionId: connection.id,
          ...endpoint,
          table: endpoint.table,
        })
        if (
          !value.columns.every((c) =>
            info.columns.some((column) => column.name === c[side]),
          )
        )
          throw new Error('존재하는 연결 열을 선택하세요.')
      }
      await checkScope()
      const latest = useWorkspace.getState().settings.virtualRelationships
      await persist([...latest.filter((r) => r.id !== value.id), value])
      setMessage('관계를 저장했습니다. 다음 AI 질문부터 활용합니다.')
    } catch (error) {
      setMessage(displayMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    setBusy(true)
    try {
      await persist(
        useWorkspace
          .getState()
          .settings.virtualRelationships.filter((r) => r.id !== id),
      )
      if (draft.id === id) {
        setDraft(blank())
        setAliases('')
      }
      setMessage('관계를 삭제했습니다. DB의 실제 FK는 변경하지 않았습니다.')
    } catch (error) {
      setMessage(displayMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const tableSelect = (side: 'source' | 'target', label: string) => (
    <label>
      {label}
      <NativeSelect
        aria-label={label}
        value={JSON.stringify(draft[side])}
        onChange={(e) => {
          const selected = JSON.parse(e.target.value) as {
            schema: string
            table: string
          }
          // A new table invalidates every pair; the auto-match refills the first one.
          patch({ [side]: selected, columns: [{ source: '', target: '' }] })
        }}
      >
        <option value={JSON.stringify({ schema: '', table: '' })}>
          테이블 선택
        </option>
        {(explorer.data?.tables ?? []).map((t: TableInfo) => (
          <option
            key={JSON.stringify(t)}
            value={JSON.stringify({ schema: t.schema, table: t.name })}
          >
            {t.schema}.{t.name}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
  const columnSelect = (
    info: TableDetails | undefined,
    side: 'source' | 'target',
    index: number,
    label: string,
  ) => (
    <label>
      {label}
      <NativeSelect
        aria-label={`${label} ${index + 1}`}
        value={draft.columns[index]![side]}
        onChange={(e) =>
          patch({
            columns: draft.columns.map((pair, i) =>
              i === index ? { ...pair, [side]: e.target.value } : pair,
            ),
          })
        }
      >
        <option value="">열 선택</option>
        {info?.columns.map((column) => (
          <option key={column.name} value={column.name}>
            {column.name} · {column.type}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
  return (
    <section
      className={tw('relationship-workspace')}
      aria-label="가상 관계 설정"
    >
      <h2>
        가상 관계 <small>{connection.currentDatabase}</small>
      </h2>
      <div className={tw('relationship-list')}>
        {relations.map((r) => (
          <div key={r.id} className={tw('relationship-card')}>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setDraft(r)
                setAliases(r.aliases.join(', '))
                setMessage('')
              }}
            >
              {r.name}
            </Button>
            <span>
              {r.source.schema}.{r.source.table} → {r.target.schema}.
              {r.target.table}
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={`${r.name} 관계 삭제`}
              onClick={() => void remove(r.id)}
            >
              삭제
            </Button>
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => {
          setDraft(blank())
          setAliases('')
          setMessage('')
        }}
      >
        새 관계
      </Button>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={busy}>
          <div className={tw('form-grid')}>
            <label>
              업무명
              <Input
                aria-label="업무명"
                maxLength={64}
                placeholder="예: 부가서비스 밴 (비우면 연결 테이블 이름)"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              별칭 (쉼표 구분)
              <Input
                aria-label="관계 별칭"
                maxLength={520}
                placeholder="예: VAN, 밴 서비스"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
              />
            </label>
            {fixedSource ? (
              <label>
                기준 테이블
                <Input
                  aria-label="기준 테이블"
                  readOnly
                  value={`${draft.source.schema}.${draft.source.table}`}
                />
              </label>
            ) : (
              tableSelect('source', '기준 테이블')
            )}
            {tableSelect('target', '연결 테이블')}
            <label>
              JOIN 방식
              <NativeSelect
                aria-label="JOIN 방식"
                value={draft.joinType}
                onChange={(e) =>
                  patch({
                    joinType: e.target.value as VirtualRelationship['joinType'],
                  })
                }
              >
                <option value="LEFT">LEFT JOIN · 기준 행 유지</option>
                <option value="INNER">INNER JOIN · 일치 행만</option>
              </NativeSelect>
            </label>
            <label>
              관계 유형
              <NativeSelect
                aria-label="관계 유형"
                value={draft.cardinality}
                onChange={(e) =>
                  patch({
                    cardinality: e.target
                      .value as VirtualRelationship['cardinality'],
                  })
                }
              >
                <option value="many-to-one">다대일 (N:1)</option>
                <option value="one-to-one">일대일 (1:1)</option>
                <option value="one-to-many">일대다 (1:N)</option>
                <option value="many-to-many">다대다 (N:M)</option>
              </NativeSelect>
            </label>
          </div>
          {draft.columns.map((_, index) => (
            <div className={tw('relationship-pair')} key={index}>
              <div className={tw('form-grid')}>
                {columnSelect(source.data, 'source', index, '기준 열')}
                {columnSelect(target.data, 'target', index, '연결 열')}
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={draft.columns.length === 1}
                aria-label={`연결 열 ${index + 1} 삭제`}
                onClick={() =>
                  patch({
                    columns: draft.columns.filter((_, i) => i !== index),
                  })
                }
              >
                삭제
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={draft.columns.length >= 8}
            onClick={() =>
              patch({ columns: [...draft.columns, { source: '', target: '' }] })
            }
          >
            연결 열 추가
          </Button>
          <div className={tw('form-grid')}>
            <label>
              업무 설명
              <Input
                aria-label="관계 설명"
                maxLength={500}
                placeholder="관계의 업무상 의미. 암호나 실제 행 데이터는 입력하지 마세요."
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
          </div>
          <Button
            type="submit"
            disabled={
              !explorer.data ||
              explorer.isFetching ||
              source.isFetching ||
              target.isFetching
            }
          >
            {busy ? '검증 중…' : '관계 검증 후 저장'}
          </Button>
        </fieldset>
      </form>
      {(explorer.error || source.error || target.error) && (
        <p role="alert">
          {displayMessage(explorer.error || source.error || target.error)}{' '}
          <Button
            onClick={() => {
              void explorer.refetch()
              if (draft.source.table) void source.refetch()
              if (draft.target.table) void target.refetch()
            }}
          >
            다시 조회
          </Button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  )
}
