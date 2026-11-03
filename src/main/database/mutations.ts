import { createHash, randomUUID } from 'node:crypto'
import { idSchema, type HistoryEntry } from '@shared/database'
import {
  mutationApplySchema,
  mutationCommitSchema,
  mutationIdSchema,
  mutationPreviewSchema,
  type MutationState,
} from '@shared/mutation'
import {
  mutationPolicyVersion,
  mutationRowLimit,
  parseMutation,
  type MutationQuery,
} from './policy'
import { databaseError, type DatabaseService } from './service'
import type { MutationSnapshot } from './MutationAdapter'

type Lease = ReturnType<DatabaseService['acquireMutationLease']>
type Record_ = {
  state: MutationState
  source: string
  query: MutationQuery
  generation: string
  connectionName: string
  started: number
  snapshot?: MutationSnapshot
  lease?: Lease
  controller: AbortController
  timer?: ReturnType<typeof setTimeout>
  job?: Promise<MutationState>
  cleanup?: Promise<MutationState>
  began: boolean
  beginAttempted: boolean
  finished: boolean
}
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const copy = (state: MutationState): MutationState => structuredClone(state)
export class MutationService {
  private records = new Map<string, Record_>()
  private latest = new Map<string, MutationState>()
  private disposed = false
  constructor(
    private readonly database: Pick<DatabaseService, 'acquireMutationLease'>,
    private readonly recordHistory: (entry: HistoryEntry) => void,
    private readonly now: () => number = Date.now,
  ) {}
  private get(id: string): Record_ {
    const record = this.records.get(id)
    if (!record || record.finished)
      throw new Error('Mutation approval is missing or already consumed')
    return record
  }
  private arm(record: Record_, milliseconds: number): void {
    clearTimeout(record.timer)
    record.state.expiresAt = this.now() + milliseconds
    record.timer = setTimeout(() => {
      void this.rollback({ id: record.state.id }).catch(() => undefined)
    }, milliseconds)
    record.timer.unref()
  }
  private async finish(
    record: Record_,
    stage: MutationState['stage'],
    message: string,
    retire: boolean,
  ): Promise<MutationState> {
    if (record.finished) return copy(record.state)
    clearTimeout(record.timer)
    if (retire && record.lease) {
      try {
        await record.lease.retire()
      } catch {
        message += ' Connection cleanup failed; do not reuse it.'
      }
    }
    record.lease?.release()
    record.lease = undefined
    record.finished = true
    record.state.stage = stage
    record.state.message = message
    delete record.state.commitToken
    this.records.delete(record.state.id)
    this.latest.set(record.state.connectionId, record.state)
    while (this.latest.size > 30)
      this.latest.delete(this.latest.keys().next().value!)
    try {
      this.recordHistory({
        id: record.state.id,
        connectionId: record.state.connectionId,
        connectionName: record.connectionName,
        database: record.state.database,
        sql: record.state.sql,
        startedAt: new Date(record.started).toISOString(),
        durationMs: this.now() - record.started,
        rowCount: record.state.affectedRows,
        status:
          stage === 'committed'
            ? 'committed'
            : stage === 'rolled-back'
              ? 'rolled-back'
              : stage === 'unknown'
                ? 'unknown'
                : stage === 'cancelled'
                  ? 'cancelled'
                  : 'error',
        message,
      })
    } catch {
      record.state.message +=
        ' Local history could not be saved; this does not change the DB outcome.'
    }
    return copy(record.state)
  }
  private async failed(
    record: Record_,
    error: unknown,
  ): Promise<MutationState> {
    record.state.detail = databaseError(error)
    if (record.beginAttempted) {
      if (!record.began)
        return this.finish(
          record,
          'unknown',
          'Transaction setup failed or its outcome is uncertain. Connection closed; verify server state before retrying.',
          true,
        )
      try {
        await record.lease!.adapter.rollback()
      } catch {
        return this.finish(
          record,
          'unknown',
          'Rollback could not be confirmed. Connection closed; verify server state. Do not retry automatically.',
          true,
        )
      }
      return this.finish(
        record,
        'rolled-back',
        record.controller.signal.aborted
          ? 'Mutation cancelled and rollback acknowledged. Reconnect before further work.'
          : 'Mutation refused or failed; rollback acknowledged. Preview again after reconnecting.',
        true,
      )
    }
    return this.finish(
      record,
      record.controller.signal.aborted ? 'cancelled' : 'error',
      'Preview cancelled or refused: unsupported target, changed schema, permissions, row limit, or driver error. No write was applied.',
      false,
    )
  }
  private validate(
    record: Record_,
    approvalHash: string,
    stage: MutationState['stage'],
  ): void {
    if (
      this.disposed ||
      record.controller.signal.aborted ||
      record.cleanup ||
      record.state.stage !== stage ||
      record.state.approvalHash !== approvalHash ||
      record.state.policyVersion !== mutationPolicyVersion ||
      record.state.expiresAt <= this.now()
    )
      throw new Error(
        'Approval hash/state/policy/expiry mismatch. Cancel and preview again.',
      )
    if (parseMutation(record.source).sql !== record.query.sql)
      throw new Error('Mutation policy changed')
  }
  async preview(input: unknown): Promise<MutationState> {
    const request = mutationPreviewSchema.parse(input)
    if (this.disposed) throw new Error('Mutation service is shutting down')
    if (
      [...this.records.values()].some(
        (record) => record.state.connectionId === request.connectionId,
      )
    )
      throw new Error('Finish or cancel the existing mutation first')
    const lease = this.database.acquireMutationLease(request.connectionId)
    // Parsed with the leased database so `db.schema.table` naming it is accepted.
    let query: MutationQuery
    try {
      query = parseMutation(request.sql, lease.profile.database)
    } catch (error) {
      lease.release()
      throw error
    }
    const id = randomUUID()
    const record: Record_ = {
      state: {
        id,
        connectionId: request.connectionId,
        database: lease.profile.database,
        kind: query.kind,
        sql: query.sql,
        approvalHash: '',
        policyVersion: mutationPolicyVersion,
        stage: 'previewing',
        affectedRows: 0,
        expiresAt: 0,
        message: 'Reading a bounded target preview. No write has been applied.',
      },
      source: request.sql,
      query,
      generation: lease.generation,
      connectionName: lease.profile.name,
      started: this.now(),
      lease,
      controller: new AbortController(),
      began: false,
      beginAttempted: false,
      finished: false,
    }
    this.records.set(id, record)
    this.latest.set(request.connectionId, record.state)
    this.arm(record, Math.min(lease.profile.timeoutSeconds, 30) * 1000)
    record.job = (async () => {
      try {
        const snapshot = await lease.adapter.mutations!.preview(
          query,
          id,
          record.controller.signal,
          false,
        )
        if (
          snapshot.count < 1 ||
          snapshot.count > mutationRowLimit ||
          (query.kind !== 'insert' &&
            (snapshot.versions.length !== snapshot.count ||
              new Set(snapshot.versions).size !== snapshot.versions.length ||
              // rowversion hex, or PK text without one (ADR-035); the adapter checks which.
              snapshot.versions.some(
                (version) => !version || version.length > 20_000,
              ))) ||
          (query.kind === 'insert' &&
            !/^[a-f0-9]{64}$/.test(snapshot.rowsDigest))
        )
          throw new Error('Invalid bounded snapshot')
        lease.assertCurrent()
        if (record.controller.signal.aborted) throw new Error('Cancelled')
        record.snapshot = snapshot
        record.state.sql = snapshot.executionSql
        record.state.approvalHash = digest({
          policy: mutationPolicyVersion,
          generation: record.generation,
          connectionId: request.connectionId,
          database: lease.profile.database,
          sql: snapshot.executionSql,
          metadata: snapshot.metadataHash,
          targets: snapshot.versions,
          rows: snapshot.rowsDigest,
        })
        record.state.affectedRows = snapshot.count
        record.state.preview = snapshot.sample
        record.state.importRows = snapshot.importRows
        record.state.stage = 'preview'
        record.state.message =
          'No changes yet. Preview expires in60s. Target versions will be rechecked under locks before applying.'
        lease.release()
        record.lease = undefined
        this.arm(record, 60000)
        return copy(record.state)
      } catch (error) {
        return this.failed(record, error)
      }
    })()
    return record.job
  }
  async apply(input: unknown): Promise<MutationState> {
    const { id, approvalHash } = mutationApplySchema.parse(input)
    const record = this.get(id)
    this.validate(record, approvalHash, 'preview')
    const lease = this.database.acquireMutationLease(record.state.connectionId)
    if (lease.generation !== record.generation) {
      lease.release()
      return this.finish(
        record,
        'error',
        'Connection generation changed. Nothing applied; preview again.',
        false,
      )
    }
    record.lease = lease
    record.state.stage = 'applying'
    this.arm(record, Math.min(lease.profile.timeoutSeconds, 30) * 1000)
    record.job = (async () => {
      try {
        lease.assertCurrent()
        record.beginAttempted = true
        await lease.adapter.beginTransaction('serializable')
        record.began = true
        if (record.controller.signal.aborted) throw new Error('Cancelled')
        const locked = await lease.adapter.mutations!.preview(
          record.query,
          id,
          record.controller.signal,
          true,
        )
        if (
          digest({
            versions: locked.versions,
            count: locked.count,
            rows: locked.rowsDigest,
            sql: locked.executionSql,
            metadata: locked.metadataHash,
          }) !==
          digest({
            versions: record.snapshot!.versions,
            count: record.snapshot!.count,
            rows: record.snapshot!.rowsDigest,
            sql: record.snapshot!.executionSql,
            metadata: record.snapshot!.metadataHash,
          })
        )
          throw new Error('Preview changed')
        const rows = await lease.adapter.mutations!.apply(
          record.query,
          locked,
          id,
          record.controller.signal,
        )
        lease.assertCurrent()
        if (record.controller.signal.aborted || rows !== record.snapshot!.count)
          throw new Error('Applied rows mismatch or cancelled')
        record.state.affectedRows = rows
        record.state.stage = 'applied'
        record.state.commitToken = randomUUID()
        record.state.message =
          'Applied inside an UNCOMMITTED transaction. Commit explicitly or rollback. Automatic rollback in30s; locks may block other sessions.'
        this.arm(record, 30000)
        return copy(record.state)
      } catch (error) {
        return this.failed(record, error)
      }
    })()
    return record.job
  }
  async commit(input: unknown): Promise<MutationState> {
    const request = mutationCommitSchema.parse(input)
    const record = this.get(request.id)
    this.validate(record, request.approvalHash, 'applied')
    if (
      request.commitToken !== record.state.commitToken ||
      request.databaseConfirmation !== record.state.database
    )
      throw new Error('Commit token or exact database confirmation mismatch')
    record.lease!.assertCurrent()
    record.state.stage = 'committing'
    delete record.state.commitToken
    clearTimeout(record.timer)
    record.job = (async () => {
      try {
        await record.lease!.adapter.commit()
      } catch {
        return this.finish(
          record,
          'unknown',
          'COMMIT outcome is UNKNOWN. Connection closed; verify the database before retrying. Rollback is not assumed.',
          true,
        )
      }
      return this.finish(
        record,
        'committed',
        'COMMIT acknowledged. Connection closed to reset session state; reconnect before further work.',
        true,
      )
    })()
    return record.job
  }
  async rollback(input: unknown): Promise<MutationState> {
    const { id } = mutationIdSchema.parse(input)
    const record = this.get(id)
    if (record.state.stage === 'committing')
      throw new Error(
        'COMMIT has been submitted and cannot be cancelled. Wait and verify the outcome.',
      )
    if (record.cleanup) return record.cleanup
    record.state.stage = 'rolling-back'
    clearTimeout(record.timer)
    record.cleanup = Promise.resolve().then(async () => {
      await record.job
      if (record.finished) return copy(record.state)
      if (record.began) {
        try {
          await record.lease!.adapter.rollback()
        } catch {
          return this.finish(
            record,
            'unknown',
            'Rollback could not be confirmed. Verify DB state; no automatic retry.',
            true,
          )
        }
        return this.finish(
          record,
          'rolled-back',
          'Rollback acknowledged. Connection closed to reset session state.',
          true,
        )
      }
      return this.finish(
        record,
        'cancelled',
        'Preview cancelled or expired. No write applied.',
        false,
      )
    })
    record.controller.abort()
    record.lease?.adapter.cancelQuery(id)
    return record.cleanup
  }
  async state(input: unknown): Promise<MutationState | null> {
    const connectionId = idSchema.parse(input)
    const record = [...this.records.values()].find(
      (value) => value.state.connectionId === connectionId,
    )
    if (
      record &&
      record.state.stage !== 'committing' &&
      record.state.expiresAt <= this.now()
    )
      await this.rollback({ id: record.state.id })
    const state = this.latest.get(connectionId)
    return state ? copy(state) : null
  }
  async abortConnection(input: unknown): Promise<void> {
    const connectionId = idSchema.parse(input)
    const record = [...this.records.values()].find(
      (value) => value.state.connectionId === connectionId,
    )
    if (!record) return
    if (record.state.stage === 'committing') await record.job
    else await this.rollback({ id: record.state.id })
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all(
      [...this.records.values()].map((record) =>
        this.abortConnection(record.state.connectionId),
      ),
    )
  }
}
