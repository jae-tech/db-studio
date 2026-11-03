# 공통 개발 규칙

이 문서는 Codex와 Claude Code의 공통 계약이다. 이전 대화 없이 HANDOFF → PROGRESS → TASKS → ARCHITECTURE → DECISIONS 순서로 읽고 재개한다.

- 사용자 승인 범위는 현재 Phase까지다. 완료 후 보고하고 다음 Phase 지시를 기다린다.
- 작업 시작/종료 시 Git 상태와 diff를 확인한다. 기존 사용자 변경을 덮어쓰지 않는다. 자동 커밋 금지.
- import 경로: 같은 폴더(`./`)와 한 단계 위(`../`)는 상대경로, 두 단계 이상 올라가면 별칭 `@shared/*`(src/shared), `@main/*`(src/main), `@/*`(src/renderer/src)를 쓴다. 별칭은 tsconfig `paths`와 `electron.vite.config.ts`의 `alias`(Vitest 설정이 재사용)에 함께 정의한다.
- strict TypeScript, 명시적 오류 처리, 작은 모듈과 리뷰 가능한 변경을 유지한다. 새 의존성은 사용자 스택 또는 명시적 승인 범위에서만 도입한다.
- Main에만 파일/DB/CLI 접근을 허용한다. preload에는 고정 메서드만 노출한다. 임의 IPC 채널, 셸, SQL 실행 브리지를 금지한다.
- Renderer에 비밀번호·CLI 인증 토큰을 저장하지 않는다. settings는 비밀이 아닌 환경설정만 저장한다. SQL 탭 내용은 평문 로컬 SQLite이므로 비밀 입력을 피한다.
- 실제 성공과 미구현 UI를 구별한다. 테스트하지 않은 기능은 완료로 표시하지 않는다.
- 작업 완료마다 PROGRESS를 갱신한다. 결정 변경은 DECISIONS, Phase 종료는 HANDOFF, 남은 작업은 TASKS에 기록한다.
- 변경 후 `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm format:check`를 사용한다. 불가능한 검증은 원인과 대안을 기록한다.
- 안전성 구현은 SQL 파서/방언/권한/승인/트랜잭션의 조합이다. 정규식만으로 안전을 보장하지 않는다. 알 수 없는 구문은 자동 실행하지 않는다.
- 테스트 DB나 AI 계정이 없으면 실제 연결/CLI 호출을 검증 완료로 표시하지 않는다. 위험한 SQL은 승인받은 테스트 DB에서만 검증한다.
- 에이전트는 비파괴적 로컬 작업을 자동 진행한다. 독립 작업은 적합할 때 native subagent로 분리하되 통합/검증 책임은 리더에게 있다.

## 실행 환경

Windows 우선, pnpm 11.5.2, Node >=22.12 (현재 환경 26.12.1). `pnpm install` 후 `pnpm dev`. GUI 테스트는 데스크톱 세션이 필요하다. 패키지 버전은 package.json과 pnpm-lock.yaml에 고정한다. 네이티브 SQLite는 `electron-builder install-app-deps`로 Electron ABI에 맞춘다. 외부 서버는 필요 없다. Vite 서버는 개발 전용이다.
