# Phase별 작업 목록

## 2026-11-03 — 테마별 색 조합

- [x] 다크·라이트별 4개 색 조합, 독립 저장·기존 설정 기본값 호환
- [x] 설정 미리보기, 화면·Monaco 색 동기화, 대비·재시작 복원 회귀

## 2026-10-30 — 수기 스타일시트 제거

- [x] `styles.css`를 Tailwind import 전용으로 축소하고 기존 전 화면 스타일을 Tailwind 유틸리티 그룹에 연결 (ADR-040)
- [x] 다크/라이트·최소 창·그리드·AI 패널 회귀 및 기본 Electron 전체 검증

## 2026-10-30 — 결과 그리드 TanStack 전환 후 실환경 검증

- [x] AG Grid 제거, TanStack Table + Virtual 기반 SQL 결과 그리드, 기본 Electron 회귀 검증 (ADR-039)
- [ ] 실제 SQL Server opt-in `live-mssql`/`live-paging`/쓰기 그리드 수용 재실행 (이번 변경에서는 테스트 DB 미사용)

## 사용자 추가 요청 — 가상 FK와 업무명 JOIN

- [x] DB 비변경 가상 관계 생성/수정/삭제, 업무명/별칭/복합 연결 열/LEFT·INNER/관계 유형과 SQLite 저장
- [x] 연결·DB 격리, 실제 열 존재 확인, AI 메타데이터 발견·실제 FK와 구분·잘못된 관계 안내·수정 시 범위 무효화 (ADR-026)
- [x] 실제 SQL Server FK 없는 두 테이블 + 공식 Codex 업무명 JOIN 제안·SELECT 결과 수용 (2026-10-29, live-relationships.spec.ts)

## 사용자 추가 요청 — 범용 엑셀과 AI SQL (최신 정정)

- [x] 정산 전용 매핑/기간규칙/전용 변경 서비스 제거: 특정 업무 규칙을 고정하지 않음
- [x] Windows XLSX 파일·시트 선택/제한된 파서/메모리 SQLite 임시 적재·샘플·삭제
- [x] 연결별 논리 테이블/컬럼 metadata와 SELECT 때 실제 pinned-session #temp 구성·정리
- [x] 일반 DB 테이블 JOIN/텍스트 보존/제한 TRY_CONVERT/세대·scope 무효화
- [x] 선택 DB metadata 자동 공유로 AI가 업로드 테이블을 발견하고 SQL 제안/미실행 변경 초안 생성 (UI 선택 옵션 제거, ADR-023)
- [x] SELECT 별도 승인 화면 제거: Main 정책·토큰·상한 유지, 실DB Electron 검증 (ADR-017)
- [x] 엑셀 JOIN UPDATE/INSERT SELECT 검증·실행, 상한1000행, 실DB 통합 검증 (ADR-018)
- [x] 저장 쿼리 이름·별칭 호출: 현재 연결/DB 범위, 정확 일치만, 중복 거부, 실DB UI 검증 (ADR-019)
- [x] AI 패널에서 저장 쿼리 이름·별칭 호출: 로컬 정확 일치/CLI 없이 SELECT 즉시 조회, 모호함·타 DB·탭 변경 차단 및 실제 DB UI 검증 (ADR-021)
- [x] 실제 Codex로 엑셀 테이블 발견·SELECT 결과·미실행 변경 초안 수용 (`live-import-ai.spec.ts`, 2026-10-29 실제 구독·DB 통과)
- [ ] 실제 업무 XLSX·고객 스키마 수용/Production TLS·부하 (제공된 업무 파일 없음)

## 사용자 추가 요청 — 가독성

