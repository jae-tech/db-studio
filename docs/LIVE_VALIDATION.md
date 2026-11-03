# 실제 MSSQL 검증 기록

## 2026-10-28 — 승인된 로컬 SQL Server 전체 읽기·쓰기 검증

- 사용자 제공 `localhost\MSSQLSERVER01`/Windows 인증으로 접속한 뒤, 사용자가 테스트 인스턴스의 모든 필요한 설정 변경/전용 DB·계정 구성을 승인했다. 혼합 인증/loopback TCP `127.0.0.1` 및 `::1:14331`로 구성하고 서비스를 재시작했다. 외부 NIC는 비활성/방화벽 변경 없음/sa 비활성을 유지했다. 원래 레지스트리 값은 로컬 `.omx/local-sql-validation/original-config.json`에 백업했다.
- SQL Server 17.0.1000.7 Standard Developer에서 실제 앱 세션의 TCP/SQL 인증/암호화 TRUE/서버 sysadmin=0을 DMV로 확인했다. 개발 인증서 신뢰 옵션을 사용했으며 Production 인증서 검증 성공으로 표시하지 않는다.
- 무작위 `aidb_write_test_local_*` DB에서 준비용 계정(db_owner, 해당 DB만), 쓰기용 계정(CONNECT/SELECT/VIEW DEFINITION + fixture별 UPDATE/DELETE), 별도 SELECT-only 계정을 사용했다. 암호는 실행 중 무작위 생성해 프로세스 환경으로만 전달했다. 앱과 OS 암호화 UI는 임시 userData로 실행했다.
- 실DB 쓰기 미리보기가 실패해 조사한 결과, rowversion 직접 varchar 변환이 기대한 16진수를 반환하지 않았다. `CONVERT(varchar(18),CONVERT(binary(8),rv),1)`를 실제 서버에서 확인하고 preview와 OUTPUT 생성 SQL에 적용했다. 먼저 회귀 테스트의 실패를 확인한 뒤 수정 후 통과시켰다.

| 새로 실행한 검증                | 결과                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck / lint / unit / build | strict / 경고0 / 182개 / 통과                                                                                                         |
| 실제 backend 포함 integration   | 6개 통과 (stdio3 + MSSQL 기본1 + 읽기 부하1 + 쓰기1), AI2개 skip                                                                      |
| 실제 DB 포함 Electron           | 7개 통과 (로컬5 + 실제 읽기1 + 실제 쓰기1), AI1개 skip                                                                                |
| 실제 쓰기 backend               | UPDATE·DELETE commit/rollback, 잠금 timeout, stale-preview/트리거/권한 거부, 정확한 DB 확인, 30초 자동 rollback, 서비스 종료 rollback |
| 실제 쓰기 UI                    | 연결 폼/preview 무변경/검토/apply/rollback/별도 DB 확인 UPDATE·DELETE commit/앱 종료 rollback                                         |
| 실제 읽기 부하                  | SELECT-only 권한 검사, 5000행/4MiB/LOB 제한, 잠금 대기 취소·1초 timeout/복구 조회                                                     |

과거 대역 UI 테스트와 달리 `tests/e2e/live-mutations.spec.ts`에는 IPC 핸들러 교체가 없다. fixture DDL/DML/권한 변경은 전용 DB의 무작위 테이블에 한정한다. 테스트별 테이블/트리거와 준비용·쓰기용·읽기용 임시 계정은 종료 후 제거한다. 실제 AI 구독 요청은 이번 DB 검증에서 실행하지 않았다. 신뢰된 인증서의 운영 TLS, 실제 DB MCP→CLI 전체 경로, Claude/SHOWPLAN, 네트워크 장애의 불명확 COMMIT 수용은 남아 있다.

최종 정리도 실제 조회로 확인했다. 이번 실행에서 생성한 무작위 DB6개는 모두 fixture/임시 사용자/사용자 세션이0개인 것을 확인한 뒤 제거했고, 빈 전용 `aidb_write_test_local`만 ONLINE으로 남겼다. 임시 SQL 로그인0개/앱 세션0개/남긴 DB 사용자 테이블0개, TCP listener가 loopback 두 주소에만 있는 것을 확인했다. SQL 서비스는 Running이다. 원래 Windows 통합 인증 접속은 계속 사용할 수 있으며 임시 SQL 계정 암호는 보존하지 않았다. 계정 없는 기본 integration도 다시 실행해 stdio3개 통과/실제 AI·DB5개 skip을 확인했다.

