# 에이전트 인계

## 최신 인계 — UI 정리·복사·재연결·실제 검증 (2026-10-30, Claude Code)

PROGRESS 2026-10-30 항목들 참고. 실DB 전체와 실제 Codex(live-mcp/live-import-ai/live-relationships 포함)는 통과했다. 남은 것은 Copilot 실제 Electron 흐름 하나로, Copilot 월 한도 소진("exceeded your monthly quota") 때문이며 한도 갱신 후 `.omx/local-sql-validation/run-copilot-mcp.ps1`로 실행한다. 커밋하지 않았다.

## 최신 인계 — AI 제공자 Codex+Copilot, 모델 선택, AI 패널 접기 (2026-10-29, Claude Code)

ADR-032: Claude 제거, Gemini 미추가, GitHub Copilot CLI 추가(격리 홈·ai_db 도구만), provider별 모델 선택, AI 패널 접기. 실제 Copilot 통합 테스트 통과. 남은 것: Copilot으로 실제 SQL Server Electron 전체 흐름, 이전부터 남은 `live-relationships.spec.ts`(Codex) 실제 실행.

## 최신 인계 — 운영 연결 SSMS와 같게 (2026-10-29, Claude Code)

ADR-031: 운영도 서버 인증서 신뢰 허용(경고), SELECT 전용 강제 제거, 쓰기는 연결별 opt-in만 따르고 권한은 DB 역할이 결정한다. 비AI 실DB 전체 검증 통과. 실제 운영 서버 접속, 실제 Codex의 `live-relationships.spec.ts`는 아직 미검증이다.

## 최신 인계 — 연결 그룹과 탐색기 접기 (2026-10-29, Claude Code)

ADR-030: 좌측 연결 그룹(폴더, settings 저장)과 그룹·섹션·패널 접기. 비AI 실DB 전체 검증 통과. 아래 ADR-028/029 인계의 `live-relationships.spec.ts` 실제 Codex 실행은 아직 남아 있다(구독 한도 해소 후 `run-relationships.ps1`).

## 최신 인계 — AI 즉시 실행/쓰기 확인/SELECT * 금지, 테이블 화면 가상 FK (2026-10-29, Claude Code)

ADR-028/029가 최신 계약이다. AI SELECT는 클릭 없이 실행, AI 쓰기는 미리보기 후 "실행할까요?" 한 번 확인으로 apply+commit, AI SELECT의 `*`는 Main이 거부한다. 테이블 상세 화면 아래에서 가상 관계를 바로 설정한다. 비AI 전체 검증과 ADR-028의 실제 Codex 검증은 통과했다. ADR-029 후 재검증의 실제 Codex 단계는 구독 한도(`limit`)로 실패해, 새 흐름의 `live-relationships.spec.ts` 실제 실행이 남아 있다. 한도가 풀리면 `.omx/local-sql-validation/run-relationships.ps1`로 다시 돌린다.

## 최신 인계 — 탭 이름·엑셀 JOIN 미일치 수·결과 전체 내보내기 완료 (2026-10-29, Claude Code)

ADR-027이 최신 계약이다. SQL 탭은 두 번 클릭/F2로 이름을 바꾼다. 엑셀 JOIN 미리보기는 엑셀 전체 행 수와 UPDATE ON 미일치 수(잠금 없는 미리보기에서만 계산)/INSERT 제외 수를 표시한다. 결과 헤더의 CSV/XLSX는 결과를 만든 SQL을 review 토큰으로 다시 검증해 Main이 저장 대화상자와 스트리밍 파일 작성(`resultFile.ts`, 1,048,575행, .partial→rename)을 맡는다. 고정 채널 `db:export-query`만 추가했고 새 의존성은 없다. unit383/실DB integration11(+AI2 skip)/Electron24(+AI4 skip)가 통과했다(`.omx/export-validation-20261029.log`). 남은 후보는 TASKS의 기간 분할 원자 변경 등이며 추가 지시 없이 시작하지 않는다.

## 최신 인계 — 가상 관계와 업무명 JOIN 완료 (2026-10-29, Codex)

ADR-026/VIRTUAL_RELATIONSHIPS.md가 최신 계약이다. 실제 FK 없는 테이블의 연결 열과 업무명/별칭/설명·LEFT/INNER·관계 유형을 SQLite settings에 연결/DB별 저장한다. 왼쪽 가상 관계 화면에서 생성/편집/복합키/검증 후 저장/삭제하며 실제 DB FK/DDL/행을 바꾸지 않는다. 여러 테이블은 관계를 이어 등록한다. Main이 기존 MCP db_list_tables/db_get_foreign_keys에 별도 가상 힌트를 제공하고, 양쪽 열 존재 상태/잘못된 관계를 구분한다. 유형/유일성/실제 행 일치는 보장하지 않는다. 관계 변경 해시로 기존 범위·재개·도구/제안을 무효화하며 기존 실행 정책·쓰기 승인·행 비공유는 그대로다. 별도 IPC/의존성/커밋 없음.

