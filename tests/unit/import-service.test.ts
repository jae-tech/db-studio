import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImportStage, ImportTable, ImportWorkbook } from '@shared/imports'
import type { DatabaseService } from '@main/database/service'
import { ImportService } from '@main/imports/service'
import {
  ImportStageStore,
  type ImportStagePort,
  type ParsedWorkbook,
} from '@main/imports/staging'

const parsed: ParsedWorkbook = {
  sheets: [
    {
      name: 'Sheet1',
      columns: ['arbitrary_code', 'description', 'raw_value'],
      rows: [{ rowNumber: 2, values: ['001', '', '1.2300'] }],
    },
  ],
}
const services: ImportService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
})

function setup() {
  const connectionId = randomUUID(),
    stageId = randomUUID(),
    workbookId = randomUUID()
  const stage: ImportStage = {
    id: stageId,
    workbookId,
    sheetName: 'Sheet1',
    tableName: `stage_${stageId.replaceAll('-', '')}`,
    columns: [...parsed.sheets[0]!.columns],
    rowCount: 1,
    sample: structuredClone(parsed.sheets[0]!.rows),
  }
  const workbook: ImportWorkbook = {
    id: workbookId,
    fileName: 'fixture.xlsx',
    sheets: [{ name: 'Sheet1', columns: stage.columns, rowCount: 1 }],
  }
  const stages: ImportStagePort = {
    open: vi.fn(() => structuredClone(workbook)),
    stage: vi.fn(() => structuredClone(stage)),
    get: vi.fn(() => structuredClone(stage)),
    getRows: vi.fn(() => [{ rowNumber: 2, values: ['001', '', null] }]),
    prune: vi.fn(),
    discard: vi.fn(),
    dispose: vi.fn(),
  }
  const tables = new Map<string, ImportTable[]>()
  const database: Pick<
    DatabaseService,
    'registerImport' | 'unregisterImport' | 'listImports'
  > = {
    registerImport: vi.fn((id, data) => {
      const current = tables.get(id) ?? []
      tables.set(id, [
        ...current.filter((table) => table.stageId !== data.id),
        {
          stageId: data.id,
          connectionId: id,
          database: 'fixture',
          schema: 'import',
          tableName: data.tableName,
          columns: [...data.columns],
          rowCount: data.rows.length,
        },
      ])
      return 'fixture'
    }),
    unregisterImport: vi.fn((id, source) => {
      tables.set(
        id,
        (tables.get(id) ?? []).filter((table) => table.stageId !== source),
      )
    }),
    listImports: vi.fn((id) => tables.get(id) ?? []),
  }
  const parser = vi.fn(async () => structuredClone(parsed))
  const service = new ImportService(database, stages, parser)
  services.push(service)
  const load = () => service.load({ stageId, connectionId })
  return {
    service,
    stages,
    parser,
    database,
    connectionId,
    stageId,
    workbookId,
    stage,
    tables,
    load,
  }
}