이하 내용은 2026-10-27 외부 개발 서버에서 실행한 과거 기록이다.

추가 기본 실행 검증: 계정/opt-in을 제거한 `pnpm test:e2e`도 새 빌드 후 로컬5개 통과/실제 DB·AI3개 skip이다. 위의 실제 DB opt-in 실행7개 통과와 별도 결과다.

검증일: 2026-10-27. 사용자가 지정한 개발 서버에 비파괴적 검증만 수행했다. 비밀번호는 숨김 입력을 거쳐 테스트 프로세스 환경에만 주입했으며 소스/문서/명령 문자열에 저장하지 않았다. Electron 테스트의 암호화 연결 프로필은 임시 userData에 저장되고 종료 후 삭제됐다.

## 접속과 범위

- 대상: 사용자 지정 개발 MSSQL 서버, 기본 TCP1433.
- 기본 연결 DB master에서 접근 가능한 사용자 DB23개를 발견했다. DB명이 별도로 지정되지 않아 이름순 첫 DB인 Athena를 선택했다.
- TLS 암호화 연결은 성공했다. 엄격한 서버 인증서 검증은 실패했고, 이 개발 서버에 한해 명시적 개발용 trustServerCertificate 옵션으로 재시도했다. 앱의 운영 TLS 정책은 변경하지 않았다.
- 실행 내용은 DB/스키마/테이블·컬럼/인덱스/FK 메타데이터 및 유효 권한 조회, 상수 SELECT42다. 테이블의 실제 업무 행을 조회하거나 데이터/스키마/권한을 변경하지 않았다.

## 실제 결과

| 검증                                     | 결과                             |
| ---------------------------------------- | -------------------------------- |
| 실제 MssqlAdapter integration            | 1개 통과, 1.62초                 |
| 실제 Electron live-mssql UI              | 1개 통과, 테스트5.9초(전체6.4초) |
| DB 연결/DB 목록/스키마·테이블 메타데이터 | 통과                             |
| 파서가 생성한 SELECT42                   | 결과 c0=42, 잘림 없음            |
| UI SQL 검토 전 이력 없음 → 사용자 승인   | 통과                             |
| 실제 결과 그리드42/성공 이력/연결 해제   | 통과                             |

backend 테스트는 첫 테이블이 있을 때 컬럼/인덱스/FK 조회도 실행한다. 현재 검증의 범위는 선택된 DB와 상수 쿼리이며23개 DB 전체 데이터/권한/부하를 검증한 것이 아니다.

## 남은 검증

실제 장기 쿼리 취소/timeout, 대량 행/LOB, 제한된 SELECT 전용 계정과 정상 신뢰 인증서의 운영 모드, 다중 DB 전환·다중 연결 부하 검증은 별도 fixture에서 수행해야 한다. 이번에 제공된 관리 계정을 운영 read-only 계정의 수용 증거로 간주하지 않는다. 이 기록은 Phase 2 DB 검증이며 이후 Phase 3 CLI 검증은 AGENT_TESTING.md를 참조한다.

## 재현

보안 주입 방식으로 AI_DB_TEST_HOST/USER/PASSWORD를 설정하고 `node scripts/validate-live-mssql.mjs`를 실행한다. 이 runner는 기본 master에 연결해 접근 가능한 사용자 DB를 찾고, AI_DB_TEST_DATABASE가 없으면 이름순 첫 DB를 선택한다. 지정 DB를 테스트하려면 해당 변수를 설정한다.

기본은 엄격한 TLS 인증서 검사다. AI_DB_TEST_TRUST_CERT=true를 명시하거나, 개발 서버에 한해 AI_DB_ALLOW_DEV_CERT_RETRY=true를 설정하면 인증서 오류 시 암호화는 유지한 채 개발 신뢰 옵션으로 재시도한다. 인증 실패·네트워크 오류를 인증서 우회로 처리하지 않는다. runner는 shell:false로 기존 Vitest와 Playwright의 live 테스트를 실행한다.

실제 검증을 재현할 자격 증명은 다시 프로세스 환경으로 주입해야 한다. 문서에 비밀번호를 추가하지 않는다.
