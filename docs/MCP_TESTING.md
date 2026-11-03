# Phase 4 — 연결 범위 MCP / 스키마 / SQL 제안

## 2026-10-29 UI 변경 — DB 구조 자동 공유 (ADR-023)

공유 체크박스는 제거됐다. 연결된 현재 SQL 탭에서 AI 메시지를 보내면 해당 연결/DB의 제한 메타데이터 도구가 자동 제공된다. 연결 선택·상태 확인·엑셀 요청 준비만으로는 AI를 호출하지 않는다. 단절 시 공유 범위와 제안을 지우고 DB 없는 메시지는 텍스트 전용이다. 행·엑셀 셀·SQL 탭·접속 자격 증명은 자동 전송하지 않는다. 아래 과거 기록의 '직접 켜기/기본 꺼짐/공유 끄기'는 당시 UI이며 현재 설정 방법이 아니다.

## 2026-10-28 최신 — 실제 DB → Main → MCP → Codex → UI 수용 완료

`tests/e2e/live-mcp.spec.ts`를 실제 로컬 SQL Server/실제 Electron Main·preload/번들 stdio relay/공식 Codex CLI/기존 ChatGPT 로그인으로 실행해 **1개 통과(28.8초, 전체30.3초)**했다. DB·CLI·IPC 핸들러 대역은 없다. 이 항목은 아래 2026-10-27의 fixture DB 통합과 별도 증거다.

- 앱 지원 CLI를 현재 설치된 **0.165.0**으로 재검증하고 정확히 고정했다. 0.164.0/0.166.0 등 다른 버전은 거부한다. ignore-user-config/ignore-rules/read-only/approval never/강제 ChatGPT와 기존 도구 제한을 유지한다. 사용자 CLI 설정/인증 파일은 수정·복제하지 않았고 API fallback/새 의존성은 없다.
- 전용 로컬 DB의 무작위 fixture 테이블에 무작위 `mcp_metric_<접미사>` 컬럼을 만들었다. 정확한 테이블·컬럼 이름은 프롬프트에 포함하지 않았다. UI에서 metadata sharing을 직접 켠 뒤 Codex가 실제 `db_get_schema` 결과로 이름을 알아내 `db_propose_sql`을 호출했고, 원래 연결/DB에 바인딩된 SQL 카드가 표시됐다.
- 실제 SELECT-only 계정(`permissionVerified=true`, 앱 readOnly=true)을 사용했다. 행 전용 canary가 AI 이벤트에 나타나지 않는지 검사했다. 공유되지 않은 원래 SQL 탭을 보존하고, 제안/새 탭/검토 단계 각각에서 실행 이력이 비어 있음을 확인했다.
- 같은 대화의 두 번째 요청에서 실제 `db_list_databases` 호출과 원래 세션 ID 재개를 확인했다. 첫 턴의 capability가 닫힌 뒤 다음 턴의 도구 연결도 성공했다. capability 자체는 Renderer로 노출하지 않는다.
- **Open SQL proposal → 별도 새 탭 → Run query → DB/SQL 검토 → Approve and execute**를 실제 UI로 수행했다. 그때만 fixture의 무작위 숫자가 그리드에 나타나고 성공 이력1개가 생겼다. 단절 시 metadata sharing 해제/제안 카드 제거도 확인했다.
- 0.165.0의 실제 텍스트 start/resume integration1개와 기존 MCP integration4개(stdio3 + 공식 Codex/fixture DB1)도 별도로 통과했다. unit184개/typecheck/lint/build 통과다. 계정 없는 기본 integration은 stdio3개 통과/AI·DB5개 skip이며 실제 실행 증거와 구별한다.
- 계정 없는 기본 `pnpm test:e2e`는 새 빌드 후 로컬5개 통과/실제 AI·DB4개 skip이다. 실제 DB MCP UI는 위처럼 opt-in으로 별도1개 통과했으며 skip을 성공으로 계산하지 않는다.

테스트는 승인된 `aidb_write_test_*` DB에만 fixture를 만들며 암호는 프로세스 환경으로만 주입한다. 실제 CLI 구독 두 턴을 소비하고 스키마 이름을 provider/CLI 기록에 보낼 수 있다. 업무 데이터/자격 증명을 프롬프트에 넣지 않는다. `AI_DB_TEST_AGENT=1`, `AI_DB_TEST_ALLOW_WRITES=dedicated-fixture-only`, 기본 SQL 접속 변수와 준비용/읽기용 계정은 WRITE_TESTING.md를 따른다. 이 쓰기 flag는 준비용 fixture DDL에 필요할 뿐 앱의 AI/DB 연결은 SELECT-only다.

