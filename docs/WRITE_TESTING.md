# Phase 5 — 제한 쓰기 설계와 검증

## 실행 전 범위/결정

- 새 의존성 없이 기존 lexer/식 AST를 확장한다. SELECT 경계는 유지하며 UPDATE/DELETE 전용의 더 좁은 문법만 추가한다. 복잡한 T-SQL/INSERT/MERGE/DDL/배치/동적 SQL은 지원하지 않는다. DROP/TRUNCATE와 WHERE 없는 쓰기는 경고 후 차단한다.
- 기본 연결은 readOnly=true다. ADR-031부터 개발·운영 모두 연결 편집의 "제한 쓰기 허용"으로 readOnly=false를 저장할 수 있다(운영은 경고 표시). 실제 가능한 작업은 로그인 계정의 DB 권한을 따른다. MCP/AI에는 쓰기·승인·트랜잭션 도구를 추가하지 않는다.
- PK와 NOT NULL rowversion이 있는 제한된 일반 테이블만 지원한다. 트리거/연쇄 변경/계산 컬럼·CHECK·RLS 등 지원되지 않는 부작용이 있는 테이블은 거부한다. 메타데이터 가시성과 대상 권한을 확인한다.
- 미리보기는 최대1000개 대상(ADR-018에서 100→1000)과 정확한 rowversion 집합을 얻는다. 이후 적용 때 같은 트랜잭션에서 잠금 미리보기를 다시 읽고 동일 집합/메타데이터인지 검증한다. 바뀌면 쓰지 않고 rollback한다. 잠금 없이 본 오래된 미리보기를 그대로 승인하지 않는다.
- Main 승인 해시는 정책 버전/연결 세대/DB/실제 생성 SQL/메타데이터/대상 집합에 묶인다. Renderer는 SQL을 실행 인자로 다시 보낼 수 없다. 적용은 단 한 번이며, COMMIT에는 별도 토큰과 DB 이름 확인이 필요하다.
- 트랜잭션 미확정 대기는30초 후 rollback한다. 취소/실패/연결 해제/종료 시 rollback·자원 정리를 한다. COMMIT을 보낸 뒤 결과가 불명확하면 성공/rollback으로 가장하거나 자동 재시도하지 않는다.

대안: UI 미리보기 동안 잠금을 유지하는 방식은 동시 변경을 막지만 사용자 판단 시간 동안 DB를 막는다. 대신 rowversion 기반 낙관적 검증 후 적용 구간에만 같은 트랜잭션의 잠금을 사용한다. rowversion 없는 테이블은 임의 직렬화로 동일성을 추정하지 않고 거부한다.

검증 계획: 기존 SELECT 회귀 → 쓰기 AST 공격/양성 → Main 승인/상태/롤백 대역 → mssql 생성 SQL·잠금·부작용 차단 대역 → Electron IPC/UI 비활성 기본값 → 전체 typecheck/lint/unit/build/e2e/format. 실DB 쓰기는 전용 테스트 DB/fixture와 명시적 opt-in이 없으면 실행하지 않고 미검증으로 남긴다.