- [x] 불필요한 대괄호 최소화·사용자 SQL 스타일 기본값·6개 포맷 옵션/미리보기/저장·정리 버튼/Alt+Shift+F·생성 SQL 적용·회귀 (ADR-025)
- [x] 다음 페이지 이동 시 필요한 서버 배치 자동 조회, 별도 더 불러오기 버튼 제거·캐시 이동·중복/오류/취소/탭 전환 회귀 (ADR-024)
- [x] AI 패널 반복 설명 축소·사용 안내 접기, CLI 상태/공유 동의/오류 유지, 두 테마·최소 창 회귀 (ADR-022)
- [x] 한국어 우선 글꼴/본문14px·보조 최소12px/다크·라이트 대비/SQL 고정폭 유지
- [x] 두 테마·세 창 크기의 크기/대비/가로 넘침·대화창 접근성 및 화면 확인 회귀
- [x] 범용 엑셀 업로드·임시 테이블·AI 쿼리 생성 (아래 최신 범위/EXCEL_IMPORT.md)
- [x] 저장 쿼리 호출 (ADR-019, SELECT 승인 제거·엑셀 JOIN 쓰기도 완료)

## 사용자 추가 요청 — 세 부분 이름·다른 DB 조회 (ADR-034)

- [x] `현재DB.스키마.테이블` 조회·쓰기 허용, 직접 작성 SELECT의 다른 DB 조회(접근·사용자 테이블 확인)
- [x] 접근 가능한 다른 DB의 `DB.스키마.테이블` 및 별칭 열 SQL 자동완성 (ADR-042, 대역 단위·Electron 검증)
- [ ] 다른 DB 자동완성용 카탈로그의 실제 SQL Server opt-in 검증 (자격 증명이 있는 전용 읽기 계정에서 실행)
- [ ] 다른 DB 쓰기·AI의 다른 DB 메타데이터 (요청 시)

## 사용자 추가 요청 — 변경 미리보기·실행/취소 (ADR-033)

- [x] 읽기 전용 변경 미리보기(쓰기 허용·rowversion 없이도), 실행 불가 사유 표시
- [x] '변경 미리보기' 체크박스: 직접 쓴 UPDATE/DELETE/INSERT 실행 시 미리보기 → 실행/취소
- [ ] rowversion 없는 테이블의 실제 실행 지원 (요청 시)

## 사용자 추가 요청 — AI 제공자·모델·패널 접기 (ADR-032)

- [x] AI 패널 접기/펼치기(상태 저장, 진행 중 대화 유지)
- [x] 채팅 하단 제공자+모델 드롭다운(CLI 로컬 카탈로그), 좌측 AI 설정 화면, 알아보기 쉬운 탐색기/AI 토글 아이콘
- [x] Claude 제거(약관), Gemini 미추가(개인 로그인 중단·제3자 OAuth 금지)
- [x] GitHub Copilot CLI 연결(격리 홈·ai_db 도구만·stdin), 실제 Copilot 통합 검증
- [ ] Copilot으로 실제 SQL Server 연결 Electron 전체 흐름(live-mcp 스타일) 수용 검증

## 사용자 추가 요청 — 운영 연결 SSMS와 같게 (ADR-031)

- [x] 운영에서도 서버 인증서 신뢰 허용(경고), SELECT 전용 계정 강제·실행 전 권한 재검사 제거, 쓰기는 연결별 opt-in만

## 사용자 추가 요청 — 연결 그룹과 탐색기 접기 (ADR-030)

- [x] 연결 그룹(폴더) 추가/삭제, 카드에서 그룹 이동, 미분류
- [x] 그룹·섹션 접기, 탐색기 전체 접기/펼치기(설정 저장)
- [ ] 그룹 이름 바꾸기·드래그로 이동 (요청 시)

## 사용자 추가 요청 — 테이블 화면에서 가상 FK 설정 (ADR-029)

- [x] 테이블 클릭 상세 화면 안의 관계 편집기(기준 테이블 고정, 동명 열/PK 자동 짝, 업무명 생략 시 테이블명)

## 사용자 추가 요청 — AI 조회 즉시 실행/쓰기 확인/SELECT * 금지 (ADR-028)

- [x] AI SELECT를 새 탭에서 바로 실행(제안 열기·실행 클릭 없음), 결과 행은 AI 비공유
- [x] AI INSERT/UPDATE/DELETE는 미리보기 자동 표시 후 "실행할까요?" 한 번 확인 → 적용+COMMIT
- [x] AI SELECT의 `*`/`별칭.*` Main 거부, 프롬프트·도구 설명 갱신

