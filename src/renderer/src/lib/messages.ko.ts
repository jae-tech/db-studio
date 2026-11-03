// Display translations only. IPC values, stored history and provider protocols stay unchanged.
export const messagesKo: Record<string, string> = {
  'SQL Server authentication failed. Check the username, password and database access.':
    'SQL Server 인증에 실패했습니다. 사용자 이름, 비밀번호와 데이터베이스 접근 권한을 확인하세요.',
  'SQL Server network/TLS connection failed. Check the host, port and certificate.':
    'SQL Server 네트워크/TLS 연결에 실패했습니다. 호스트, 포트와 인증서를 확인하세요.',
  'SQL Server request timed out.': 'SQL Server 요청 제한 시간을 초과했습니다.',
  'Query cancelled.': '쿼리를 취소했습니다.',
  'The database connection is closed. Reconnect to continue.':
    '데이터베이스 연결이 닫혔습니다. 다시 연결하세요.',
  'Database operation failed': '데이터베이스 작업에 실패했습니다.',
  'Writes are disabled. Enable restricted writes on the connection profile and reconnect.':
    '쓰기가 비활성화되어 있습니다. 연결 편집에서 제한 쓰기를 허용한 뒤 다시 연결하세요.',
  'Wait for the current query before previewing a mutation':
    '현재 쿼리가 끝난 뒤 쓰기를 미리 볼 수 있습니다.',
  'Mutation connection changed or closed':
    '쓰기 연결이 변경되었거나 닫혔습니다.',
  'Database service is shutting down':
    '데이터베이스 서비스를 종료하는 중입니다.',
  'Connection operation is in progress': '연결 작업이 진행 중입니다.',
  'No database connected. Select and connect a saved connection first.':
    '연결된 데이터베이스가 없습니다. 저장된 연결을 선택하고 접속하세요.',
  'Metadata connection changed': '메타데이터 연결이 변경되었습니다.',
  'Disconnect before editing a connection': '연결을 끊은 뒤 편집하세요.',
  'Maximum 30 saved connections': '연결은 최대 30개까지 저장할 수 있습니다.',
  'Disconnect before connecting or changing database':
    '새로 연결하거나 데이터베이스를 바꾸기 전에 연결을 끊으세요.',
  'Metadata scope is disconnected or has changed':
    '메타데이터 공유 연결이 끊겼거나 범위가 변경되었습니다.',
  'Too many pending approvals': '대기 중인 승인 요청이 너무 많습니다.',
  'Query approval is missing, expired or belongs to another connection. Review again.':
    '쿼리 승인이 없거나 만료되었거나 다른 연결의 승인입니다. 다시 검토하세요.',
  'One query per connection can run at a time':
    '연결당 한 번에 쿼리 하나만 실행할 수 있습니다.',
  'Duplicate request ID': '중복된 요청 ID입니다.',
  'Query policy changed. Review again.':
    '쿼리 정책이 변경되었습니다. 다시 검토하세요.',
  'Query timed out': '쿼리 제한 시간을 초과했습니다.',
  'Result limit reached; output was truncated.':
    '결과 상한에 도달해 일부만 표시합니다.',
  Completed: '완료',
  'Query cancelled': '쿼리를 취소했습니다.',
  'Query cancelled by user': '사용자가 쿼리를 취소했습니다.',
  'Application closing': '앱을 종료하는 중입니다.',
  'Mutation approval is missing or already consumed':
    '쓰기 승인이 없거나 이미 사용되었습니다.',
  'Transaction setup failed or its outcome is uncertain. Connection closed; verify server state before retrying.':
    '트랜잭션 시작에 실패했거나 결과가 불확실합니다. 연결을 닫았습니다. 다시 시도하기 전에 서버 상태를 확인하세요.',
  'Rollback could not be confirmed. Connection closed; verify server state. Do not retry automatically.':
    '롤백을 확인하지 못해 연결을 닫았습니다. 서버 상태를 확인하고 자동으로 재시도하지 마세요.',
  'Mutation cancelled and rollback acknowledged. Reconnect before further work.':
    '쓰기를 취소하고 롤백을 확인했습니다. 다음 작업 전에 다시 연결하세요.',
  'Mutation refused or failed; rollback acknowledged. Preview again after reconnecting.':
    '쓰기가 거부되었거나 실패하여 롤백했습니다. 다시 연결한 뒤 새로 미리 보세요.',
  'Preview cancelled or refused: unsupported target, changed schema, permissions, row limit, or driver error. No write was applied.':
    '미리보기가 취소되거나 거부되었습니다. 미지원 대상, 스키마 변경, 권한, 행 상한 또는 드라이버 오류를 확인하세요. 쓰기는 적용되지 않았습니다.',
  'Approval hash/state/policy/expiry mismatch. Cancel and preview again.':
    '승인 해시·상태·정책·유효 시간이 일치하지 않습니다. 취소한 뒤 다시 미리 보세요.',
  'Mutation policy changed': '쓰기 정책이 변경되었습니다.',
  'Mutation service is shutting down': '쓰기 서비스를 종료하는 중입니다.',
  'Finish or cancel the existing mutation first':
    '기존 쓰기 작업을 먼저 완료하거나 취소하세요.',
  'Reading a bounded target preview. No write has been applied.':
    '제한된 대상 샘플을 조회하는 중입니다. 쓰기는 아직 적용하지 않았습니다.',
  'Invalid bounded snapshot': '유효하지 않은 대상 스냅샷입니다.',
  'No changes yet. Preview expires in60s. Target versions will be rechecked under locks before applying.':
    '아직 변경하지 않았습니다. 미리보기는 60초 후 만료됩니다. 적용 전 잠금 상태에서 대상 버전을 다시 확인합니다.',
  'Connection generation changed. Nothing applied; preview again.':
    '연결 세대가 변경되었습니다. 변경을 적용하지 않았습니다. 다시 미리 보세요.',
  'Preview changed': '미리보기 대상이 변경되었습니다.',
  'Applied rows mismatch or cancelled':
    '적용 행이 일치하지 않거나 취소되었습니다.',
  'Applied inside an UNCOMMITTED transaction. Commit explicitly or rollback. Automatic rollback in30s; locks may block other sessions.':
    '아직 COMMIT하지 않은 트랜잭션에 적용했습니다. 직접 COMMIT하거나 롤백하세요. 30초 후 자동 롤백하며 잠금으로 다른 세션이 대기할 수 있습니다.',
  'Commit token or exact database confirmation mismatch':
    'COMMIT 토큰 또는 데이터베이스 이름 확인이 일치하지 않습니다.',
  'COMMIT outcome is UNKNOWN. Connection closed; verify the database before retrying. Rollback is not assumed.':
    'COMMIT 결과가 불명확합니다. 연결을 닫았습니다. 롤백되었다고 가정하지 말고 다시 시도하기 전에 실제 DB를 확인하세요.',
  'COMMIT acknowledged. Connection closed to reset session state; reconnect before further work.':
    'COMMIT을 확인했습니다. 세션 상태를 초기화하기 위해 연결을 닫았습니다. 다음 작업 전에 다시 연결하세요.',
  'COMMIT has been submitted and cannot be cancelled. Wait and verify the outcome.':
    '이미 COMMIT을 요청하여 취소할 수 없습니다. 완료를 기다린 뒤 결과를 확인하세요.',
  'Rollback could not be confirmed. Verify DB state; no automatic retry.':
    '롤백을 확인하지 못했습니다. 실제 DB 상태를 확인하고 자동으로 재시도하지 마세요.',
  'Rollback acknowledged. Connection closed to reset session state.':
    '롤백을 확인했습니다. 세션 상태를 초기화하기 위해 연결을 닫았습니다.',
  'Preview cancelled or expired. No write applied.':
    '미리보기가 취소되거나 만료되었습니다. 쓰기는 적용되지 않았습니다.',
  'Connection cleanup failed; do not reuse it.':
    '연결 정리에 실패했습니다. 이 연결을 재사용하지 마세요.',
  'Local history could not be saved; this does not change the DB outcome.':
    '로컬 이력을 저장하지 못했습니다. 실제 DB 처리 결과는 바뀌지 않습니다.',
  'SQL exceeds 200 KB': 'SQL이 200 KB를 초과합니다.',
  'SQL is too complex': 'SQL이 복잡도 한도를 초과합니다.',
  'Comment nesting limit': '주석 중첩 한도를 초과합니다.',
  'Unclosed comment': '닫히지 않은 주석입니다.',
  'Unclosed string': '닫히지 않은 문자열입니다.',
  'Invalid quoted identifier': '인용된 식별자가 올바르지 않습니다.',
  'Expected an identifier; unsupported SQL is blocked':
    '식별자가 필요합니다. 지원하지 않는 SQL은 차단됩니다.',
  'Expression nesting limit': '표현식 중첩 한도를 초과합니다.',
  'Only allowlisted built-in scalar/aggregate functions are supported':
    '허용 목록에 있는 내장 스칼라·집계 함수만 지원합니다.',
  'DROP and TRUNCATE are always blocked': 'DROP과 TRUNCATE는 항상 차단됩니다.',
  'Only restricted UPDATE/DELETE/INSERT are supported; DDL, MERGE and batches are blocked':
    '제한된 UPDATE/DELETE와 엑셀 INSERT만 지원합니다. DDL·MERGE·일괄 문장은 차단됩니다.',
  'Duplicate assignment or too many columns':
    '중복된 대입이 있거나 컬럼 수가 너무 많습니다.',
  'SET values must be literals; expressions, functions and DEFAULT are blocked':
    'SET에는 리터럴 값만 사용할 수 있습니다. 표현식·함수·DEFAULT는 차단됩니다.',
  'WHERE is required: full-table UPDATE/DELETE is blocked':
    'WHERE가 필요합니다. 테이블 전체 UPDATE/DELETE는 차단됩니다.',
  'WHERE must compare local columns with literals; constant predicates, functions and subqueries are blocked':
    'WHERE는 현재 테이블 컬럼과 리터럴 값을 비교해야 합니다. 상수 조건·함수·하위 쿼리는 차단됩니다.',
  'Unsupported write syntax: joins, aliases, hints, OUTPUT and batches are blocked':
    '지원하지 않는 쓰기 구문입니다. 조인·별칭·힌트·OUTPUT·일괄 문장은 차단됩니다.',
  'TOP requires a positive integer': 'TOP에는 양의 정수가 필요합니다.',
  'Unsupported SQL. Writes, batches, CTEs, subqueries, variables, hints and cross-database queries are blocked in Phase 2.':
    '지원하지 않는 SELECT 구문입니다. 쓰기·일괄 문장·CTE·하위 쿼리·변수·힌트·다른 DB 조회는 차단됩니다.',
  'Invalid row limit': '행 수 제한이 올바르지 않습니다.',
  'NUL is not allowed in mutation SQL':
    '쓰기 SQL에 NUL 문자를 사용할 수 없습니다.',
  'Mutation SQL exceeds 16000 characters':
    '쓰기 SQL은 16,000자를 초과할 수 없습니다.',
  'Already connected': '이미 연결되어 있습니다.',
  'Connection is not available. Reconnect to continue.':
    '연결을 사용할 수 없습니다. 다시 연결하세요.',
  'Only current-database user tables are allowed by the Phase 2 execution policy':
    '현재 데이터베이스의 사용자 테이블만 조회할 수 있습니다.',
  'Results exceed the 256-column limit': '결과가 최대 256열을 초과합니다.',
  'Unable to serialize a SQL result value':
    'SQL 결과 값을 변환하지 못했습니다.',
  'Transaction already active': '이미 진행 중인 트랜잭션이 있습니다.',
  'Not connected': '연결되어 있지 않습니다.',
  'No transaction': '진행 중인 트랜잭션이 없습니다.',
  'Write opt-in is required': '제한 쓰기를 직접 허용해야 합니다.',
  'Mutation cancelled': '쓰기를 취소했습니다.',
  'Write target refused: metadata visibility/permissions or unsupported table side effects':
    '메타데이터 조회·쓰기 권한이 없거나 지원하지 않는 테이블 부작용이 있어 대상을 거부했습니다.',
  'Write target requires a PK and bounded built-in scalar columns; computed/LOB/user-defined types are unsupported':
    'PK·길이가 제한된 내장 스칼라 컬럼이 필요합니다. 계산 컬럼·LOB·사용자 정의 타입은 지원하지 않습니다.',
  'Use exact, existing column names':
    '실제 컬럼 이름을 대소문자까지 정확하게 사용하세요.',
  'PK, identity and rowversion updates are blocked':
    'PK·identity·rowversion 컬럼 변경은 차단됩니다.',
  'Invalid target snapshot': '대상 스냅샷이 올바르지 않습니다.',
  'Locked preview requires a transaction':
    '잠금 미리보기에는 트랜잭션이 필요합니다.',
  'Preview must match between 1 and 1000 rows; narrow the WHERE clause':
    '미리보기 대상은 1~1000행이어야 합니다. WHERE 조건을 좁히세요.',
  'Ambiguous rowversion snapshot':
    '대상 스냅샷이 행을 고유하게 구분하지 못합니다.',
  'Table metadata changed during preview':
    '미리보기 도중 테이블 메타데이터가 변경되었습니다.',
  'Mutation requires a transaction': '쓰기에는 트랜잭션이 필요합니다.',
  'Mutation policy or target metadata changed':
    '쓰기 정책 또는 대상 메타데이터가 변경되었습니다.',
  'Affected rows differ from the approved snapshot; rollback required':
    '영향받은 행이 승인한 스냅샷과 다릅니다. 롤백이 필요합니다.',
  'Install the official Codex CLI, then sign in with ChatGPT in your terminal.':
    '공식 Codex CLI를 설치한 뒤 터미널에서 ChatGPT 계정으로 로그인하세요.',
  'Assistant is shutting down.': 'AI 도우미를 종료하는 중입니다.',
  'API-key environment detected. This app does not use API billing. Remove it from the app environment and use ChatGPT login.':
    'API 키 환경변수가 감지되었습니다. 이 앱은 API 과금을 사용하지 않습니다. 앱 환경에서 키를 제거하고 ChatGPT 로그인을 사용하세요.',
  'Required CLI isolation options are unavailable.':
    '필수 CLI 격리 옵션을 사용할 수 없습니다.',
  'API-key CLI authentication is not supported. Use the official CLI ChatGPT login; no automatic fallback.':
    'API 키 방식의 CLI 인증은 지원하지 않습니다. 공식 CLI의 ChatGPT 로그인을 사용하세요. 자동 대체는 없습니다.',
  'ChatGPT authentication could not be verified. Run codex login in your terminal.':
    'ChatGPT 인증을 확인하지 못했습니다. 터미널에서 codex login을 실행하세요.',
  'ChatGPT login verified. Only your message is sent; no DB context or tools. CLI usage limits apply.':
    'ChatGPT 로그인 확인 완료. 기본은 메시지만 전송하며 DB 정보·도구 공유는 직접 켜야 합니다. CLI 사용량 제한이 적용됩니다.',
  'CLI inspection failed or timed out. Check the official CLI in your terminal.':
    'CLI 확인에 실패했거나 제한 시간을 초과했습니다. 터미널에서 공식 CLI를 확인하세요.',
  'Assistant unavailable or busy':
    'AI 도우미를 사용할 수 없거나 다른 요청을 처리 중입니다.',
  'CLI did not complete successfully. Check login, usage limits and CLI compatibility.':
    'CLI 요청을 완료하지 못했습니다. 로그인, 사용량 제한과 CLI 호환성을 확인하세요.',
  'CLI stopped: timeout, invalid stream or output limit. No automatic retry.':
    'CLI가 중지되었습니다. 제한 시간·잘못된 응답·출력 상한을 확인하세요. 자동 재시도는 하지 않습니다.',
  'Install the official GitHub Copilot CLI, then sign in with copilot login in your terminal.':
    '공식 GitHub Copilot CLI를 설치한 뒤 터미널에서 copilot login으로 로그인하세요.',
  'This Copilot CLI lacks the required isolation options. Update the official CLI.':
    '이 Copilot CLI에는 필요한 격리 옵션이 없습니다. 공식 CLI를 업데이트하세요.',
  'GitHub Copilot sign-in was not found. Run copilot login in your terminal.':
    'GitHub Copilot 로그인을 찾지 못했습니다. 터미널에서 copilot login을 실행하세요.',
  'GitHub Copilot sign-in found. Copilot premium request limits apply.':
    'GitHub Copilot 로그인을 확인했습니다. Copilot 프리미엄 요청 한도가 적용됩니다.',
  'Assistant shutting down': 'AI 도우미를 종료하는 중입니다.',
  'Assistant busy or shutting down':
    'AI 도우미가 다른 요청을 처리 중이거나 종료 중입니다.',
  'No resumable session for this provider':
    '이 제공자에서 이어갈 수 있는 대화가 없습니다.',
  'Metadata integration is unavailable':
    '메타데이터 연동을 사용할 수 없습니다.',
  'Provider unavailable or request rejected. Inspect CLI status.':
    'AI 제공자를 사용할 수 없거나 요청이 거부되었습니다. CLI 상태를 확인하세요.',
  'Cancel the active request before resetting':
    '진행 중인 요청을 취소한 뒤 대화를 초기화하세요.',
  'CLI reported an error. Check authentication and subscription usage in the official CLI.':
    'CLI에서 오류가 발생했습니다. 공식 CLI에서 인증 및 구독 사용량을 확인하세요.',
  'CLI request failed. Check login and subscription usage in the official CLI.':
    'CLI 요청에 실패했습니다. 공식 CLI에서 로그인과 구독 사용량을 확인하세요.',
  'OS credential encryption is unavailable. No credentials were saved.':
    '운영체제의 자격 증명 암호화를 사용할 수 없습니다. 자격 증명을 저장하지 않았습니다.',
  'Connection storage ID mismatch': '저장된 연결 ID가 일치하지 않습니다.',
  'A password is required for a new connection':
    '새 연결에는 비밀번호가 필요합니다.',
  'Connection not found': '연결을 찾을 수 없습니다.',
}
