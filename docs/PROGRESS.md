# 진행 상황

## 2026-11-03 — 테마별 색 조합

- 다크·라이트 모드에 에메랄드/오션/바이올렛/앰버 4종씩 추가했다. 설정 화면 미리보기에서 선택하며 각 모드의 조합은 따로 SQLite settings에 저장된다(ADR-041). 기존 설정은 두 모드 모두 기존 에메랄드로 이어받는다.
- 화면 변수·강조색 장식과 Monaco SQL 편집기를 선택 조합에 맞췄다. 8개 조합의 텍스트/보조 텍스트/강조색 대비 4.5:1 이상을 단위 테스트로 확인하고, 다크 오션·라이트 바이올렛 선택/전환/재시작 복원을 Electron 테스트로 확인했다.
- 최종 검증: `pnpm typecheck`, `pnpm lint`, 단위 테스트 395개, `pnpm build`, `pnpm format:check`, 기본 Electron E2E 28개 통과(실DB/실AI opt-in 8개 skip). 시각 스냅샷은 `.omx/theme-palettes/`. 실제 DB·AI 호출은 색상 변경에서 재검증하지 않았다.

## 2026-11-03 — 테이블 자동완성 시 SELECT 접두어 보완

- SQL 편집기에서 Ctrl+Space로 테이블을 확정할 때 현재 문장이 테이블 이름만 있거나 비어 있으면 `SELECT * FROM`을 앞에 붙인다. `FROM`으로 시작하면 `SELECT *`만 넣어 중복 FROM을 피한다. 기존 `SELECT`·`UPDATE` 등의 SQL과 열/키워드 자동완성은 그대로다. 세미콜론 뒤 새 문장에도 적용한다.
- `sqlCompletion.ts`의 보수적 문맥 판별 단위 테스트와 Electron 자동완성 테스트를 확장했다. Main/IPC/DB 실행 정책은 변경하지 않았다.
- 최종 검증: `pnpm typecheck`, `pnpm lint`, 단위 테스트 393개, `pnpm build`, `pnpm format:check`, 기본 Electron E2E 27개 통과(실DB/실AI opt-in 8개 skip). 실제 DB/AI 호출은 이번 편집기 기능에서 재검증하지 않았다.

## 2026-10-30 — 남은 실제 검증 처리

- 실DB 전체(`run-relationships.ps1`): typecheck/lint/format/peers/unit392/build, 실DB integration13(+3 skip), Electron31(+4 skip) 통과. 실제 Codex integration5와 Electron5(agent 2, live-mcp, live-import-ai, live-relationships) 통과(`.omx/full-live-validation-3-20261030.log`, `.omx/ai-live-validation-20261030.log`). 임시 DB·로그인은 각 실행에서 제거했다.
- 실행 중 발견·수정: (1) 하단 접기 버튼 이름이 "실행 이력" 탭과 접두가 겹쳐 live-mssql이 실패 → "하단 이력·출력 패널 접기/펼치기"로 변경. (2) live-mssql은 저장 쿼리 포맷 적용에 맞춰 `formatSql` 결과를 기대. (3) live-import-ai는 ADR-033 이전 문구를 기다렸다 → 읽기 전용 연결의 미리보기 "실행할 수 없음"/실행 버튼 없음을 검사. (4) live-relationships 프롬프트의 "SQL을 실행하지 마"가 ADR-028(제안 SELECT 즉시 실행)과 충돌해 Codex가 도구 호출을 거부 → 앱이 실행하고 행은 AI에 전달되지 않는다고 안내.
- Copilot 실제 Electron 흐름: `live-mcp.spec.ts`를 `AI_DB_TEST_AGENT_PROVIDER=copilot`으로 실행하도록 했고(`run-copilot-mcp.ps1`, `run-ai-only.ps1`), 2회 모두 `limit`. CLI 직접 호출 원문 "You have exceeded your monthly quota" — Copilot 월 한도 소진으로 미검증. 한도 갱신 후 `run-copilot-mcp.ps1`.
- 우클릭 복사: 시스템 클립보드가 복구된 뒤 실제 클립보드로 셀/열/IN 목록 복사를 확인했다(일회성 테스트, 저장소에 남기지 않음).

## 2026-10-30 — 새로고침 시 앱 종료, 재연결 DB, 결과 건수 중복 수정

- 새로고침(Ctrl+R)이 미저장 설정과 겹치면 앱이 종료되던 문제: `beforeunload`가 종료를 막고 비동기 저장 후 `window.close()`를 호출했다. 고정 채널 `settings:save-sync`(같은 신뢰 발신자 검사·같은 Zod 저장)와 preload `saveSettingsSync`를 추가해 언로드 중 동기 저장만 하고 종료/새로고침은 그대로 진행한다. `workspace.spec.ts`에 편집 직후 새로고침 시 창 유지·값 저장 검사와 preload API 목록 갱신.
- 시작 재연결은 연결별 마지막 사용 DB(`currentDatabase`)로 접속한다(localStorage `{id, database}`). `reconnect.spec.ts` 갱신.
- 전체 실행 결과 탭이 있으면 헤더의 별도 행 수 표시를 숨긴다(탭마다 행 수 표시).

## 2026-10-30 — 시작 시 마지막 연결 자동 재연결

- 렌더러가 연결 목록 폴링 결과에서 연결된 id를 localStorage(`reconnect-connections`)에 기록하고, 앱 시작 시 한 번 해당 연결을 다시 연결한다(기본 DB로 접속, 실패하면 알림). 직접 연결 해제한 연결은 목록에서 빠진다.
- settings가 아니라 localStorage인 이유: settings 변경은 350ms 뒤 저장되고, 미저장 상태의 `beforeunload`는 저장 후 `window.close()`를 호출해 새로고침(Ctrl+R)도 창 종료로 바뀐다. 처음 settings에 넣었더니 `grid-density.spec.ts`의 reload가 이 경로로 앱을 종료시켰다. 이 기존 동작(미저장 설정+새로고침=종료)은 남아 있다.
- 신규 `reconnect.spec.ts`(시작 재연결 1회, 해제 시 목록 제거). 실제 앱 종료→재시작은 핸들러 대역 특성상 reload로 대신 검증했다.

## 2026-10-30 — 키워드 자동완성 뒤 공백

- SQL 키워드 자동완성(`sel`+Enter → `SELECT `)은 뒤에 공백을 붙인다. 커서 뒤가 이미 공백이면 붙이지 않는다. 함수(COUNT/SUM/AVG/MIN/MAX/COALESCE/ISNULL/TRY_CONVERT)는 `COUNT()`로 넣고 커서를 괄호 안에 둔다. 테이블·열 자동완성은 그대로다.
- `sql-completion.spec.ts`에 `sel`→`cou`→`1` = `SELECT COUNT(1)` 검사 추가. typecheck/lint/build/format, 전체 Electron 통과.

## 2026-10-30 — 작은 강조 버튼 글자색, 더블클릭만으로 편집 처리되던 문제

- Button `small`의 `text-[var(--font-size-label)]`를 tailwind-merge가 글자색으로 해석해 `text-[var(--on-accent)]`를 지웠다(결과 헤더 "저장" 버튼이 회색 글자). `text-[length:var(--font-size-label)]`로 명시했다.
- 결과 셀을 더블클릭 후 그대로 닫아도 숫자 원값(495)과 입력 문자열('495')이 달라 편집으로 잡혔다. 원값을 문자열로 바꿔 비교한다.
- `grid-edit.spec.ts`: 숫자 열 더블클릭→Enter 시 변경 없음, 저장 버튼 글자색 검사 추가. typecheck/lint/build/format, 전체 Electron 26개 통과(opt-in 8 skip).

## 2026-10-30 — 결과 그리드 우클릭 복사

- 결과 셀·열 머리글 우클릭 메뉴(radix-ui ContextMenu, 기존 의존성): 셀 값 복사, 열 값 복사(줄바꿈), 열 값을 `IN (...)` 목록으로 복사(중복·NULL 제외, 숫자는 그대로, 문자는 `N'..'`와 `''` 이스케이프). 열 값은 현재 페이지가 아니라 불러온 행 전체의 필터·정렬 결과다. 복사 결과는 하단 알림에 표시한다.
- Main 권한 처리기는 모든 권한 거부를 유지하되 `clipboard-sanitized-write`(클립보드 쓰기)만 허용한다. 읽기는 계속 막는다.
- 검증: `grid-density.spec.ts`에 셀·열·IN 목록(숫자/문자) 복사 검사 추가. 첫 실행은 실제 시스템 클립보드로 통과했으나, 이후 이 PC의 클립보드가 PowerShell로도 쓰기·읽기 불가 상태가 되어 테스트는 `navigator.clipboard.writeText`를 기록하는 방식으로 바꿨다(사용자 클립보드도 덮어쓰지 않음). typecheck/lint/unit392/build/format, 전체 Electron 통과.

## 2026-10-30 — 결과 가로 스크롤, 하단 AI 패널 최소 높이, 저장 쿼리, 이력·출력 접기

- 결과 가로 스크롤: `tw()`가 의미 클래스 이름을 그대로 남겨 `grid` 키가 Tailwind `display:grid`로 해석됐고, 결과 영역이 표 너비만큼 늘어나 바깥에서 잘렸다. 키를 `result-grid-host`로 바꿨다(Tailwind 유틸리티와 겹치는 키는 이것 하나였다). `grid-density.spec.ts`에 좁은 창에서 스크롤 영역이 결과 영역 안에 있고 가로로 넘치는지 검사를 추가했다.
- 하단 AI 패널 최소 높이(140px)에서 대화 영역 최소 60px 때문에 스크롤이 생겼다. 하단 배치에서는 대화 영역이 0까지 줄어든다. `agent-panel-compact.spec.ts`에 검사 추가.
- 저장 쿼리: 불러올 때 현재 SQL 포맷 설정으로 정리한다(불필요한 `[]` 제거, 정리 실패 시 원문). 버튼 이름은 "실행"(접근성 이름 "저장 쿼리 실행"). Main이 설정 읽기·저장 때 `nativeTheme.themeSource`를 앱 테마로 맞춰 자동완성 목록(datalist)이 OS 다크 모드를 따르지 않게 했다(화면 확인은 안 함).
- 실행 이력·출력은 기본으로 탭 줄만 보이고, 접힌 동안 최근 메시지는 탭 줄 오른쪽 한 줄(`role=status`)로 보인다. 탭 클릭으로 펼치고 같은 탭이나 접기 버튼으로 닫는다. 접힘 상태는 저장하지 않는다.
- 검증: typecheck/lint/unit392/build/format, 전체 Electron 26개 통과(실DB/AI opt-in 8개 skip).

## 2026-10-30 — 결과 탭·필터 줄·표시 설정 정리

- 전체 실행 결과 탭을 `번호 · 대상 테이블(또는 문장 키워드) · 행 수`로 키우고 선택 탭을 강조했다(접근성 이름 `결과 N`). 필터 입력은 헤더 고정 높이 50% 분할을 없애고 22px 테두리 입력으로 바꿨다.
- 페이지당 행 수(`resultPageSize`, 50/100/500, 기본 100)를 settings로 옮기고 설정 화면에서만 바꾼다. 결과 표의 글자 크기·페이지당 행 수 선택상자는 제거했다(글자 크기는 기존 설정 화면 항목 사용). 관련 E2E는 설정 화면을 거치도록 바꿨다.
- 검증: typecheck/lint/unit392/build/format, Electron auto-paging·grid-edit·run-statements·chat-settings·readability 통과. 화면 `.omx/readability/result-batch-tabs.png`. live 스펙(live-paging, live-mssql)은 문구만 바꾸고 실행하지 않았다.

## 2026-10-30 — 강조 버튼 글자색 수정

- 앱 루트의 `[&_button]:[color:inherit]`(특이도 0,1,1)가 Button의 `text-[var(--on-accent)]`(0,1,0)를 덮어 초록 버튼 글자가 배경과 섞였다. 규칙을 `:where()`로 감싸 특이도를 낮췄다. typecheck/lint/build, Electron import-workspace·readability·agent-panel-compact 통과.

## 2026-10-30 — 전역 수기 CSS 제거

- `styles.css`는 Tailwind import 한 줄만 남겼다. 기존 화면 의미 클래스의 레이아웃·상태·반응형 규칙은 `lib/styleClasses.ts`의 정적 Tailwind 유틸리티 그룹과 각 Renderer 컴포넌트의 클래스에 연결했다. 테마 팔레트·글꼴은 문서 루트에 적용하고, 그리드 가상 행·열 너비·사용자 분할 영역처럼 동적으로 계산되는 값만 인라인 스타일로 유지한다(ADR-040).
- 기존 가독성·그리드·AI 패널 E2E 3개는 변경 전후 통과했다. 최종 typecheck/lint/unit392/build/format 통과, 전체 Electron 재실행 26개 통과·실DB/실AI opt-in 8개 skip. 첫 전체 실행에서 SQL 자동완성 1개가 간헐 실패했지만 단독과 최종 전체 재실행에서 통과했다. 실제 SQL Server/AI 호출은 이번 스타일 작업에서 재검증하지 않았다.

