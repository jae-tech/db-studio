import { tw } from '@/lib/styleClasses'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ContextMenu } from 'radix-ui'
import type { CellValue, QueryResult } from '@shared/database'

export type ResultRow = Record<string, CellValue>
export type ResultGridHandle = { stopEditing: () => void; refresh: () => void }
const emptyRows: ResultRow[] = []
const emptyColumns: QueryResult['columns'] = []
const text = (value: CellValue): string =>
  value === null ? 'NULL' : String(value ?? '')
// Distinct non-NULL values as a T-SQL IN list; numbers stay bare, text is quoted.
export const inList = (values: CellValue[]): string =>
  `(${[...new Set(values.filter((value) => value !== null))]
    .map((value) =>
      typeof value === 'number' || typeof value === 'bigint'
        ? String(value)
        : `N'${String(value).replaceAll("'", "''")}'`,
    )
    .join(', ')})`

export function ResultGrid({
  columns: sourceColumns = emptyColumns,
  rows = emptyRows,
  page,
  pageSize,
  fontSize,
  editable,
  isEdited,
  onEdit,
  onStats,
  onFilterChange,
  onPageReset,
  onNotice,
  handle,
}: {
  columns?: QueryResult['columns']
  rows?: ResultRow[]
  page: number
  pageSize: number
  fontSize: number
  editable: Set<string>
  isEdited: (row: ResultRow, key: string) => boolean
  onEdit: (
    row: ResultRow,
    key: string,
    previous: CellValue,
    next: CellValue,
  ) => void
  onStats: (rows: number, pages: number) => void
  onFilterChange: (filtered: boolean) => void
  onPageReset: () => void
  onNotice: (message: string) => void
  handle: React.RefObject<ResultGridHandle | null>
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [filters, setFilters] = useState<ColumnFiltersState>([])
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<{
    row: ResultRow
    key: string
    old: CellValue
    value: string
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Right-clicked cell or header; the context menu copies from it.
  const [target, setTarget] = useState<{
    key: string
    value?: CellValue
  } | null>(null)
  const editorRef = useRef<HTMLInputElement>(null)
  const cancelEdit = useRef(false)
  const commit = () => {
    if (!editing) return
    const next =
      editing.value === '' && editing.old === null ? null : editing.value
    // Unchanged text is not an edit, even when the source value is a number.
    const before = editing.old === null ? null : String(editing.old)
    if (!cancelEdit.current && next !== before)
      onEdit(editing.row, editing.key, editing.old, next)
    cancelEdit.current = false
    setEditing(null)
    setRevision((n) => n + 1)
  }
  handle.current = {
    stopEditing: () => editorRef.current?.blur(),
    refresh: () => setRevision((n) => n + 1),
  }
  const columns = useMemo<ColumnDef<ResultRow>[]>(
    () =>
      sourceColumns.map((column) => ({
        id: column.key,
        accessorFn: (row) => row[column.key],
        header: column.name,
        sortingFn: 'alphanumeric',
        sortDescFirst: false,
        filterFn: 'includesString',
        size: Math.min(
          420,
          Math.max(
            120,
            Math.ceil(
              Math.max(
                column.name.length,
                ...rows
                  .slice(0, 50)
                  .map((row) => String(row[column.key] ?? '').length),
              ) *
                fontSize *
                0.9 +
                30,
            ),
          ),
        ),
        minSize: 72,
        maxSize: 420,
      })),
    [sourceColumns, rows, fontSize],
  )
  // The parent deliberately mutates edited row objects; a new array invalidates
  // TanStack's cached sort/filter row models after edit or rollback.
  const tableData = useMemo(() => [...rows], [rows, revision])
  const table = useReactTable({
    data: tableData,
    columns,
    state: {
      sorting,
      columnFilters: filters,
      pagination: { pageIndex: page, pageSize },
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    columnResizeMode: 'onChange',
    autoResetPageIndex: false,
  })
  const count = table.getFilteredRowModel().rows.length
  const pages = Math.ceil(count / pageSize)
  useEffect(() => onStats(count, pages), [count, pages, onStats])
  useEffect(
    () =>
      onFilterChange(filters.some((item) => String(item.value ?? '') !== '')),
    [filters, onFilterChange],
  )
  const pageRows = table.getRowModel().rows
  const copy = (value: string, message: string): void => {
    navigator.clipboard.writeText(value).then(
      () => onNotice(message),
      () => onNotice('클립보드에 복사하지 못했습니다.'),
    )
  }
  // All loaded rows after filter/sort, not just the visible page.
  const columnValues = (key: string): CellValue[] =>
    table
      .getPrePaginationRowModel()
      .rows.map((row) => row.original[key] ?? null)
  const height = Math.round(fontSize * 1.9) + 2
  const virtual = useVirtualizer({
    count: pageRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => height,
    overscan: 8,
  })
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    editorRef.current?.blur()
  }, [page, pageSize])
  return (
    <div
      className={tw('result-grid')}
      role="grid"
      aria-label="쿼리 결과"
      style={{ fontSize }}
    >
      <ContextMenu.Root onOpenChange={(open) => !open && setTarget(null)}>
        <ContextMenu.Trigger asChild>
          <div className={tw('result-grid-scroll')} ref={scrollRef}>
            <table
              className={tw('result-grid-table')}
              style={{ width: table.getTotalSize() }}
            >
              <thead className={tw('result-grid-head')}>
                <tr>
                  {table.getFlatHeaders().map((header) => (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() }}
                      onContextMenu={() => setTarget({ key: header.id })}
                      title={`${header.column.columnDef.header} · ${sourceColumns.find((c) => c.key === header.id)?.type ?? ''}`}
                    >
                      <div className={tw('result-grid-heading')}>
                        <button
                          type="button"
                          aria-label={`${header.column.columnDef.header} 정렬`}
                          onClick={(event) => {
                            onPageReset()
                            header.column.getToggleSortingHandler()?.(event)
                          }}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          {header.column.getIsSorted() === 'asc'
                            ? ' ↑'
                            : header.column.getIsSorted() === 'desc'
                              ? ' ↓'
                              : ''}
                        </button>
                        <span
                          className={tw('result-grid-resizer')}
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`${header.column.columnDef.header} 열 너비`}
                          aria-valuemin={72}
                          aria-valuemax={420}
                          aria-valuenow={header.getSize()}
                          tabIndex={0}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onKeyDown={(event) => {
                            if (
                              event.key !== 'ArrowLeft' &&
                              event.key !== 'ArrowRight'
                            )
                              return
                            event.preventDefault()
                            const delta = event.key === 'ArrowRight' ? 10 : -10
                            table.setColumnSizing((current) => ({
                              ...current,
                              [header.column.id]: Math.max(
                                72,
                                Math.min(420, header.getSize() + delta),
                              ),
                            }))
                          }}
                        />
                      </div>
                      <input
                        aria-label={`${header.column.columnDef.header} 필터`}
                        value={String(header.column.getFilterValue() ?? '')}
                        onChange={(event) => {
                          onPageReset()
                          header.column.setFilterValue(event.target.value)
                        }}
                        placeholder="필터"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody
                style={{ height: virtual.getTotalSize(), position: 'relative' }}
              >
                {virtual.getVirtualItems().map((item) => {
                  const row = pageRows[item.index]!
                  return (
                    <tr
                      className={tw('result-grid-row')}
                      key={row.id}
                      data-row-index={item.index}
                      style={{
                        height,
                        transform: `translateY(${item.start}px)`,
                      }}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const key = cell.column.id,
                          original = row.original,
                          value = original[key] ?? null
                        const active =
                          editing?.row === original && editing.key === key
                        return (
                          <td
                            key={cell.id}
                            data-col-id={key}
                            className={tw(
                              `result-grid-cell${isEdited(original, key) ? ' cell-edited' : ''}`,
                            )}
                            style={{ width: cell.column.getSize(), height }}
                            title={text(value)}
                            onContextMenu={() => setTarget({ key, value })}
                            onDoubleClick={() => {
                              if (editable.has(key))
                                setEditing({
                                  row: original,
                                  key,
                                  old: value,
                                  value:
                                    value === null ? '' : String(value ?? ''),
                                })
                            }}
                          >
                            {active ? (
                              <input
                                ref={editorRef}
                                autoFocus
                                className={tw('result-grid-editor')}
                                value={editing.value}
                                onChange={(event) =>
                                  setEditing({
                                    ...editing,
                                    value: event.target.value,
                                  })
                                }
                                onBlur={commit}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter')
                                    editorRef.current?.blur()
                                  if (event.key === 'Escape') {
                                    cancelEdit.current = true
                                    editorRef.current?.blur()
                                  }
                                }}
                              />
                            ) : value === null ? (
                              'NULL'
                            ) : (
                              String(value ?? '')
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!rows.length && (
              <div className={tw('grid-empty')}>
                <strong>쿼리 결과를 확인하세요</strong>
                <span>
                  데이터베이스를 연결하고 SELECT 쿼리를 실행하면 결과가
                  표시됩니다.
                </span>
              </div>
            )}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          {target && (
            <ContextMenu.Content className={tw('grid-menu')}>
              {'value' in target && (
                <ContextMenu.Item
                  onSelect={() =>
                    copy(text(target.value ?? null), '셀 값을 복사했습니다.')
                  }
                >
                  셀 값 복사
                </ContextMenu.Item>
              )}
              <ContextMenu.Item
                onSelect={() => {
                  const values = columnValues(target.key)
                  copy(
                    values.map(text).join('\n'),
                    `열 값 ${values.length.toLocaleString()}개를 복사했습니다.`,
                  )
                }}
              >
                열 값 복사 (줄바꿈)
              </ContextMenu.Item>
              <ContextMenu.Item
                onSelect={() =>
                  copy(
                    inList(columnValues(target.key)),
                    '열 값을 IN 목록으로 복사했습니다(중복·NULL 제외).',
                  )
                }
              >
                열 값을 IN (...) 목록으로 복사
              </ContextMenu.Item>
            </ContextMenu.Content>
          )}
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  )
}