typecheck/lint/format/peers/unit375/build, 실제 SQL Server integration12개와 실제 AI 포함 Electron27개(기본+opt-in 중복 제외)가 통과했다. 새 live-relationships.spec.ts는 실제 FK 0개 테이블 두 개를 UI에서 등록하고 프롬프트에 없는 테이블명을 공식 Codex가 업무명으로 발견해 LEFT JOIN 제안→SELECT-only 결과까지 수용했다. 로그 .omx/relationships-validation-final-20261029.log, 화면 .omx/relationships/. 첫 전체 실행의 기존 쓰기 UI 초기 메타데이터 경쟁은 테스트에서 초기 탐색기 로드 완료를 기다려 재실행 통과했으며 Main 잠금/쓰기 규칙은 변경하지 않았다. 두 실행 DB/임시 로그인을 정리했고 원래 aidb_write_test_local은 ONLINE이다. 고객 실제 관계/업무 스키마의 의미 검증·자동 관계 추론·ER 다이어그램/임의 ON 필터 등은 별도 범위다. 추가 지시 없이 다른 후보 작업은 시작하지 않는다.

## 최신 인계 — SQL 포맷 설정과 자동 페이지 완료 (2026-10-29, Codex)

ADR-025/SQL_FORMATTING.md가 SQL 작성 스타일 기준이다. 일반 식별자의 불필요한 대괄호 제거·앞쪽 쉼표·대문자·JOIN ON 정렬을 기본으로 제공한다. 툴바 SQL 정리/Alt+Shift+F와 SQL 포맷 설정(6개 옵션/미리보기/SQLite 저장/기본값/취소)을 추가했다. AI 카드·새 탭·테이블 SELECT 생성에 적용하며 기존 탭/저장 SQL/이력은 일괄 변경하지 않는다. Main은 여전히 안전 인용·기존 실행 문법/승인을 사용한다. 스타일 정보만 기존 Agent context의 선택적 bounded DTO로 전달한다. 미지원/잘못된 SQL의 정리 실패는 알리고 원문을 보존한다.

앞선 사용자 요청인 다음 페이지 자동 조회도 ADR-024로 구현했다. cached page는 DB 호출 없이 이동하고 필요한 경우에만 기존 continuation을 소비한다. Main/IPC를 확장하지 않았다. 실제 SQL Server 2500행 1000/1000/500·캐시·마지막 페이지와 UI 중복/오류/취소/탭 전환을 검증했다. 공유 DB catalog 변경 시 교착이 발생한 integration 파일들은 이제 순차 실행하며 테스트 내부 동시 세션 검사는 그대로다. 기존 테이블 드래그 테스트는 실제 pointer drag 상태와 drop 상태를 기다려 안정화했다.

typecheck/lint/format/peers/unit368/build, 실제 DB integration12개/실제 AI 포함 Electron25개(중복 제외)가 통과했다. 로그 `.omx/sql-formatting-validation-20261029.log`; 최종 contextual identifier 대소문자 보호 및 기본 재빌드/회귀 `.omx/sql-formatting-final-20261029.log`; 화면 `.omx/sql-formatting/`. 이전 페이지 검증의 교착/드래그 간헐 실패와 후속 조치는 PROGRESS에 남겼다. 실행 전용 DB와 임시 계정을 정리했고 기존 테스트 DB를 보존했다. 새 의존성/커밋 없음. 다음 Phase/실제 사용자 업무 데이터/운영 환경/다중 문장 원자 실행을 자동 시작하지 않았다.

## 최신 인계 — DB 구조 자동 공유·선택 옵션 제거 (2026-10-29, Codex)

사용자가 DB 공유 필수·선택 옵션 삭제를 지시했다. ADR-023이 최신 계약이다. AgentPanel은 연결된 현재 SQL 탭에서 AI 메시지를 보낼 때 기존 context `{connectionId, shareSchema:true}`를 자동 첨부한다. 체크박스·토글 상태는 제거됐고 공유 연결/DB·행 제외만 표시한다. DB 미연결은 텍스트 전용, 저장 쿼리 호출은 로컬, 연결 선택/상태 확인/엑셀 요청 준비만으로는 AI호출이 없다. Main의 세대/scope/capability·CLI 인증/격리·행/셀/자격 증명 비공유·쓰기 승인 경계는 보존했다.