## 사용자 추가 요청 — 탭 이름/미일치 행 수/결과 내보내기 (ADR-027)

- [x] SQL 탭 이름 바꾸기 (두 번 클릭·F2, Enter 확정/Escape 취소/빈 이름 무시, 설정 저장)
- [x] 엑셀 JOIN 미리보기에 엑셀 전체·ON 미일치(UPDATE)/추가 제외(INSERT) 행 수 표시
- [x] 결과 전체 CSV/XLSX 내보내기 (Main 스트리밍, 1,048,575행 상한, .partial 후 rename)

## 다음 후보 (사용자 승인 전 미착수)

- [ ] 기간 분할(기존 기간 종료+새 기간 추가) 2문장 원자 변경
- [ ] 내보내기 CSV 전용 상한 확대/여러 결과 집합·여러 시트 (현재 미지원)

## 사용자 추가 요청 — 한글화

- [x] 기본 UI/접근성 이름/연결·SQL·쓰기·AI 화면/그리드·이력 한국어 표시
- [x] 내부 SQL·IPC·상태값과 기존 사용자 데이터 보존, 알려진 오류·기존 이력의 표시 경계 번역
- [x] 로컬 Monaco 한국어/HTML·Chromium·Zod 한국어 적용, 새 의존성 없음
- [x] 단위·Electron 한국어/한글 SQL·입력 검증 및 실제 DB 읽기/쓰기 보호 흐름 회귀 (LOCALIZATION.md)

## Phase 1

- [x] 빈 디렉터리/Git 상태 확인, 공통 개발/인계 문서
- [x] Electron/React/strict TypeScript/Vite/pnpm
- [x] Tailwind/shadcn 스타일 버튼, 기본 레이아웃
- [x] Explorer/Monaco 다중 SQL 탭/빈 AG Grid/AI 패널
- [x] 격리 preload, 고정 IPC, sender 검증, Zod 설정 검증
- [x] SQLite 설정 저장, 테마/탭/폭/provider 복원
- [x] 타입/lint/unit/build/Electron e2e 검증 (최종 결과는 PROGRESS 참고)

## Phase 2 — 구현/로컬·실제 DB 기본 성공 경로 검증 완료

- [x] DatabaseAdapter/DTO와 MSSQL dialect/metadata 인터페이스 (타입 검사)
- [x] mssql 12.7.13 / @types/mssql 12.3.0 설치, 테스트 DB 조건 문서화
- [x] async safeStorage 암호화: 실제 Electron 저장·복원/평문 미저장 검증
- [x] 운영 권한 검사, TLS 정책, 파라미터 메타데이터 (테스트 대역 검증)
- [x] 연결 관리/다중 연결/탐색 트리/리소스 정리 구현 (연결 CRUD/실패 E2E, 나머지 대역 검증)
- [x] 제한 SELECT 파서/일회성 승인/취소/timeout/행·바이트·셀 제한 (단위 테스트)
- [x] 오류/최근 100건 이력/탭별 결과/AG Grid 가상화와 클라이언트 페이지 UI 구현
- [x] 실제 MSSQL 접속/메타데이터/SELECT42/검토·승인/그리드·이력·단절 (LIVE_VALIDATION.md)
- [x] 실제 잠금 대기 SELECT 취소·timeout/5000행·4MiB·LOB 제한/SELECT-only 계정 권한 검사 (2026-10-28 전용 로컬 fixture)
- [ ] 신뢰된 인증서를 사용하는 Production TLS·SELECT 전용 계정 전체 수용 검증

## Phase 3 — 구현/로컬·실제 Codex 구독 기본 경로 검증 완료

- [x] AgentAdapter/Codex native 탐지/ChatGPT 인증 확인/최신 약관 확인 (Claude는 약관·구독 격리 미검증으로 비활성)
- [x] 절대 native 경로 spawn/shell:false/환경변수 allowlist/버전 고정/도구·hooks·MCP 제한
- [x] Codex exec/Claude -p JSONL 파싱·UTF-8 chunk 경계·상한·오류 테스트 (Claude 파서는 offline 전용)
- [x] 고정 stream IPC/Main 소유 세션 재개/provider 전환 시 취소/시간·출력·사용량 한도 처리
- [x] 실제 Codex ChatGPT 구독 start/resume integration 및 Electron 응답/재개/새 대화 검증
- [x] ~~Claude 활성화~~ → ADR-032로 제거

