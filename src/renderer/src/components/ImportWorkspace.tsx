import { tw } from '@/lib/styleClasses'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { NativeSelect } from '@/components/ui/native-select'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileSpreadsheet, ShieldCheck } from 'lucide-react'
import type { ConnectionSummary } from '@shared/database'
import type { ImportStage, ImportTable, ImportWorkbook } from '@shared/imports'
import { desktop } from '../lib/desktop'
import { displayMessage } from '../lib/locale'
import { Button } from './ui/button'

const quote = (name: string): string => `[${name.replaceAll(']', ']]')}]`
const reference = (table: ImportTable): string =>
  `${quote(table.schema)}.${quote(table.tableName)}`

export function ImportWorkspace({
  connection,
  onUseInAi,
}: {
  connection?: ConnectionSummary
  onUseInAi?: (table: ImportTable) => void
}) {
  const client = useQueryClient()
  const [workbook, setWorkbook] = useState<ImportWorkbook | null>(null)
  const [sheetName, setSheetName] = useState('')
  const [stage, setStage] = useState<ImportStage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connected = connection?.status === 'connected'
  const loaded = useQuery({
    queryKey: ['import-tables', connection?.id, connection?.currentDatabase],
    enabled: connected,
    queryFn: () => desktop().db.imports.list(connection!.id),
    retry: false,
  })
  const tables = connected
    ? (loaded.data ?? []).filter(
        (table) => table.database === connection?.currentDatabase,
      )
    : []
  const currentTable = tables.find((table) => table.stageId === stage?.id)
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['import-tables'] })
    void client.invalidateQueries({ queryKey: ['explorer'] })
    void client.invalidateQueries({ queryKey: ['table'] })
  }
  const run = async (job: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await job()
    } catch (cause) {
      setError(displayMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const discard = (id: string): Promise<void> =>
    run(async () => {
      try {
        await desktop().db.imports.discard({ id })
      } finally {
        refresh()
      }
      if (id === stage?.id || id === workbook?.id) setStage(null)
      if (id === workbook?.id) {
        setWorkbook(null)
        setSheetName('')
      }
    })

  return (
    <section className={tw('import-workspace')} aria-label="엑셀 가져오기">
      <header className={tw('import-toolbar')}>
        <h2>
          <FileSpreadsheet size={20} /> 엑셀 가져오기
        </h2>
        <span className={tw('local-badge')}>
          <ShieldCheck size={14} /> AI에 행 데이터 자동 공유 안 함
        </span>
      </header>
      {(error || loaded.error) && (
        <p className={tw('inline-error')} role="alert">
          {error || displayMessage(loaded.error)}
        </p>
      )}
      <section className={tw('import-card')} aria-label="엑셀 파일과 워크시트">
        <h3>1. 파일 선택 · 로컬 임시 적재</h3>
        <div className={tw('import-actions')}>
          <Button
            variant="outline"
            disabled={busy || !!workbook}
            onClick={() => {
              void run(async () => {
                const opened = await desktop().db.imports.open()
                if (!opened) return
                setWorkbook(opened)
                setSheetName(opened.sheets[0]?.name ?? '')
              })
            }}
          >
            엑셀 파일 선택
          </Button>
          <span>{workbook?.fileName ?? '선택한 파일 없음'}</span>
        </div>
        {workbook && (
          <>
            <div className={tw('form-grid')}>
              <label>
                워크시트
                <NativeSelect
                  aria-label="엑셀 워크시트"
                  value={sheetName}
                  disabled={busy}
                  onChange={(event) => {
                    setSheetName(event.target.value)
                    setStage(null)
                  }}
                >
                  {workbook.sheets.map((sheet) => (
                    <option key={sheet.name} value={sheet.name}>
                      {sheet.name} · {sheet.rowCount}행
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <div className={tw('import-actions')}>
              <Button
                size="small"
                disabled={busy || !!stage || !sheetName}
                onClick={() => {
                  void run(async () => {
                    setStage(
                      await desktop().db.imports.stage({
                        workbookId: workbook.id,
                        sheetName,
                      }),
                    )
                  })
                }}
              >
                로컬 임시 데이터로 적재
              </Button>
              <Button
                size="small"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void discard(workbook.id)
                }}
              >
                파일 및 임시 데이터 삭제
              </Button>
            </div>
          </>
        )}
        {stage && (
          <>
            <p role="status">
              {stage.sheetName} · {stage.rowCount}행 · {stage.columns.length}개
              컬럼 적재됨
            </p>
            <div
              className={tw('import-changes mutation-sample')}
              tabIndex={0}
              aria-label="엑셀 원본 샘플"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>엑셀 행</TableHead>
                    {stage.columns.map((column) => (
                      <TableHead key={column}>{column}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stage.sample.slice(0, 20).map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell>{row.rowNumber}</TableCell>
                      {stage.columns.map((column, index) => (
                        <TableCell key={column}>
                          {row.values[index] ?? ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              size="small"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void discard(stage.id)
              }}
            >
              현재 임시 데이터 삭제
            </Button>
          </>
        )}
      </section>
      <section
        className={tw('import-card')}
        aria-label="쿼리에 사용할 임시 테이블"
      >
        <h3>2. 선택한 연결에서 사용할 임시 테이블</h3>
        <p>
          {connection
            ? `${connection.name} · ${connection.currentDatabase}`
            : '선택한 데이터베이스 연결 없음'}
        </p>
        <Button
          size="small"
          variant="ghost"
          disabled={busy || !connected || loaded.isFetching}
          onClick={() => {
            void loaded.refetch()
          }}
        >
          임시 테이블 목록 새로고침
        </Button>
        <Button
          disabled={busy || !connected || !stage || !!currentTable}
          onClick={() => {
            if (!connection || !stage) return
            void run(async () => {
              await desktop().db.imports.load({
                stageId: stage.id,
                connectionId: connection.id,
              })
              refresh()
            })
          }}
        >
          {currentTable ? '이 연결에 등록됨' : '선택한 연결에 임시 테이블 등록'}
        </Button>
        {loaded.isFetching && (
          <p role="status">임시 테이블 목록 불러오는 중…</p>
        )}
        {connected && !tables.length && !loaded.isFetching && (
          <p>이 연결에 등록한 임시 테이블이 없습니다.</p>
        )}
        {tables.map((table) => (
          <article
            className={tw('import-card')}
            key={table.stageId}
            aria-label={`임시 테이블 ${table.tableName}`}
          >
            <strong>{reference(table)}</strong>
            <p>
              {table.database} · {table.rowCount}행 · {table.columns.length}개
              컬럼
            </p>
            <p className={tw('form-note')}>
              {table.columns
                .map((column) => `${quote(column)} nvarchar`)
                .join(' · ')}
            </p>
            <pre>{`SELECT TOP (100) ${table.columns.map(quote).join(', ')}\nFROM ${reference(table)};`}</pre>
            <div className={tw('import-actions')}>
              <Button
                size="small"
                disabled={busy || !connected || !onUseInAi}
                onClick={() => onUseInAi?.(table)}
              >
                AI에 이 테이블 활용 요청
              </Button>
              <Button
                size="small"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void discard(table.stageId)
                }}
              >
                이 임시 테이블 삭제
              </Button>
            </div>
          </article>
        ))}
      </section>
    </section>
  )
}