typecheck/lint/format/peers/unit341/build, 실제 DB integration12개와 Electron22개(기본+실제 AI opt-in 중복 제외)가 통과했다. `agent-auto-context.spec.ts`는 자동 context/DB 변경/연결 전환 시 활성 요청 취소/단절 후 text-only를 handler double로 확인한다. 실제 `live-mcp`/`live-import-ai`도 공유 체크박스 없이 통과했다. 로그 `.omx/auto-db-context-validation-20261029.log`. 실행 DB `aidb_write_test_local_07e5de2c10be`와 임시 계정을 정리했고 원래 테스트 DB는 보존했다. Main/preload/IPC/새 의존성/커밋 변경은 없다. 아래 과거의 UI 공유 선택·기본 꺼짐 문구는 현재 동작이 아니다.

## 최신 인계 — AI 패널 설명 축소 (2026-10-29, Codex)

사용자가 AI 패널 설명이 많다고 지적해 반복 고지를 기본 닫힌 **사용 안내**로 옮겼다(ADR-022). CLI 상태/확인·공유 동의/행 제외·공유 DB와 입력/대화를 중심으로 표시한다. 오류·거부 사유는 접지 않고, 제안 미실행과 쓰기 승인 안내도 보존한다. AgentPanel의 전송/이벤트/저장 조회 로직이나 Main/IPC는 바꾸지 않았다. 글꼴 축소·새 의존성·커밋 없음.

typecheck/lint/format/unit341/build, 기본 integration3개·Electron15개가 통과했다(실DB/AI opt-in 각각9개/6개 skip, 이번 표시 변경에서는 실제 DB/CLI 재호출 없음). 새 `agent-panel-compact.spec.ts`가 도움말 키보드 조작/입력 보존/짧은 상태·전체 진단/두 테마·최소 창 대화 면적과 버튼 가시성을 검증한다. `.omx/agent-panel-compact/`의 최종 화면과 `.omx/agent-panel-compact-verification-20261029.log`를 참고한다. 기능 잔여 범위는 TASKS대로이며 새 기능을 자동 시작하지 않았다.

## 최신 인계 — AI 패널 저장 쿼리 이름 호출 완료 (2026-10-29, Codex)

사용자 "다음 작업" 지시로 남은 첫 후보를 구현했다(ADR-021). AI 패널에서 `매출`, `매출 조회해줘`, `/조회 매출`로 현재 연결/DB의 저장 쿼리를 로컬 호출한다. CLI/메타데이터 공유가 필요 없고 SQL·결과를 AI에 보내지 않는다. `savedQueryRequest.ts`가 정확한 이름/별칭만 해석하며 `App`의 component ref가 기존 `SqlWorkspace.run`으로 연결한다. 현재 SQL 탭을 불러온 SQL로 바꾸고 SELECT 결과를 표시한다. 모호함/미일치/타 DB/탭 변경은 차단하며 review의 DB가 저장 DB와 다르면 execute하지 않는다. 쓰기는 Main SELECT 정책에서 거부하고 기존 수동 preview/apply/COMMIT은 그대로다. 일반 AI 질문과 미실행 제안 정책은 보존했다.

unit341/typecheck/lint/format/peers/build, 실제 DB integration12개와 Electron20개(각 기본+AI opt-in 중복 제외)가 통과했다. 실제 이름 SELECT/쓰기·타DB 거부 및 기존 실제 Codex/MCP/XLSX 전체 경로를 재검증했다. 로그 `.omx/saved-query-chat-validation-20261029.log`, 최종 문구·기본 UI 회귀 `.omx/saved-query-chat-final-20261029.log`. 실행용 DB `aidb_write_test_local_14536667a5ae`는 제거했고 기존 테스트 DB는 보존했다. 새 의존성/Main/preload/IPC 변경·커밋은 없다. 아래 인계에서 AI 패널 저장 쿼리 호출이 미구현이라는 문구는 과거 상태다. 다음 후보는 TASKS의 SQL 탭 이름 변경/내보내기/다중 문장 원자 변경/미일치 건수이며 사용자 지시 없이 다음 Phase로 확대하지 않는다.

## 최신 인계 — 잔여 실제 AI 테스트 완료 (2026-10-29, Codex)

이전 Codex 사용량 한도로 미완료였던 `live-import-ai.spec.ts`/`live-mcp.spec.ts`/실제 텍스트·재개를 모두 재실행해 통과했다. 앱 소스 수정 없이 현재 SELECT 즉시 실행·엑셀 JOIN 변경·저장 쿼리·페이지·탐색기 구현을 보존했다. typecheck/lint/format/peers/unit324/build 통과. 실제 DB integration10개+AI opt-in5개(중복3개, 전체12개), Electron16개+AI opt-in4개(중복1개, 전체19개) 통과다. 로그 `.omx/resume-tests-20261029.log`와 PROGRESS 최신 항목이 증거다. 실행 전용 DB와 임시 계정을 정리했고 기존 빈 `aidb_write_test_local`은 ONLINE 유지했다. AI 패널 저장 쿼리 호출/두 문장 원자 실행/실제 사용자 XLSX·운영 환경 검증은 여전히 별도 남은 범위다. 아래 과거 사용량 한도 기록은 현재 실패 상태가 아니다.