## Phase 4 — 지원 경로 구현/로컬·실제 Codex MCP 검증 완료, 잔여 수용 항목 있음

- [x] 제한된 stdio MCP/명시된 7개 도구/연결·DB 세대 scope/짧은 수명 capability (실행계획 도구는 명시적 미지원 응답)
- [x] Main 메모리 메타데이터 캐시/스키마·출력 예산/제한 SELECT 제안 카드·별도 탭/명시적 오류 분석 입력
- [x] 공식 Codex MCP 조회·제안·새 capability 세션 재개 (0.164.0 과거 검증, 현재0.165.0 재검증; 메타데이터 fixture/실제 구독 요청)
- [x] 실제 Node/Electron stdio relay 및 codex/claude client protocol fixture 테스트 (공식 Claude CLI 아님)
- [x] 공식 CLI MCP 연결: Codex 통과, Copilot 통합 테스트 통과(ADR-032)
- [x] 실제 DB→Main→MCP→공식 Codex→UI 전체 수용 검증 (실제 스키마로 SQL 제안/동일 세션 재개/새 탭/별도 승인 실행·그리드/단절 범위 해제, 2026-10-28)
- [ ] SQL Server 실제 예상 실행계획: SHOWPLAN 권한/세션 격리·복원 검증 전 비활성, 정적 정책 분석만 제공

구현/검증/제약의 기준은 MCP_TESTING.md다. DB 쓰기·승인 우회 도구는 없다.

## Phase 5 — 제한 쓰기 구현/로컬·실제 DB 수용 검증 완료

- [x] 기존 lexer/식 AST 재사용 결정: UPDATE/DELETE 전용 양성 문법 추가, 복잡한 T-SQL은 계속 거부 (ADR-013)
- [x] 개발 연결 명시적 opt-in/PK+rowversion 대상 미리보기/WHERE 없음 경고·차단/100행 상한
- [x] DROP/TRUNCATE·배치 차단/정책·연결 세대·실제 SQL·메타데이터·대상 해시/잠금 재검증
- [x] Main의 SERIALIZABLE begin/적용·commit 분리/DB 확인·일회성 토큰/rollback·만료·취소·실패·경쟁 테스트 (대역)
- [x] 실제 Electron 기본 비활성·고정 IPC·개발 opt-in 저장/복원/운영 거부 및 UI 단계 흐름 (UI 쓰기 핸들러는 대역)
- [x] 승인된 전용 DB에서 실제 UPDATE/DELETE/잠금/commit/rollback/권한·트리거 거부 통합 검증 (30초 자동 rollback/서비스 종료 정리 포함)
- [x] 실제 DB 쓰기 UI 전체 경로 수용 검증 (실제 Main/드라이버, preview/rollback/UPDATE·DELETE commit/앱 종료 rollback)
- [x] 사용자 승인으로 MSSQLSERVER01 혼합 인증/loopback TCP14331/전용 테스트 DB·분리 계정 구성 및 실제 SQL 인증/TLS 접속 검증 (sa 비활성 유지, 외부 포트 미개방)

WRITE_TESTING.md가 사용법·지원 문법·예산·수용 갭의 기준이다. Production 쓰기/복잡한 T-SQL/AI 쓰기 도구는 미지원이며 Phase 6는 시작하지 않았다.

## Phase 6

- [ ] pg/mysql2 어댑터/방언별 정책·통합 테스트
- [ ] 대량 결과 페이징/worker/메모리 한도 검증 (기본 서버 페이징 ADR-020·페이지 이동 자동 조회 ADR-024·파일 내보내기 ADR-027 구현, worker 분리는 미구현)
- [ ] Windows installer/서명·배포 정책/설치·제거 smoke test