## 2026-10-30 — 결과 그리드 TanStack Table 전환

- AG Grid 의존성과 렌더러 연결을 제거하고 TanStack Table v8 + TanStack Virtual로 SQL 결과 그리드를 교체했다. 기존 Main/IPC SQL 실행·쓰기 승인 경로는 변경하지 않았다.
- 결과 행 가상화, 로컬 정렬·필터, 열 크기 조절, 셀 편집·원복·행별 안전 저장, 50/100/500 페이지와 기존 continuation 자동 조회·캐시·취소 경계를 유지한다. 관련 E2E 선택자를 새 결과 그리드에 맞췄다.
- 최종 검증: `pnpm typecheck`, `pnpm lint`, 단위 테스트 387개, `pnpm build`, `pnpm format:check` 통과. Electron 전체 기본 테스트 25개 통과·실DB/실AI opt-in 8개 건너뜀. 그리드 핵심 3개는 최종 수정 후 별도 재실행도 통과했다. 실제 SQL Server와 실제 AI 호출은 이번 변경에서 검증하지 않았다. 변경 후 화면 스냅샷은 `.omx/readability/grid-1500x960.png`.

## 2026-10-30 — shadcn/TanStack 전환 진행 중

- 후속 진행: 화면 전반의 텍스트 입력, 텍스트 영역, 네이티브 선택상자와 일반 HTML 표를 소유형 shadcn 스타일 컴포넌트로 통일했다. 체크박스 등은 기존 구현을 유지한다. TanStack Table은 아직 적용하지 않았고 AG Grid를 유지한다.
- 최종 typecheck/lint/unit 388/build/format 통과. 기본 Electron 전체 실행은 23개 통과·8개 건너뜀·2개 실패였으며, 실행 중 빌드가 겹쳤다. 실패한 SQL 자동완성과 테이블 상세 및 변경된 표의 엑셀/쓰기 화면을 빌드 종료 후 재실행해 4개 통과했다. 전체 E2E가 깨끗하게 통과했다고 보지 않는다.
- 공통 Button의 variant 및 크기 스타일을 기존 전역 CSS에서 Tailwind 유틸리티 기반 소유 컴포넌트로 옮겼다. 기존 테마 변수와 버튼 API를 유지한다.
- typecheck, lint, unit 388개, build, format:check 및 Electron readability/agent-panel-compact 2개 통과. 전체 E2E, 실DB는 이번 변경에서 실행하지 않았다.
- 전환은 미완료다. 다른 UI와 AG Grid 결과 테이블은 그대로이며, TanStack Table 교체 시 셀 편집·안전한 저장, 필터/정렬/크기, 이어서 조회·탭 전환, 가상화 및 관련 E2E를 보존해야 한다.

## 2026-10-29 — 변경 미리보기(ADR-033), 자동완성 잘림 수정 (Claude Code)

- ADR-033 구현: `mutation:inspect`(읽기 전용 COUNT/TOP 20 미리보기, opt-in·rowversion 불필요, `applyBlocked` 사유), MutationPanel의 '변경 미리보기' 체크박스(`writePreview`)와 실행/취소, 쿼리 실행 시 쓰기 문장은 미리보기로 전환. 수동 버튼·3단계 화면 제거. unit391(미리보기 SQL·쓰기 미전송·opt-in 없이 동작), Electron 기본 통과. 실DB 1차 검증에서 [실행] 직후 미리보기와 COMMIT 결과가 동시에 보이던 문제를 발견해 실행 즉시 미리보기를 닫도록 고쳤다(UPDATE 미리보기→취소→실행 커밋은 실제 DB에서 통과).
- 실DB 최종 검증(`.omx/write-preview-validation-3-20261029.log`): unit391, 실DB integration11(+AI3 skip), Electron27(+AI4 skip) 통과. 실제 SQL Server에서 UPDATE 미리보기(현재 10 → 20)·취소 시 무변경·실행 시 커밋, DELETE 미리보기·실행, 미리보기만 열고 종료 시 무변경을 확인했다. 앞선 두 실패는 테스트 대기 조건(이전 'COMMIT 완료' 표시)과 검증 중 임시 빌드 겹침이었다.
- 자동완성 목록이 짧은 편집기에서 잘리던 문제: Monaco `fixedOverflowWidgets`로 편집기 밖에 겹쳐 그린다. `sql-completion.spec.ts`에 최소 높이(96px)·맨 아래 줄에서 목록이 편집기 밖으로 넘치고 클릭 가능한지 검사를 추가했고, 수정을 빼면 실패함을 확인했다. 화면 `.omx/readability/sql-completion-short.png`.

## 2026-10-29 — AI 패널 접기, 모델 선택, Claude 제거·Copilot 추가 (Claude Code)