## 최신 인계 — 결과 그리드 가독성 (2026-10-28, Claude Code)

`styles.css`의 `.editor-region`(20%, resize)·`.results-region`(flex 1)과 `SqlWorkspace.tsx`의 그리드 테마(rowHeight 30)·`autoSizeStrategy`가 기준이다. 회귀는 `grid-density.spec.ts`. 실제 업무 DB 화면은 사용자 확인이 필요하다.

## 이전 인계 — 저장 쿼리 (2026-10-28, Claude Code)

ADR-019가 계약이다. 이름 해석은 Renderer의 `resolveSavedQuery`(순수 함수, `tests/unit/saved-queries.test.ts`)가 하고, 저장 시 중복 검사는 Main `repository.saveQuery`가 다시 한다. 실행은 기존 SELECT 경로만 사용한다. 사용자 요구 중 남은 것: AI 패널 이름 호출(미구현), 기간 종료+추가 두 문장 원자 실행(미지원), 실제 업무 XLSX 수용, Codex 한도 회복 후 실제 AI 스펙 재실행. 2026-10-28 사용자 지시로 빈 실행용 DB 9개(`aidb_write_test_local_<12hex>`)를 삭제했다. 원래의 빈 `aidb_write_test_local`만 ONLINE이며 임시 로그인은 0개다. 이후 실행 스크립트가 만드는 DB는 실행 뒤 같은 방식으로 정리한다.

## 이전 인계 — 엑셀 JOIN UPDATE/INSERT 실행 (2026-10-28, Claude Code)

ADR-018/EXCEL_IMPORT.md가 계약이다. `MutationQuery.join`이 있는 경우만 stage를 `#stage_...`로 적재해 미리보기(rollback 전용 `mutationScope`)와 적용(쓰기 트랜잭션)을 수행한다. UPDATE는 rowversion 집합, INSERT는 `MutationSnapshot.rowsDigest`/`count`로 재검증한다. 상한 `mutationRowLimit`=1000은 일반 UPDATE/DELETE에도 적용된다. 재현: `.omx/local-sql-validation/run-korean-read.ps1`의 실행 줄을 `tests/integration/import-mutations.test.ts`로 바꿔 실행한다. 리뷰 LOW 잔여(미일치 행 수 표시, 넓은 잠금 가능성, `isolated()` 정리 순서)는 PROGRESS 참조. 남은 것: 저장 쿼리 이름 호출, 두 문장(기간 종료+추가)의 원자적 실행은 미지원, 실제 업무 XLSX 수용 미검증, 실제 AI 스펙은 Codex 한도 회복 후 재실행.

## 이전 인계 — SELECT 즉시 실행 (2026-10-28, Claude Code)

SELECT 검토 모달을 제거했다(ADR-017, `src/renderer/src/components/SqlWorkspace.tsx`의 `run`). Main 승인 토큰은 내부 핸드셰이크로 유지되므로 Main/IPC 테스트는 그대로다. 검증 결과는 PROGRESS 최신 항목. 다음 후보: (1) 저장 쿼리 이름/별칭 호출 — 현재 DB 범위 한정, 모호하면 실행 금지, 값 보간 금지, (2) 엑셀 stage JOIN 변경 SQL 검증·실행 — 기존 UPDATE/DELETE 문법·100행 상한·트랜잭션 확장 필요, 사용자 결정 필요. 실제 AI 스펙(`live-mcp`, `live-import-ai`)은 Codex 한도 회복 후 `.omx/local-sql-validation/run-mcp.ps1`/`run-import-ai.ps1`로 재실행한다. 남은 빈 `aidb_write_test_local_*` DB 정리는 사용자 확인이 필요하다.

## 이전 인계 — Claude Code 이관 시점 상태 확인 (2026-10-28)

Codex 사용량 소진으로 Claude Code가 이어받았다. 아래 "가독성" 인계 이후 범용 엑셀 가져오기(EXCEL_IMPORT.md, `src/main/imports/*`, `ImportWorkspace.tsx`, `src/shared/imports.ts`)가 구현됐으나 HANDOFF/PROGRESS에 기록되지 않았었다. 코드가 기준이며 TASKS.md의 엑셀 항목이 최신이다. 이관 시 재실행: typecheck/lint 통과, unit295개 통과. 마지막 Codex 세션의 opt-in 실검증(`.omx/generic-import-*.log`)은 integration imports2개/실DB Electron12개 통과, `live-import-ai.spec.ts`1개만 실패했으며 원인은 코드가 아닌 Codex CLI 사용량 한도(`code: "limit"`)다. 이 실제 AI 수용은 미완료로 남긴다. 남은 사용자 요구: SELECT 별도 승인 제거, 저장 쿼리 이름 호출, 엑셀 JOIN 변경 SQL의 범용 검증·실행(`.omx/context/db-ai-workflows-20261028.md` 경계 참조).