describe('generic Main workbook imports', () => {
  it('parses only a Main-owned path and returns path-free workbook metadata', async () => {
    const f = setup(),
      workbook = await f.service.open('C:\\private\\fixture.xlsx')
    expect(f.parser).toHaveBeenCalledWith('C:\\private\\fixture.xlsx')
    expect(workbook.fileName).toBe('fixture.xlsx')
    expect(JSON.stringify(workbook)).not.toContain('private')
  })
  it('registers arbitrary columns and exact nullable string data, without business mappings', async () => {
    const f = setup(),
      table = await f.load()
    expect(f.database.registerImport).toHaveBeenCalledWith(f.connectionId, {
      id: f.stageId,
      tableName: f.stage.tableName,
      columns: f.stage.columns,
      rows: [['001', '', null]],
    })
    expect(table).toEqual({
      stageId: f.stageId,
      connectionId: f.connectionId,
      database: 'fixture',
      schema: 'import',
      tableName: f.stage.tableName,
      columns: f.stage.columns,
      rowCount: 1,
    })
    expect(table).not.toHaveProperty('rows')
    expect(table).not.toHaveProperty('mapping')
    expect(table).not.toHaveProperty('approvalHash')
  })
  it('lists only metadata from the current connection and returns detached values', async () => {
    const f = setup()
    await f.load()
    const listed = await f.service.list(f.connectionId)
    listed[0]!.columns[0] = 'tampered'
    expect((await f.service.list(f.connectionId))[0]!.columns[0]).toBe(
      'arbitrary_code',
    )
    expect(await f.service.list(randomUUID())).toEqual([])
    expect(JSON.stringify(listed)).not.toContain('001')
  })
  it('protects loaded stages from local TTL pruning', async () => {
    const f = setup()
    await f.load()
    await f.service.stage({ workbookId: f.workbookId, sheetName: 'Sheet1' })
    expect(f.stages.prune).toHaveBeenLastCalledWith(new Set([f.stageId]))
  })
  it.each(['stage', 'workbook'] as const)(
    'unregisters a %s from all connections before deleting local data',
    async (kind) => {
      const f = setup(),
        secondConnection = randomUUID()
      await f.load()
      await f.service.load({
        stageId: f.stageId,
        connectionId: secondConnection,
      })
      const calls: string[] = []
      vi.mocked(f.database.unregisterImport).mockImplementation((id) => {
        calls.push(id)
      })
      vi.mocked(f.stages.discard).mockImplementation(() => {
        calls.push('local-discard')
      })
      const id = kind === 'stage' ? f.stageId : f.workbookId
      await f.service.discard({ id })
      expect(calls).toEqual([f.connectionId, secondConnection, 'local-discard'])
      expect(f.stages.discard).toHaveBeenCalledWith(id, new Set())
    },
  )
  it('preserves local rows and ownership when a busy DB query refuses unregister', async () => {
    const f = setup()
    await f.load()
    vi.mocked(f.database.unregisterImport).mockImplementationOnce(() => {
      throw new Error('query running')
    })
    await expect(f.service.discard({ id: f.workbookId })).rejects.toThrow(
      'query running',
    )
    expect(f.stages.discard).not.toHaveBeenCalled()
    await f.service.stage({ workbookId: f.workbookId, sheetName: 'Sheet1' })
    expect(f.stages.prune).toHaveBeenLastCalledWith(new Set([f.stageId]))
    await f.service.discard({ id: f.workbookId })
    expect(f.database.unregisterImport).toHaveBeenCalledTimes(2)
    expect(f.stages.discard).toHaveBeenCalledOnce()
  })
  it('does not record failed registrations or unregister unrelated imports', async () => {
    const f = setup()
    vi.mocked(f.database.registerImport).mockImplementationOnce(() => {
      throw new Error('disconnected')
    })
    await expect(f.load()).rejects.toThrow('disconnected')
    await f.service.discard({ id: randomUUID() })
    expect(f.database.unregisterImport).not.toHaveBeenCalled()
    expect(f.stages.discard).toHaveBeenCalledWith(expect.any(String), new Set())
  })
  it('rejects arbitrary extra IPC fields rather than accepting execution instructions', async () => {
    const f = setup()
    await expect(
      f.service.load({
        stageId: f.stageId,
        connectionId: f.connectionId,
        sql: 'DROP TABLE dbo.items',
      }),
    ).rejects.toThrow()
    await expect(
      f.service.stage({
        workbookId: f.workbookId,
        sheetName: 'Sheet1',
        path: 'C:\\secret',
      }),
    ).rejects.toThrow()
    expect(f.database.registerImport).not.toHaveBeenCalled()
  })
  it('does not revive pending parsed workbooks during shutdown and disposes once', async () => {
    const f = setup()
    let finish!: (data: ParsedWorkbook) => void
    f.parser.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = f.service.open('fixture.xlsx'),
      rejected = expect(pending).rejects.toThrow('종료')
    const disposal = f.service.dispose()
    finish(parsed)
    await Promise.all([rejected, disposal, f.service.dispose()])
    expect(f.stages.open).not.toHaveBeenCalled()
    expect(f.stages.dispose).toHaveBeenCalledOnce()
    await expect(f.load()).rejects.toThrow('종료')
  })
})

