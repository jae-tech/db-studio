import { tw } from '@/lib/styleClasses'
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { displayMessage, mutationStageLabels } from '../lib/locale'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectionSummary } from '@shared/database'
import type { MutationInspection, MutationState } from '@shared/mutation'
import { desktop } from '../lib/desktop'
import { applyWrite } from '../lib/gridEdit'
import { Button } from './ui/button'

const activeStages = new Set<MutationState['stage']>([
  'previewing',
  'preview',
  'applying',
  'applied',
  'committing',
  'rolling-back',
])
export function MutationPanel({
  connection,
  sql,
  autoPreview = false,
  onAutoPreview,
}: {
  connection?: ConnectionSummary
  sql: string
  // Set for an AI write: preview once without a click; applying still needs the user.
  autoPreview?: boolean
  onAutoPreview?: () => void
}) {
  const client = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  // AI write (ADR-028/033): a read-only "what changes" view, shown for any connection.
  const [inspection, setInspection] = useState<
    MutationInspection & { sql: string }
  >()
  const status = useQuery({
    queryKey: ['mutation', connection?.id],
    enabled: !!connection,
    queryFn: () => desktop().db.mutations.state(connection!.id),
    refetchInterval: 1000,
  })
  const state = status.data
  const active = !!state && activeStages.has(state.stage)
  const canWrite = connection?.status === 'connected' && !connection.readOnly
  useEffect(() => {
    setReviewed(false)
    setConfirmation('')
    setError('')
  }, [state?.id, connection?.id])
  useEffect(() => {
    if (!autoPreview || busy) return
    onAutoPreview?.()
    if (connection?.status !== 'connected') {
      setError(
        'AI 변경 SQL입니다. DB에 연결하면 바뀔 행을 미리 볼 수 있습니다.',
      )
      return
    }
    const source = sql
    setBusy(true)
    setError('')
    desktop()
      .db.mutations.inspect({ connectionId: connection.id, sql: source })
      .then((result) => setInspection({ ...result, sql: source }))
      .catch((cause: unknown) =>
        setError(`변경 미리보기를 만들지 못했습니다: ${displayMessage(cause)}`),
      )
      .finally(() => setBusy(false))
    // sql/connection are read at trigger time; re-running on their identity would preview twice.
  }, [autoPreview, busy])
  // An edited statement no longer matches the preview shown for it.
  useEffect(() => {
    setInspection((current) =>
      current && current.sql !== sql ? undefined : current,
    )
  }, [sql])
  // One answer runs the guarded path: locked re-check, apply, then COMMIT.
  const execute = (target: MutationInspection & { sql: string }): void => {
    // The guarded states (applying → COMMIT 완료) replace the preview right away.
    setInspection(undefined)
    void perform(() => applyWrite(connection!.id, target.sql))
  }
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['mutation'] })
    void client.invalidateQueries({ queryKey: ['connections'] })
    void client.invalidateQueries({ queryKey: ['history'] })
  }
  const perform = async (job: () => Promise<MutationState>): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const next = await job()
      client.setQueryData(['mutation', next.connectionId], next)
    } catch (cause) {
      setError(displayMessage(cause))
    } finally {
      setBusy(false)
      refresh()
    }
  }
  // Nothing to review: no empty bar above the editor (the toggle lives in 설정).
  if (!error && !status.error && !inspection && !state) return null
  return (
    <section className={tw('mutation-panel')} aria-label="제한 쓰기 트랜잭션">
      {(error || status.error) && (
        <p role="alert">{error || displayMessage(status.error)}</p>
      )}
      {inspection && (
        <div
          className={tw('mutation-state preview')}
          aria-label="변경 미리보기"
        >
          <strong>
            변경 미리보기 — 아직 적용되지 않음 · {inspection.target} ·{' '}
            {inspection.affectedRows.toLocaleString()}행{' '}
            {inspection.kind === 'delete'
              ? '삭제'
              : inspection.kind === 'insert'
                ? '추가'
                : '변경'}
          </strong>
          <div className={tw('mutation-sample')}>
            <Table>
              <TableHeader>
                <TableRow>
                  {inspection.sample.columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className={tw(
                        column.name.startsWith('→') ? 'next' : undefined,
                      )}
                    >
                      {column.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspection.sample.rows.map((row, index) => (
                  <TableRow key={index}>
                    {inspection.sample.columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={tw(
                          column.name.startsWith('→') ? 'next' : undefined,
                        )}
                      >
                        {row[column.key] === null
                          ? 'NULL'
                          : String(row[column.key] ?? '')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {inspection.sample.truncated && (
            <small>처음 {inspection.sample.rows.length}행만 표시합니다.</small>
          )}
          {inspection.applyBlocked ? (
            <p role="note">
              실행할 수 없음: {displayMessage(inspection.applyBlocked)}
            </p>
          ) : (
            <div className={tw('mutation-confirm')}>
              <strong>
                {inspection.affectedRows.toLocaleString()}행을{' '}
                {inspection.kind === 'delete'
                  ? '삭제'
                  : inspection.kind === 'insert'
                    ? '추가'
                    : '변경'}
                합니다. 실행할까요?
              </strong>
              <Button
                size="small"
                disabled={busy || active}
                onClick={() => execute(inspection)}
              >
                실행
              </Button>
              <Button
                size="small"
                variant="ghost"
                disabled={busy}
                onClick={() => setInspection(undefined)}
              >
                취소
              </Button>
            </div>
          )}
        </div>
      )}
      {state && (
        <div className={tw(`mutation-state ${state.stage}`)}>
          <strong>
            {state.stage === 'preview'
              ? '쓰기 미리보기 검토 — 아직 적용되지 않음'
              : state.stage === 'applied'
                ? '미확정 변경 — 별도 COMMIT 필요'
                : mutationStageLabels[state.stage]}{' '}
            · {state.database} · {state.affectedRows} 개 대상{' '}
          </strong>
          {state.stage === 'preview' && state.importRows && (
            <p role="note">
              엑셀 전체 {state.importRows.total.toLocaleString()}행 ·{' '}
              {state.importRows.unmatched === undefined
                ? `추가하지 않는 행 ${Math.max(0, state.importRows.total - state.affectedRows).toLocaleString()}행 (기존 행과 일치하거나 WHERE로 제외)`
                : `대상과 일치하지 않는 행 ${state.importRows.unmatched.toLocaleString()}행 (ON 조건 기준, 변경되지 않음)`}
            </p>
          )}
          <p role="status">
            {displayMessage(state.message)}
            {active && state.stage !== 'committing'
              ? ` (${Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000))}초 남음)`
              : ''}
          </p>
          {state.detail && (
            <p role="alert">사유: {displayMessage(state.detail)}</p>
          )}
          {active && (
            <>
              <pre>{state.sql}</pre>
            </>
          )}
          {state.stage === 'preview' && (
            <>
              <p>
                샘플은 최대 20행·16열·셀당 512자만 표시합니다. 적용 시 잠금
                상태에서 대상 버전을 다시 확인하며, 대상이 바뀌면 새 미리보기가
                필요합니다.{' '}
              </p>
              <div className={tw('mutation-sample')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {state.preview?.columns.map((column) => (
                        <TableHead key={column.key}>{column.name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.preview?.rows.map((row, index) => (
                      <TableRow key={index}>
                        {state.preview?.columns.map((column) => (
                          <TableCell key={column.key}>
                            {row[column.key] === null
                              ? 'NULL'
                              : String(row[column.key] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <label className={tw('checkbox-label')}>
                <input
                  type="checkbox"
                  aria-label="쓰기 대상과 실제 SQL 검토 확인"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                대상 샘플과 실제 제한 SQL을 검토했습니다. 이 샘플은 전체
                데이터가 아닙니다.{' '}
              </label>
              <Button
                size="small"
                disabled={!reviewed || busy || !canWrite}
                onClick={() => {
                  void perform(() =>
                    desktop().db.mutations.apply({
                      id: state.id,
                      approvalHash: state.approvalHash,
                    }),
                  )
                }}
              >
                트랜잭션에 적용 — COMMIT 아님{' '}
              </Button>
            </>
          )}
          {state.stage === 'applied' && (
            <div className={tw('mutation-commit')}>
              <label>
                COMMIT하려면 데이터베이스 이름을 정확히 입력하세요{' '}
                <Input
                  aria-label="쓰기 데이터베이스 확인"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <Button
                size="small"
                disabled={
                  busy || confirmation !== state.database || !state.commitToken
                }
                onClick={() => {
                  void perform(() =>
                    desktop().db.mutations.commit({
                      id: state.id,
                      approvalHash: state.approvalHash,
                      commitToken: state.commitToken!,
                      databaseConfirmation: confirmation,
                    }),
                  )
                }}
              >
                변경 확정(COMMIT){' '}
              </Button>
            </div>
          )}
          {active && state.stage !== 'committing' && (
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                void desktop()
                  .db.mutations.rollback({ id: state.id })
                  .then((next) => {
                    client.setQueryData(['mutation', next.connectionId], next)
                    refresh()
                  })
                  .catch((cause) => setError(displayMessage(cause)))
              }}
            >
              {state.stage === 'preview'
                ? '쓰기 미리보기 취소'
                : '취소 / 트랜잭션 롤백'}
            </Button>
          )}
          {state.stage === 'unknown' && (
            <p role="alert">
              자동으로 재시도하지 마세요. DBA가 실제 DB에서 COMMIT 또는 롤백
              여부를 확인해야 합니다.{' '}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