## 최신 인계 — 가독성 개선 및 후속 요구사항 구분 (2026-10-28)

UI를 Noto Sans KR 우선(미설치 시 맑은 고딕 등 대체), 본문14px/보조 최소12px로 조정하고 다크·라이트 보조 텍스트 대비를 높였다. SQL은 고정폭14px를 유지한다. `readability.spec.ts`는 두 테마/세 창 크기를 검증하고 전후 화면도 확인했다. typecheck/lint/unit189개/build/format/peers 통과, 기본 Electron7개 통과/4개 skip 및 integration3개 통과/5개 skip이다. 새 의존성/외부 글꼴/DB 변경은 없다. 사용자 후속 SQL/정산 작업 요구는 별도 범위이며 현재 미구현이다. 최신 정리와 미확정 경계는 `.omx/context/db-ai-workflows-20261028.md`를 참조해 재개하고 기존 구현 상태와 혼동하지 않는다.

## 최신 인계 — 한글화 (2026-10-28)

앱 기본 UI/접근성 이름/연결·쿼리·쓰기 승인·AI·그리드·이력·알려진 오류를 한국어로 표시한다. LOCALIZATION.md/ADR-015가 최신 언어 계약이다. 내부 상태/IPC/SQL/사용자 데이터와 기존 저장소는 바꾸지 않는다. 알려진 영어 이력은 표시 경계에서 번역하며 외부 진단/AI 답변은 원문을 유지한다. Monaco의 기존 로컬 한국어 리소스를 사용하고 새 의존성을 추가하지 않았다. unit189개/typecheck/lint/build 및 실제 DB opt-in integration6개/Electron8개가 통과했다(각 AI2개 skip). 화면 캡처/한글 SQL 저장/한국어 입력 오류/기존 실제 DB 쓰기 보호 흐름도 검증했다. 과거 영어 버튼명 대신 최신 화면과 LOCALIZATION.md의 용어를 따른다. 실제 AI를 새로 호출하거나 Phase 6로 진행하지 않았다.

## 최신 인계 — 실제 DB MCP 전체 경로 완료 (2026-10-28)

요청한 잔여1번을 완료했다. `tests/e2e/live-mcp.spec.ts`는 실제 로컬 SQL Server/실제 Electron Main·preload/공식 Codex CLI0.165.0으로 스키마 조회→제안→UI→별도 승인 SELECT·그리드·이력까지 대역 없이 통과했다. 프롬프트에 없는 무작위 테이블·컬럼 탐색, 원래 SQL 탭 보존, 승인 전 이력0개, 같은 세션의 두 번째 MCP 호출, SELECT-only 계정과 단절 시 공유 해제도 검증했다. 설치 CLI 변경으로 정확한 지원 pin은0.165.0이며 다른 버전은 거부한다. 실제 텍스트 integration1개/MCP integration4개/실DB MCP UI1개, unit184개 및 typecheck/lint/build 통과다. MCP_TESTING.md/ADR-014가 최신 계약이다. 아래 과거 인계의 실DB MCP 전체 경로 미완료와0.164.0 지원 지시는 더 이상 현재 상태가 아니다. 남은 것은 Claude/SHOWPLAN/Production TLS·장애 수용/Phase 6이며 사용자 지시 없이 확장하지 않는다.

## 최신 검증 업데이트 — 2026-10-28

사용자 승인 후 로컬 MSSQLSERVER01을 혼합 인증/loopback TCP14331로 구성하고 실제 DB 읽기·쓰기와 Electron 전체 경로를 검증했다. 외부 NIC/방화벽을 열지 않았으며 sa는 비활성이다. 앱의 실제 TCP/SQL 인증/TLS(TRUE), 최소 권한 계정, UPDATE·DELETE commit/rollback/잠금/오래된 미리보기·트리거·권한 거부, 30초 자동 rollback/서비스·앱 종료 정리를 확인했다. rowversion 직접 varchar 변환 버그를 발견해 binary(8) 명시 변환과 회귀 테스트로 수정했다. 최신 unit182개, opt-in integration6개/AI2개 skip, Electron7개/AI1개 skip 및 typecheck/lint/build 통과다. 테스트 암호는 저장하지 않고 임시 계정을 제거한다. 재현은 WRITE_TESTING.md의 준비용/쓰기용/읽기용 계정 구분을 따른다. 신뢰 인증서의 운영 TLS, 실제 DB MCP→CLI, Claude/SHOWPLAN은 남아 있다. Phase 6는 시작하지 않았다. 아래 2026-10-27 기록보다 이 업데이트와 PROGRESS/LIVE_VALIDATION의 최신 항목이 우선한다.

