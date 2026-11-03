import { describe, expect, it } from 'vitest'
import {
  displayMessage,
  connectionStatusLabels,
  historyStatusLabels,
  mutationStageLabels,
  agentOutcomeLabels,
} from '@/lib/locale'

describe('Korean display boundary', () => {
  it('keeps committed, rolled back and unknown outcomes distinct', () => {
    expect(historyStatusLabels.committed).toBe('COMMIT 완료')
    expect(historyStatusLabels['rolled-back']).toBe('롤백됨')
    expect(historyStatusLabels.unknown).toBe('결과 불명확')
    expect(mutationStageLabels.applied).toBe('미확정 변경')
    expect(connectionStatusLabels.connected).toBe('연결됨')
    expect(agentOutcomeLabels.failed).toBe('실패')
  })
  it('translates IPC-wrapped app errors and old history without changing codes', () => {
    expect(
      displayMessage(
        new Error(
          "Error invoking remote method 'db:connect': Error: Query timed out",
        ),
      ),
    ).toBe('쿼리 제한 시간을 초과했습니다.')
    expect(
      displayMessage(
        'SQL Server request failed (EREQUEST). Check permissions, SQL syntax and connection settings.',
      ),
    ).toContain('EREQUEST')
    expect(
      displayMessage(
        new Error(
          "Error invoking remote method 'import:open': Error: XLSX parsing failed: Macros, embedded content and external links are not supported (part: xl/embeddings/oleObject1.bin).",
        ),
      ),
    ).toContain('파일 내부 경로: xl/embeddings/oleObject1.bin')
    expect(
      displayMessage(
        'Only Codex CLI 0.165.0 has a verified restricted launch contract. Other versions are disabled.',
      ),
    ).toContain('0.165.0')
    expect(displayMessage('Unsupported SQL character at 7')).toContain('7번째')
  })
  it('preserves uncertainty and appended cleanup warnings', () => {
    const text = displayMessage(
      'COMMIT outcome is UNKNOWN. Connection closed; verify the database before retrying. Rollback is not assumed. Local history could not be saved; this does not change the DB outcome.',
    )
    expect(text).toContain('결과가 불명확')
    expect(text).toContain('롤백되었다고 가정하지 말고')
    expect(text).toContain('이력을 저장하지 못했습니다')
  })
  it('does not rewrite unknown SQL, user content or server diagnostics', () => {
    const text = 'Custom server diagnostic: SELECT 42 AS hello FROM dbo.orders'
    expect(displayMessage(text)).toBe(text)
    expect(displayMessage('')).toBe('')
    expect(displayMessage('toString')).toBe('toString')
  })
})