function stagingFixture() {
  const tables = new Map<string, { row_number: number; data: string }[]>()
  const sql: string[] = []
  const db = {
    exec: vi.fn((query: string) => {
      sql.push(query)
      const name = /"(stage_[a-f0-9]{32})"/.exec(query)?.[1]
      if (!name) throw new Error('unsafe identifier')
      if (query.startsWith('CREATE TEMP')) tables.set(name, [])
      else if (query.startsWith('DROP')) tables.delete(name)
    }),
    prepare: (query: string) => {
      sql.push(query)
      const name = /"(stage_[a-f0-9]{32})"/.exec(query)?.[1]
      if (!name) throw new Error('unsafe identifier')
      return {
        run: (row_number: number, data: string) =>
          tables.get(name)!.push({ row_number, data }),
        all: () =>
          [...tables.get(name)!].sort((a, b) => a.row_number - b.row_number),
      }
    },
    transaction: (body: () => void) => body,
    close: vi.fn(),
  }
  let now = 0
  const store = new ImportStageStore(
    () => now,
    () => db as unknown as Database.Database,
  )
  return {
    store,
    db,
    sql,
    tables,
    advance: () => {
      now += 30 * 60 * 1000 + 1
    },
  }
}
describe('generic memory-only SQLite staging', () => {
  it('uses generated TEMP identifiers and parameterized exact strings', () => {
    const f = stagingFixture(),
      data = structuredClone(parsed)
    data.sheets[0]!.rows[0]!.values[1] = "'); DROP TABLE anything; --"
    const workbook = f.store.open('C:\\private\\data.xlsx', data)
    data.sheets[0]!.rows[0]!.values[0] = 'changed after open'
    const stage = f.store.stage({
      workbookId: workbook.id,
      sheetName: 'Sheet1',
    })
    expect(stage.tableName).toMatch(/^stage_[a-f0-9]{32}$/)
    expect(f.sql[0]).toContain('CREATE TEMP TABLE')
    expect(f.sql.join('\n')).not.toContain('DROP TABLE anything')
    expect(f.store.getRows(stage.id)[0]!.values).toEqual([
      '001',
      "'); DROP TABLE anything; --",
      '1.2300',
    ])
    expect(JSON.stringify(workbook)).not.toContain('private')
    f.store.dispose()
    expect(f.db.close).toHaveBeenCalledOnce()
  })
  it('pads absent cells with null but preserves explicit blanks and zero strings', () => {
    const f = stagingFixture(),
      data = structuredClone(parsed)
    data.sheets[0]!.rows[0]!.values = ['0', '']
    const workbook = f.store.open('data.xlsx', data),
      stage = f.store.stage({ workbookId: workbook.id, sheetName: 'Sheet1' })
    const rows = f.store.getRows(stage.id)
    expect(rows).toEqual([{ rowNumber: 2, values: ['0', '', null] }])
    rows[0]!.values[0] = 'tampered'
    expect(f.store.getRows(stage.id)[0]!.values[0]).toBe('0')
    f.store.dispose()
  })
  it.each([
    ['same', 'SAME'],
    ['', 'other'],
    ['nul\0header', 'other'],
    ['x'.repeat(129), 'other'],
  ])('refuses invalid or ambiguous headers: %j', (...headers) => {
    const f = stagingFixture(),
      data = structuredClone(parsed)
    data.sheets[0]!.columns = headers
    data.sheets[0]!.rows = []
    expect(() => f.store.open('data.xlsx', data)).toThrow('열 이름')
    f.store.dispose()
  })
  it('accepts 50000 raw rows and refuses more, with at most20 sample rows', () => {
    const f = stagingFixture(),
      data = structuredClone(parsed)
    data.sheets[0]!.rows = Array.from({ length: 50_000 }, (_, index) => ({
      rowNumber: index + 2,
      values: ['', '', String(index)],
    }))
    const workbook = f.store.open('data.xlsx', data),
      stage = f.store.stage({ workbookId: workbook.id, sheetName: 'Sheet1' })
    expect(stage.sample).toHaveLength(20)
    expect(f.store.getRows(stage.id)).toHaveLength(50_000)
    data.sheets[0]!.rows.push({ rowNumber: 50_002, values: [] })
    expect(() => f.store.open('too-many.xlsx', data)).toThrow('제한')
    f.store.dispose()
  })
  it('protects registered data, expires inactive stages, and enforces count limits', () => {
    const f = stagingFixture(),
      workbook = f.store.open('data.xlsx', parsed)
    const stage = f.store.stage({
      workbookId: workbook.id,
      sheetName: 'Sheet1',
    })
    expect(() => f.store.discard(workbook.id, new Set([stage.id]))).toThrow()
    f.advance()
    f.store.prune(new Set([stage.id]))
    expect(f.tables.size).toBe(1)
    f.advance()
    f.store.prune(new Set())
    expect(f.tables.size).toBe(0)
    expect(() => f.store.get(stage.id)).toThrow()
    const w2 = f.store.open('two.xlsx', parsed)
    f.store.open('three.xlsx', parsed)
    f.store.open('four.xlsx', parsed)
    expect(() => f.store.open('five.xlsx', parsed)).toThrow('3개')
    for (let index = 0; index < 8; index++)
      f.store.stage({ workbookId: w2.id, sheetName: 'Sheet1' })
    expect(() =>
      f.store.stage({ workbookId: w2.id, sheetName: 'Sheet1' }),
    ).toThrow('8개')
    f.store.dispose()
  })
})