```powershell
# 위 opt-in과 임시 계정을 안전하게 주입한 프로세스에서 실행
pnpm build
pnpm exec playwright test tests/e2e/live-mcp.spec.ts
```

Claude 실제 연결, 서버 SHOWPLAN, 신뢰된 인증서의 Production TLS, installer/asar는 여전히 별도 미완료 항목이다. 아래 과거 기록의 실DB 전체 경로 미완료 문구는 이 최신 수용 결과로 대체한다.

최종 정리 조회에서 이번 실행용 무작위 DB2개는 fixture/임시 사용자/사용자 세션0개를 확인한 뒤 제거했다. 준비용/쓰기용/읽기용 임시 로그인0개, 앱 SQL 세션0개이며 기존 빈 `aidb_write_test_local`만 ONLINE으로 유지된다. 암호는 저장하지 않았다. 공식 CLI/provider의 세션 기록은 앱이 삭제하지 않는다.

## 2026-10-27 구현 시점 기록

2026-10-27. Phase 4의 지원 가능한 경로를 구현했다. **Claude 실제 CLI 연결, 서버 실행계획, 실제 DB를 포함한 MCP 전체 경로는 미검증/미지원 항목으로 남긴다.** Phase 5 쓰기/트랜잭션은 구현하지 않는다.

## 구현 범위와 사용

1. 기존 연결을 선택하고 Connect한다. AI 패널에서 Codex의 Check CLI status를 확인한다.
2. 현재 SQL 탭의 연결/DB가 AI 패널에 표시된다. 공유를 따로 선택하지 않고 메시지를 보내면 해당 DB 구조를 자동 공유한다. 연결/DB 변경·단절 시 진행 중 요청을 취소하고 제안을 지운다.
3. 메시지를 전송하면 해당 연결 세대와 DB에만 묶인 MCP capability를 만든다. DB 행·호스트·사용자명·비밀번호·다른 연결/DB 목록은 도구로 제공하지 않는다. 메타데이터와 제안 내용은 공식 CLI/provider로 전송되고 CLI 로컬 기록에 남을 수 있다.
4. (ADR-028로 변경) AI SELECT는 같은 연결/DB일 때 새 탭에서 바로 실행되고, 쓰기 초안은 미리보기 후 한 번 확인한다. 아래는 이전 흐름 기록이다. SQL 제안 카드는 정규화한 제한 SELECT만 포함한다. **Open SQL proposal**은 원래 연결/DB가 선택·연결된 경우에만 별도 탭을 만든다. 기존 SQL을 덮어쓰거나 실행하지 않는다. 기존 Run query → 검토 → Approve and execute 경로를 별도로 거쳐야 한다.
5. **Analyze last SQL error**는 선택 연결의 마지막 실패 SQL/오류를 입력창에 복사할 뿐이다. SQL 최대6000문자/오류1000문자이며 민감 리터럴을 확인·수정한 뒤 직접 Send한다. 실행 이력/SQL 탭을 자동 전송하지 않는다.

공유 범위가 달라지거나 재접속해 연결 세대가 바뀌면 기존 CLI 대화를 재개하지 않는다. 같은 세대·범위의 재개도 capability/로컬 IPC 주소는 매 턴 새로 만든다. DB를 끊거나 연결이 없는 탭에서 메시지를 보내면 과거 DB 대화와 다른 새 텍스트 세션을 시작한다. 과거 CLI 로컬 기록 자체를 삭제하지는 않는다.

## 7개 도구

| 도구                  | 범위                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `db_list_databases`   | 현재 허가된 DB 이름 하나만 반환. DB 변경 없음                                                                      |
| `db_list_tables`      | 현재 DB 사용자 테이블 이름, schema 필터/출력 상한                                                                  |
| `db_describe_table`   | 현재 DB의 실제 테이블 컬럼·인덱스, 행 없음                                                                         |
| `db_get_foreign_keys` | 현재 DB 테이블의 FK 메타데이터                                                                                     |
| `db_get_schema`       | 작은 테이블/컬럼/FK 스냅샷. 전체 스키마라는 보장 없음                                                              |
| `db_explain_query`    | **서버 실행계획 미지원**. `supported:false`와 정적 SELECT 정책 분석만 반환. SQL 실행 없음                          |
| `db_propose_sql`      | 제한 SELECT 파싱/정규화(`*` 거부)와 실제 테이블 확인 후 UI 이벤트. 앱이 즉시 실행, 도구 자체는 실행/승인 토큰 없음 |

