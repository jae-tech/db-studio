import { tw } from '@/lib/styleClasses'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  KeyRound,
  Table2,
} from 'lucide-react'
import type { ColumnInfo, ConnectionSummary } from '@shared/database'
import { displayMessage } from '../lib/locale'
import { identifier } from '../lib/sqlCompletion'
import { desktop } from '../lib/desktop'
import { Button } from './ui/button'
import { useWorkspace } from '../store'
import { RelationshipEditor } from './RelationshipWorkspace'

export type OpenTable = {
  connectionId: string
  database: string
  schema: string
  name: string
}

/** Center-pane table details: column order/selection drives the generated SELECT. */
export function TableView({
  table,
  connection,
  onSql,
}: {
  table: OpenTable
  // Connected session for this table's DB; virtual relations are edited only then.
  connection?: ConnectionSummary
  onSql: (sql: string) => void
}) {
  const details = useQuery({
    queryKey: [
      'table',
      table.connectionId,
      table.database,
      table.schema,
      table.name,
    ],
    queryFn: () =>
      desktop().db.describeTable({
        connectionId: table.connectionId,
        schema: table.schema,
        table: table.name,
      }),
  })
  const { settings, update, notify } = useWorkspace()
  const layoutKey = `${table.connectionId}:${table.database}:${table.schema}.${table.name}`
  const saved = settings.columnLayouts[layoutKey]
  const [order, setOrder] = useState<ColumnInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => {
    const columns = details.data?.columns ?? []
    // Saved order first; columns added to the table since then go last, dropped ones are ignored.
    const rank = new Map(saved?.order.map((name, index) => [name, index]))
    setOrder(
      [...columns].sort(
        (a, b) =>
          (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity) ||
          a.ordinal - b.ordinal,
      ),
    )
    const hidden = new Set(saved?.hidden)
    setSelected(
      new Set(
        columns
          .filter((column) => !hidden.has(column.name))
          .map((column) => column.name),
      ),
    )
    // Re-apply only when metadata loads, not after every save.
  }, [details.data])
  const layout = {
    order: order.map((column) => column.name),
    hidden: order
      .filter((column) => !selected.has(column.name))
      .map((column) => column.name),
  }
  const dirty =
    JSON.stringify(layout) !==
    JSON.stringify(
      saved ?? {
        order: (details.data?.columns ?? []).map((column) => column.name),
        hidden: [],
      },
    )
  const save = (): void => {
    const next = { ...settings.columnLayouts, [layoutKey]: layout }
    if (Object.keys(next).length > 200) {
      notify(
        '저장된 열 순서는 최대 200개 테이블입니다. 다른 테이블의 저장을 지우세요.',
      )
      return
    }
    update({ columnLayouts: next })
    notify(`${table.schema}.${table.name} 열 순서를 저장했습니다.`)
  }
  const forget = (): void => {
    const next = { ...settings.columnLayouts }
    delete next[layoutKey]
    update({ columnLayouts: next })
    setOrder(details.data?.columns ?? [])
    setSelected(new Set((details.data?.columns ?? []).map((c) => c.name)))
    notify(`${table.schema}.${table.name} 저장된 열 순서를 지웠습니다.`)
  }
  // Moves one column to another position; used by drag-and-drop and the ↑↓ buttons.
  const move = (from: number, to: number): void =>
    setOrder((current) => {
      if (from === to || to < 0 || to >= current.length) return current
      const next = [...current]
      next.splice(to, 0, ...next.splice(from, 1))
      return next
    })
  const [dragging, setDragging] = useState<number>()
  const [over, setOver] = useState<number>()
  const chosen = order.filter((column) => selected.has(column.name))
  const original = details.data?.columns ?? []
  // Columns are always listed explicitly; generated SQL never uses SELECT * (ADR-028).
  const select = chosen.map((column) => identifier(column.name)).join(',\n  ')
  return (
    <section className={tw('table-view-panel')} aria-label="테이블 상세">
      <header>
        <Table2 size={16} />
        <h2>
          {table.schema}.{table.name}
        </h2>
        <small>{table.database}</small>
        <span className={tw('toolbar-spacer')} />
        <Button
          size="small"
          disabled={!chosen.length}
          onClick={() =>
            onSql(
              `SELECT TOP (100) ${select}\nFROM ${identifier(table.schema)}.${identifier(table.name)};`,
            )
          }
        >
          SELECT를 편집기에서 열기
        </Button>
      </header>
      {details.isPending && <p> 컬럼 불러오는 중… </p>}
      {details.error && <p role="alert">{displayMessage(details.error)}</p>}
      {details.data && (
        <>
          <div className={tw('table-view-tools')}>
            <Button
              size="small"
              variant="outline"
              onClick={() =>
                setSelected(
                  selected.size === order.length
                    ? new Set()
                    : new Set(order.map((column) => column.name)),
                )
              }
            >
              {selected.size === order.length ? '전체 해제' : '전체 선택'}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => setOrder(original)}
            >
              원래 순서
            </Button>
            <Button
              size="small"
              variant="outline"
              disabled={!dirty}
              onClick={save}
            >
              순서 저장
            </Button>
            {saved && (
              <Button size="small" variant="ghost" onClick={forget}>
                저장 삭제
              </Button>
            )}
            {saved && !dirty && <small>저장된 순서 적용 중</small>}
            <small>
              {chosen.length}/{order.length}개 열 선택
            </small>
          </div>
          <Table className={tw('column-table')}>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">선택</TableHead>
                <TableHead scope="col">순서</TableHead>
                <TableHead scope="col">열 이름</TableHead>
                <TableHead scope="col">형식</TableHead>
                <TableHead scope="col">NULL 허용</TableHead>
                <TableHead scope="col">PK</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.map((column, index) => (
                <TableRow
                  key={column.name}
                  draggable
                  className={tw(
                    `${dragging === index ? 'dragging' : ''} ${over === index && dragging !== index ? 'drop-target' : ''}`,
                  )}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', column.name)
                    setDragging(index)
                  }}
                  onDragOver={(event) => {
                    if (dragging === undefined) return
                    event.preventDefault()
                    setOver(index)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (dragging !== undefined) move(dragging, index)
                    setDragging(undefined)
                    setOver(undefined)
                  }}
                  onDragEnd={() => {
                    setDragging(undefined)
                    setOver(undefined)
                  }}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`${column.name} 선택`}
                      checked={selected.has(column.name)}
                      onChange={(event) => {
                        const next = new Set(selected)
                        if (event.target.checked) next.add(column.name)
                        else next.delete(column.name)
                        setSelected(next)
                      }}
                    />
                  </TableCell>
                  <TableCell className={tw('column-move')}>
                    <GripVertical
                      size={13}
                      className={tw('column-grip')}
                      aria-hidden
                    />
                    <button
                      aria-label={`${column.name} 위로`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      aria-label={`${column.name} 아래로`}
                      disabled={index === order.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </TableCell>
                  <TableCell>{column.name}</TableCell>
                  <TableCell>
                    <code>{column.type}</code>
                  </TableCell>
                  <TableCell>{column.nullable ? '예' : '—'}</TableCell>
                  <TableCell>
                    {column.primaryKey && (
                      <KeyRound size={13} aria-label="기본 키" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <h3>인덱스 ({details.data.indexes.length})</h3>
          {details.data.indexes.map((index, i) => (
            <p key={i}>
              {index.name}: {index.column}
              {index.unique ? ' · 고유' : ''}
            </p>
          ))}
          <h3>외래 키 ({details.data.foreignKeys.length})</h3>
          {details.data.foreignKeys.map((key, i) => (
            <p key={i}>
              {key.column} → {key.referencedSchema}.{key.referencedTable}.
              {key.referencedColumn}
            </p>
          ))}
          {connection && (
            <RelationshipEditor
              connection={connection}
              fixedSource={{ schema: table.schema, table: table.name }}
            />
          )}
        </>
      )}
    </section>
  )
}
