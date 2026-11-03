# 아키텍처

## 현재 구현: Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 지원 경로

```text
React Renderer (Zustand / TanStack Query / Monaco / TanStack Table)
    ↓ window.desktop: settings / db / agent (fixed typed methods)
Sandboxed CJS Preload (contextBridge)
    ↓ fixed IPC channels
Electron Main (sender frame + exact URL / Zod / approval / SELECT parser)
    ├─ SettingsStore → SQLite preferences.db (non-secret preferences)
    ├─ DatabaseRepository → SQLite database.db (OS-encrypted connections, query history)
    ├─ DatabaseService → MssqlAdapter → per-connection mssql/Tedious pool
    └─ AgentService → CodexAdapter → restricted native Codex CLI (ChatGPT auth)
```

electron-vite가 main/preload/renderer를 별도 빌드한다. Main은 ESM, sandbox preload는 CJS이며 외부 런타임 모듈을 로드하지 않도록 묶는다. Renderer는 Node 접근이 없고 CSP로 로컬 스크립트·worker만 로드한다. Monaco worker와 모듈은 번들에 포함되므로 CDN이 필요 없다. Electron의 창 열기/페이지 이동/권한 요청을 차단한다. 임의 파일/셸/원문 SQL 실행 브리지는 없으며 DB 실행은 review/execute/cancel의 고정 IPC만 제공한다.

Renderer의 `styles.css`는 Tailwind v4 빌드 진입점(`@import 'tailwindcss'`)만 담는다. 화면 스타일은 컴포넌트의 Tailwind 클래스와 `lib/styleClasses.ts`의 기존 의미 클래스용 유틸리티 그룹에서 생성한다. 색상·글꼴 테마 변수는 `App.tsx`가 문서 루트에 적용하고, 그리드 행 위치·분할 영역 크기처럼 실행 중 계산되는 값만 인라인 스타일로 둔다. 의미 클래스 이름은 테스트 훅을 위해 보존한다.

SQLite는 테마·provider 선택·SQL 탭·활성 탭·패널 폭을 저장한다. 스키마 버전 1은 단일 preferences 행이며 Zod로 엄격하게 검사한다. 손상된 설정은 오류로 표면화하고 조용히 덮어쓰지 않는다. SQL 텍스트는 암호화되지 않으며 자격 증명을 저장할 장소가 아니다. 종료 시 DB를 닫는다. 대형 DB 작업은 향후 worker로 분리한다. 현재 동기 SQLite 작업은 30개/탭당 200KB로 제한된 설정 저장뿐이다.

## DB 구현: Phase 2

DatabaseAdapter는 connect/disconnect, isConnected, listDatabases/listSchemas/listTables, getColumns/getIndexes/getForeignKeys, executeQuery/cancelQuery, beginTransaction/commit/rollback을 정의한다. MSSQL 어댑터와 dialect/metadata를 구현했고 pg/mysql2는 Phase 6이다. request ID/AbortSignal/timeout/row limit과 Main 소유 pool을 사용한다. 트랜잭션은 내부 계약만 제공하고 IPC로 공개하지 않는다. 실제 개발 DB의 기본 성공 경로와 Electron UI는 검증했으며(LIVE_VALIDATION.md), 드라이버/서비스 단위 테스트의 대역과 구분한다. 2026-10-28 로컬 fixture에서 실제 행·바이트·LOB 제한/잠금 대기 취소·timeout/SELECT-only 권한 검사를 검증했고, 신뢰 인증서의 Production TLS 수용은 남아 있다.

DatabaseRepository는 연결 프로필/비밀번호를 async safeStorage로 암호화한다. 시작 시 프로필만 복호화하고 암호는 연결 시 복호화한다. OS 암호화 불가 또는 복호화 오류는 fail closed다. 연결 반환 DTO는 hasPassword만 포함한다. SQLite prepared statement/원자적 upsert를 쓰며 환경설정과 다른 DB 파일을 사용한다. history는 최근100건 평문 원문/상태/시간/건수다.

DatabaseService는 연결별 독립 session과 세대 ID, 60초 일회성 SQL 승인, 요청별 AbortController를 소유한다. SQL은 토큰화/제한 문법 분석/식 AST를 거쳐 재생성되며 원문을 실행하지 않는다. 실행 직전에 재파싱하고 승인 SQL과 비교한다. 연결당 실행은1개, Main은 여러 연결을 소유할 수 있다. 종료 시 실행 취소, 진행 중 연결/암호화 작업 완료, pool 종료 후 SQLite를 닫는다.

