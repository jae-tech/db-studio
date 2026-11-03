# 읽기 기준과 Phase 5 안내

이 문서의 SQL 실행 설명은 Phase 2 읽기 경로 기준이다. 이후 추가한 개발 opt-in 제한 쓰기와 미완료 실DB 수용은 [WRITE_TESTING.md](WRITE_TESTING.md)를 먼저 확인한다. 기존 읽기 테스트 환경변수만으로 쓰기 테스트를 활성화하지 않는다.

# MSSQL 사용 및 검증

2026-10-28 업데이트: 승인된 로컬 MSSQLSERVER01의 loopback TCP14331/SQL 인증으로 실제 읽기·쓰기와 Electron 수용을 추가 검증했다. `mssql-fixture.test.ts`는 별도 SELECT-only 계정으로 5000행/4MiB/LOB 제한과 잠금 대기 중 취소·timeout을 확인한다. 이 추가 fixture 테스트는 쓰기 opt-in도 필요하며 DB/준비용/읽기용 계정 조건은 WRITE_TESTING.md를 따른다. 신뢰 인증서의 Production 전체 경로는 여전히 미검증이다. 최신 결과는 LIVE_VALIDATION.md의 2026-10-28 항목이 기준이다.

## 앱에서 연결

`pnpm dev` → Explorer의 New connection → SQL Server host/명시적 TCP port/database/SQL username/password 입력 → Save connection → Connect. 저장 자체는 접속 성공을 의미하지 않는다. SQL Server 2016 이상(on-prem MSSQL) 메타데이터를 대상으로 구현했다. Windows 통합 인증, SQL Browser를 통한 named instance 포트 탐색, Azure 특수 권한 지원은 검증하지 않았다.

TLS는 항상 켜진다. 자체 서명 인증서는 개발·운영 모두 "서버 인증서 신뢰" 체크박스(SSMS의 Trust server certificate와 같음)로 명시 허용할 수 있고, 운영에서 켜면 경고를 표시한다(ADR-031). 운영 계정의 권한은 앱이 SELECT 전용으로 강제하지 않고 DB 역할을 따른다. `ApplicationIntent=ReadOnly` 같은 라우팅 옵션을 읽기 전용 권한 보장으로 간주하지 않는다.

연결 클릭 후 SQL 탭에 해당 연결이 지정된다. 각 탭의 SQL connection으로 별도 연결을 지정할 수 있다. Explorer DB 선택을 바꾸면 기존 pool을 종료하고 새 DB에서 권한을 다시 검사한다. 테이블을 펼치면 컬럼/PK/인덱스/FK가 나온다. Open SELECT in editor는 SQL만 작성하고 실행하지 않는다.

Run query 또는 Ctrl+Enter → 정규화된 SQL/대상 DB/시간·행 제한 검토 → Approve and execute. Cancel query는 해당 요청을 취소한다. 읽기는 자동 실행되지 않으며, 앱 밖에서 DB 계정 권한도 읽기 전용으로 제한해야 한다. SQL Server 오류는 코드와 안전한 메시지로 표시된다.

## 허용되는 SQL

```sql
SELECT 42 AS answer;

SELECT TOP (100) p.id, UPPER(p.name) AS display_name
FROM dbo.people AS p
WHERE p.id IN (1, 2, 3) AND p.name IS NOT NULL
ORDER BY p.id DESC;
```

FROM/JOIN은 현재 DB의 실제 사용자 테이블만 허용한다. 식별자는 schema.table 형식이고 별칭은 AS가 필요하다. 허용 함수는 COUNT, SUM, AVG, MIN, MAX, COALESCE, ISNULL, NULLIF, LOWER, UPPER, LEN, ABS, ROUND, GETDATE, GETUTCDATE다. JOIN/WHERE/GROUP BY/HAVING/ORDER BY와 기본 산술·비교·논리·LIKE/IN/IS NULL을 지원한다.

CTE/서브쿼리/UNION/CASE/window/임시 테이블/뷰/TVF/저장 프로시저/힌트/변수/외부 DB/다중 문장/쓰기 구문은 미지원이며 실행 거부한다. 지원하지 않는 SQL을 원문 실행으로 우회하지 않는다. 입력은 200KB, 2000토큰, 식 중첩40으로 제한한다.