- 후속5: AI 패널의 공유 DB 표시를 삭제했다. 이 표시를 연결 완료 확인 지점으로 쓰던 e2e(agent-auto-context, agent, import-workspace, live-import-ai, live-mcp, live-relationships)는 상단 제목줄(`.title-center`)과 상태 표시줄('연결 안 됨')을 검사하도록 바꿨다. 기본 Electron23 통과, live 스펙 3개는 이번에 실행하지 않았다.
- 후속4: 머리글의 'AI 도우미' 글자를 강조색 아이콘 하나(접근성 이름 'AI 도우미')로 바꾸고, 최소 폭(280px)에서 제목이 줄바꿈되던 문제를 고쳤다(제목 한 줄 고정, 범위 칩만 말줄임, 아이콘 줄은 줄어들지 않음). `agent-panel-compact.spec.ts`에 최소 폭 한 줄·가로 넘침 없음·머리글 버튼 표시 검사와 화면 `.omx/agent-panel-compact/minimum-width.png`를 추가했다.
- 후속3: AI 패널 아이콘 중심 개편(머리글 + / 오류 분석 / 다시 확인 / 접기, 전송↔중지 토글, 안내 문구·하단 버튼 줄 제거, 문제 있을 때만 상태 한 줄). 정리 중 공통 선택자 규칙과 함께 지워진 `.agent-transcript` 스타일을 다시 작성했다. live/compact 스펙의 상태 문구 검사는 새로고침 버튼 툴팁 검사로 바꿨다. 검증 unit389, Electron23(+DB/AI8 skip), 화면 `.omx/agent-panel-compact/`.
- 후속2: AI 패널 '사용 안내' 제거, CLI 상태 자동 확인(시작 시·전송 시 필요하면), 수동 확인은 새로고침 아이콘. `saved-query-chat.spec.ts`는 자동 확인이 실제 Codex를 찾으면 일반 질문이 전송되므로 'CLI 미설치' status 대역을 넣었다. 검증 unit389, Electron23(+DB/AI8 skip).
- 후속: 모델 선택을 채팅 입력창 아래 드롭다운(제공자+모델, `lib/agentModels.ts` 공유 상태 캐시)으로 옮기고 상단 버튼/입력칸을 없앴다. Main은 CLI 로컬 카탈로그(`codexModels`, `copilotModels`)를 status에 포함한다. 좌측 메뉴에 `AiSettingsView`(CLI 상태·기본 모델·대화 AI 전환)를 추가했고, 다른 화면에서 제공자를 바꾸면 진행 중 요청을 취소한다. 탐색기 토글은 FolderTree, AI 토글은 'AI' 글자 버튼, 패널 안 접기는 «/». 검증: unit389, Electron23(+DB/AI8 skip; 신규 `ai-settings.spec.ts`, 화면 `.omx/readability/ai-settings.png`).
- ADR-032. AI 패널 접기(`agentCollapsed`, 숨김 유지), provider별 모델 선택(`agentModels`, Codex `-c model`, Copilot `--model`), Claude 어댑터·오프라인 파서·UI 제거(저장된 'claude'는 Codex로), 새 `main/agent/copilot.ts`(격리 COPILOT_HOME에 계정 이름만 복사, ai_db 도구만, stdin 프롬프트, 이벤트 해석·도구 범위 검사), `process.firstNative`로 실행 파일 탐색 공통화, MCP 범위를 Copilot에도 허용.
- 정책 확인 출처(2026-10 검색, 2차 자료 포함): Claude 구독 정책 [Zed 블로그](https://zed.dev/blog/anthropic-subscription-changes), [autonomee 정리(2026-10-26 갱신)](https://autonomee.ai/blog/claude-code-terms-of-service-explained/); Gemini [gemini-cli Discussion #22970](https://github.com/google-gemini/gemini-cli/discussions/22970), [Gemini Code Assist FAQ](https://developers.google.com/gemini-code-assist/resources/faqs), [Gemini CLI ToS](https://geminicli.com/docs/resources/tos-privacy/); Copilot [CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference). Copilot 제품별 약관 전문은 확인하지 못했다.
- 실제 확인: 로컬 Copilot CLI 1.0.105. 탐색 호출에서 `--available-tools`를 비우면 사용자 MCP·내장 도구 232개가 열리는 것을 확인해, 일치하지 않는 이름 하나로 0개가 되게 했다. 격리 홈은 계정 이름만 있으면 OS 자격 증명 저장소 토큰으로 인증된다. 임시 탐색 테스트는 삭제했다. Copilot 사용량 약 5회(탐색 3, 통합 2)를 썼다.
- 검증: typecheck/lint/format, unit387(Copilot 이벤트·범위·격리 인자·홈 복사·모델 검증), Electron22(+DB/AI8 skip; agent.spec는 제거된 provider·잘못된 모델이 프로세스 없이 거부됨을 확인), 실제 `AI_DB_TEST_COPILOT=1` `copilot.test.ts` 통과(MCP 발견→SELECT 제안→같은 세션 재개). 실제 SQL Server+Copilot Electron 전체 흐름은 아직이다. 커밋하지 않았다.

## 2026-10-29 — 운영 연결 SSMS와 같게 (Claude Code)

- 추가: 탐색기 접기/펼치기 버튼을 활동 표시줄 맨 위로 옮겼고, 쓰기 패널의 '개발 프로필에서만' 안내를 ADR-031에 맞게 고쳤다. 이후 unit385·Electron22(+DB/AI8 skip) 통과.
- 추가: 넓은 권한 계정 접속 시 연결 카드에 뜨던 '읽기 전용 범위를 넘는 권한' 경고를 사용자 요청으로 제거했다(adapter connect의 warning, 한국어 매핑, unit 기대값).
- ADR-031: 운영 프로필의 신뢰 인증서·readOnly 강제(Zod refine), 접속 시 SELECT 전용 계정 거부, 실행 직전 권한 재검사를 제거했다. 쓰기는 환경과 무관하게 연결의 "제한 쓰기 허용" opt-in만 따른다(Main 쓰기 gate/lease, MutationPanel). 연결 편집은 운영에서도 두 체크박스를 쓸 수 있고 켜면 경고를 표시한다. 체크박스 접근성 이름을 "제한 쓰기 허용"/"서버 인증서 신뢰"로 고정했다. TLS 암호화 강제, 쓰기 안전 장치, SELECT 파서 정책은 그대로다.
- 테스트: unit(policy/mssql-adapter/mutations)를 새 정책으로 바꿨다(385개). e2e mutations/live 스펙의 라벨을 갱신했다. 검증 중 `live-mutations.spec.ts`가 입력 중 자동 완성 메타데이터 읽기와 미리보기 lease 거부("현재 쿼리가 끝난 뒤…")의 기존 경쟁으로 1회 실패해, 테스트만 미리보기 재시도(최대20초)로 바꿨다. Main 보호 규칙은 바꾸지 않았다.
- 검증: `.omx/production-policy-validation-3-20261029.log`(`run-auto-paging.ps1`)에서 typecheck/lint/format/peers/unit385/build, 실DB integration11(+AI2 skip), Electron26(+AI4 skip) 통과. 앞선 두 실패 로그(`-validation-`, `-validation-2-`)는 라벨 변경과 위 경쟁이다. 실제 운영 서버 접속은 검증하지 않았다(로컬 전용 서버만). 실제 Codex 단계와 `live-relationships.spec.ts`는 기존 인계대로 남아 있다. 커밋하지 않았다.

## 2026-10-29 — 연결 그룹(폴더)과 탐색기 접기 (Claude Code)

- ADR-030: settings에 `connectionGroups`/`collapsed`/`explorerCollapsed` 추가(기존 설정은 기본값으로 호환). `DatabaseExplorer`의 연결 목록을 그룹별(미분류 포함)로 나누고, 그룹 추가(폴더 버튼→이름 Enter)·삭제(연결은 미분류로)·카드의 그룹 선택 이동·그룹/섹션 접기를 넣었다. 검색 중에는 접힌 그룹도 결과를 보여준다. 탐색기 제목과 활동 표시줄 하단에 전체 접기/펼치기 버튼을 넣었다. 새 IPC/의존성 없음.
- 검증(`.omx/explorer-groups-validation-20261029.log`, `run-auto-paging.ps1`): typecheck/lint/format/peers/unit386/build, 실DB integration11(+AI2 skip), Electron26(+AI4 skip) 통과. 신규 `explorer-groups.spec.ts`(그룹 생성·이동·접기·검색·섹션 접기·전체 접기 재시작 유지·그룹 삭제), 화면 `.omx/readability/explorer-groups.png` 확인. 실제 Codex 단계는 이번 변경과 무관하고 직전 구독 한도 문제로 실행하지 않았다. 남은 `live-relationships.spec.ts` 실제 실행은 이전 항목 그대로다. 커밋하지 않았다.

## 2026-10-29 — AI 조회 즉시 실행·쓰기 한 번 확인·SELECT * 금지, 테이블 화면 가상 FK (Claude Code)

- ADR-028: AI SELECT 제안은 같은 연결/DB일 때 새 탭("AI 조회")에서 바로 실행된다(`SqlWorkspace.openAiSql`, 탭이 보일 때 1회 실행). AI 쓰기 초안은 새 탭("AI 변경 · 확인 필요")에서 미리보기를 자동으로 띄우고 "N행을 변경합니다. 실행할까요?" [실행]이 apply+commit을 연이어 호출한다(사용자 선택: 한 번만 묻기). 직접 연 쓰기는 기존 3단계 유지. Main은 AI SELECT의 `*`/`별칭.*`를 거부한다(`ReadQuery.shape.star`). MCP 응답/도구 설명/프롬프트를 새 흐름으로 바꿨고 결과 행은 AI에 보내지 않는다. 엑셀 예시·테이블 화면 SELECT 생성도 열을 나열한다.
- ADR-029: 테이블 상세 화면 아래 `RelationshipEditor`(기준 테이블 고정, 동명 열·PK 자동 짝, 업무명 생략 시 연결 테이블 이름). 테이블 연결이 현재 연결·같은 DB일 때만 표시.
- 검증 1(ADR-028 직후, `.omx/ai-autorun-validation-20261029.log`, `run-resume-tests.ps1`): unit386, 실DB integration11(+AI2 skip), Electron25(+AI4 skip), 실제 Codex agent/mcp integration5, 실제 Codex Electron 4개(agent/live-mcp/live-import-ai) 모두 통과. 실제 Codex가 제안한 SELECT가 클릭 없이 실행돼 무작위 값이 그리드에 나왔고 재개 턴 이벤트에 행 값이 없었다. 읽기 전용 연결의 쓰기 초안은 자동으로 열리고 실행 불가 안내만 표시됐으며 업무 행은 바뀌지 않았다.
- 검증 2(ADR-029 후, `.omx/table-relationship-validation-20261029.log`, `run-relationships.ps1`): typecheck/lint/format/peers/unit386/build, 실DB integration11(+AI2 skip), Electron25(+AI4 skip) 통과. 이어진 실제 Codex 단계는 Codex 측 `limit` 오류(구독 사용량 한도, `CLI request failed. Check login and subscription usage`)로 agent/mcp integration 2개가 실패해 중단됐다. 코드 회귀가 아니라 외부 한도로 판단하며, 같은 테스트는 검증 1에서 통과했다. 그래서 새 흐름의 `live-relationships.spec.ts`(실제 Codex)는 아직 실행되지 않았다. 재시도하지 않았다. 임시 DB와 로그인은 정리됐다.
- 신규/수정 테스트: unit(mcp `*` 거부·응답 형식, policy star 판별), e2e 신규 `agent-auto-run.spec.ts`(SELECT 즉시 실행·쓰기 자동 미리보기·한 번 확인 실행), `table-view.spec.ts`(테이블 화면 관계 생성·자동 짝·연결 테이블 쪽 표시, 화면 `.omx/readability/table-view-relationship.png`), live 스펙 3개를 새 흐름으로 수정. 커밋하지 않았다.

## 2026-10-29 — 탭 이름 바꾸기·엑셀 JOIN 미일치 행 수·결과 전체 내보내기 (Claude Code)

- 사용자 승인 후보 1·4·2만 구현했다(ADR-027). 기간 분할 원자 변경은 착수하지 않았다.
- 탭 이름: `store.renameTab`, SqlWorkspace의 두 번 클릭/F2 인라인 입력(Enter 확정, Escape 원래 이름, 빈 이름 무시, 80자). 기존 settings 스키마에 그대로 저장된다.
- 미일치 행 수: `MutationSnapshot/MutationState.importRows`. UPDATE JOIN은 잠금 없는 첫 미리보기에서만 `NOT EXISTS` COUNT로 ON 미일치 엑셀 행 수를 계산하고(잠금 재확인에서는 계산하지 않음), INSERT는 엑셀 전체 행 수만 보내 UI에서 추가 제외 행 수를 표시한다. 승인 해시에는 포함하지 않는다.
- 내보내기: 새 `main/database/resultFile.ts`(CSV BOM/RFC 4180, 새 의존성 없이 zlib로 쓰는 스트리밍 XLSX ZIP, `.partial`→rename, 실패 시 삭제), `ResultSink`로 adapter 스트림 pause/resume, `DatabaseService.exportQuery`(review 토큰 재사용, Main 저장 대화상자, `exportRowLimit` 1,048,575 TOP, 30분 제한, 이력 기록), 고정 채널 `db:export-query`, 결과 헤더 CSV/XLSX 버튼(결과를 만든 SQL 재실행, 실행 중 취소 가능).
- 검증: `.omx/local-sql-validation/run-auto-paging.ps1`(AI 단계 없는 기존 스크립트)로 typecheck/lint/format/peers/unit **383**/build 통과, 실DB integration **11통과/AI2 skip**(신규 `export.test.ts`: 5만 행 CSV·XLSX 스트리밍/CRC·크기/그리드 상한 유지/실패 시 파일 없음; `import-mutations`에 importRows 확인), Electron **24통과/AI4 skip**(신규 `result-export.spec.ts`, `mutation-flow` 미일치 문구). 로그 `.omx/export-validation-20261029.log`. 실행 DB `aidb_write_test_local_6543fd3f312d`와 임시 로그인은 스크립트가 정리했다. 실제 AI 테스트는 이번 변경과 무관해 실행하지 않았다(skip을 통과로 세지 않음).
- 단위 신규: `result-file.test.ts`(실제 `readWorkbook` 파서로 XLSX 역검증, 3만 행 스트리밍, 셀 한도, abort가 기존 파일 보존), `database-service` 내보내기(대화상자 취소=null·토큰 소모, sink 상한, 실패 시 .partial 삭제), `mssql-mutations` importRows 2개.
- 한계: XLSX ZIP64 미지원(4GiB 초과 실패), 시트 1개·결과 집합 1개, CSV 수식 주입 접두어 없음(값 보존 우선), 내보내기는 같은 SQL을 다시 실행하므로 화면 결과와 시점이 다를 수 있다. Excel 실제 앱으로 여는 수동 확인은 하지 않았고 .NET ZipArchive 기반 기존 파서와 독립 ZIP 검사로 대신했다. 작업 중 Python 쓰기 오류로 `resultFile.ts`가 한 번 비워졌으며 전체를 다시 작성한 뒤 위 검증을 수행했다. 커밋하지 않았다.

## 2026-10-29 — 가상 FK/업무 관계 저장과 AI JOIN 활용 완료 (Codex)

- 사용자 요구: 실제 FK 미설정 테이블들의 연결을 앱에 등록하고 `부가서비스 밴 조회해줘` 같은 업무명으로 AI가 관련 테이블을 JOIN하도록 한다. 특정 업무/코드 값을 하드코딩하지 않았다.
- 구현: `shared/relationships.ts` 엄격 DTO/구버전 빈 기본값·상한·복합키 중복 거부; `RelationshipWorkspace.tsx`와 App/styles의 가상 관계 메뉴/테이블·열 선택/업무명·별칭·설명/LEFT·INNER/관계 유형/저장 전 실제 메타데이터 재확인/수정·삭제/연결·DB 분리. SQLite settings만 저장하며 실제 FK/행/DDL은 변경하지 않는다.
- Main: `mcp/relationships.ts`의 연결+DB 필터·관계 해시·scope revocation; `metadata.ts` 선택적 힌트; `session.ts`의 기존 db_list_tables 업무 힌트와 db_get_foreign_keys 양방향 가상 관계/열 존재 상태. 기존 물리 FK와 별도이며 불일치/접근 불가는 invalid다. JSON 힌트 12KB/기존 턴 예산·기존 메타데이터 캐시 유지. `main/index.ts`에서 Main settings를 직접 읽고 `agent/service.ts`와 shared/mcp 설명에 관계 발견·검증·모호함 확인·코드 값 추측 금지·행 증식 주의를 추가했다. 새 도구/IPC/임의 ON SQL·실행 권한은 없다.
- 자동 검증: typecheck/lint/format/peer/build 통과, unit **375개/18파일**. actual DB integration **10통과/AI2 skip** 후 AI opt-in **5통과**(중복3개) → 서로 다른 **12개**. Electron actual DB **23통과/AI4 skip** 후 actual AI opt-in **5통과**(중복1개) → 서로 다른 **27개**. skip을 live 성공으로 집계하지 않았다. 최종 성공 로그 `.omx/relationships-validation-final-20261029.log`.
- 신규 테스트: unit7개(설정/복합키/상한/서버 식별자 보존/DB 격리·revision/수정·단절 후 거부/물리 FK 분리/열 누락/UTF-8 예산). 실제 Electron/SQLite+메타데이터 핸들러 대역 `relationships.spec.ts`가 생성·복합키·편집·재읽기·삭제·없는 열 거부/DB 전환·이력0·두 테마/최소창 가로 넘침 없음을 확인했다. `.omx/relationships/editor-dark.png`, `editor-light-minimum.png`를 직접 확인했다.
- 실제 신규 수용: `live-relationships.spec.ts`는 전용 SQL Server에 물리 FK 없는 무작위 테이블 두 개를 만들고 실제 UI로 업무명/연결 열을 저장한다. 공식 Codex0.165.0/ChatGPT가 테이블명이 없는 한국어 요청으로 db_list_tables/db_get_foreign_keys를 사용해 LEFT JOIN을 제안하고, 별도 열기/SELECT 실행에서 무작위 금액이 실제 결과에 나타났다. 제안 전 실행 이력0/행 전용 비공유 표식 미노출/실제 FK 여전히0을 확인했다. 기존 실제 텍스트+재개/DB MCP/XLSX JOIN 및 쓰기 rollback·COMMIT 회귀도 통과했다. API 과금 fallback 없음.
- 실패와 복구: 최초 신규 UI 테스트의 즉시 reload는 기존 App의 350ms 설정 저장 확인 전 beforeunload flush/close와 충돌했다. 기존 debounce 확인 뒤 reload하도록 테스트만 조정했고 통과했다. 첫 전체 검증 `.omx/relationships-validation-20261029.log`에서 기존 `live-mutations`가 초기 탐색기 메타데이터 읽기 중 쓰기 lease를 요청해 올바르게 거부됐다(`현재 쿼리가 끝난 뒤…`). 테스트의 connect helper가 실제 DB 선택기가 나타나 초기 탐색기 조회 완료된 뒤 진행하도록 변경했고 최종 전체 실행이 통과했다. Main lease/쓰기/메타데이터 보호를 완화하거나 자동 재시도를 추가하지 않았다.
- 정리: 실행 DB `aidb_write_test_local_45ba7c625f57`, `aidb_write_test_local_86cbadabfe53` 및 실행 전용 setup/writer/reader 사용자를 제거했다. 별도 Windows 인증 audit에서 run_databases=0/run_logins=0/app_sessions=0/original_test_database_online=1. 원래 빈 테스트 DB/서버 설정은 보존했다.
- 문서: ADR-026, VIRTUAL_RELATIONSHIPS.md, README/HANDOFF/TASKS. 새 의존성·커밋 없음. 관계 정보는 공유되는 비밀 아닌 메타데이터이며 업무명/설명에 실제 비밀을 넣으면 안 된다. 자료형 호환/유일성/행 매칭/업무 의미는 자동 보증하지 않으며 고객 실스키마 수용은 별도다. 전체 프로젝트가 기존부터 untracked여서 git diff는 변경 파일 목록 증거가 아니며 실제 소스/테스트 출력을 기준으로 확인했다.

## 2026-10-29 최신 — SQL 포맷 설정·불필요한 대괄호 제거 (Codex)

- 사용자 예시를 기본으로 앞쪽 쉼표/대문자 키워드/4칸 들여쓰기/JOIN ON 정렬/AND·OR 줄바꿈을 구현했다(ADR-025, SQL_FORMATTING.md). 일반 영문 식별자의 불필요한 대괄호를 제거하고 예약어·특수문자·앱 파서상 필요한 인용은 유지한다. 식별자 대소문자·리터럴·변수/주석·GO 구분을 보존하며 포맷을 실행 승인으로 사용하지 않는다.
- SQL 정리 버튼/Alt+Shift+F·undo, 6개 옵션 native dialog/실시간 미리보기·저장/기본값/취소/Escape, 기존 SQLite 설정의 기본값 호환·재시작 복원을 추가했다. AI 카드/새 제안 탭/테이블 SELECT 생성에 적용하고 기존 탭·저장 SQL·이력은 자동 재작성하지 않는다. AI context에는 검증된 스타일 enum/숫자/boolean만 추가했다. Main 실행 파서/정규화 인용·승인/쓰기 정책은 바꾸지 않았다.
- 변경: `shared/{sqlFormatting,contracts,agent}.ts`, `main/agent/service.ts`, Renderer `App/store/lib/sqlCompletion/components/{AgentPanel,SqlWorkspace,SqlFormattingDialog}/styles.css`; SQL formatter unit/Electron 및 기존 MCP/자동 scope/테이블 생성 테스트 기대값, SQL_FORMATTING/DECISIONS/TASKS/HANDOFF/README. 새 의존성·임의 IPC·커밋 없음. 닫히지 않은/지원하지 않는 SQL의 수동 정리는 원문을 보존하고 오류를 표시하며, AI 초안은 정리 실패를 명시한 뒤 원문을 표시/연다.
- 검증: `.omx/sql-formatting-validation-20261029.log`에서 typecheck/lint/format/peers/unit368/build, 실제 DB integration10개+AI opt-in5개(중복3개)로 전체12개, 실제 DB Electron22개+AI opt-in4개(중복1개)로 전체25개 통과. 실제 Codex 메타데이터→정리된 제안/새 탭→SELECT 결과, XLSX/변경 초안 미실행, 기존 읽기/쓰기/저장 조회와 자동 페이지도 재통과했다. 최종 보수 검토에서 contextual word/AS 별칭의 원래 대소문자를 보호하는 회귀를 추가한 뒤 typecheck/lint/format/unit368/재빌드·기본 Electron18개도 재통과했다(DB/AI7개 opt-in skip). 최종 증거는 `.omx/sql-formatting-final-20261029.log`다.
- 화면 `.omx/sql-formatting/`: 다크 및 1080×720 라이트 native dialog 중앙 배치·가로 넘침 없음·저장 버튼 접근을 확인했다. 설정 저장/미리보기/Ctrl+Enter로 SQL이 실행되지 않으며 잘못된 문자열 정리도 기존 SQL을 잃지 않는다. 사용자 예시의 변수/3부분 객체명을 포맷할 수 있는 것이 실행 문법 확장을 뜻하지 않는다.
- 실행 전용 DB `aidb_write_test_local_e0be2d158420`과 임시 계정을 정리하고 원래 테스트 DB는 보존했다. 독립 Windows 인증 조회로 이번 3개 실행 DB/로그인·앱 SQL 세션0개 및 원래 테스트 DB ONLINE을 확인했다. 실제 사용자 업무 파일/운영 TLS·부하·다중 문장 원자 변경 등은 기존 TASKS대로 남는다.

## 2026-10-29 — 다음 페이지 자동 추가 조회 (Codex)

- ADR-024: 별도 다음 N행 버튼을 없애고 하단 다음 페이지 이동 시 필요한 서버 배치를 자동 조회한다. 캐시 이동은 DB를 호출하지 않고 작은 배치도 요청 화면 페이지를 채운다. 미확인 건수는 `+`, 전체 미확인 시 마지막 페이지 이동은 비활성이다. 기존 상한·일회성 continuation·원래 연결/DB 범위는 유지한다.
- 변경: SqlWorkspace/styles, auto-paging/live-paging/grid-density 테스트, vitest.integration.config 및 문서. 중복 클릭·오류/취소 후 소비된 토큰 재시도 금지·기존 행 보존·탭 변경 후 늦은 응답 격리·작은 배치 합치기를 handler-double로 검증했다. 실제 SQL Server 2500행은 화면 500행 이동 시 서버 조회가 정확히1000/1000/500으로 발생하고 캐시 이동은 추가 호출이 없음을 확인했다.
- 첫 전체 검증의 공유 DB fixture 병렬 수행에서 기존 mutation 테스트가 SQL1205 교착으로 실패했다(`.omx/auto-paging-validation-20261029.log`). 정확한 서버 교착 그래프는 수집하지 않아 순환 원인은 확정하지 않는다. 파일 간 같은 DB의 catalog/permission 변경 간섭을 줄이도록 integration 파일을 순차 실행한다. 테스트 내부 물리 연결 동시성/잠금 검증은 유지하며 앱의 자동 재시도를 추가하지 않았다.
- 순차 DB integration10개는 통과했다. 당시 전체 Electron은20개 통과/AI3개 skip/기존 table-view dragTo1개 실패였고, 해당 테스트 단독3회와 전체 기본17개/DB·AI7개 skip 재실행은 통과했다(`.omx/auto-paging-serial-validation-20261029.log`, `auto-paging-default-final-20261029.log`). 이후 drag 상태/목표 drop 상태를 기다리는 실제 포인터 동작으로 회귀를 강화했고 위 SQL 포맷 전체 검증에서는 해당 테스트와 실제 페이지 테스트까지 모두 통과했다. TableView 제품의 드래그 로직은 바꾸지 않았다.
- 실행 DB `aidb_write_test_local_aada834e7080`/`2d81aa361e14`는 정리됐다. 정렬/필터는 불러온 행만 대상으로 하는 기존 client-side 계약이며 DB 전체 정렬은 SQL ORDER BY를 사용한다. 필터 클릭만으로 DB 전체를 끝없이 조회하지 않는다.

## 2026-10-29 최신 — 선택 DB 구조 자동 공유 (Codex)

- 사용자 지시로 AI 패널의 DB 공유 체크박스·토글 상태를 제거했다(ADR-023). 연결된 현재 SQL 탭의 DB 구조가 메시지 전송 시 자동으로 제공된다. 기본 화면에는 공유 중인 연결/DB와 행 데이터 제외만 짧게 표시한다. DB 선택·CLI 상태 확인·엑셀 요청 준비만으로 AI를 호출하지 않으며 DB 미연결 대화는 텍스트 전용이다. 저장 쿼리 이름 호출은 계속 로컬 처리한다.
- 기존 Main context/capability를 사용한다. 내부 `shareSchema: true` 필드는 남지만 UI 옵션은 아니다. 선택 연결/DB 변경 시 취소·제안 정리, 세대·scope 검증, 다른 DB/행/엑셀 셀/SQL 탭/자격 증명 비공유, AI 제안 미실행과 쓰기 승인 경계는 유지했다. Main/preload/IPC/설정 저장소/의존성은 변경하지 않았다.
- 변경: `components/AgentPanel.tsx`, `styles.css`; 신규 `agent-auto-context.spec.ts`와 기존 agent/agent-panel-compact/import-workspace/live-mcp/live-import-ai UI 테스트; README와 관련 사용·설계·인계 문서. 신규 handler-double 회귀는 선택/상태 확인 시 AI호출0회, 전송 시 자동 context, DB/연결 변경·활성 요청 취소·단절 후 text-only를 검증한다. 실제 MCP/XLSX 스펙도 체크박스 조작 없이 돌아가도록 바꿨다.
- 검증: typecheck/lint/format/peers/unit341/build 통과. 실제 DB integration10개+AI opt-in5개(중복3개)로 **12개** 통과. Electron19개+AI opt-in4개(중복1개)로 **22개** 모두 통과했다. 실제 Codex/SQL Server에서 체크박스 없이 메타데이터 발견→제안→SELECT/결과, 같은 세션 재개, XLSX 발견과 미실행 변경 초안, 셀/행 비공유와 단절 정리를 재검증했다. UI 축소/두 테마·창 크기·쓰기/저장 조회 회귀도 통과다.
- 증거 `.omx/auto-db-context-validation-20261029.log` (`run-resume-tests.ps1`). 실행 전용 빈 DB `aidb_write_test_local_07e5de2c10be`와 임시 계정을 정리하고 원래 테스트 DB를 보존했다. 새 커밋/운영 환경 변경 없음. 아래 과거 기록의 명시적 UI 공유 선택·기본 꺼짐은 ADR-023으로 대체한다.

## 2026-10-29 최신 — AI 패널 설명 축소 (Codex)

- 사용자 피드백으로 상단 공유/인증 설명, 빈 대화 안내, 입력창/하단의 반복 고지를 기본 닫힌 **사용 안내**로 모았다(ADR-022). 기본 화면은 짧은 CLI 상태/확인, DB 구조 공유·행 제외, 공유 중 DB, 한 줄 빈 대화와 입력/동작 버튼 위주다. 제안 카드의 미실행·쓰기 승인 안내는 한 줄로 유지했다.
- 변경: `src/renderer/src/components/AgentPanel.tsx`, `src/renderer/src/styles.css`, 신규 `tests/e2e/agent-panel-compact.spec.ts`, `tests/e2e/readability.spec.ts`, DECISIONS/TASKS/HANDOFF/PROGRESS. 글꼴 축소/새 의존성/설정 마이그레이션 없이 기본 대화 공간을 확보했다. handler/IPC/DB/CLI 인증·전송/저장 쿼리 로직은 변경하지 않았다.
- 행동 잠금 후 표시만 수정했다. 별도 검토 패스에서 오류·거부 사유의 상시 표시, 공유 기본 꺼짐과 접근성 이름, 펼쳐 읽을 수 있는 진단/기록/과금/쓰기 안내를 확인했다. 변경한 fallback/예외 처리 경로는 없다. native details 키보드 열기/닫기, 입력 보존, 두 테마·1500×800/1080×720에서 대화 높이180px 이상·패널 세로 넘침 없음·전송/새 대화가 스크롤 없이 보임을 회귀로 고정하고 캡처를 검토했다.
- 검증: typecheck/lint/format/unit341/build 통과. 기본 integration3개 통과·DB/AI9개 opt-in skip, 전체 기본 Electron15개 통과·DB/AI6개 skip. 실제 DB/구독 호출은 이번 표시 변경 범위에서 재실행하지 않았으며 이전 실검증과 구분한다. 계획 `.omx/context/ai-panel-compact-plan-20261029.md`, 로그 `.omx/agent-panel-compact-verification-20261029.log`, 화면 `.omx/agent-panel-compact/`. 업무 DB 변경/커밋 없음. 기존 비차단 Vite/NO_COLOR 경고는 유지된다.

## 2026-10-29 최신 — AI 패널 저장 쿼리 호출 완료 (Codex)

- 사용자 다음 작업 지시로 ADR-021을 구현했다. AI 대화창에서 정확한 이름·별칭, `매출 조회해줘`, `저장 쿼리 매출 실행`, `/조회 매출`을 처리한다. CLI 로그인이나 metadata 공유 없이 로컬 실행하고 저장 SQL·결과·명령을 AI에 전송하지 않는다. 일반 질문은 기존 CLI 상태 확인/구독 경로를 유지한다.
- 목록은 매 호출 Main에서 새로 읽고 기존 SQL 작업 공간의 SELECT review→execute·그리드·취소·이력을 재사용한다. 값 보간이나 새 IPC/MCP 도구는 없다. 모호한 이름·명시적 미일치·타 연결/DB·대기 중 탭/연결 바인딩/편집 변경을 거부한다. Main review의 DB와 저장 DB가 다르면 execute하지 않는다. 쓰기 SQL은 Main SELECT 정책에서 거부하며 자동 preview/apply/commit하지 않는다. 현재 탭에 SQL을 불러오는 동작은 기존 저장 쿼리 입력칸과 같다.
- 변경 파일: `src/renderer/src/{App.tsx,components/AgentPanel.tsx,components/SqlWorkspace.tsx,lib/savedQueryRequest.ts}`; `tests/unit/saved-query-request.test.ts`, `tests/e2e/{saved-query-chat.spec.ts,live-mssql.spec.ts,agent.spec.ts}`; README와 DECISIONS/TASKS/HANDOFF/PROGRESS. 기존 저장소·Main·preload·SQL 정책·의존성은 변경하지 않았다. 별도 실행기를 만들지 않고 기존 SELECT 실행을 재사용했다.
- 검증: typecheck/lint/format/peers/unit **341개**/build 통과. 전용 실제 DB integration **10개 통과·AI2개 skip** 및 opt-in **5개 통과**(중복3개), 중복 제외 **12개**. 실제 DB Electron **17개 통과·AI3개 skip** 및 opt-in **4개 통과**(중복1개), 중복 제외 **20개**. 신규 UI handler-double 테스트는 실행1회/AI호출0회, 중복·DB 변경·탭 변경의 추가 실행0회를 확인했다. 실제 `live-mssql`은 이름 조회 결과42·이력 증가, 저장 UPDATE와 타 DB 이름 거부·이력 불변을 검증했다. 기존 실제 Codex 텍스트/재개·MCP·XLSX/SQL/미실행 초안도 재통과했다.
- 증거 `.omx/saved-query-chat-validation-20261029.log` (`run-resume-tests.ps1`). 실행 전용 DB `aidb_write_test_local_14536667a5ae`와 임시 계정을 정리했다. 독립 Windows 인증 조회에서 실행 DB/로그인/앱 세션0개, 원래 테스트 DB ONLINE을 확인했다. 안내 문구만 최종 정리한 후 lint/format/`test:e2e`(재빌드 포함)도 다시 통과했다(기본14개 통과·DB/AI6개 opt-in skip, 앞선 실제 환경에서 전부 통과). 최종 로그는 `.omx/saved-query-chat-final-20261029.log`이며 두 테마·세 창 크기의 가독성 회귀와 최종 화면도 확인했다. 커밋하지 않았다.
- 남은 범위: SQL 탭 이름 변경, 결과 파일 내보내기, 다중 문장 원자 변경, 엑셀 JOIN 미일치 건수 표시, 실제 업무 파일·Production TLS/부하. 이번 작업으로 후속 Phase를 자동 시작하지 않는다. 기존 Vite native config 로더/NO_COLOR 경고는 비차단이다.

## 2026-10-29 최신 — 잔여 실제 AI 수용 및 전체 회귀 완료 (Codex)

- 이전 사용량 한도로 미완료였던 실제 Codex0.165.0/ChatGPT 구독 테스트를 재개해 통과했다. `live-import-ai.spec.ts`는 실제 XLSX → Main 파서·SQLite → 읽기 전용 SQL Server → MCP로 무작위 테이블·열 발견 → SELECT 생성·모달 없는 실행·실제 그리드 → 미실행 UPDATE/JOIN 초안을 검증했다. 엑셀 셀 값은 AI 이벤트에 나타나지 않고 초안 생성으로 업무 행/이력이 변경되지 않음을 확인했다.
- `live-mcp.spec.ts`의 실제 DB metadata 발견/같은 AI 세션 재개/제안·원래 SQL 보존/SELECT/단절 공유 해제와 `agent.spec.ts`의 실제 텍스트·대화 재개도 통과했다. 최신 SELECT 즉시 실행/엑셀 JOIN 변경/저장 쿼리/페이지·탐색기 기능을 유지했으며 앱 소스 수정은 필요하지 않았다.
- 검증: typecheck/lint/format/peers/build 통과, unit **324개**. 전용 실제 DB 환경 integration **10개 통과·AI2개 skip** 후 AI opt-in integration **5개 통과**(기존3개 재실행 포함), 즉 중복 제외 전체 integration **12개 통과**. Electron 기본 **16개 통과·AI3개 skip** 후 opt-in **4개 통과**(기존1개 재실행 포함), 즉 전체19개 모두 수용했다. `workspace.spec.ts`의 이전 간헐 실패도 이번 전체 실행에서는 재현되지 않았다.
- 재현 스크립트 `.omx/local-sql-validation/run-resume-tests.ps1`, 로그 `.omx/resume-tests-20261029.log`. 무작위 전용 DB와 일회성 준비용/쓰기용/조회용 계정만 사용했고 암호는 기록하지 않았다. 실행용 빈 DB `aidb_write_test_local_c930b8459f67`과 임시 로그인은 제거했다. 원래 빈 `aidb_write_test_local`은 ONLINE 유지다. 커밋하지 않았다.
- 남은 범위: 실제 사용자 업무 파일·업무 스키마 수용, Production TLS/부하, AI 패널에서 저장 쿼리 이름 호출, 기간 종료+추가의 두 문장 원자 실행. 이번 테스트 완료가 해당 미구현·미검증 범위의 완료를 뜻하지 않는다. Vite의 향후 native config 로더 경고는 비차단이며 현재 빌드는 통과했다.

## 2026-10-28 최신 — 더 불러오기·테이블 상세·열 순서 저장 (Claude Code)

- 결과 페이지(ADR-020): `policy.ts` OFFSET/FETCH·`ReadQuery.shape`·page 인자, `service.ts` `run()`/`fetchMore`/continuation, 고정 IPC `db:fetch-more`, 결과 헤더 "다음 N행 불러오기"·이어 불러올 수 없을 때 안내. PK 조회 중 취소/종료가 쿼리를 시작하지 않도록 abort 확인을 추가했다.
- 탐색기: 상단 검색은 연결 전용, 스키마 트리 위에 별도 **테이블 검색**(일치 수·빈 스키마 숨김). 테이블 클릭 시 가운데 `TableView`(열·형식·**NULL 허용**·PK, 인덱스, FK)가 열린다. 사이드바의 좁은 열 목록과 `?` 표시는 제거했다.
- 열 순서: 행 드래그(HTML5) 또는 ↑↓, 체크 해제로 제외, **순서 저장**으로 설정 SQLite `columnLayouts`(연결:DB:스키마.테이블, 최대200개)에 저장해 다시 열면 복원(새 열은 뒤에 추가). "SELECT를 편집기에서 열기"는 그 순서로 SELECT를 만든다. 결과 그리드 열은 AG Grid 헤더 드래그로 이동할 수 있다.
- 검증: unit324개, 기본 Electron13개 통과/6개 skip(신규 `table-view.spec.ts`: 검색·가운데 표시·NULL 열·실제 드래그·저장·재열기 복원·SQL 순서), 로컬 MSSQLSERVER01에서 `paging.test.ts`(2500행 1000/1000/500·PK/ORDER BY 순서 무중복·TOP 상한·JOIN 미발급·토큰 재사용/재접속 거부)와 imports integration, `live-mssql.spec.ts` 통과. 실행용 DB는 비어 있음을 확인 후 삭제했다. typecheck/lint/format 통과. 첫 전체 e2e에서 `workspace.spec.ts`가 1회 실패했으나 단독·5회 반복·재실행 모두 통과했다(원인 미확인 간헐 실패).

## 2026-10-28 최신 — 패널 경계 드래그와 import 별칭 (Claude Code)

- `Splitter.tsx`: 탐색기|작업 공간|AI 패널 사이와 편집기|결과 사이 경계를 마우스로 끌어 조절한다(포커스 후 방향키 16px). 너비는 기존 설정으로 저장되고 편집기 높이는 세션 동안 유지된다. 끌기 시작점은 화면에 실제 렌더링된 크기다. 같은 기능의 하단 슬라이더 2개를 제거했고 최대 폭을 탐색기 600px/AI 800px로 넓혔다(기존 저장값 호환).
- import: 두 단계 이상 상대경로 134개를 `@shared`/`@main`/`@` 별칭으로 바꿨다(DEVELOPMENT.md 규칙). tsconfig paths, electron-vite main/preload/renderer, Vitest 두 설정이 같은 `alias`를 쓴다.
- 검증: typecheck/lint/unit321개/build/format, 기본 Electron12개 통과/6개 skip(workspace.spec가 실제 마우스 드래그·키보드로 탐색기300px·편집기+80px·AI360px 저장/복원 검사), 기본 integration3개 통과/8개 skip.

## 2026-10-28 최신 — SQL 자동완성 (Claude Code)

- `src/renderer/src/lib/sqlCompletion.ts`: Monaco 공통 completion provider. Ctrl+Space는 현재 SQL에서 참조한 테이블의 열 → 전체 `스키마.테이블` → 키워드 순으로 제안하고, `.` 입력 시 `별칭.`/`테이블.`은 열(형식·PK 표시), `스키마.`은 테이블을 제안한다. 메타데이터는 탐색기와 같은 react-query 키(`explorer`/`table`)를 재사용하며 새 IPC는 없다. 한글·예약어 식별자는 앱 파서가 읽을 수 있도록 `[...]`로 삽입한다.
- `monaco.ts`가 쓰는 `editor.api.js`에는 suggest 위젯이 없어 `suggestController` contribution만 추가로 import했다(전체 editor.main 미사용).
- 검증: unit321개(`sql-completion.test.ts` 별칭/문맥/식별자), `sql-completion.spec.ts`(실제 Monaco·핸들러 대역: `dbo.`→테이블, `t.`→열 선택 시 `[정산금액]` 삽입, Ctrl+Space 테이블), 기본 Electron12개 통과/6개 skip, typecheck/lint/format 통과.

## 2026-10-28 최신 — 실제 업무 XLSX 가져오기 오류 수정 (Claude Code)

- 사용자 업로드가 `XLSX parsing failed: Macros, embedded content and external links are not supported.`로 실패했다. 파서가 모든 `.bin` 파트를 거부해 Excel이 일반 문서에 넣는 인쇄 설정 `printerSettingsN.bin`도 막은 것이 유력한 원인이다(사용자 파일 자체는 확인하지 못함). 해당 경로만 허용하고, 거부 시 원인 파트/콘텐츠 형식을 메시지에 포함해 한국어로 표시한다. 회귀: import-workbook 허용1개·거부 경로 표시1개, locale1개 추가, unit318개 통과, import Electron2개 통과.

## 2026-10-28 최신 — 결과 그리드 가독성 (Claude Code)

- 탭 바: 1px 세로 넘침으로 생긴 세로 스크롤바 제거. 탭은 120~180px로 줄어들고 넘치면 스크롤바 없이 휠로 가로 이동하며, 활성 탭은 자동으로 보이게 스크롤한다. `+`와 새 **탭 목록** 버튼(모든 탭의 제목 + SQL 첫 줄, Esc/바깥 클릭으로 닫힘)은 항상 보인다. 탭 툴팁에 SQL 첫 줄을 표시한다. `grid-density.spec.ts`에 1080×720·탭12개 검사(세로·가로 스크롤바0, 활성 탭·버튼 가시성, 목록 전환)를 추가했고 기본 Electron11개 통과/6개 skip.
- 사용자 화면(결과 약4행만 보임, 값 잘림) 피드백: 에디터를 기본20%·드래그 크기 조절(`resize: vertical`)로 바꾸고 결과 영역이 남은 공간을 차지한다. 행30px/헤더34px, 열 너비 내용 맞춤(`fitCellContents`, 72~420px), 잘린 값 툴팁, 셀 텍스트 선택을 적용했다. 상태줄의 지난 "명시적 승인 필요" 문구를 "검증 후 바로 실행"으로 고쳤다.
- `grid-density.spec.ts`(핸들러 대역, DB 없음) 추가: 1500×960에서 완전히 보이는 행9개 이상(화면상10행)·이름 열 미잘림, 캡처 `.omx/readability/grid-1500x960.png`. typecheck/lint/unit316개/format, 기본 Electron11개 통과/6개 skip(readability 포함).

## 2026-10-28 최신 — 저장 쿼리 이름·별칭 호출 (Claude Code)

- ADR-019. `shared/database.ts`(계약·`resolveSavedQuery`·`assertUniqueQueryNames`), `repository.ts`(`saved_queries`), 고정 IPC 3개(`db:saved-queries`/`db:save-query`/`db:delete-saved-query`), `SqlWorkspace.tsx` 저장 쿼리 입력칸(불러와 실행/현재 SQL 저장/저장 쿼리 삭제, datalist 자동완성)을 추가했다. 새 의존성은 없다.
- 검증: typecheck/lint/unit316개/build 통과. 기본 Electron10개 통과/6개 skip(신규 `saved-queries.spec.ts`: 실제 SQLite 저장·중복/잘못된 입력 거부·재시작 유지·삭제). 로컬 MSSQLSERVER01에서 `live-mssql.spec.ts` 통과(저장 → 없는 이름 거부 → 대소문자 다른 별칭으로 실행 → 실제 결과 42·이력2건).
- 정리: 사용자 지시로 이번 세션 6개와 이전 Codex 실행분 3개, 총 빈 실행용 DB 9개를 비어 있음(사용자 테이블·사용자 0)을 확인한 뒤 삭제했다. `aidb_write_test_local`만 ONLINE이며 임시 로그인은 0개다. 아래 항목의 "남아 있다" 기록은 이 정리로 대체한다.

## 2026-10-28 최신 — 엑셀 JOIN UPDATE/INSERT 실행 (Claude Code)

- 사용자 결정(UPDATE JOIN + INSERT SELECT, 상한1000행)에 따라 기존 개발 전용 쓰기 흐름에 문법을 추가했다(ADR-018, EXCEL_IMPORT.md "엑셀 JOIN 쓰기"). 변경 파일: `policy.ts`(문법), `mssql/mutations.ts`(미리보기·실행·검증), `mssql/adapter.ts`(`#temp` 적재·rollback 전용 미리보기 트랜잭션), `mutations.ts`(행 수·digest 검증, 실패 사유 `detail`), `MutationPanel.tsx`(사유 표시·안내 문구).
- 먼저 기존 엑셀 SELECT JOIN 실검증을 재실행했다: integration imports2개, Electron import-file2개 통과.
- 검증: typecheck/lint/unit313개/build 통과, 기본 Electron9개 통과/6개 skip. 로컬 MSSQLSERVER01 전용 fixture에서 신규 `import-mutations.test.ts`(UPDATE JOIN 미리보기·COMMIT, 다중 일치/변환 실패/원문→int 거부, INSERT rollback·동시 삽입 경쟁 rollback·COMMIT)와 기존 mutations/imports integration 총4개 통과, `live-mutations.spec.ts` UI1개 통과.
- 별도 리뷰(차단 결함 없음) 반영: 원문 텍스트를 nvarchar/nchar로 제한(MEDIUM, varchar `?` 손실), ON 키 공백·변환 실패 거부(INSERT 중복 방지). 재실행 결과 unit313개/실DB integration4개 통과. 남은 LOW: 미일치 엑셀 행 수 미표시, varchar↔nvarchar 비교 시 인덱스 미사용으로 넓은 잠금 가능, `isolated()` 정리 순서가 `busy` 직렬화에 의존.
- 실행용 빈 DB `aidb_write_test_local_9f9c76bc4be2`, `..._4542dec7cae6`, `..._36737658fca5`, `..._4a9c0314c66f`가 추가로 남아 있다(삭제 권한 거부, 임시 계정은 제거됨).

## 2026-10-28 최신 — SELECT 별도 승인 화면 제거 (Claude Code)

- 사용자 요구에 따라 `SqlWorkspace.tsx`의 검토 모달을 없애고 쿼리 실행/Ctrl+Enter가 `reviewQuery`→`executeQuery`를 이어 호출해 바로 결과를 표시한다. Main/IPC/preload 계약과 파서·토큰·상한·이력은 변경하지 않았다(ADR-017). 쓰기 경로는 그대로다.
- 검증: typecheck/lint/unit295개/build 통과, 기본 Electron9개 통과/실제 AI·DB6개 skip. 로컬 MSSQLSERVER01 전용 fixture에서 `live-mssql.spec.ts`1개 통과(모달 없음→실제 그리드 42→이력 성공). `live-mcp`/`live-import-ai` 스펙은 모달 단계를 제거했으나 Codex 사용량 한도로 이번에 재실행하지 않았다.
- 이번 실행 DB `aidb_write_test_local_a3274ba685c1`(빈 DB, 임시 계정 제거됨)는 자동 삭제 권한이 거부되어 남아 있다. 이전 실행의 `..._cb9e912abec1`, `..._eec349054a60`도 남아 있을 수 있다.

## 2026-10-28 최신 — 범용 엑셀 가져오기 (Claude Code 이관 시 기록 보완)

- XLSX 선택/제한 파서/메모리 SQLite 적재, 연결별 `[import].[stage_*]` 논리 테이블 등록, SELECT 시 pinned-session `#temp` 구성·rollback 정리, 제한 TRY_CONVERT, AI 메타데이터 발견과 미실행 변경 초안(`draft=true`)을 구현했다. 범위/제한은 EXCEL_IMPORT.md.
- 검증: typecheck/lint/unit295개 통과(이관 시 재실행). Codex 세션의 opt-in 실DB integration imports2개와 Electron12개 통과. `live-import-ai.spec.ts`는 Codex 사용량 한도로 실패해 실제 AI 수용은 미완료다.

## 2026-10-28 최신 — 작은 한글 가독성 개선

- 사용자 화면 피드백에 따라 UI 글꼴을 로컬 Noto Sans KR 우선/맑은 고딕·Segoe UI 대체로 변경했다. 본문14px, 보조 문구 최소12px, 주요 조작13px 이상으로 조정하고 과도한 자간을 줄였다. SQL 편집기/검토 SQL은 고정폭을 유지하며14px로 표시한다.
- 다크·라이트 테마의 보조색 대비와 입력 안내를 개선했다. 일반 보조 텍스트 색은 기본/패널/상승 배경에서 대비4.5 이상을 검사한다. 밝은 테마의 기본 버튼 글자는 흰색으로 구분한다. 한국어 줄바꿈과 좁은 창에서의 쓰기 안내 줄바꿈도 조정했다. 외부 글꼴 다운로드/새 의존성/DB·CLI 정책 변경은 없다.
- 변경 전12px 기준 실패를 확인한 뒤 `readability.spec.ts`를 추가해 두 테마 ×1500×960/1500×800/1080×720에서 크기·대비·가로 넘침·대화창 접근성을 검증했다. 전후 화면을 직접 확인했고 `.omx/readability/`에 보관했다.
- typecheck/lint/unit189개/build/format/peers/diff-check 통과. 기본 Electron7개 통과/실제 AI·DB4개 skip, 기본 integration3개 통과/5개 skip이다. 이번 스타일 변경에서는 실제 DB나 AI를 호출하지 않았다.
- 이후 사용자 요청한 자연어 SQL 작성 중심 UX/SELECT 즉시 조회/저장 쿼리 재사용/엑셀 정산 이력 반영은 별도 요구사항 정리 중이며 아직 구현 완료가 아니다. 기존 승인·쓰기 제한을 임의로 해제하지 않았다.

## 2026-10-28 최신 — 기본 UI 한글화

- 사용자 요청 범위로 화면/접근성 이름/연결 폼/쿼리·쓰기 승인/AI 패널/결과·이력/안전 경고를 한국어로 표시한다. 기본 탭 제목과 SQL 안내 주석, HTML/Chromium/Zod 언어, Monaco 번들 한국어와 그리드 문구도 적용했다.
- SQL·사용자 데이터·기존 탭·내부 enum·IPC·CLI 프로토콜과 승인 정책은 보존한다. 알려진 오류/이력은 표시 경계에서 번역하고 알 수 없는 외부 진단은 원문을 유지한다. 새 의존성/언어 선택 기능/자동 커밋은 없다.
- 변경 전 unit184개 통과 후 번역 회귀5개를 추가해 unit189개/typecheck/lint/build 통과다. 실제 DB opt-in integration6개/AI2개 skip, Electron8개/AI2개 skip이다. 기존 쓰기 승인·COMMIT/rollback과 한국어 페이지 표시, 한글 SQL 정확 저장/검증 오류/Monaco 한국어 리소스를 확인했다.
- 화면 캡처를 직접 확인했다. 범위·용어·파일·재현은 LOCALIZATION.md를 따른다. 이번에는 실제 AI 구독을 새로 호출하지 않았으며 기존 실제 MCP 수용 기록은 별도 과거 증거다.
- 계정 없는 기본 E2E6개 통과/AI·DB4개 skip, 최종 실제 읽기 E2E1개도 별도 통과했다. 실행용 DB2개/임시 계정·fixture를 제거하고 임시 로그인/앱 SQL 세션/기존 빈 테스트 DB 사용자 테이블 모두0개를 확인했다. 기존 테스트 DB는 ONLINE이다.

## 2026-10-28 최신 — 실제 DB MCP·Codex·UI 전체 수용 완료

- 사용자 요청한 잔여1번 범위만 수행했다. 실제 로컬 DB → Electron Main → MCP stdio → 공식 Codex CLI → SQL 제안 카드 → 별도 SQL 탭/검토·승인/실제 결과 그리드를 대역 없이 검증했다. `tests/e2e/live-mcp.spec.ts`1개 통과(28.8초)다.
- 프롬프트에 없는 무작위 테이블·컬럼 이름을 실제 `db_get_schema`에서 발견해 제안했고, 같은 세션의 새 턴 `db_list_databases`도 성공했다. 제안/새 탭/검토 때는 이력0개이고 승인 뒤에만 성공1개다. 원래 SQL 탭 보존/SELECT-only 계정/행 canary 미노출/단절 시 공유·카드 해제를 확인했다.
- 설치 CLI0.165.0을 발견해 공식 문서/로컬 help와 실제 텍스트·MCP start/resume으로 재검증 후 지원 버전을 정확히0.165.0으로 갱신했다. 이웃 버전 거부 회귀를 추가했고 기존 인증·프로세스·도구 제한은 유지했다. 전역 CLI 설정/토큰 저장소/의존성은 변경하지 않았다.
- 새 검증은 typecheck/lint/unit184개/build 통과, 실제 텍스트 integration1개/MCP integration4개/실DB MCP UI1개 통과다. 계정 없는 기본 integration은3개 통과/5개 skip이다. 자세한 재현·범위는 MCP_TESTING.md의 최신 항목을 따른다.
- 계정 없는 기본 `pnpm test:e2e`도 새 빌드 후5개 통과/실제 AI·DB4개 skip이다. 이 skip은 앞서 별도 실행한 실DB MCP UI 통과와 구분한다.
- 실행용 무작위 DB2개와 fixture·임시 계정을 정리하고 실제 조회로 임시 로그인/앱 SQL 세션/기존 빈 테스트 DB 사용자 테이블 모두0개를 확인했다. 기존 `aidb_write_test_local`은 ONLINE이다. CLI/provider 세션 기록은 삭제하지 않는다.
- Claude/SHOWPLAN/Production TLS/네트워크 장애 수용/Phase 6는 진행하지 않았다. 아래 기존 기록의 실DB MCP 전체 경로 미완료는 이 결과로 갱신한다. 자동 커밋은 없다.

## 2026-10-28 최신 — 실제 로컬 MSSQL 읽기·쓰기 및 Electron 수용

- 사용자가 로컬 테스트 인스턴스의 구성 변경/DB·계정 생성을 승인했다. MSSQLSERVER01을 혼합 인증으로 전환하고 TCP를 `127.0.0.1`/`::1:14331`에만 활성화해 재시작했다. 외부 NIC/방화벽은 열지 않았고 sa는 계속 비활성이다. 실제 앱 세션의 TCP/SQL 인증/TLS 암호화(TRUE)와 sysadmin=0을 서버 DMV에서도 확인했다.
- 전용 `aidb_write_test_*` DB와 임시 준비용 db_owner/앱용 객체별 UPDATE·DELETE 계정/SELECT-only 계정을 분리했다. 암호는 무작위 생성 후 테스트 프로세스 환경에만 주입했고 저장/출력하지 않았다. 테스트별 테이블과 임시 계정은 종료 후 제거한다.
- 실DB에서 rowversion 직접 varchar 변환이 16진수 문자열을 만들지 않아 미리보기가 실패하는 버그를 발견했다. 실패하는 회귀 테스트를 먼저 추가하고 preview/OUTPUT 양쪽에 명시적인 binary(8) 변환을 적용했다. 기존 승인/권한/쓰기 상한은 완화하지 않았다.
- 실DB backend는 UPDATE·DELETE commit/rollback, 별도 연결의 잠금 timeout, 오래된 미리보기 거부, 트리거·UPDATE 권한 거부, 정확한 DB 확인, 30초 자동 rollback과 서비스 종료 rollback을 검증한다. 상태 조회의 만료 fallback 없이 DB 잠금이 자동 해제되는지 확인한다.
- 실제 Electron은 연결 입력 UI/OS 암호화/실제 Main·preload·드라이버로 preview 무변경 → 검토 → 미확정 apply → rollback, 별도 DB 이름 확인 UPDATE·DELETE commit, 앱 종료 rollback을 검증한다. 기존 핸들러 대역 UI 테스트와 분리했다.
- 최신 검증: typecheck/lint/unit182개/build 통과. 전용 fixture opt-in integration6개 통과/AI2개 skip, Electron7개 통과/AI1개 skip. 일반 실행은 계정 없이 DB/AI를 호출하지 않는다. 새 의존성/자동 커밋/Phase 6 진행은 없다.
- 개발 self-signed 인증서 신뢰 옵션을 사용했다. 신뢰된 인증서의 Production TLS 경로, 실제 DB MCP→CLI 전체 경로, Claude 및 SHOWPLAN은 여전히 미검증/미지원이다. 실제 서비스 장애/COMMIT ack 불명확 수용도 이번 검증에 포함하지 않았다.
- 최종 정리: 이번에 만든 무작위 실행 DB6개를 빈 상태 확인 후 제거하고, 빈 `aidb_write_test_local`만 ONLINE으로 유지했다. 임시 SQL 로그인/앱 세션/남긴 DB 사용자 테이블은 모두0개, 서비스는 Running이다. format/peers/diff-check 통과, 계정 없는 기본 integration도 stdio3개 통과/AI·DB5개 skip이다.

## 2026-10-28 구성 승인 전 진단 (과거 기록)

- 새로 실행한 typecheck/lint/unit181개/build/Electron 로컬5개/format/peers는 통과했다. 기본 integration은 stdio3개 통과, 실제 AI/DB4개 skip이며 Electron의 실제 AI/DB2개도 skip이다. 실DB 쓰기 성공 증거가 아니다.
- 사용자가 제공한 `localhost\MSSQLSERVER01`/`master`/Windows 통합 인증으로 .NET SqlClient 읽기 전용 진단 접속에 성공했다. SQL Server 17.0.1000.7 Developer, shared memory/NTLM이며 해당 연결의 암호화는 FALSE다. 앱의 TLS/TCP/SQL 인증 경로를 검증한 것이 아니다.
- 서버는 Windows 인증 전용(`IsIntegratedSecurityOnly=1`), TCP 설정 비활성(`Enabled=0`)이고 접근 가능한 사용자 DB 조회 결과는0개다. 현재 로그인은 sysadmin이므로 최소 권한 수용 증거도 아니다.
- 현재 앱은 SQL 인증/명시 TCP 포트만 지원한다. 서버 인증·TCP 설정 변경/서비스 재시작, 테스트 DB·로그인 생성이나 통합 인증 구현은 별도 범위 결정 전 실행하지 않았다. `master`에 DDL/DML을 실행하지 않았고 Phase 5 실제 쓰기/전체 UI 수용은 계속 미완료다.

기준일: 2026-10-27. Phase 1 완료. Phase 2 소스/로컬 검증에 이어 사용자 지정 개발 MSSQL의 기본 성공 경로도 검증했다. 실제 부하/취소·운영 SELECT 전용 계정 검증은 남아 있다. Phase 3의 제한된 Codex 구독 CLI 통합을 구현하고 실제 기본 응답/재개를 검증했다. Claude는 비활성이다. Phase 4의 지원 가능한 MCP 경로를 구현하고 실제 Codex+fixture DB 호출/재개를 검증했으며 Claude·실DB 전체 경로·서버 실행계획 수용은 남아 있다. Phase 5의 개발 opt-in 제한 쓰기와 로컬 검증도 추가했으나 실DB 쓰기 수용은 미완료다. 상세 증거는 LIVE_VALIDATION.md/MCP_TESTING.md/WRITE_TESTING.md를 참조한다.

## 완료된 작업

- Phase 1: Electron45/React19/TypeScript strict/Vite8/pnpm, 격리 preload·sender 검증·Zod, Tailwind/shadcn Button, 로컬 Monaco/AG Grid, 다크/라이트/탭/폭·SQLite 설정, 에이전트 공통 문서.
- Phase 2 연결: mssql12.7.13, SQL Server 인증·TLS·명시포트, 새 연결/편집/삭제/선택/연결/단절, 별도 pool 다중 연결. 프로필과 비밀번호를 async safeStorage로 암호화 저장. 기존 암호 유지 편집과 재시작 복원 검증.
- Phase 2 탐색: DB/스키마/사용자 테이블/컬럼·PK·인덱스·FK 조회 코드, 파라미터 메타데이터 쿼리, DB 전환 시 재접속/권한 재검사, 테이블 SELECT 편집기 열기.
- Phase 2 실행: 토큰화/식 AST/제한 SELECT 문법, 정규화 SQL 검토, 60초 일회성 승인, 연결 세대 바인딩/재파싱, 실행·취소·시간 제한. 쓰기/배치/미지원 구문은 거부한다.
- Phase 2 결과: mssql arrayRowMode stream, TOP/행·4MiB·256열·셀/LOB 상한, 중복 열명 보존, AG Grid 가상화·페이지, 탭별 결과(최근5탭), 원래 연결/DB 표시, 최근100건 평문 실행 이력.
- Phase 2 보안/정리: 운영 TLS 정책과 유효 권한 허용 목록, 권한 변화 실행 직전 검사, 개발 계정 초과 권한 경고. 오류/취소 기록, 종료 시 요청 abort/진행 중 연결 대기/pool·내부 transaction 정리.

위 목록은 구현 범위다. 실제 DB 성공 경로의 검증 여부는 아래 표와 미완료 항목을 따른다.

## Phase 2 당시 검증 상태 (과거 기록)

| 명령                                    | 결과                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `pnpm typecheck`                        | strict 통과                                                     |
| `pnpm lint`                             | 통과, 경고0                                                     |
| `pnpm test`                             | 5개 파일, 58개 통과                                             |
| `pnpm build`                            | Main ESM/preload CJS/renderer 프로덕션 빌드 통과                |
| Electron E2E                            | 기존 로컬2개 통과 + 이번 실제 MSSQL live UI1개 통과 (별도 실행) |
| MSSQL integration                       | 기존에는 skip했으나 이번 실제 서버 실행1개 통과                 |
| `pnpm format:check`, `pnpm peers check` | 통과, 포맷/peer 충돌 없음                                       |

단위 테스트는 파서 양성/공격 구문, 승인 필요/재사용/만료/재접속 무효화, 동시 실행 차단, 요청별 취소·timeout·shutdown, OS 암호화 실패 거부, 스트림 상한/중복 열/권한 거부/메타데이터 파라미터·transaction 정리를 검증한다. DB 서비스와 driver의 성공 응답은 명시적 테스트 대역이다.

Electron E2E는 실제 async OS 암호화/SQLite/연결 CRUD/암호·호스트 평문 미저장/프로필 복원/노드 격리/잘못된 설정 거부/SQL탭 복원/종료 직전 저장을 검증한다. 실제 mssql 드라이버로 127.0.0.1:1 접속 실패도 확인한다. 추가 실제 서버 검증에서는23개 접근 가능한 사용자 DB를 발견하고 Athena의 메타데이터/SELECT42와 Electron 검토·승인·그리드·이력·단절이 통과했다. 개발 인증서 신뢰 옵션을 사용했으며 DB를 변경하거나 업무 행을 조회하지 않았다. 임시 사용자 프로필은 테스트 종료 후 삭제한다.

## 진행 중 / 미완료

- 실제 장기 쿼리 취소·timeout/대량 행·LOB/운영 SELECT 전용 계정·신뢰 인증서 검증이 남아 있다. 기본 실제 서버 성공 경로와 live UI는 통과했다.
- 로컬 MSSQL/Docker는 시작하지 않았고 사용자 제공 외부 개발 서버에서 검증했다. 자격 증명은 파일에 저장하지 않았다.
- Windows 통합 인증/named instance 자동 탐색/뷰/복잡한 SQL은 현재 미지원. Phase 5의 제한 개발 쓰기/트랜잭션 UI는 구현했지만 실제 DB 쓰기 검증은 남아 있다.
- Phase 3 Codex 통합은 구현했다. Claude는 비활성이다. Phase 4의 제한 MCP/메타데이터/제안은 구현했으며 PostgreSQL/MySQL/installer는 Phase 6 미구현이다.

## 알려진 제한/발견 사항

- SQL 탭과 실행 이력은 평문이며 SQL 리터럴·DB명/연결명이 남는다. 비밀값을 SQL에 넣지 않는다. OS 암호화는 같은 OS 사용자 권한의 악성 앱을 차단하는 경계가 아니다.
- 제한 파서는 완전한 T-SQL 호환 구현이 아니다. AS 별칭과 schema.table을 사용하고, CTE/서브쿼리/UNION/CASE/window/TVF/뷰/변수/힌트/다중 문장/쓰기는 거부한다.
- 결과는 미리보기이며 긴 셀은 잘릴 수 있다. 압축 전 renderer JS 약8.16MB, 큰 규모 메타데이터/LOB와 실제 부하 성능은 추후 실DB에서 측정해야 한다. 별도 worker 분리는 미구현이다.
- 운영 권한 검사는 보수적이며 서버별 권한/메타데이터 차이와 외부 DBA 변경의 TOCTOU를 실환경에서 확인해야 한다. 권한 검사 실패를 성공으로 처리하지 않는다.
- 초기 Git dubious ownership은 명령별 safe.directory로 대응했고 전역 설정/자동 커밋은 없다. Phase 1 파일이 아직 untracked이며 기존 사용자 파일을 삭제하지 않았다.
- TypeScript6.0.3/ESLint10 조합, Monaco0.57 export 경로, pnpm11 allowBuilds, sandbox preload 무의존 채널은 유지했다.
- 테스트로 발견한 스트림 취소 오류가 최초 제한 오류를 덮는 문제를 수정했다. 행 직렬화 오류도 catch/cancel한다.
- Claude 최신 공식 약관은 제품 내 실행을 조건부로 설명한다(ADR-011). 과거의 일률적 제3자 구독 금지 설명을 현재 정책으로 단정하지 않는다. 상업 약관/구독 격리 미검증으로 실행은 비활성이다.

## 다음 작업

전용 fixture에서 실제 취소/timeout·권한 거부·큰 결과 검증을 추가한다. 기본 실제 연결/메타데이터/SELECT/UI 성공 경로는 완료했다. Phase 3은 사용자 지시로 구현했다. Phase 4는 사용자 지시로 지원 경로를 구현했다. Phase 5는 사용자 지시로 제한된 경로를 구현했다. Phase 6는 별도 지시 전 시작하지 않는다. 재검증 방법은 LIVE_VALIDATION.md와 MSSQL_TESTING.md에 있다.

## Phase 3 — 이번 변경과 검증

- AgentAdapter/CodexAdapter/비활성 ClaudeAdapter, Main 소유 AgentService와 고정 status/start/cancel/reset/event IPC를 추가했다. Renderer에는 shell·파일·인증 토큰 접근을 노출하지 않는다.
- 공식 Codex CLI 0.164.0의 native 실행 파일만 절대 경로로 찾고 shell:false로 실행한다. API 키 환경/저장 인증과 미확인 인증·다른 버전은 거부한다. 토큰 파일을 직접 읽거나 복사하지 않는다.
- 사용자 config/rules 무시, 별도 앱 작업 폴더, ChatGPT 인증 강제, read-only/승인 never, 셸·hooks·plugins·apps·브라우저·멀티에이전트·Code Mode·MCP 비활성을 적용한다. 새 의존성은 없다.
- JSONL UTF-8 경계/중복 완료/프로토콜·프로세스 실패를 처리한다. 120초/1MiB/줄256KiB/2048개 이벤트 한도, 프로세스 트리 취소와 종료 정리, provider별 Main 세션과 실패·취소 시 무효화를 적용한다.
- UI는 CLI 상태 확인, 명시적 메시지 전송, 메시지 단위 스트림, 같은 provider 재개, 전환 시 취소, 새 대화, 사용량/오류를 표시한다. DB/SQL 탭을 자동 전송하거나 SQL을 실행하지 않는다. 로컬 대화는 최근20개로 제한한다.
- 실제 검증에서 Codex가 비활성 Code Mode 안내를 item.error로 출력한 뒤 정상 진행하는 것을 발견했다. 고정 버전의 해당 안내만 무시하고 다른 오류·도구 이벤트는 실패 처리하는 회귀 테스트를 추가했다.
- 최신 검증 명령/결과와 실제 구독 검증 범위는 AGENT_TESTING.md에 기록한다. 기존 Phase 2의 실제 DB 기록은 별도 과거 증거이며 이번에 DB 계정을 재사용하지 않았다.

이번 최종 로컬 검증은 typecheck/lint/unit92개/build/Electron3개/format/peers/diff-check 통과다. 실제 Codex integration1개와 Electron live1개도 별도 통과했다. 기본 integration은 AI/DB 조건 미설정으로2개 skip이며 실제 DB 재검증이 아니다.

## Phase 4 — 이번 변경과 검증

- src/shared/mcp.ts에 지정된7개 도구와 엄격한 인자/제안 계약을 추가했다. Main의 MetadataScope는 연결 세대·DB에 묶이고 비동기 조회 후에도 유효성을 확인한다. 다른 DB/연결·행·자격 증명·임의 SQL 실행 포트는 없다.
- src/main/mcp의 프로토콜/캐시/도구 세션/로컬 IPC broker와 별도 mcp-stdio entry를 추가했다. 256-bit capability/130초/고정 도구/직렬 처리/요청·출력 예산/TTL·크기 제한 캐시를 적용한다. TCP/HTTP는 없다. 새 의존성은 없다.
- AgentService는 명시적인 공유 context가 있을 때만 capability를 열고 종료·취소 때 닫는다. 범위/세대 변경 시 CLI 세션을 재개하지 않는다. Codex scoped 호출에서만 MCP에 필요한 code_mode_host를 활성화하며 셸/쓰기·타 provider 도구는 계속 차단한다.
- UI는 기본 공유 꺼짐, 연결/DB 변경 시 공유 해제·취소, SQL 제안 카드/원래 DB 확인/새 탭, 마지막 SQL 오류의 검토 가능한 입력 복사를 제공한다. SQL 실행과 승인은 기존 별도 경로다.
- 실제 Codex에서 표준 params _meta 처리와 code_mode_host 필요 조건을 발견해 수정·회귀 검증했다. 공식 Codex가 실제 stdio 스키마 조회/제안을 호출했고 capability를 교체한 뒤 같은 세션에서 DB 범위를 다시 조회했다. DB는 명시적 fixture이며 업무 DB를 조회하거나 수정하지 않았다.
- 최신 로컬 검증: typecheck/lint/unit115개/build/Electron 로컬3개 통과. integration은 실제 Node/Electron relay3개 통과, opt-in AI/DB3개 skip. 실제 Codex MCP integration1개는 별도 통과했다. 포맷/peer/diff 확인은 MCP_TESTING.md를 기준으로 한다.
- Claude 실제 MCP, 실DB 포함 전체 UI 경로, SQL Server 예상 실행계획은 미완료다. 정적 분석을 서버 계획으로 가장하지 않는다. TASKS.md에 따로 남겼다. Phase 5는 진행하지 않았다.

## Phase 5 — 이번 변경과 검증

- 기존 lexer/식 AST를 유지하고 더 좁은 UPDATE/DELETE 전용 파서를 추가했다. WHERE 누락/상수 술어/DDL/DROP/TRUNCATE/배치/함수·계산식/조인/다른 DB는 차단한다. 새 의존성은 없다. 기존 SELECT 경계를 쓰기 경로로 넓히지 않았다.
- 연결 readOnly 기본true와 운영 SELECT-only를 유지한다. 개발 프로필에서만 명시적인 false 저장·재접속으로 제한 쓰기를 켤 수 있다. 기존 프로필을 자동 활성화하지 않는다.
- Main MutationService/고정 preview·apply·commit·rollback·state IPC와 MssqlMutations를 추가했다. PK+NOT NULL rowversion/기능·권한 검사/최대100 대상·제한 샘플, 승인 SHA-256, 연결 세대·정책·메타데이터·대상 검증을 적용했다.
- 미리보기 후 SERIALIZABLE/UPDLOCK/HOLDLOCK으로 동일 대상을 확인한 뒤 적용하고, 별도 commit token과 DB 이름 확인 후에만 COMMIT한다. 취소/만료/실패/종료는 rollback하며, COMMIT ack 불명확은 unknown이다. 트랜잭션 종료 시 연결을 폐기해 세션 상태 재사용을 막는다.
- 메타데이터 조회 중에는 쓰기 lease를 거부한다. rollback 요청 직후 COMMIT이 끼어드는 경쟁도 차단하고 회귀 테스트를 추가했다. MCP/AI에는 쓰기/승인/commit 기능을 추가하지 않았다.
- 변경 전115개 회귀 통과. 최종 typecheck/lint/unit181개/build와 Electron 로컬5개 통과(실제 AI/DB2개 skip). 기본 integration은 로컬 stdio3개 통과, 실제 AI/DB/쓰기4개 skip이다. UI 쓰기 흐름 테스트의 Main 핸들러와 unit DB/driver는 명시적 대역이다.
- 전용 테스트 DB가 없으므로 실제 위험 SQL/트랜잭션을 실행하지 않았다. 강한 opt-in/DB 이름 제약이 있는 fixture 통합 테스트만 추가했고 실행 완료로 표시하지 않았다. TASKS/WRITE_TESTING의 실DB 통합·UI 수용 항목은 미완료다. Phase 6는 진행하지 않았다.

## 2026-10-29 — 다른 DB 조회(ADR-034) 보완 · date 표시 · 포맷 설정 대화상자

- 사용자 SELECT는 `다른DB.schema.table` 조회를 허용한다(쓰기·AI 도구는 현재 DB만). 실DB 전체 검증(`run-auto-paging.ps1` + cross-database 통합) 27 passed/4 skipped(AI opt-in), 임시 DB 삭제 확인.
- 자동완성: `Athena.dbo.Table 별칭` 3단 이름에서 별칭/컬럼 인식, `현재DB.` 입력 시 스키마 제안. 탐색기 검색도 `DB.schema.table` 형식을 받는다.
- 결과 그리드: SQL Server `date` 컬럼은 `2024-05-07`처럼 시간 없이 표시한다(datetime 계열은 기존 ISO 유지).
- SQL 포맷 설정 버튼: 개발 모드 StrictMode에서 effect 재실행 시 cleanup의 `dialog.close()`가 onClose를 불러 즉시 닫히던 문제를 수정했다.
- typecheck/lint/format/unit 392/build, e2e sql-completion·table-view·sql-formatting 통과. date 표시는 unit으로만 확인(실DB date 컬럼 e2e 없음).

## 2026-10-30 — 예시 쿼리로 SQL 포맷 설정 추론 · 키워드 열 맞춤 스타일

- SQL 포맷 설정에 "내 스타일 예시 쿼리" 입력과 "예시에서 설정 추론" 버튼 추가. `inferSqlFormatting`은 모든 옵션 조합으로 예시를 정리해 줄이 가장 많이 일치하는 조합을 고른다(AI 미사용, 로컬 계산).
- 새 옵션 `alignKeywords`(기본 false, 기존 설정 마이그레이션 영향 없음): `FROM    x`/`AND     x` 키워드 열 맞춤, ON 아래 AND/OR 정렬, `AND (` 안에 괄호 그룹이 오면 들여쓴 블록과 단독 OR 줄. `WITH (NOLOCK)` 공백 유지(모든 스타일).
- 편집기 붙여넣기: 줄 중간부터 복사해 첫 줄만 들여쓰기가 빠진 SQL은 나머지 줄의 원본 들여쓰기를 제거한다(`dedentSql`, 한 번의 Ctrl+Z로 원문 복구).
- typecheck/lint/format, unit 394(2회), build, e2e sql-formatting·readability 통과. 붙여넣기 보정은 unit(dedentSql)으로만 확인.

## 2026-10-30 — UI 안내 문구 제거

- 사용자 요청으로 순수 안내 문구를 삭제했다: 탐색기 하단 보안 안내, 연결 대화상자 비밀번호/통신 안내, AI 설정 안내·제공자 설명, AI 제안 카드 부연, 가져오기 화면 안내 5개, 가상 관계 안내 2개, SQL 포맷 보존 안내, 변경 미리보기의 정책·승인 해시 줄, 저장 쿼리 "현재 연결/DB 전용", 테이블 뷰 열 순서 사용법. 오류·운영 경고·개수·결과 이어 불러오기 안내는 기능 정보라 유지했다.
- typecheck/lint/format, unit 394, build, e2e 23 passed / 8 skipped(실DB·AI opt-in) 통과.

## 2026-10-30 — 결과 직접 편집 · rowversion 없는 쓰기 · 엑셀 파서 교체 · 아래 AI 채팅 · 설정 화면

- ADR-035: rowversion 없는 PK 테이블도 쓰기 허용(사용자 선택). 대상 행은 PK 값 식별자로 고정, 서비스 계층 스냅샷 형식 검사도 함께 완화. 실DB 통합 테스트 `key-guarded-write`(rowversion 없는 표에서 SELECT 결과 → UPDATE → COMMIT, 값 25 확인) 통과.
- ADR-037: 단일 테이블·별칭 없는 SELECT 결과를 그리드에서 편집(PK 열은 잠금), [저장]은 행마다 미리보기→apply→COMMIT, [취소]는 원복. 결과 표 글자 크기 설정. e2e `grid-edit`, unit `grid-edit` 추가.
- ADR-036: 엑셀 파서를 PowerShell → Node(zlib)로 교체하고 값만 읽는 관대한 규칙 적용. 사용자 파일 `VAN_고객마스터_20260929.xlsx`(3시트·112열·7,132행, 외부 연결·수식 포함)가 1초 안에 읽힘(이전: 외부 연결 거부 → 완화 후에도 120초 초과). 엑셀 가져오기 머리 아이콘 줄바꿈 수정.
- `date` 컬럼 표시는 날짜만(`2026-10-01`) — 실DB `imports` 통합 테스트 기대값 갱신.
- ADR-038: AI 채팅 기본 위치를 중앙 아래로(오른쪽 전환 가능), 말풍선·마크다운 답변, 지난 대화(로컬 30개), 왼쪽 아래 설정 화면(테마·전체/편집기/결과 글자 크기·AI 위치·변경 미리보기·SQL 포맷). '변경 미리보기' 체크박스 문구 단축.
- 검증: typecheck/lint/format, unit 388, build, e2e 25 passed/8 skipped(실DB·AI opt-in). 실DB 전체 검증(`run-auto-paging.ps1`) 결과는 아래 줄에 기록.
- 실DB 전체 검증(run-auto-paging.ps1): unit 388, 실DB 통합 13 passed/3 skipped, Electron 29 passed/4 skipped(AI opt-in), 임시 DB 삭제 확인. 검증 중 드러난 결과 파일 취소 경쟁(Windows에서 .partial 잔존 가능)을 파일 핸들 close 이후 삭제로 수정, 8회 반복 통과.

## 2026-10-30 — 여러 문장: 현재 문장 실행(Ctrl+Enter)·전체 실행(Alt+X)

- 편집기에 문장이 여러 개면 Ctrl+Enter는 커서 위치 문장(선택 영역 우선)만, Alt+X는 모든 문장을 차례로 실행하고 결과 탭(1, 2…)을 만든다. 문장은 `;`(문자열·[이름]·주석 밖) 또는 빈 줄로 나눈다(`lib/statements.ts`). 쓰기 문장은 그 문장만 변경 미리보기로 열고 전체 실행을 멈춘다. 상단 [쿼리 실행] 버튼은 삭제하고 단축키 안내만 둔다. Main의 한 문장 정책은 그대로다.
- unit statements 4, e2e run-statements 추가. 버튼을 누르던 e2e는 Ctrl+Enter로 바꿨다. typecheck/lint/format, unit 391, build, e2e 26 passed/8 skipped.
- 참고: 같은 시간에 다른 작업이 결과 그리드를 AG Grid에서 자체 `ResultGrid`로 바꿨다(이 작업 범위 아님, 변경 유지).

- 2026-10-30: SQL 툴바 정리 — 단축키 안내 문구 삭제(쿼리 취소 버튼은 실행 중에만 구분선과 함께 표시), 연결 선택 상자 글자 잘림 수정(높이 32px·세로 여백 0·line-height normal).
- 2026-10-30: 전체 디자인 정리 — 선택 상자/입력창 높이 32px·세로 여백 0으로 통일(글자 잘림 해결), 탐색기 압축(검색 이중 테두리 제거, 섹션 제목 줄바꿈 방지, 새로고침·그룹 삭제 아이콘화, 연결 카드 한 줄 주소·말줄임, 테이블 목록 촘촘히·말줄임·hover), '변경 미리보기' 체크 행 삭제(설정 탭으로 일원화, 내용 없으면 패널 숨김), 저장 쿼리 줄 버튼 축약(불러와 실행/저장/삭제, 개수는 placeholder로), 결과 머리·하단 탭의 불필요 문구 삭제, AI 입력창 이중 테두리·스크롤바 제거, 탐색기 얇은 스크롤바.
- 2026-10-30: DB 미연결 상태에서 Ctrl+Space를 누르면 'DB가 연결되지 않아 테이블·열 자동완성을 할 수 없습니다' 알림을 띄우고 키워드 제안은 그대로 연다(SqlWorkspace 편집기 명령). e2e sql-completion에 확인 추가. typecheck/lint/build, e2e 27 passed/8 skipped.

## 2026-11-03 — 다른 DB SQL 자동완성 (ADR-042)

- 연결 계정이 접근 가능한 DB를 SQL 편집기 후보로 제시하고 `DB.` → 스키마, `DB.스키마.` → 테이블, 세 부분 이름의 별칭 `a.` → 대상 DB 열을 완성한다. 맨 앞의 세 부분 테이블 참조는 기존처럼 `SELECT * FROM`을 자동으로 붙인다.
- Main의 기존 탐색/테이블 설명 IPC에 선택적 DB 범위를 더했다. 다른 DB는 접근 가능 목록에서 재검증하고 인용된 해당 DB `sys` 카탈로그만 읽는다. 연결 DB, 쿼리 실행·쓰기 정책, AI/MCP 현재 DB 범위는 변경하지 않았다.
- 검증: typecheck, lint, unit 397 통과, build, Electron E2E 28 통과/실DB·AI opt-in 8 skip, format 통과. 기본 integration은 로컬 3 통과/실DB 등 13 skip. SQL Server 실계정의 다른 DB 메타데이터 조회는 이번 환경에서 미실행이며 opt-in 통합 검증 항목으로 남겼다.
