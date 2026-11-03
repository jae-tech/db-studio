# Phase 3 — CLI 정책·사용·검증

2026-10-29 UI 업데이트(ADR-023): 연결된 현재 SQL 탭에서 메시지를 보내면 선택 DB의 테이블·컬럼 구조를 자동 공유한다. 공유 체크박스는 없으며 DB 연결이 없는 대화만 텍스트 전용이다. 행·엑셀 셀·SQL 탭·접속 자격 증명은 자동 전송하지 않는다. 저장 쿼리 이름 호출은 CLI 확인 없이 로컬 처리한다. 아래 Phase 3 당시의 '메시지만 전송/입력 비활성' 설명보다 이 동작과 MCP_TESTING.md가 우선한다.

2026-10-28 지원 버전 업데이트: 현재 정확한 지원 pin은 **0.165.0**이다. 공식 문서/로컬 exec·resume help와 실제 텍스트 start/resume, 실제 MCP/실DB UI를 재검증했다. 격리/ChatGPT 인증/도구 제한은 유지하며 다른 버전은 거부한다. unit184개 및 최신 증거는 MCP_TESTING.md/ADR-014를 따른다. 아래0.164.0 검증 기록은 과거 증거다.

기준일: 2026-10-27. 이 문서는 Phase 3 당시 기준이다. 이후 구현한 opt-in MCP와 최신 검증은 [MCP_TESTING.md](MCP_TESTING.md)를 따른다. Phase 3 당시에는 텍스트만 구현했다. Phase 4의 MCP/DB 도구, 스키마 자동 전송, SQL 자동 실행은 없다. 새 패키지를 추가하거나 Git 커밋을 만들지 않았다.

## 사용

1. 공식 Codex CLI **0.165.0**을 설치하고 터미널에서 `codex login`으로 ChatGPT 계정에 로그인한다. 앱이 로그인·토큰 추출·인증 파일 복사를 대신하지 않는다.
2. 앱의 Codex → **Check CLI status**를 누른다. 지원 버전/native 실행 파일/ChatGPT 인증이 모두 확인돼야 입력과 전송이 활성화된다. 상태 확인만으로 AI 요청을 보내지는 않는다.
3. 직접 입력한 메시지만 전송된다. DB 연결·스키마·결과·SQL 탭은 자동 전송하지 않는다. DB를 연결하지 않아도 텍스트 대화를 사용할 수 있다.
4. **Stop response**는 요청과 프로세스 트리를 중단한다. 같은 provider의 성공한 대화는 다음 메시지에서 재개한다. 실패/취소 후에는 새 대화로 시작한다. provider 전환 시 진행 중 요청을 먼저 취소한다.
5. **New conversation**은 앱의 대화/세션 참조를 초기화한다. 공식 CLI의 과거 로컬 세션 파일이나 provider의 기록을 삭제하는 기능은 아니다. 앱 재시작 후 과거 대화를 자동 재개하지 않는다.

API 키 입력/직접 API SDK/과금 fallback은 없다. API 키 환경 또는 CLI API 인증, 인증 상태 미확인, 미지원 버전은 거부한다. ChatGPT 로그인이 유료 플랜/무제한 사용 가능성을 보장하는 것은 아니며 실제 계정 한도와 CLI 오류를 따른다. 한도 오류 뒤 자동 재시도하지 않는다.

## 실행·비밀 경계

- Main만 절대 native 실행 파일을 찾아 인자 배열과 `shell:false`, `windowsHide:true`로 실행한다. `.cmd`/`.ps1`이나 workspace 실행 파일로 우회하지 않는다. 지원하는 Windows npm native 배치 경로 외의 설치 방식은 탐지되지 않을 수 있다.
- 자식 환경은 OS 홈/임시 폴더 및 `CODEX_HOME` 등 명시된 이름만 전달한다. PATH, API 키, DB 암호, Node loader 옵션, provider endpoint, OMX 상태를 상속하지 않는다. 사용자 CLI 인증 저장소는 CLI가 직접 사용한다.
- userData/agent-workspace를 작업 폴더로 사용한다. `--ignore-user-config`, `--ignore-rules`, read-only/approval never, 강제 ChatGPT/OpenAI provider, 셸·hooks·plugins·apps·브라우저·멀티에이전트·Code Mode 비활성과 빈 MCP 구성을 적용한다. 사용자 CLI 설정을 수정하지 않는다.
- 설정 제한과 CLI sandbox가 실행 경계다. JSONL의 예상하지 못한 도구 이벤트 거부는 추가 방어이며, 실행 후 이벤트 필터만으로 안전을 보장한다고 주장하지 않는다. 검증한 버전 외에는 실행을 막는다. 관리자 관리 정책/변형 CLI/다른 OS까지 검증한 것은 아니다.
- 요청은 16,000문자, 실행은 120초, stdout+stderr는 1MiB, JSONL 한 줄은 256KiB, 이벤트는 2048개로 제한한다. stderr/미확인 필드/추론/도구 인자를 Renderer에 전달하지 않는다. 종료 코드0·완료 이벤트·유효 세션을 함께 확인한다.
- Codex 0.164.0은 비활성 Code Mode 안내를 `item.error`로 출력한 뒤 정상 진행한다. 해당 시작 안내만 양성 허용하고 다른 오류는 실패 처리한다. 실제 발견을 단위 테스트로 고정했다.
- UI는 최근20개 메시지/응답당128K문자만 보유한다. React 텍스트로 렌더링하며 생성된 HTML/SQL을 실행하지 않는다. 앱은 대화 내용을 preferences SQLite에 저장하지 않지만 **공식 CLI는 메시지를 평문 로컬 세션에 저장할 수 있다**. 자격 증명을 메시지에 넣지 않는다.