2026-10-28 최종 서버 상태: MSSQLSERVER01 Running, loopback TCP14331/혼합 인증, sa 비활성. 빈 `aidb_write_test_local`만 유지하며 실행용 무작위 DB6개와 임시 SQL 계정은 제거했다. 최종 조회에서 임시 로그인/앱 세션/남긴 DB 사용자 테이블 모두0개다. 원래 Windows 인증은 유지된다. 앱 테스트를 재실행하려면 새 임시 SQL 계정과 안전한 환경변수 주입이 필요하다.

## 2026-10-27 프로젝트 상태 (과거 기록)

2026-10-27: Phase 1 완료, Phase 2 소스/로컬 검증과 **실제 개발 MSSQL 기본 성공 경로 검증 완료**. 실제 부하·취소·운영 SELECT 전용 계정 검증은 남아 있다. Phase 3의 Codex 구독 CLI 통합과 실제 응답/세션 재개 검증을 완료했다. Phase 4의 제한 MCP/스키마/SQL 제안도 구현하고 실제 Codex+fixture 메타데이터 도구 호출/재개를 검증했다. Claude 실제 연결·실DB MCP 전체 수용·서버 실행계획은 남아 있다. Claude는 약관·구독 격리 미검증으로 비활성이다. Phase 5의 개발 opt-in 제한 쓰기/트랜잭션과 로컬 검증도 구현했지만 실제 DB 쓰기 수용은 남아 있다. 자동 커밋을 만들지 않았으며 Phase 1부터 파일이 untracked다. 기존 사용자 변경을 덮어쓰지 않았다.

읽기 순서: DEVELOPMENT → PROGRESS → TASKS → ARCHITECTURE → DECISIONS → MSSQL_TESTING. AGENTS.md/CLAUDE.md는 같은 공통 개발 규칙을 참조한다. 대화 내용 없이 이 문서와 소스로 재개할 수 있다.

## Phase 2 마지막 완료 작업

MSSQL 어댑터/정책/암호화 연결 저장소/고정 DB IPC와 실제 UI를 연결했다. 기존 단위 테스트58개와 로컬 Electron E2E2개에 이어 사용자 지정 개발 서버에서 backend1개/live Electron1개도 통과했다. 기본 포트1433에서 사용자 DB23개를 발견하고 첫 DB Athena를 선택해 메타데이터/SELECT42/검토·승인/그리드·이력·단절을 검증했다. 개발 TLS 인증서 신뢰 옵션이 필요했으며 업무 데이터/스키마 변경은 없다. 비밀번호는 숨김 입력 → 임시 프로세스 환경으로 주입했고 파일에 저장하지 않았다. 상세 증거는 LIVE_VALIDATION.md다.

## 다음에 수행할 정확한 작업

1. Git 상태를 확인하고 기존 untracked 사용자 파일을 보존한다. 자동 커밋하지 않는다. DEVELOPMENT.md의 로컬 검증을 실행한다.
2. Phase 3 코드/검증을 재개하려면 AGENT_TESTING.md와 ADR-011을 읽는다. 기본 테스트는 AI 호출을 하지 않으며 실제 구독 테스트는 AI_DB_TEST_AGENT=1 opt-in이다. 실제 요청에는 사용자 메시지만 포함한다.
3. 현재 지원 버전은 Codex0.165.0/ChatGPT 인증이며 텍스트와 명시적 메타데이터 공유 MCP를 재검증했다. MCP_TESTING.md/ADR-014를 먼저 따른다. Claude는 상업 약관과 구독 격리 미검증으로 비활성이다. API 과금 자동 대체/토큰 추출/인증 파일 복사를 추가하지 않는다.
4. Phase 2의 실제 잠금 대기 취소·timeout/대량 행·LOB/SELECT-only 권한 검사는 로컬 fixture에서 통과했다. 신뢰 인증서를 쓰는 Production 전체 경로는 남아 있다. 재현은 MSSQL_TESTING.md/WRITE_TESTING.md/LIVE_VALIDATION.md를 따르고 자격 증명은 다시 안전하게 주입한다. 직전 비밀번호는 저장돼 있지 않다. 사용자 승인은 로컬 테스트 인스턴스 구성에 한정하며 임의 운영 DB/다른 서비스로 확대하지 않는다.
5. 실패를 고치고 테스트 후 PROGRESS/TASKS/HANDOFF를 갱신한다. 테스트하지 않은 기능을 완료로 표시하지 않는다. Phase 4 구현/검증은 MCP_TESTING.md를 읽는다. 남은 Claude 활성화/서버 계획은 별도 조건 검증 없이 켜지 않는다. Phase 5는 WRITE_TESTING.md/ADR-013을 읽는다. 실제 쓰기 fixture 승인이 없으면 실행하지 않는다. Phase 6는 사용자 지시 전 진행하지 않는다.

## 수정 중인 파일 / 주요 코드

현재 미완료 편집 파일은 없다. 다음 작업 전에 Git으로 실제 파일 상태를 다시 확인한다.