운영 연결은 신뢰된 TLS와 fn_my_permissions 유효 권한 허용 목록 검사를 요구한다. 쓰기·EXECUTE·관리/알 수 없는 권한은 거부하고 실행 직전 다시 검사한다. 개발 연결은 초과 권한 경고를 표시하고 같은 SELECT 문법 정책을 적용한다. 계정에 권한이 추가되거나 DBA가 객체를 바꾸는 TOCTOU까지 원자적으로 보장하지 않으므로 DB 자체의 SELECT 전용 계정 운용이 필요하다.

결과는 arrayRowMode stream으로 받아 중복 열명을 인덱스 기반 c0/c1 키로 보존한다. 행/4MiB/256열 제한을 넘으면 cancel하고 truncated를 표시한다. 문자/바이너리 셀과 Tedious textsize도 제한한다. Renderer는 최근5개 탭 결과만 보유하고 AG Grid 가상화·페이지를 사용한다. 상세 문법·한도·실DB 검증 방법은 MSSQL_TESTING.md가 기준이다.

## Agent: Phase 3 / 제한 MCP: Phase 4

2026-10-29 변경(ADR-023): UI의 공유 체크박스를 제거했다. 연결된 현재 SQL 탭에서 AI 메시지를 보내면 기존 고정 context로 해당 DB의 제한 메타데이터를 자동 제공한다. 연결 선택만으로 AI를 호출하지 않으며 행·엑셀 셀·SQL 탭·접속 자격 증명은 자동 공유하지 않는다. DB가 없으면 context 없는 텍스트 대화이며, 저장 쿼리 호출은 계속 로컬 처리한다. 아래 초기 Phase 4의 '명시적 UI opt-in'은 이 정책으로 대체한다. Main의 연결/DB 세대·capability/세션 격리는 유지한다.

AgentAdapter는 detect/inspectAuth/start/resume/cancel/dispose를 제공한다. CodexAdapter는 native CLI 0.165.0만 허용하며 공식 login status의 ChatGPT 인증과 키 환경 부재를 확인한다. 절대 경로 spawn/shell:false/최소 환경/별도 앱 작업 폴더, ignore-user-config/ignore-rules, read-only/never, forced ChatGPT/openai provider와 셸·hooks·plugins·apps·브라우저·멀티에이전트·Code Mode·MCP 차단을 적용한다. CLI 토큰 파일을 앱이 직접 읽거나 복사하지 않는다. ClaudeAdapter는 최신 조건부 상업 약관과 구독 격리 미검증으로 요청을 거부한다. 설치 여부도 탐지하지 않았음을 null로 표시한다.

JSONL 파서는 UTF-8 chunk 경계와 최종 개행 없는 줄을 처리한다. text/session/usage/error/done으로 정규화하고 도구·미지원 이벤트는 실패 처리한다. 고정 버전의 비활성 Code Mode 시작 안내만 별도 양성 허용한다. 프로세스 종료0/turn.completed/유효 세션을 모두 확인하기 전 성공으로 보고하지 않는다. 120초/1MiB/줄256KiB/2048개 이벤트 상한과 Windows 프로세스 트리 취소를 적용한다.

AgentService는 동시에 요청1개와 provider별 성공 세션 ID를 Main에서 소유한다. Renderer는 요청 UUID/provider/prompt/resume만 전달하고 임의 세션·인자·파일·도구를 지정할 수 없다. 실패/취소 시 앱 세션을 지우고 자동 재시도·API fallback을 하지 않는다. 고정 event IPC는 검증된 창에만 전달되고 preload가 Electron 이벤트를 숨긴다. UI는 최근20개 메시지와 응답당128K문자만 유지한다. Phase 4에서 DB 메타데이터는 opt-in 도구로만 제공하고 SQL 탭/자격 증명은 자동 전송하지 않는다. 실제 구독 CLI/정책/검증 근거는 AGENT_TESTING.md와 ADR-011에 있다.

Phase 4는 Main의 MetadataScope/캐시/도구 세션/JSON-RPC 프로토콜/로컬 capability broker와 별도 mcp-stdio entry로 구현했다. Codex가 stdio relay를 시작하고 relay는 턴별 named pipe/Unix socket으로 Main에만 접근한다. TCP/HTTP와 DB 실행 포트가 없다. 지정7개 도구만 존재하고 schema/context 공유는 UI에서 명시적으로 선택해야 한다. 요청마다 연결 세대·DB를 검증한다. scope 변경 시 새 대화, 동일 scope 재개 시에도 capability 교체를 적용한다.