공식 근거: [rowversion](https://learn.microsoft.com/en-us/sql/t-sql/data-types/rowversion-transact-sql), [UPDLOCK/HOLDLOCK](https://learn.microsoft.com/en-us/sql/t-sql/queries/hints-transact-sql-table), [node-mssql transaction](https://tediousjs.github.io/node-mssql/). 잠금/트랜잭션은 동시 DBA의 권한·DDL 변경이나 악성 서버에 대한 완전한 보장이 아니다.

## 구현과 사용

1. 기본 연결은 여전히 SELECT 전용이다. **연결을 끊은 뒤** Edit connection → Development → **Allow guarded development writes**를 명시적으로 켜고 저장·재접속한다. Production은 readOnly=false를 Main Zod 계약부터 거부한다. Development 라벨은 실제 서버가 테스트 서버라는 증거가 아니므로 운영 서버를 Development로 표시해 우회하지 않는다.
2. SQL 편집기에 제한 UPDATE/DELETE를 입력하고 **Preview UPDATE or DELETE**를 누른다. 기존 Run query는 계속 SELECT 전용이다. 미리보기는 쓰기를 적용하거나 트랜잭션을 열지 않는다.
3. 대상 수/샘플/정규화 SQL·해시를 확인하고 **I reviewed...**를 선택한 뒤 **Apply in transaction — not COMMIT**을 누른다. Main이 SERIALIZABLE 트랜잭션을 열고 UPDLOCK/HOLDLOCK 조회로 대상/메타데이터를 재검증한다. 변경이 있으면 쓰기 전에 rollback한다.
4. 적용 후에도 **UNCOMMITTED**다. 별도의 commit token과 DB 이름의 정확한 재입력 없이는 COMMIT하지 않는다. **Cancel / Rollback transaction**으로 되돌릴 수 있다. 미확정 대기30초가 지나면 자동 rollback한다.
5. COMMIT/rollback/불명확 실패로 트랜잭션이 끝나면 해당 pool/session을 닫고 다시 연결하도록 한다. SERIALIZABLE 등 세션 상태가 후속 SELECT에 누수되는 것을 피하기 위한 보수적 선택이다. 이전 결과 그리드는 자동으로 재실행하지 않으므로 새 조회로 확인한다.

취소 요청 뒤에는 commit 검증을 즉시 막고 rollback 작업을 공유한다. 이미 보낸 COMMIT에는 rollback을 경쟁 실행하지 않는다. COMMIT ack를 받지 못하면 **unknown**으로 기록하며 성공/rollback을 추정하거나 자동 재시도하지 않는다. 운영자가 실제 DB 상태를 확인해야 한다. 요청 취소/드라이버 timeout은 적용하지만 네트워크 장애에서 트랜잭션 제어 ack/연결 정리가 반드시 정해진 초 안에 끝난다고 보장하지 않는다.

## 지원 문법과 대상

```sql
UPDATE dbo.items SET amount = 20, note = N'reviewed' WHERE id = 1;
DELETE FROM dbo.items WHERE id IN (1, 2) AND amount < 10;
```

- 단일 schema.table만 허용한다. SET은 숫자/유니코드 문자열/NULL과 부호 숫자 리터럴만 허용한다. WHERE는 로컬 컬럼과 리터럴의 비교/IN/LIKE/IS NULL 및 AND/OR/NOT로 제한한다. 정확한 메타데이터 컬럼 이름을 사용한다. 예약어 컬럼은 대괄호로 감싼다.
- WHERE 누락은 경고 후 **차단**하며 일괄 전체 변경 승인을 따로 제공하지 않는다. `WHERE 1=1`도 거부한다. 컬럼 조건이 넓어지는 경우라도 대상1~1000개 상한이 적용된다.
- INSERT/MERGE/DDL/DROP/TRUNCATE/EXEC/배치/CTE/하위 쿼리/힌트/조인/별칭/사용자 OUTPUT/함수/SET 계산식/DEFAULT는 거부한다. PK/identity/rowversion 변경도 거부한다. 복잡한 T-SQL을 지원한다고 주장하지 않는다.
- 대상에 PK와 NOT NULL rowversion이 필요하다. 트리거, CHECK, RLS, 연쇄 FK 작업, temporal/replication/CDC/stretch, 계산·hidden/generated(그래프/ledger 포함)·암호화·마스킹·사용자 정의 타입·큰 LOB 등 지원하지 않는 기능은 거부한다. 자동으로 컬럼/테이블/권한을 만들거나 바꾸지 않는다. 필요한 sys 메타데이터가 없는 서버도 실패 폐쇄한다.
- DB VIEW DEFINITION과 대상 SELECT 및 해당 UPDATE/DELETE 권한을 확인한다. 앱이 권한을 부여하지 않는다. 신뢰할 수 있는 DBA의 안정적인 스키마와 최소 권한 테스트 계정을 사용한다.

## 승인·미리보기·정리 경계

- Main의 승인 해시는 정책 버전/연결 세대/DB/메타데이터 fingerprint/정렬된 rowversion 집합/실제 생성 SQL에 묶인다. 적용 전 원문을 다시 파싱하고 비교한다. Renderer는 apply/commit 호출에 SQL을 전달할 수 없다. 별도 raw BEGIN/COMMIT/SQL 실행 IPC는 없다.
- 실제 생성 SQL에는 Main이 만든 `OUTPUT deleted.rowversion` 변환과 정확한 rowversion IN guard가 포함된다. rowversion은 먼저 `binary(8)`로 변환한 뒤 16진수 varchar로 변환한다. 직접 varchar 변환은 실제 서버에서 잘못된 문자열을 만들어 거부되는 것을 발견해 수정했다. 이 SQL도 검토 카드와 승인 해시에 포함한다. 적용 후 반환된 이전 버전 집합까지 확인하고 다르면 rollback한다.
- 미리보기는 TOP1001로1000개 초과를 감지하고, 표시 샘플은 최대20행/16열/셀512문자/64KiB다. 표시가 일부 잘려도 승인 대상의 정확한 버전 집합은 별도로 유지한다. rowversion 없는 테이블을 손실 있는 문자열 샘플 해시로 승인하지 않는다.
- 미리보기 유효 시간60초, 적용 중 요청 timeout은 설정과30초 중 작은 값, 적용 후 미확정 대기30초다. 같은 연결의 SELECT 실행과 메타데이터 조회/다른 쓰기를 격리한다. 실행 중 메타데이터가 있으면 쓰기 lease를 얻지 못한다. 단절/삭제/앱 종료는 쓰기 정리를 먼저 수행한다.
- 이력은 committed/rolled-back/unknown과 취소/오류를 구별한다. 이력 rowCount는 검토/적용 대상 수이며 rollback된 행을 영구 반영 건수로 해석하지 않는다. COMMIT ack 후 로컬 SQLite 이력 저장 실패를 DB commit 실패로 바꾸지 않는다.
- SQL 탭/이력은 평문이다. 비밀값을 SQL에 넣지 않는다. 새 코드/DTO/IPC는 Main에만 쓰기 권한을 두며 **MCP/CLI 도구는 계속 읽기·SELECT 제안 전용**이다. AI에 승인/commit 토큰을 제공하지 않는다.

## 검증 결과와 수용 갭

2026-10-28 사용자 승인 후 로컬 MSSQLSERVER01을 혼합 인증/loopback TCP14331로 구성해 아래 실제 DB 검증을 실행했다. 전용 fixture DB 안에서만 DDL/DML을 수행했고 준비용 db_owner와 앱용 최소 권한 계정을 분리했다. 실제 앱 세션의 TCP/SQL 인증/암호화(TRUE)/sysadmin=0도 확인했다. 개발 self-signed 인증서 신뢰 옵션을 사용했으며 신뢰 인증서의 Production TLS 수용과 구분한다.

| 검증                | 결과                                   |
| ------------------- | -------------------------------------- |
| 변경 전 단위 회귀   | 기존115개 통과                         |
| typecheck / lint    | strict/경고0 통과                      |
| 최종 unit           | 9개 파일, 182개 통과                   |
| build               | Main/stdio relay/preload/renderer 통과 |
| opt-in Electron E2E | 로컬5개 + 실제 DB2개 통과, AI1개 skip  |
| opt-in integration  | stdio3개 + 실제 DB3개 통과, AI2개 skip |

unit은 양성/공격 문법, 개발 opt-in·운영 거부, 실제 SQL 생성/메타데이터 바인딩/부작용 차단/대상 상한, 승인 해시·재사용·세대·대상 변경, SERIALIZABLE 요청, 적용/commit 분리, 취소/timeout/30초 timer/shutdown rollback, commit-vs-rollback 경쟁 차단, 불명확 ack/rollback 실패/이력 저장 실패를 검증한다. **DB/드라이버는 명시적인 대역이다.**

Electron 테스트 하나는 실제 Main/preload/SQLite에서 기본 비활성·개발 opt-in 저장/복원·운영 모드 거부·위험 SQL/가짜 승인 거부를 확인한다. 기존 `mutation-flow.spec.ts`는 **Main 쓰기 핸들러 대역**이다. 새 `live-mutations.spec.ts`는 대역 없이 연결 입력 UI → 실제 Main/드라이버 → SQL Server를 사용한다. 미리보기 무변경/검토/apply/rollback, 잘못된 DB 이름 COMMIT 비활성, 정확한 DB 이름 UPDATE·DELETE commit과 실제 저장 결과, 미확정 상태 앱 종료 rollback을 검증했다.

실DB backend는 UPDATE·DELETE commit/rollback, 별도 연결의 잠금 timeout, 오래된 미리보기 거부, 트리거·UPDATE 권한 거부, 30초 자동 rollback/서비스 종료 rollback을 통과했다. timer 검증은 state 조회의 만료 fallback을 호출하지 않고 독립 연결의 DB 잠금 해제를 확인한다. `mssql-fixture.test.ts`는 SELECT-only 계정의 실제 권한 검사와 5000행/4MiB/LOB 제한, 잠금 대기 중 취소·timeout 및 이후 재조회 성공을 확인한다. COMMIT ack 손실/실제 네트워크 장애는 대역 검증만 존재한다. 운영 쓰기를 지원한다는 의미가 아니며 Phase 6는 시작하지 않았다.

## 실DB 테스트의 명시적 opt-in

`tests/integration/mutations.test.ts`는 아래 두 조건과 접속 환경변수가 모두 있어야 실행된다.

- `AI_DB_TEST_ALLOW_WRITES=dedicated-fixture-only`
- 이미 별도로 준비된 DB 이름이 `aidb_write_test_<영문숫자_접미사>` 형식

테스트는 DB/로그인을 만들지 않는다. 그 전용 DB 안에 무작위 `dbo.aidb_write_fixture_<32자리 hex>` 테이블만 만들고 검증 후 **자신이 만든 테이블만** 제거한다. 준비용 계정을 별도로 제공하면 해당 fixture 객체에만 앱 계정의 SELECT/UPDATE/DELETE를 부여하고 거부 테스트에서 fixture-local DENY/GRANT를 수행한다. DB/서버 전체 권한은 변경하지 않는다. 업무 DB 이름이나 일반 AI_DB_TEST_* 설정만으로 쓰기가 켜지지 않는다. 환경변수/암호를 출력하거나 파일에 저장하지 않는다.

- `AI_DB_TEST_USER/PASSWORD`: 앱용 계정. 전용 DB CONNECT/SELECT/VIEW DEFINITION, fixture 객체별 UPDATE/DELETE만 필요하며 db_owner/sysadmin/DDL은 필요 없다.
- `AI_DB_TEST_SETUP_USER/PASSWORD`: 두 값 모두 별도로 주입한다. 전용 DB에만 db_owner인 준비용 계정으로 fixture 생성/권한/정리를 담당한다. 생략하면 이전 단일 계정 방식으로 동작하지만 최소 권한 거부 검증의 증거로 사용하지 않는다.
- `AI_DB_TEST_READ_USER/PASSWORD`: SELECT-only 권한 검사/대량 결과/취소·timeout 테스트에 필요한 별도 읽기 계정. 전용 DB CONNECT/SELECT/VIEW DEFINITION만 부여한다. 없으면 해당 추가 fixture 테스트만 skip한다.
- `AI_DB_TEST_HOST/PORT/DATABASE/TRUST_CERT`: 기존 MSSQL_TESTING.md 계약과 같다. 로컬 검증은 `127.0.0.1:14331`과 개발 인증서 신뢰 옵션을 사용했다. 자격 증명은 프로세스 환경으로만 주입하며 준비용 계정 암호를 앱 연결에 사용하지 않는다.

```powershell
# 먼저 승인된 전용 테스트 DB와 접속 정보를 안전하게 준비한다.
$env:AI_DB_TEST_ALLOW_WRITES = 'dedicated-fixture-only'
try {
  pnpm exec vitest run --config vitest.integration.config.ts tests/integration/mutations.test.ts
  pnpm exec vitest run --config vitest.integration.config.ts tests/integration/mssql-fixture.test.ts
  pnpm build
  pnpm exec playwright test tests/e2e/live-mutations.spec.ts
} finally {
  Remove-Item Env:AI_DB_TEST_ALLOW_WRITES -ErrorAction SilentlyContinue
}
```

2026-10-28에는 위 실제 DB 테스트가 통과했다. 기본 실행은 여전히 opt-in/계정이 없으면 skip이며, 이후 실행의 skip을 과거 실DB 증거로 대체하지 않는다. 임시 암호/로그인을 보존하지 않았으므로 재실행 시 다시 안전하게 준비해야 한다.
