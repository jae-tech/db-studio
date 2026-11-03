# AI DB Studio PRD

## 목표

개인용 Windows 우선 Electron DB 클라이언트. DBeaver의 탐색/실행 기능과 간결한 작업 공간, 설치된 CLI를 이용한 AI SQL 제안을 제공한다. 로그인·결제·클라우드 동기화·별도 웹 API 서버는 범위 밖이다.

## 최종 제품 요구사항

- MSSQL 우선; PostgreSQL/MySQL 확장. 다중 연결·DB/스키마/테이블/컬럼/인덱스/FK 탐색.
- 다중 Monaco SQL 탭, 실행/취소/시간 제한, AG Grid Community 결과, 실행 이력·오류·시간·건수. 대용량 결과는 제한/페이지/배치 전송과 가상화로 UI 정지를 막는다.
- Electron Main DB 접근, SQLite 로컬 상태, OS 기반 자격 증명 암호화. 운영 연결은 실제 DB 읽기 전용 권한을 우선하고 앱 정책도 적용한다.
- CLI 탐지·인증 모드 검사·stream JSON·세션 재개·취소·오류/한도 처리·Claude/Codex 전환. 직접 OpenAI/Anthropic API 호출 없음.
- 스키마 인식 AI는 SQL을 제안하며 자동 실행하지 않는다. UPDATE/DELETE는 대상 미리보기와 승인; WHERE 없음 경고; DROP/TRUNCATE 차단; 불명확한 구문은 실행 거부. 승인된 SQL의 해시/연결/정책을 실행 시 다시 확인한다.
- MCP 도구: db_list_databases, db_list_tables, db_describe_table, db_get_foreign_keys, db_get_schema, db_explain_query, db_propose_sql. 임의 쓰기 SQL 도구 없음.
- 다크/라이트, 패널 폭 조절, 탭 복원, 단축키, 연결 상태. 계정 인증을 앱 자체에서 수집하지 않는다.

## Phase 경계

1. 실행 가능한 Electron/React/Vite, UI 골격, 제한된 IPC, SQLite 환경설정, 개발/빌드/검증 및 인계.
2. MSSQL 연결/탐색/실행/취소. 자격 증명 암호화와 read-only 정책을 연결 기능과 함께 제공.
3. CLI 어댑터/인증 검증/스트리밍/세션/취소.
4. 읽기 전용 MCP와 스키마 컨텍스트, SQL 제안/오류 분석.
5. SQL 파서 기반 위험 판정, 변경 미리보기, 승인/트랜잭션.
6. PostgreSQL/MySQL, Windows 설치 파일 및 최종 통합 테스트.

## Phase 1 수용 기준

실제 Electron 창에서 로컬 UI가 로드되고, preload로 버전과 환경설정을 읽고 쓰며, 재실행 시 탭/테마/패널 폭이 복원된다. 위험한 임의 IPC와 renderer Node 접근은 불가능하다. 연결·AI 실행을 성공으로 가장하지 않는다. 타입 검사/빌드/가용 테스트의 실제 결과를 문서화한다.

## Phase 2 수용 기준 및 현재 제한

MSSQL 연결 CRUD/암호화/다중 pool/스키마 탐색/승인 SELECT/취소/제한/오류/이력이 구현되고, 실제 테스트 서버에서 성공 경로가 검증되어야 Phase 전체 수용 완료다. 소스와 로컬 자동 검증에 이어 실제 개발 서버의 메타데이터·SELECT42 및 Electron 성공 경로를 검증했다. 실제 부하/취소·운영 계정·신뢰 인증서 검증은 별도 fixture에서 남아 있다. 제한 SELECT 문법만 제공하고 쓰기와 복잡한 T-SQL은 차단한다. 정확한 증거와 다음 검증은 LIVE_VALIDATION.md/MSSQL_TESTING.md/HANDOFF.md에 기록한다.