Codex 공유 요청에서만 필요한 code_mode_host를 활성화하고 나머지 기존 CLI 제한을 유지한다. 메타데이터는 크기/횟수/시간 예산과 generation-keyed TTL cache를 적용한다. SQL 제안은 Main의 제한 SELECT 정규화·테이블 확인 후 UI 카드/새 탭으로 전달할 뿐 승인/실행하지 않는다. db_explain_query는 실제 SHOWPLAN 미검증으로 supported:false와 정적 정책 분석만 제공한다. 2026-10-28 실제 DB→Main→MCP→공식 Codex→UI 제안/동일 세션 재개/별도 승인 SELECT 실행까지 검증했다. Claude 실제 통합은 비활성이고 Claude client fixture만 검증했다. 정확한 도구/한도/검증/미완료 수용 항목은 MCP_TESTING.md/ADR-012/TASKS.md를 따른다.

## 실행 정책

현재는 실제 DB 권한 검사 + 제한 SELECT AST + 앱 정책 + 명시 승인을 결합한다. 저장 프로시저/동적 SQL/다중 문장/해석 불가 구문은 기본 거부한다. 승인 객체는 Main의 SQL 원문/정규화 구조·연결 세대·만료에 묶이고 실행 직전 재검증한다. 쓰기 미리보기·SQL 해시/정책 버전·트랜잭션 승인 UI는 Phase 5 범위다.

## 기술 및 공식 근거

정확한 설치 버전은 package.json/lockfile이 기준이다. 2026-10-27 공식 문서 확인:

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox): 격리·sandbox·sender 검증.
- [electron-vite](https://electron-vite.org/guide/), [Vite](https://vite.dev/guide/): 분리 빌드와 지원 Node 조건. 개발 서버만 사용.
- [Tailwind Vite](https://tailwindcss.com/docs/installation/using-vite), [shadcn Vite](https://ui.shadcn.com/docs/installation/vite): Tailwind Vite plugin과 소스 소유 컴포넌트 패턴. 버튼은 Radix Slot/CVA 기반 로컬 컴포넌트.
- [TanStack Table](https://tanstack.com/table/v8/docs/introduction) 및 [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction), [Monaco](https://microsoft.github.io/monaco-editor/docs.html), [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md).
- [Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode), [authentication](https://learn.chatgpt.com/docs/auth): 기존 CLI 인증 재사용과 별도의 API key 인증 모드가 존재한다. 구독 상태만 보고 과금 모드를 추정하지 않는다.
- [Claude CLI automation](https://code.claude.com/docs/en/headless), [legal](https://code.claude.com/docs/en/legal-and-compliance): CLI는 -p 프로그램 실행과 구조화 출력을 제공한다. 최신 legal 문서는 상업 약관 등 조건 아래 제품 내 원본 CLI 실행을 설명한다. 이 앱은 조건 충족과 안전한 구독 실행 격리를 검증하지 않아 Claude를 비활성으로 유지한다(ADR-011). 토큰 추출이나 API 과금 자동 대체는 하지 않는다.

## 제한 쓰기: Phase 5

기존 settings/db/agent 경계 안에서 db.mutations의 고정 preview/apply/commit/rollback/state만 추가했다. Main MutationService가 DatabaseService의 독점 lease와 기존 adapter의 내부 트랜잭션 제어를 소유한다. Renderer는 SQL을 preview에만 보내고 apply/commit에는 Main 발급 id/hash/token만 보낸다. 일반 SELECT/MCP 경로는 쓰기와 독립적으로 유지된다.

MssqlMutations는 제한 AST에서 생성한 로컬 UPDATE/DELETE만 처리한다. PK/rowversion과 권한·메타데이터/테이블 기능 검사, 100 대상/샘플 예산, 정책·SQL·세대·대상 승인, 잠금 재검증과 OUTPUT 이전 버전 검사를 결합한다. UI는 별도 검토/미확정 적용/DB 확인 COMMIT/rollback을 표시한다. 요청 취소·timeout·idle rollback·연결 폐기·불명확 ack/이력 처리는 WRITE_TESTING.md/ADR-013이 기준이다.

진행 중 SELECT/메타데이터와 쓰기를 섞지 않는다. 트랜잭션 종료 시 해당 pool을 폐기하고 재접속하게 한다. Production/readOnly 기본값을 완화하지 않고 개발 opt-in만 추가했다. 2026-10-28 승인된 로컬 전용 fixture에서 실제 UPDATE·DELETE commit/rollback/잠금/권한·트리거 거부/30초 자동 rollback과 Electron 전체 UI·앱 종료 rollback을 검증했다. 준비용 계정과 최소 권한 앱 계정은 분리하며 WRITE_TESTING.md가 증거와 재현 조건의 기준이다. Phase 6/운영 쓰기/복잡한 T-SQL은 구현하지 않았다.
