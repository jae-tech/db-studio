# 한국어 UI

2026-10-29: DB 메타데이터 공유 체크박스는 ADR-023으로 제거했다. 현재 AI 패널은 연결된 DB의 공유 범위와 행 데이터 제외만 표시하며 메시지 전송 시 구조를 자동 공유한다. 아래 초기 용어표의 공유 옵션은 과거 UI다.

가독성 후속 업데이트: 로컬 Noto Sans KR을 우선하고 본문14px/보조 최소12px와 두 테마의 보조 텍스트 대비를 적용했다. SQL 편집기/검토 SQL의 고정폭은 유지한다. `readability.spec.ts`와 `.omx/readability/` 캡처가 최신 시각 검증이며 이 업데이트는 DB/CLI/SQL 실행 정책을 바꾸지 않는다.

2026-10-28 사용자 요청으로 기본 화면을 한국어로 제공한다. 언어 선택 UI나 새 번역 의존성을 추가하지 않고, 기존 기능·SQL 정책·인증·IPC 계약을 유지한다.

## 적용 범위

- 제목/상태 표시줄, 탐색기와 연결 추가·편집·삭제, SQL 탭·쿼리 검토·결과·실행 이력, 쓰기 미리보기·적용·COMMIT·롤백, AI 패널과 접근성 이름·도움말을 번역했다.
- HTML `lang=ko`, Chromium 한국어, 한국어 글꼴 대체 목록을 적용했다. Monaco0.57.0에 포함된 `nls/lang/ko.js`를 편집기보다 먼저 로드한다. 기존 API-only 편집기에 찾기 등 새 기능을 추가한 것은 아니다.
- 결과 표의 페이지/필터/정렬 및 접근성 문구는 소유형 TanStack 결과 컴포넌트에서 한국어로 제공한다. 외부 CDN은 사용하지 않는다.
- Main의 Zod 기본 검증과 연결 프로필의 사용자 안내를 한국어로 표시한다. 알려진 DB/CLI/트랜잭션 오류와 경고는 Renderer 표시 경계에서 번역하므로 이전에 저장한 영어 이력도 읽을 수 있다.

## 보존하는 값

SQL 키워드·사용자 SQL·리터럴·DB/테이블/컬럼/연결 이름, CLI 도구명과 프로토콜 필드, 내부 enum·CSS·IPC 채널·이력 상태값은 바꾸지 않는다. 기존 사용자 탭 제목과 SQL을 일괄 수정하거나 설정 스키마를 마이그레이션하지 않는다. 새 기본 탭만 `쿼리 1`, `쿼리 2` 등으로 생성한다.

외부 SQL Server/CLI의 알 수 없는 기술 진단은 숨기거나 임의로 번역하지 않고 원문을 유지한다. AI 응답과 사용자가 입력한 콘텐츠도 자동 번역하지 않는다. 브랜드/SQL 명령/오류 코드는 의미를 보존한다.

| 화면 용어                             | 의미                                            |
| ------------------------------------- | ----------------------------------------------- |
| 쿼리 실행                             | 제한 SELECT를 Main 검증 후 바로 실행 (ADR-017)  |
| UPDATE/DELETE 미리보기                | 읽기 미리보기이며 쓰기를 적용하지 않음          |
| 트랜잭션에 적용 — COMMIT 아님         | 미확정 변경, 아직 영구 반영하지 않음            |
| 변경 확정(COMMIT)                     | 정확한 DB 이름 확인 후 별도 확정                |
| 롤백됨                                | DB가 롤백을 확인한 상태                         |
| 결과 불명확                           | 성공/롤백으로 추정하지 않으며 실제 DB 확인 필요 |
| 선택한 데이터베이스의 메타데이터 공유 | 기존 명시적 MCP opt-in, 기본 꺼짐               |

## 변경 지점과 검증

- 화면 리터럴: `src/renderer/src/App.tsx`, `components/*.tsx`, `store.ts`.
- 상태/그리드 번역과 안전한 오류 표시: `lib/locale.ts`, `lib/messages.ko.ts`. 내부 상태와 표시를 분리해 commit/rollback/unknown의 의미를 유지한다.
- 기본 설정/연결 검증: `src/shared/{contracts,database}.ts`. Main의 표시 언어 초기화와 시작/종료 알림은 `src/main/index.ts`다.
- `tests/unit/locale.test.ts`: 상태 의미 구분, IPC 오류·기존 이력 번역, 오류 코드 유지, 알 수 없는 SQL/진단 원문 보존, 그리드 문구를 검사한다.
- `tests/e2e/localization.spec.ts`: 실제 Electron에서 한국어 HTML/접근성 이름/Monaco 리소스, 한글 SQL의 정확한 저장, 한국어 입력 오류, 승인 없는 실행 차단을 검사한다.
- 기존 E2E의 화면 선택자와 표시 문구 기대값을 한국어로 갱신했다. 내부 payload 상태값과 가짜 Main 핸들러의 역할은 그대로다.

최신 단위189개/typecheck/lint/build 통과. 전용 로컬 DB opt-in integration6개 통과/AI2개 skip, Electron8개 통과/AI2개 skip이다. 실제 읽기 승인/한국어 그리드 페이지 안내 및 실제 UPDATE·DELETE의 별도 COMMIT/롤백·앱 종료 정리를 확인했다. 한국어 화면 캡처는 실행 산출물 `test-results/workspace-korean.png`이며 Git에는 포함하지 않는다. 이번 변경에서 실제 AI 구독 요청을 새로 실행하지 않았다.

계정 없는 기본 E2E는6개 통과/실제 AI·DB4개 skip이다. 최종 실제 읽기 E2E를 별도로 재실행해 페이지 안내와 `성공`/`1행` 이력 표시도 확인했다. 실행용 무작위 DB2개/임시 계정/fixture를 정리했고 실제 조회에서 임시 로그인·앱 SQL 세션·기존 빈 테스트 DB 사용자 테이블이 모두0개다. 기존 `aidb_write_test_local`만 ONLINE으로 유지한다.

기본 재현은 DEVELOPMENT.md의 명령을 사용한다. 실제 DB 재현은 WRITE_TESTING.md의 명시적 fixture opt-in과 임시 계정을 사용한다. 과거 문서의 영문 버튼명은 이 문서와 최신 화면 용어를 따른다.

공식 자료: [Monaco 지역화](https://github.com/microsoft/monaco-editor#localization), [AG Grid localeText](https://www.ag-grid.com/react-data-grid/localisation/). 실제 사용 경로는 설치된 Monaco0.57.0 및 AG Grid36.2.0과 빌드/Electron 실행으로 확인했다.