`db_explain_query`는 SHOWPLAN 권한과 session 상태 격리/복원을 검증하지 않았기 때문에 `SET SHOWPLAN_*`나 사용자 SQL을 실행하지 않는다. 정적 분석을 실제 예상 실행계획으로 표시하지 않는다. 제안도 전체 SQL 의미론/성능/컬럼 정확성 증명이 아니다. 쓰기·배치·동적 SQL·미지원 문법은 기존 양성 SELECT 파서가 거부한다.

## 프로세스·보안 경계

```text
Codex native CLI
  └─ app-bundled mcp-stdio.js (stdin/stdout JSON-RPC relay)
       └─ per-turn local named pipe / Unix socket + capability
            └─ Electron Main: McpProtocol → ToolSession → MetadataScope
                                                └─ DatabaseService metadata only
```

- TCP/HTTP 포트를 열지 않는다. Main 내부 IPC는 Windows named pipe/Unix domain socket이며 무작위 주소+256-bit capability를 사용한다. Unix socket은 mode600, 다른 사용자에 대한 공개 설정은 하지 않는다. 같은 OS 계정의 악성 프로세스를 막는 경계라고 주장하지 않는다.
- CLI는 절대 Electron 실행 파일과 번들된 relay 경로로 서버를 시작한다. `ELECTRON_RUN_AS_NODE=1`은 이 relay 실행에 필요하다. relay는 DB/파일/셸 실행 API가 없고 Main으로 JSON-RPC만 중계한다. 앱의 DB 자격 증명이나 OAuth 토큰을 복제하지 않는다.
- capability/주소는 환경변수로만 전달하고 CLI argv/Renderer/SQLite에 넣지 않는다. 취소/종료/130초 만료 시 서버·socket을 폐기한다. 요청마다 연결/DB 세대를 확인하고 비동기 읽기 후에도 다시 검사한다. 단절/재접속 전 결과를 반환하지 않는다.
- Codex는 기존 ignore-user-config/ignore-rules/read-only/approval never/강제 ChatGPT/OpenAI 인증을 유지한다. 서버는 `ai_db` 하나, enabled_tools는 위 7개, required=true다. 전역 MCP 설정을 추가·변경하지 않는다. 셸·hooks·plugins·apps·브라우저·멀티에이전트와 Code Mode 플래그는 비활성이다.
- **0.164.0에서는 MCP 호출에 `code_mode_host`가 필요**한 것을 실제 검증에서 확인했다. 공유한 요청에서만 host를 켜고, 텍스트 전용 요청에서는 기존처럼 끈다. 이것은 셸/파일 쓰기를 허용하는 우회가 아니다. 코드 실행·다른 서버/도구 이벤트는 여전히 거부한다. 호스트의 존재나 사후 이벤트 필터만을 보안 경계라고 주장하지 않는다. 실제 Main 메타데이터 전용 포트와 CLI 제한을 함께 적용한다.
- 표준 initialize/initialized/ping/tools/list/tools/call만 제공한다. 표준 params `_meta`는 허용하되 도구 arguments는 엄격하게 검증한다. 임의 method/connectionId/database/SQL 실행 인자를 우회 경로로 받지 않는다. stdout에는 JSON-RPC만 기록한다. 도구 결과/인자/추론/인증 정보는 Renderer의 tool 이벤트에 포함하지 않는다.
- capability 취소는 IPC와 늦은 결과 전송을 차단한다. 이미 시작한 DB 메타데이터 조회의 즉시 중단까지 보장하지 않으며 드라이버 timeout/연결 정리를 따른다. MCP에는 쿼리 실행/승인/commit 경로가 없다.

## 예산과 캐시

- capability130초, CLI 실행120초, 턴 도구 호출40회/제안5개/응답 총128KiB, 응답당24KiB.
- 스키마 스냅샷 최대8테이블 × 컬럼32개/FK16개, 스냅샷 JSON20KB. 테이블 목록100개, 테이블 상세 컬럼64개/인덱스16개, FK64개. 한도 초과는 truncated 또는 명시적 오류이며 전체 스키마로 가장하지 않는다.
- 메타데이터 캐시는 Main 메모리에만 있고 연결 세대+조회 키로 구분한다. TTL30초, 항목64개, 총1MiB, 항목당64KiB 이하. cache hit도 유효 범위를 재확인한다. 실제 테이블 조회가 캐시보다 먼저 큰 결과를 반환하는 경우의 드라이버 메모리 최적화는 Phase 6 범위다.
- stdio/내부 IPC는 UTF-8 JSONL 경계와 역압력을 처리한다. 입력1MiB/줄256KiB/이벤트2048개, 대기 요청8개와 중복/전체 request ID 예산을 제한한다. 도구 호출은 직렬화한다.

