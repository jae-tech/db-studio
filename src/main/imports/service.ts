import { idSchema } from '@shared/database'
import {
  importIdSchema,
  importLoadSchema,
  importStageSchema,
  type ImportWorkbook,
  type ImportStage,
  type ImportTable,
} from '@shared/imports'
import type { DatabaseService } from '../database/service'
import {
  ImportStageStore,
  type ImportStagePort,
  type ParsedWorkbook,
} from './staging'
import { readWorkbook } from './workbook'

/** Generic workbook staging only. Query proposal, review and execution remain in their existing services. */
export class ImportService {
  private registrations = new Map<
    string,
    { workbookId: string; connections: Set<string> }
  >()
  private disposed = false
  private closing?: Promise<void>
  private opens = new Set<Promise<ImportWorkbook>>()
  constructor(
    private readonly database: Pick<
      DatabaseService,
      'registerImport' | 'unregisterImport' | 'listImports'
    >,
    private readonly stages: ImportStagePort = new ImportStageStore(),
    private readonly parser: (
      path: string,
    ) => Promise<ParsedWorkbook> = readWorkbook,
  ) {}
  private assertLive(): void {
    if (this.disposed) throw new Error('가져오기 서비스가 종료 중입니다.')
  }
  private protectedStages(): Set<string> {
    return new Set(this.registrations.keys())
  }
  async open(path: string): Promise<ImportWorkbook> {
    this.assertLive()
    if (this.opens.size >= 3)
      throw new Error('동시에 여는 통합 문서는 최대 3개입니다.')
    const job = (async () => {
      const workbook = await this.parser(path)
      this.assertLive()
      this.stages.prune(this.protectedStages())
      return this.stages.open(path, workbook)
    })()
    this.opens.add(job)
    try {
      return await job
    } finally {
      this.opens.delete(job)
    }
  }
  async stage(input: unknown): Promise<ImportStage> {
    this.assertLive()
    const request = importStageSchema.parse(input)
    this.stages.prune(this.protectedStages())
    return this.stages.stage(request)
  }
  async load(input: unknown): Promise<ImportTable> {
    this.assertLive()
    const { stageId, connectionId } = importLoadSchema.parse(input)
    this.stages.prune(this.protectedStages())
    const stage = this.stages.get(stageId)
    const rows = this.stages.getRows(stageId).map((row) => row.values)
    // Registration is synchronous: no discard can interleave between registration and ownership tracking.
    const database = this.database.registerImport(connectionId, {
      id: stageId,
      tableName: stage.tableName,
      columns: [...stage.columns],
      rows,
    })
    const registration = this.registrations.get(stageId) ?? {
      workbookId: stage.workbookId,
      connections: new Set<string>(),
    }
    registration.connections.add(connectionId)
    this.registrations.set(stageId, registration)
    return {
      stageId,
      connectionId,
      database,
      schema: 'import',
      tableName: stage.tableName,
      columns: [...stage.columns],
      rowCount: rows.length,
    }
  }
  async list(input: unknown): Promise<ImportTable[]> {
    this.assertLive()
    const connectionId = idSchema.parse(input)
    return structuredClone(this.database.listImports(connectionId))
  }
  async discard(input: unknown): Promise<void> {
    this.assertLive()
    const { id } = importIdSchema.parse(input)
    // Unregister first. A busy-query refusal leaves the local workbook/stage intact.
    for (const [stageId, registration] of this.registrations) {
      if (stageId !== id && registration.workbookId !== id) continue
      for (const connectionId of registration.connections) {
        this.database.unregisterImport(connectionId, stageId)
        registration.connections.delete(connectionId)
      }
      this.registrations.delete(stageId)
    }
    this.stages.discard(id, this.protectedStages())
    this.stages.prune(this.protectedStages())
  }
  async dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.closing = (async () => {
      await Promise.allSettled([...this.opens])
      this.registrations.clear()
      this.stages.dispose()
    })()
    return this.closing
  }
}