- `src/shared/database.ts`: 연결/메타데이터/실행·이력 DTO와 Zod 계약. `contracts.ts`는 탭별 선택 connectionId를 저장한다.
- `src/main/database/DatabaseAdapter.ts`: 확장 계약. `mssql/adapter.ts`는 pool·stream·취소·내부 transaction, `metadata.ts`는 파라미터 쿼리, `dialect.ts`는 권한/직렬화.
- `src/main/database/policy.ts`: 제한 SQL lexer/식 AST/SELECT 분석/정규화. 미지원 문법은 거부하고 원문 fallback 금지.
- `src/main/database/service.ts`: session 세대/일회성 승인/AbortController/timeout/history/종료 정리. 실행에 원문 SQL을 받지 않고 Main의 승인 객체만 사용한다.
- `src/main/database/repository.ts`, `src/main/security/credentials.ts`: async OS 암호화된 프로필·암호와 SQLite 저장. history는 평문. 초기화 완료 후 IPC를 등록한다.
- `src/main/index.ts`, `src/preload/index.ts`, `src/shared/channels.ts`: 격리 bridge/sender 검증/고정 IPC. preload에 Zod/mssql/Node 외부 require를 추가하지 않는다.
- `src/renderer/src/components/{ConnectionDialog,DatabaseExplorer,SqlWorkspace}.tsx`: UI, 탭별 연결/결과, 승인 modal/취소/이력. App은 환경설정과 공통 레이아웃을 소유한다.
- `tests/unit/*`: 테스트 대역 포함58개. `tests/e2e/connections.spec.ts`: 실제 OS 암호화/SQLite/연결 실패. `live-mssql.spec.ts`와 `tests/integration/mssql.test.ts`: opt-in 실제 DB.

## 설계/주의사항

DB 연결당 독립 pool, 동시 실행1개, 연결 정보 수정은 단절 후 가능하다. DB 전환은 pool을 다시 만들고 권한을 검사한다. Renderer는 비밀번호를 저장하거나 다시 받지 않는다(연결 입력 폼의 임시 값만 존재). Production은 TLS 우회 금지와 엄격 권한 검사, Development는 초과 권한 경고와 동일한 SELECT 정책이다.

안전 정책은 완전한 SQL 의미론 증명이 아니다. 로컬 사용자 테이블과 제한 내장 함수만 허용하며 전용 DB SELECT 권한이 기본이다. 원문/배치/동적 SQL 실행을 추가하지 않는다. 60초 token은 재사용 불가이며 연결 세대가 바뀌면 무효다. 수정을 승인한 SQL과 실행할 SQL이 달라지지 않도록 재파싱한다.

결과는 최대5000행/4MiB/256열/셀8192문자/서버LOB16384바이트, 최근5탭 결과와100건 이력을 유지한다. 결과가 전체 데이터라는 의미가 아니다. 원래 연결/DB 표시를 유지한다. SQL 탭·이력의 비밀값은 암호화되지 않는다. crypto를 사용할 수 없으면 저장/복호화를 거부하며 평문 fallback을 추가하지 않는다. 다른 OS 계정으로 프로필을 복사하면 복호화되지 않을 수 있다.

트랜잭션 메서드는 어댑터 내부 구현/대역 테스트만 존재한다. Phase 5의 개발 제한 쓰기 UI/IPC는 추가했으며 실제 DB 검증은 WRITE_TESTING.md의 미완료 항목을 따른다. Windows 통합 인증, 뷰, 복잡한 T-SQL은 미지원이다. 알려진 로컬/실제 개발 DB 기본 경로 실패는 없다. 실제 대량 부하/장기 쿼리 취소와 운영 계정·신뢰 인증서 환경은 미검증이다.