결과는 설정상 최대5000행, 4MiB, 256열로 제한하며 한도를 넘으면 스트림을 취소한다. 긴 셀은 잘릴 수 있다(문자8192, 바이너리2048바이트, 서버의 LOB textsize16384바이트). 결과 제목에 원래 연결/DB와 제한 표시가 남는다. 최대5개 탭 결과를 메모리에 유지한다. 이력은 최근100건이며 SQL 원문/DB명/연결명은 평문 SQLite다.

## 읽기 전용 테스트 계정

DBA가 별도 테스트 DB에 전용 SQL login/user를 준비한다. 이 앱은 사용자/테이블을 자동 생성하거나 기존 서비스/DB를 변경하지 않는다. 필요한 권한은 CONNECT, 대상 테이블/스키마 SELECT와 메타데이터 조회용 VIEW DEFINITION 정도다. db_owner/sysadmin/db_datawriter/EXECUTE/ALTER 권한을 부여하지 않는다. 기존 계정의 role/group/상속 권한도 검토한다. 운영 앱 검사에서는 알 수 없는 권한도 거부하므로 서버별 유효 권한 목록을 실제 검증해야 한다.

## 자동 검증

- `pnpm test`: 파서/계약/승인/수명/암호화 실패/드라이버 스트림의 단위 테스트. DB는 테스트 대역이며 실제 SQL Server 성공 검증이 아니다.
- `pnpm test:e2e`: 실제 Electron·OS 암호화·SQLite·UI 검증. 로컬 127.0.0.1:1의 연결 실패가 정상적으로 표시되는지 검사한다. 기존 서비스는 시작하지 않는다.
- `pnpm test:db`: 명시된 환경변수가 있을 때만 실제 MSSQL 연결/메타데이터/SELECT 42를 검증한다. 없으면 테스트를 skip한다.
- 같은 환경변수가 있으면 `pnpm test:e2e`의 live-mssql.spec.ts도 실제 UI 연결 → 검토 → 승인 → 그리드/이력을 검증한다. 없으면 skip한다.

환경변수는 로컬 보안 주입 방식으로 프로세스에 설정한다. `.env` 자동 로드는 없으며 비밀번호를 Git/문서/명령 기록에 넣지 않는다.

| 변수                  | 용도                             |
| --------------------- | -------------------------------- |
| AI_DB_TEST_HOST       | 필수, 테스트 서버                |
| AI_DB_TEST_DATABASE   | 필수, 전용 테스트 DB             |
| AI_DB_TEST_USER       | 필수, 테스트 SQL login           |
| AI_DB_TEST_PASSWORD   | 필수, 테스트 비밀번호            |
| AI_DB_TEST_PORT       | 기본1433                         |
| AI_DB_TEST_TRUST_CERT | 개발 self-signed 테스트에만 true |

테스트는 스키마를 수정하지 않는다. 실제 부하 취소/timeout/운영 권한 거부는 전용 fixture 환경에서 추가 수용 검증해야 한다. 성공을 테스트한 뒤 PROGRESS의 미검증 항목을 갱신한다.

2026-10-27 사용자 지정 실제 개발 DB의 backend/live Electron 테스트가 각각1개 통과했다. 인증서 신뢰 옵션과 정확한 검증 범위는 [LIVE_VALIDATION](LIVE_VALIDATION.md)을 참조한다. `node scripts/validate-live-mssql.mjs`는 환경변수의 자격 증명으로 master에서 사용자 DB를 발견하고 선택 DB의 기존 두 live 테스트를 실행한다. AI_DB_TEST_DATABASE가 없으면 이름순 첫 사용자 DB를 선택하며, 기본은 엄격한 인증서 검사다. 재검증에도 자격 증명을 새로 주입해야 한다.

## 공식 자료 (2026-10-27 확인)

- [node-mssql](https://github.com/tediousjs/node-mssql): pool/request/arrayRowMode/stream/cancel/transaction API.
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage): async API와 OS별 암호화 경계.
- [SQL Server fn_my_permissions](https://learn.microsoft.com/en-us/sql/relational-databases/system-functions/sys-fn-my-permissions-transact-sql?view=sql-server-ver17): 호출자 유효 권한 검사.
- [Tedious connection options](https://tediousjs.github.io/tedious/api-connection.html): TLS/timeout/textsize. readOnlyIntent는 Availability Group 라우팅 의도다.