## Claude·Gemini 제거, GitHub Copilot 추가 (ADR-032)

Claude는 약관상 구독으로 제3자 앱을 구동할 근거가 없어 제거했다. Gemini는 개인 Google 로그인 중단·제3자 OAuth 사용 금지로 추가하지 않았다. GitHub Copilot은 공식 CLI 비대화형 모드로 연결한다. 실제 검증: `AI_DB_TEST_COPILOT=1 pnpm exec vitest run --config vitest.integration.config.ts tests/integration/copilot.test.ts`는 로그인된 Copilot CLI로 격리 홈 인증 → ai_db MCP 테이블 발견·SELECT 제안 → 같은 세션 재개를 확인한다(프리미엄 요청 2회 정도 사용). 기본 테스트는 AI를 호출하지 않는다.

## 검증 결과

| 검증                                                        | 결과                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm install --frozen-lockfile`                            | lockfile 변경 없이 통과                              |
| `pnpm typecheck`, `pnpm lint`                               | strict/경고0 통과                                    |
| `pnpm test`                                                 | 6개 파일, 92개 통과                                  |
| `pnpm build`                                                | Main/preload/renderer 프로덕션 빌드 통과             |
| 기본 Electron E2E                                           | 로컬3개 통과, opt-in AI/DB 2개 skip                  |
| 실제 Codex adapter integration                              | ChatGPT 구독 start/resume 1개 통과 (두 메시지)       |
| 실제 Codex Electron E2E                                     | 전송/응답/세션 재개/새 대화 1개 통과 (두 메시지)     |
| `pnpm test:db` 기본 실행                                    | AI/DB opt-in 계정 조건 없이 2개 skip; DB 재검증 아님 |
| `pnpm format:check`, `pnpm peers check`, `git diff --check` | 통과                                                 |

단위 테스트는 두 provider UTF-8/개행/chunk, 잘못된 JSON/세션/usage, 줄·전체 출력·이벤트 상한, 알 수 없는 도구, API 키/버전 거부, 제한 인자/환경, 중복·불완전 완료, 한도·timeout, 동시 요청 차단, Main 세션 재개·실패 무효화·초기화, 요청별 취소/인증 확인 중 취소/종료를 포함한다. Node fixture 프로세스를 실제 spawn해 stdin/비정상 종료/시간 제한/취소/출력 초과를 검증한다. AI 응답 대역과 실제 구독 검증은 구분한다.

로컬 Electron 테스트는 실제 preload IPC/입력 검증/구독 해제/제거된 provider·잘못된 모델 이름 거부(프로세스 미실행)/DB 이력 불변을 확인한다. 기본 테스트는 AI 호출을 하지 않는다.

실제 구독 검증은 고정 문자열 `STUDIO_42`를 기억하고 다음 메시지에서 재현하는 두 턴이다. DB 정보/자격 증명을 전송하지 않았고 DB 이력은 빈 상태였다. 실제 장시간 생성·실제 quota 소진·모든 관리 정책/CLI 버전의 격리를 검증한 것은 아니다. 취소/timeout/한도 실패는 테스트 대역과 실제 Node fixture에서 검증했다. Phase 2의 실제 부하/운영 계정 검증은 별도로 남아 있다.

## 재현

기본 검증은 DEVELOPMENT.md를 따른다. **아래 opt-in 명령은 실제 구독 사용량을 소비**한다. API 인증으로 대체하지 않는다. 두 명령을 모두 실행하면 성공 기준 네 메시지가 전송된다. Electron 테스트 전 `pnpm build`가 필요하다.

```powershell
$env:AI_DB_TEST_AGENT = '1'
try {
  pnpm exec vitest run --config vitest.integration.config.ts tests/integration/agent.test.ts
  pnpm exec playwright test tests/e2e/agent.spec.ts --grep 'opt-in real'
} finally {
  Remove-Item Env:AI_DB_TEST_AGENT -ErrorAction SilentlyContinue
}
```

GUI 테스트는 임시 userData를 사용하고 테스트 종료 시 해당 프로필만 삭제한다. 공식 CLI 자체의 세션 기록을 앱/테스트가 임의 삭제하지 않는다.
