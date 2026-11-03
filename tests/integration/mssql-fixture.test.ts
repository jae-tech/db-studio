import { expect, test } from 'vitest'
import sql from 'mssql'
import { randomUUID } from 'node:crypto'
import { MssqlAdapter } from '@main/database/mssql/adapter'
import { parseReadQuery } from '@main/database/policy'
import { liveFixture, liveWriteEnabled } from '../helpers/live-mssql'

test.skipIf(
  !liveWriteEnabled ||
    !process.env.AI_DB_TEST_READ_USER ||
    !process.env.AI_DB_TEST_READ_PASSWORD,
)(
  'dedicated SQL Server SELECT: real row/byte/LOB bounds, cancellation, timeout and SELECT-only permissions',
  async () => {
    const fixture = await liveFixture()
    const adapter = new MssqlAdapter()
    const run = (text: string, signal = new AbortController().signal) =>
      adapter.executeQuery(parseReadQuery(text, 5000), randomUUID(), signal)
    let transaction: sql.Transaction | undefined
    try {
      await fixture.setup
        .request()
        .query(`ALTER TABLE ${fixture.target} ADD note nvarchar(max) NULL`)
      await fixture.setup.request().query(`
        UPDATE ${fixture.target} SET note=REPLICATE(CAST(N'x' AS nvarchar(max)),20000);
        INSERT INTO ${fixture.target} (id,amount,note)
        SELECT TOP (5000) ROW_NUMBER() OVER (ORDER BY (SELECT NULL))+1,10,REPLICATE(CAST(N'x' AS nvarchar(max)),20000)
        FROM sys.all_columns a CROSS JOIN sys.all_columns b;
      `)
      const connected = await adapter.connect(
        {
          ...fixture.profile,
          username: process.env.AI_DB_TEST_READ_USER!,
          readOnly: true,
          maxRows: 5000,
          timeoutSeconds: 1,
        },
        process.env.AI_DB_TEST_READ_PASSWORD!,
      )
      expect(connected.permissionVerified).toBe(true)
      const rows = await run(`SELECT id FROM dbo.${fixture.table} ORDER BY id`)
      expect(rows.rowCount).toBe(5000)
      expect(rows.truncated).toBe(true)
      const lob = await run(`SELECT note FROM dbo.${fixture.table} WHERE id=1`)
      expect(String(lob.rows[0]?.c0).length).toBeLessThanOrEqual(8211)
      expect(String(lob.rows[0]?.c0)).toMatch(/^x+$/)
      const bytes = await run(
        `SELECT note FROM dbo.${fixture.table} ORDER BY id`,
      )
      expect(bytes.truncated).toBe(true)
      expect(bytes.rowCount).toBeGreaterThan(0)
      expect(bytes.rowCount).toBeLessThan(5000)
      expect(Buffer.byteLength(JSON.stringify(bytes.rows))).toBeLessThanOrEqual(
        4 * 1024 * 1024,
      )

      transaction = new sql.Transaction(fixture.setup)
      await transaction.begin()
      await new sql.Request(transaction).query(
        `UPDATE ${fixture.target} SET amount=11 WHERE id=1`,
      )
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 200)
      try {
        await expect(
          run(
            `SELECT amount FROM dbo.${fixture.table} WHERE id=1`,
            controller.signal,
          ),
        ).rejects.toThrow(/cancel/i)
      } finally {
        clearTimeout(timer)
      }
      await expect(
        run(`SELECT amount FROM dbo.${fixture.table} WHERE id=1`),
      ).rejects.toThrow(/timeout/i)
      await transaction.rollback()
      transaction = undefined
      expect(
        (await run(`SELECT amount FROM dbo.${fixture.table} WHERE id=1`)).rows,
      ).toEqual([{ c0: 10 }])
    } finally {
      try {
        if (transaction) await transaction.rollback()
      } finally {
        try {
          await adapter.disconnect()
        } finally {
          await fixture.close()
        }
      }
    }
  },
  60000,
)