## 검증 명령

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm test:db
pnpm format:check
pnpm peers check
git -c safe.directory=C:/Users/heo/ai-db-studio status --short
git -c safe.directory=C:/Users/heo/ai-db-studio diff --check
```

실행은 `pnpm dev`. Node >=22.12/pnpm11.5.2/Windows x64 기준이다. native SQLite는 postinstall로 Electron ABI를 준비한다. E2E에는 GUI 세션이 필요하며 임시 `--user-data-dir`를 사용해 실제 프로필과 분리한다. 자동 Git 커밋 금지.

## Phase 3 인계

- src/shared/agent.ts: 엄격한 요청·provider DTO와 고정 AgentApi. src/main/agent/: native 탐지/최소 환경/프로세스 트리 취소, AgentAdapter/CodexAdapter/비활성 ClaudeAdapter/JSONL 파서/서비스.
- Main이 userData/agent-workspace에서만 CLI를 시작한다. 전역 사용자 config/rules를 무시하며 CLI 인증은 공식 저장소를 그대로 사용한다. 자격 증명 파일을 읽거나 복제하지 않는다. 앱 API 키 UI/SDK/토큰 저장소는 없다.
- AgentPanel.tsx: 상태 확인 후 명시적 전송, 스트림·취소·재개·provider 전환·초기화 UI. preload의 onEvent는 Electron event를 숨기고 구독 해제 함수를 돌려준다. 새 대화는 CLI 로컬 기록 삭제가 아니다.
- tests/unit/agent.test.ts와 tests/e2e/agent.spec.ts의 기본 테스트는 AI 호출을 하지 않는다. integration/agent.test.ts와 opt-in live UI는 AI_DB_TEST_AGENT=1일 때만 구독 요청을 보낸다. 기본 pnpm test:db는 AI/DB 계정 없으면 skip이다.
- 실제 Codex 0.164.0 ChatGPT start/resume은 integration으로 통과했다. Electron 실제 UI 검증 및 최종 로컬 검증 결과는 AGENT_TESTING.md가 기준이다. Phase 2의 미완료 실DB 부하/운영 권한 검증은 그대로 남는다.

## Phase 4 인계

- 필수 재개 문서: MCP_TESTING.md → TASKS.md → ADR-012. stdio relay가 별도 빌드 entry이므로 integration 전 pnpm build를 실행한다.
- src/main/mcp/{metadata,session,protocol,broker}.ts, src/main/mcp-stdio.ts, src/shared/mcp.ts 추가. DatabaseService.metadataScope는 Main 내부 메타데이터 전용 계약이다. Renderer에는 새 범용 IPC를 추가하지 않았다.
- capability는 턴별 환경변수로만 CLI/relay에 전달한다. broker는 TCP가 아닌 로컬 named pipe/Unix socket이다. 공식 CLI 인증 토큰이나 DB 암호를 MCP에 제공하지 않는다. CLI 사용자 설정을 수정하지 않았다.
- codexArguments는 공유가 없으면 이전 빈 MCP/host 비활성을 유지하고, 공유 시 ai_db 하나와7개 도구만 등록한다. code_mode_host는 이 경우에만 필요하다. code_mode/셸/쓰기 기능 제한을 풀지 않는다.
- AgentPanel 공유 기본 꺼짐/원래 연결 DB의 제안만 열기/오류 입력 검토/새 SQL 탭 동작을 유지한다. SQL 제안은 승인 객체나 실행 결과가 아니다.
- 실제 Codex MCP 호출과 fresh capability resume은 통과했다. DB는 fixture다. Claude client fixture는 공식 Claude CLI가 아니다. 실DB MCP 전체 UI/SHOWPLAN/Claude 인증은 미검증이며 완료로 표시하지 않는다. 기존 Phase 2 미완료 항목도 그대로다.

## Phase 5 인계

- 필수 문서: WRITE_TESTING.md → TASKS.md → ADR-013. 실제 쓰기 테스트 DB/계정은 없다. 저장된 이전 업무 DB 비밀번호를 재사용하거나 임의 DB에 위험 SQL을 실행하지 않는다.
- src/shared/mutation.ts, src/main/database/{MutationAdapter,mutations}.ts, mssql/mutations.ts, renderer MutationPanel.tsx 추가. ConnectionDialog의 readOnly 기본true/개발 opt-in과 Production 강제를 유지한다.
- 제품은 제한 UPDATE/DELETE만 지원한다. PK+NOT NULL rowversion과 메타데이터 가시성/대상 권한, 부작용 없는 일반 테이블이 필요하다. 자동 스키마/권한 변경은 없다.
- Main preview는 SELECT만 한다. apply가 내부 BEGIN/잠금 재검증/변경을 수행하고 별도 commit 호출까지 미확정이다. 일회성 해시/토큰/DB 확인을 검증한다. 30초 idle rollback과 rollback-vs-commit 경쟁 방지, 불명확 결과 unknown을 유지한다.
- 트랜잭션을 끝낸 연결은 폐기하고 사용자에게 재접속을 요구한다. SELECT와 진행 중 메타데이터가 쓰기 lease와 섞이지 않도록 유지한다. Disconnect/Delete/Quit은 MutationService 정리가 먼저다.
- unit181개와 로컬 Electron5개 통과지만 실제 DB 트랜잭션 성공 증거가 아니다. tests/e2e/mutation-flow.spec.ts는 Main 쓰기 핸들러 대역이다. tests/integration/mutations.test.ts는 명시적인 dedicated-fixture-only 플래그와 aidb_write_test_* DB를 요구하며 이번에는 skip이다.
- SQL 탭/이력은 평문이다. committed/rolled-back/unknown을 구별하며 SQLite 저장 실패를 DB COMMIT 실패로 바꾸지 않는다. MCP 도구는 계속 읽기/SELECT 제안만 제공한다. 자동 Git 커밋/Phase 6 진행은 하지 않았다.