## 검증과 남은 항목

| 검증                              | 결과                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| typecheck / lint                  | 통과, 경고0                                                                     |
| 단위 테스트                       | 7개 파일, 115개 통과                                                            |
| build                             | Main/stdio relay+공유 chunk/preload/renderer 통과                               |
| 기본 Electron E2E                 | 로컬3개 통과, 실제 AI/DB opt-in2개 skip                                         |
| 기본 integration (`pnpm test:db`) | stdio3개 통과, 실제 AI/DB3개 skip                                               |
| 실제 Codex MCP integration        | 1개 통과: 스키마 조회/SELECT 제안 + 새 capability로 같은 세션 재개/DB 범위 조회 |
| Claude                            | 프로토콜 fixture 통과만 확인. **실제 CLI 호출/연결은 하지 않음**                |

단위 테스트는 7개 도구/입력 양성 허용/다른 DB·연결 거부/쓰기·배치 거부/실제 테이블 검증/예산·TTL·취소/연결 세대·늦은 응답 무효화/캐시/임의 MCP 도구 거부/표준 `_meta`/Main 세션 범위 변경/SQL 새 탭을 검증한다. local socket 테스트는 잘못된 capability 거부와 취소 시 연결 종료를 확인한다.

integration의 codex/claude **client fixture**는 실제 Node stdio 프로세스와 통신하지만 공식 CLI가 아니다. 별도 Electron runtime relay 테스트도 통과했다. 실제 Codex 테스트는 공식 CLI 0.164.0과 기존 ChatGPT 로그인을 사용하되 DB 포트는 명시적인 가짜 메타데이터 fixture다. DB 자격 증명/업무 데이터/실제 DB 행을 전송하거나 SQL을 실행하지 않았다.

Claude는 Phase 3의 약관·구독 격리 미검증 상태를 유지한다. 실제 Claude CLI MCP 연결, 실제 DB→Main→MCP→CLI→UI 전체 성공 경로, 실제 서버 실행계획, installer/asar 경로는 완료 증거가 없다. TASKS.md에 미완료로 남긴다.

## 재현

기본 검증은 DEVELOPMENT.md를 따른다. integration은 빌드된 stdio relay를 사용하므로 `pnpm build`를 먼저 실행한다. 아래 opt-in은 **실제 구독 두 턴을 소비**한다. 계정/기능 미지원 실패를 API 과금으로 대체하지 않는다.

```powershell
pnpm build
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/mcp.test.ts
$env:AI_DB_TEST_AGENT = '1'
try {
  pnpm exec vitest run --config vitest.integration.config.ts tests/integration/mcp.test.ts -t 'official Codex'
} finally {
  Remove-Item Env:AI_DB_TEST_AGENT -ErrorAction SilentlyContinue
}
```

근거: [MCP stdio](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle), [tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [공식 Codex MCP 설정](https://learn.chatgpt.com/docs/extend/mcp), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference), [Claude MCP](https://code.claude.com/docs/en/mcp). host 필요 여부와 런타임 동작은 로컬 0.164.0 실제 검증 근거다. 공식 기능 문서만으로 구독/상업 약관 허용을 추정하지 않는다.

## 2026-10-28 범용 엑셀 확장

ADR-016/EXCEL_IMPORT.md가 최신 추가 계약이다. 기존7개 도구를 유지하면서 metadata에 연결 소유의 논리 import.stage_<32hex> 테이블을 포함한다. 열 정보만 노출하며 업로드 셀을 공유하지 않는다. db_propose_sql은 기본 제한 SELECT 검증을 유지하고 명시적 draft=true일 때만 임의 SQL을 미검증·미실행 초안으로 전달한다. draft의 executable/validated는 false이며 승인/쓰기 capability가 아니다. 등록·삭제로 metadata revision이 바뀌면 이전 scope/캐시는 사용할 수 없다. SQL 실행 정책 자체를 일반 SQL로 확장하지 않는다.
