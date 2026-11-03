import type { AgentStatus } from '@shared/agent'
import type { ConnectionSummary, HistoryEntry } from '@shared/database'
import type { MutationState } from '@shared/mutation'
import type { ToolName } from '@shared/mcp'
import { messagesKo } from './messages.ko'

export const connectionStatusLabels: Record<
  ConnectionSummary['status'],
  string
> = {
  connected: '연결됨',
  connecting: '연결 중',
  disconnected: '연결 안 됨',
}
export const historyStatusLabels: Record<HistoryEntry['status'], string> = {
  success: '성공',
  error: '오류',
  cancelled: '취소됨',
  committed: 'COMMIT 완료',
  'rolled-back': '롤백됨',
  unknown: '결과 불명확',
}
export const mutationStageLabels: Record<MutationState['stage'], string> = {
  previewing: '미리보기 조회 중',
  preview: '미리보기',
  applying: '적용 중',
  applied: '미확정 변경',
  committing: 'COMMIT 진행 중',
  committed: 'COMMIT 완료',
  'rolling-back': '롤백 진행 중',
  'rolled-back': '롤백됨',
  cancelled: '취소됨',
  error: '오류',
  unknown: '결과 불명확',
}
export const agentAuthLabels: Record<AgentStatus['auth'], string> = {
  subscription: '구독 인증',
  'api-key': 'API 키 인증(미지원)',
  unknown: '인증 미확인',
  unavailable: '사용 불가',
}
export const agentOutcomeLabels = {
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
} as const
export const toolLabels: Record<ToolName, string> = {
  db_list_databases: '공유 DB 확인',
  db_list_tables: '테이블 목록 조회',
  db_describe_table: '테이블 구조 조회',
  db_get_foreign_keys: '외래 키 조회',
  db_get_schema: '스키마 조회',
  db_explain_query: '정적 쿼리 분석',
  db_propose_sql: 'SQL 제안',
}

// Translate app-owned messages at the display boundary, including old history.
// Unknown server/provider diagnostics remain intact rather than hiding details.
export function displayMessage(value: unknown): string {
  const text = (value instanceof Error ? value.message : String(value ?? ''))
    .replace(
      /^(?:Error: )?(?:Error invoking remote method '[^']+': )?(?:Error: )?/,
      '',
    )
    .trim()
  if (Object.hasOwn(messagesKo, text)) return messagesKo[text]!
  for (const suffix of [
    'Connection cleanup failed; do not reuse it.',
    'Local history could not be saved; this does not change the DB outcome.',
  ]) {
    if (text.endsWith(` ${suffix}`))
      return `${displayMessage(text.slice(0, -suffix.length))} ${messagesKo[suffix]}`
  }
  const version =
    /^Only Codex CLI (\d+\.\d+\.\d+) has a verified restricted launch contract\. Other versions are disabled\.$/.exec(
      text,
    )
  if (version)
    return `제한 실행을 검증한 Codex CLI ${version[1]}만 지원합니다. 다른 버전은 비활성화됩니다.`
  const sql =
    /^SQL Server request failed \(([^)]+)\)\. Check permissions, SQL syntax and connection settings\.$/.exec(
      text,
    )
  if (sql)
    return `SQL Server 요청에 실패했습니다(${sql[1]}). 권한, SQL 구문과 연결 설정을 확인하세요.`
  const blocked =
    /^XLSX parsing failed: Macros, embedded content and external links are not supported \((part|content type): (.+)\)\.$/.exec(
      text,
    )
  if (blocked)
    return `엑셀 파일에 매크로·포함 개체·외부 연결로 보이는 구성 요소가 있어 가져올 수 없습니다(${blocked[1] === 'part' ? '파일 내부 경로' : '콘텐츠 형식'}: ${blocked[2]}). 해당 요소를 제거하거나 값만 새 통합 문서에 붙여 넣어 .xlsx로 저장하세요.`
  const expected = /^Expected (.+)$/.exec(text)
  if (expected) return `SQL에 ${expected[1]}이(가) 필요합니다.`
  const character = /^Unsupported SQL character at (\d+)$/.exec(text)
  if (character)
    return `SQL의 ${character[1]}번째 위치에 지원하지 않는 문자가 있습니다.`
  return text
}
