# 결정 기록

## ADR-042 — 2026-11-03: 다른 DB의 SQL 자동완성 메타데이터

사용자가 직접 작성하는 SELECT의 다른 DB 조회(ADR-034)에 맞춰 SQL 편집기 자동완성을 `DB.스키마.테이블`과 해당 테이블 별칭의 열까지 확장한다. DB 이름 후보는 연결 계정이 `HAS_DBACCESS`로 접근 가능한 목록만 사용한다. Renderer는 DB 선택 시 기존 고정 `db:explorer`·`db:describe` IPC에 명시적 DB 범위를 전달하고, Main은 현재 연결의 세대를 유지한 채 허용 목록을 재확인한 뒤 인용된 대상 DB의 `sys` 카탈로그만 읽는다. 연결 DB를 변경하거나 새 SQL 실행/쓰기 경로를 만들지 않는다. AI/MCP 메타데이터 범위는 현재 연결 DB로 계속 제한한다. 메타데이터 가시성이 없는 객체는 제안하지 않으며, 실제 SELECT 권한과 실행 정책은 기존 검사를 따른다.

## ADR-041 — 2026-11-03: 다크·라이트별 색 조합

다크·라이트 각각 에메랄드(기존 기본값), 오션, 바이올렛, 앰버 네 조합을 제공한다. `settings.themePalettes`에 두 모드의 선택을 별도로 저장하고, 이전 설정에는 양쪽 에메랄드를 기본값으로 적용한다. 설정 화면에서 색상 미리보기 카드를 선택하고, 상단 테마 전환은 각 모드에서 마지막으로 고른 조합을 복원한다. Renderer의 CSS 변수와 Monaco SQL 편집기 배경·전경·선택·제안 목록을 같은 팔레트로 맞춘다. 새 의존성·수기 CSS·IPC/DB 실행 경로는 추가하지 않는다.

## ADR-040 — 2026-10-30: Renderer의 수기 CSS 제거

사용자의 전 화면 스타일 전환 지시에 따라 `styles.css`에서 수기 선택자·선언을 제거하고 Tailwind v4 import만 남긴다. 기존 의미 클래스는 접근성/E2E 선택자로 보존하고, 이에 대응하는 스타일은 Renderer 소유 TypeScript의 정적 Tailwind 유틸리티 그룹으로 옮긴다. 컴포넌트의 shadcn 소유형 Button/Input/Textarea/NativeSelect/Table은 유지한다. 색상 테마 변수와 런타임 크기(패널/그리드)는 App/컴포넌트가 적용하며 Main/IPC/DB 계약은 바꾸지 않는다. 이는 스타일 구현 이전이지 화면의 시각적 재설계 완료를 뜻하지 않는다.

## ADR-039 — 2026-10-30: SQL 결과 표를 TanStack Table로 전환

사용자 요청으로 AG Grid Community를 제거하고 SQL 결과 표에 TanStack Table v8의 client-side 정렬·필터·페이지·열 크기 상태와 TanStack Virtual 행 가상화를 사용한다. 단순 미리보기 표는 기존 소유형 Table 컴포넌트를 유지한다. Main의 SELECT 실행·continuation 일회성 토큰·쓰기 미리보기/apply/COMMIT 정책은 변경하지 않는다. 결과 표는 화면에 로드된 행만 정렬·필터하며, 서버 continuation의 전체 결과를 정렬·필터한 것처럼 표시하지 않는다. 필터 중 다음 페이지 요청은 한 배치만 불러오는 기존 동작을 유지한다. 열 편집은 기존 안전 경로만 사용한다.

## ADR-038 — 2026-10-30: AI 채팅을 중앙 아래에 두기, 지난 대화, 마크다운 답변, 설정 화면

사용자 요청으로 AI 패널 기본 위치를 **작업 영역 중앙 아래**(`agentDock: 'bottom'`, 높이 `agentHeight` 기본 300, 위쪽 경계를 끌어 조절)로 바꾸고, 패널 머리의 버튼이나 설정에서 오른쪽 열로 되돌릴 수 있다. 대화 상태는 패널 밖 저장소(zustand)에 있어 위치를 바꿔도 이어진다. 메시지는 이름표('나'/'AI 도우미') 없이 내가 보낸 말은 오른쪽 말풍선, 답변은 마크다운으로 표시한다(제목·목록·인용·코드 블록·굵게/기울임/인라인 코드만 지원하는 작은 렌더러, React 요소만 생성해 HTML 주입 없음, 새 의존성 없음). [새 대화]나 앱 종료 때 현재 대화를 **지난 대화**(이 PC의 renderer 저장소, 최근 30개)에 남기고, 머리의 기록 버튼으로 목록을 열어 읽거나 지운다. 지난 대화는 읽기 전용이며 CLI 세션을 이어 가지 않는다.

왼쪽 아래 톱니 버튼으로 여는 **설정** 화면에서 테마, 전체 글자 크기(`uiZoom` 80–150%, preload의 `webFrame.setZoomFactor`, IPC 없음), SQL 편집기 글자 크기(`editorFontSize`), 결과 표 글자 크기(`gridFontSize`), AI 패널 위치·표시, 변경 미리보기, SQL 포맷 설정을 한곳에서 바꾼다. 노출 API에 `setZoom`이 추가되었다(값은 80–150%로 제한).

## ADR-037 — 2026-10-30: 결과 그리드 직접 편집, 결과 글자 크기 설정

사용자 요청(DBeaver 같은 편의성)으로 SELECT 결과를 그리드에서 바로 고친다. Main은 **한 테이블·현재 DB·집계 없음·모든 선택 항목이 `*` 또는 자기 이름 그대로인 열**(`ReadQuery.shape.plain`)이고 PK가 있는 결과에만 `QueryResult.source = { schema, table, keys }`를 붙인다(별칭·계산식·JOIN·다른 DB·엑셀 임시 테이블은 편집 불가). 렌더러는 PK 열이 모두 결과에 있을 때 PK가 아닌 열만 편집 가능하게 하고, 바뀐 셀을 표시한 뒤 [저장]에서 행마다 `UPDATE [s].[t] SET ... WHERE [pk] = <원래 값>`(문자열은 N'' 이스케이프, 직접 입력한 `NULL`은 NULL)을 만들어 기존 보호 경로(미리보기 → 잠금 재확인 apply → COMMIT, ADR-013/033)로 한 행씩 실행한다. 행마다 별도 트랜잭션이라 중간 실패 시 앞선 행은 저장된 상태로 남고 나머지 변경은 유지된다. 연결이 읽기 전용이면 편집하지 않는다. [취소]는 원래 값으로 되돌린다. 결과 그리드 글자 크기(`gridFontSize`, 10–18px, 기본 12)는 설정이며 행 높이가 비례한다.

## ADR-036 — 2026-10-30: 엑셀 가져오기를 Node 파서와 관대한 값 읽기로 전환

실사용 파일(외부 연결·수식·병합·112열·7천 행)이 모두 거부되고 PowerShell 파서는 셀 43만 개에서 2분을 넘겼다. 파서를 Main의 Node 코드(`node:zlib`만, 새 의존성 없음)로 바꾸고 값만 읽는다: 수식은 Excel이 저장한 결과값, 하이퍼링크·병합·외부 연결 파트·이진 파트는 무시(열거나 따라가지 않음), 지수·15자리 초과 숫자·알 수 없는 서식·오류 셀은 저장된 텍스트 그대로, 시간이 있는 날짜는 `yyyy-MM-dd HH:mm:ss`. 빈/중복/긴 헤더는 `열N`·`_2`·120자로 이름을 만들고, 헤더도 데이터도 없는 열은 버린다. 빈 시트·차트 시트는 건너뛴다. 유지하는 거부: ZIP 경로 조작·중복, 매크로(vbaProject), 암호화, DTD, 셀 8192자, 시트당 50,000행, 256열, 32시트, 입력 32MiB, 압축 해제 256MiB(선언·실제 모두), 출력 64MiB. 등록 한도도 열 256·행 50,000·연결당 64MiB로 올렸다. 시트 선택은 기존 UI(파일을 연 뒤 시트 드롭다운)를 쓴다. 실제 파일(3시트, 112열, 7,132행)은 1초 안에 읽힌다.

## ADR-035 — 2026-10-30: rowversion 없는 테이블의 쓰기는 PK 값으로 대상 고정

사용자 결정: 일반 테이블(예: CodeMaster)도 UPDATE/DELETE를 허용한다. 대상에 NOT NULL rowversion이 있으면 기존처럼 rowversion 집합으로, 없으면 PK 값을 길이 접두 텍스트로 이은 식별자(`CONCAT(DATALENGTH(k), N':', k, N'|' ...)`, 날짜 126·이진 1·실수 3 스타일)로 미리보기 대상 행을 고정한다. 적용 SQL은 `WHERE (조건) AND <식별자> IN (N'...')`(DB가 만든 값을 이스케이프한 리터럴로만 되돌림)이고 OUTPUT 식별자 집합이 미리보기와 정확히 같아야 COMMIT 단계로 간다. 같은 행인지는 보장하지만 미리보기와 적용 사이에 다른 세션이 값을 바꾼 것은 감지하지 못한다(DBeaver·SSMS 수준). PK 없는 테이블, PK/identity/rowversion 열 변경, 트리거 등 기존 위험 조건은 계속 차단한다.

## ADR-034 — 2026-10-29: 세 부분 이름(DB.스키마.테이블)과 다른 DB 조회

사용자 요청으로 `DB.스키마.테이블`을 지원한다. 연결된 DB 이름이면 접두어를 떼고 기존과 같게 처리한다(조회·변경 미리보기·실행 모두). 직접 작성한 SELECT(쿼리 실행·페이지·내보내기, 엑셀 임시 테이블 JOIN 포함)는 같은 서버의 **다른 DB**도 이름을 유지해 조회한다. Main은 실행 전에 `HAS_DBACCESS`로 그 DB 접근을 확인하고, 그 DB의 `sys.tables`에서 사용자 테이블(시스템·외부 테이블 제외)인지 확인한다. 실제 읽기 권한은 로그인 계정의 DB 역할이 결정한다(ADR-031). 다른 DB 테이블은 PK 기반 자동 페이지 정렬을 쓰지 않는다(ORDER BY가 있으면 페이지 가능). 쓰기(변경 미리보기·실행)와 AI 메타데이터 도구·AI 제안 SELECT는 지금처럼 연결된 DB로 한정한다(쓰기 안전 검사와 AI 공유 범위가 연결 DB 기준).

## ADR-033 — 2026-10-29: 변경 미리보기(읽기 전용)와 실행/취소, '변경 미리보기' 체크박스

사용자 요청: AI가 만든 UPDATE/DELETE든 직접 쓴 것이든, 실행 전에 바뀔 데이터를 보고 승인/취소한다. 기존 'UPDATE/DELETE 미리보기' 버튼과 검토 체크→적용→DB 이름 입력 COMMIT의 화면 흐름을 대체한다.

- 읽기 전용 미리보기 `db:` 고정 채널 `mutation:inspect` → `DatabaseService.inspectMutation`. 기존 쓰기 파서(`parseMutation`) 결과의 렌더링된 부분만으로 `SELECT COUNT_BIG(*)`와 `SELECT TOP (20)`(키·문맥 열, 바뀔 열의 현재 값, `→ 열` 새 값; DELETE는 삭제될 행; INSERT는 추가될 값)을 만든다. 쓰기 허용(opt-in)·PK·rowversion이 없어도 동작하며 데이터·트랜잭션을 바꾸지 않는다. 메타데이터 읽기와 같은 lease를 써서 쓰기 작업과 겹치지 않는다. 엑셀 JOIN 형식은 격리 트랜잭션에 #temp를 적재해 읽는다.
- 응답의 `applyBlocked`가 실행 가능 여부를 알려준다: 쓰기 허용 꺼짐, 대상 0행 또는 1000행 초과, 기존 대상 조건(PK+rowversion·트리거 없음 등) 불충족. 이때 미리보기는 보이고 [실행]만 막힌다.
- [실행]은 기존 보호 경로를 그대로 연이어 호출한다: 미리보기(스냅샷) → SERIALIZABLE 잠금 재확인·적용 → COMMIT(DB 이름은 Renderer가 채움). [취소]는 미리보기를 닫을 뿐 DB에는 아무것도 하지 않는다.
- SQL 작업 공간 툴바의 **'변경 미리보기' 체크박스**(settings `writePreview`, 기본 켜짐): 켜져 있으면 UPDATE·DELETE·INSERT를 쿼리 실행(Ctrl+Enter)할 때 바로 실행하지 않고 위 미리보기를 연다. 꺼져 있으면 쓰기 문장은 실행하지 않고 안내만 한다. AI가 만든 쓰기 탭은 항상 미리보기를 연다.
- 제거: 수동 미리보기 버튼과 화면의 3단계 확인. Main의 쓰기 상태 머신·적용/COMMIT/롤백·30초 자동 롤백은 그대로이며, 실행 도중 실패하면 기존 미확정 화면(COMMIT/롤백)이 남는다.

## ADR-032 — 2026-10-29: AI 제공자 Codex + GitHub Copilot, Claude 제거, 모델 선택, AI 패널 접기

후속3(사용자 요청): 머리글의 공유 범위 표시(연결·DB 칩/점)를 삭제했다. 메시지 전송 시 공유되는 DB는 SQL 툴바 연결 선택과 상단 제목줄의 '연결 · DB'와 같다(ADR-023의 별도 표시를 대체). 공유 범위·행 비공유 규칙은 바뀌지 않았다.

후속2(사용자 요청): AI 패널을 아이콘 중심으로 정리했다. 머리글에 새 대화(+)·최근 SQL 오류 분석(벌레)·CLI 다시 확인(새로고침, 툴팁에 로그인 상태)·접기(») 아이콘만 둔다. 로그인 정상·빈 대화·'새 대화' 같은 안내 문구는 없애고, CLI 문제가 있을 때만 한 줄을 표시한다. 응답 중에는 전송 버튼이 중지 버튼으로 바뀐다(하단 버튼 줄 제거).

후속(사용자 요청): AI 패널의 '사용 안내' 접기 블록을 없앴다(정책 안내는 AI 설정 화면). CLI 상태 확인은 설치·버전·로그인만 로컬로 검사하고 AI를 호출하지 않으므로, 앱 시작(채팅 패널/AI 설정 화면) 때 자동으로 한 번 실행하고 전송 시 결과가 없으면 그때 확인한다. 수동 버튼은 새로고침 아이콘('CLI 상태 확인', CLI 설치·로그인 뒤 다시 확인용)으로만 남긴다. 모든 턴은 시작 전에 Main이 다시 상태를 검사하므로 자동 확인이 실행 권한을 넓히지 않는다.

사용자 지시로 "공식 CLI 구독 방식"만 유지한다(API 키 과금 없음, ADR-011 원칙 유지). 2026-10 기준 공개 자료를 확인한 결과(PROGRESS 항목의 출처 참고):

- **Claude**: Anthropic 약관상 구독 로그인은 Claude Code 등 Anthropic 자체 앱의 일반 사용용이고, 다른 제품은 API 키를 쓰도록 안내한다. 이 앱에서 구독으로 쓸 근거가 없어 제공자에서 **제거**했다(어댑터·오프라인 파서·UI). 저장된 provider 'claude'는 Codex로 대체된다.
- **Gemini**: 개인 Google 로그인은 2026-06-18부터 Gemini CLI에서 중단됐고, 제3자 소프트웨어가 Gemini CLI OAuth를 쓰는 것은 금지·정지 사유다. API 키 방식은 사용자가 선택하지 않았으므로 **추가하지 않는다**.
- **GitHub Copilot**: 공식 CLI가 스크립트·자동화용 비대화형 모드(`-p`/stdin, `--output-format json`)를 문서화하고 있어 **추가**했다. 사용량은 사용자의 Copilot 프리미엄 요청에서 차감된다. 제품별 약관 전문은 확인하지 못했다.

Copilot 연결 계약(`main/agent/copilot.ts`): 네이티브 `copilot.exe`만(PATH 절대 경로·WinGet). 앱 전용 `COPILOT_HOME`(userData/agent-workspace/copilot-home)을 쓰고, 사용자 `~/.copilot/config.json`에서 계정 식별 정보(host/login)만 복사한다. 토큰은 OS 자격 증명 저장소에 남고 앱은 읽지 않는다. 그래서 사용자의 MCP 서버·플러그인·지침은 불러오지 않는다. `--available-tools`에 `ai_db-<도구>`만(대화 전용이면 일치하지 않는 이름 하나로 0개, 빈 목록은 무제한이라 쓰지 않음), `--allow-tool ai_db`, `--disable-builtin-mcps`, `--no-custom-instructions`, `--no-ask-user`, `--no-auto-update`. 프롬프트는 stdin, MCP 접속 토큰은 환경변수로만 전달한다(argv 노출 없음). 환경변수 허용 목록으로 GH_TOKEN·BYOK(COPILOT_PROVIDER_*) 설정은 넘기지 않는다. 버전은 고정하지 않는다(자동 업데이트가 잦음). 대신 실행 전 `--help`에서 필수 격리 옵션 존재를 확인하고 없으면 막는다. 이벤트는 assistant.message 텍스트, ai_db 도구 start/complete, result(sessionId)만 쓰고, 다른 서버·내장 도구 이벤트가 오면 턴을 실패시킨다.

모델 선택: 채팅 입력창 아래 드롭다운 하나에서 제공자와 모델을 함께 고른다(상단 제공자 버튼·모델 입력칸 제거). 목록은 설치된 CLI의 로컬 카탈로그(Codex `models_cache.json`의 list 항목, Copilot `help config`의 model 값)를 처음 열 때 읽으며 AI를 호출하지 않는다. 좌측 활동 표시줄의 **AI 설정** 화면에서 제공자별 CLI 상태·기본 모델·대화 AI 전환을 같은 상태 캐시로 관리한다. 탐색기 토글은 폴더 트리 아이콘(열림 강조), AI 패널 토글은 상단의 'AI' 글자 버튼이다. provider별 모델 이름(`agentModels`, 영문·숫자·`._:-` 64자)은 Codex는 `-c model="…"`, Copilot은 `--model`로 넘긴다. 비우면 CLI 기본 모델. AI 패널은 숨김(언마운트 아님)으로 접어 진행 중인 대화·자동 실행을 유지하며 `agentCollapsed`로 저장한다.

## ADR-031 — 2026-10-29: 운영 연결도 SSMS처럼 — 인증서 신뢰 허용, 읽기 전용 강제 해제

사용자 지시로 운영(production) 프로필에 걸던 앱 차원의 제한을 해제한다. 권한은 로그인 계정에 설정된 DB 역할이 관리한다는 전제다. 이 결정은 ADR-008/009/013과 MSSQL_TESTING·WRITE_TESTING의 "운영은 신뢰 인증서·SELECT 전용 계정·쓰기 금지" 서술을 대체한다.

- TLS 암호화(`encrypt: true`)는 그대로 항상 켠다. 운영에서도 "서버 인증서 신뢰"(SSMS의 Trust server certificate와 같음)를 체크할 수 있다. 체크하면 서버 신원을 검증하지 않아 중간자 공격을 막지 못하므로 연결 편집 화면에 경고를 표시한다.
- 운영 접속 시 SELECT 전용이 아닌 계정을 거부하던 검사와, 실행 직전 권한 재검사를 제거했다. 넓은 권한 계정에 대한 연결 카드 경고도 사용자 요청으로 없앴다(권한 목록 조회 결과 `permissionVerified`는 내부 값으로만 남는다).
- 쓰기(제한 UPDATE/DELETE/INSERT)는 환경과 관계없이 연결의 "제한 쓰기 허용"(readOnly=false, 기본 꺼짐) opt-in만 따른다. 운영에서 켜면 경고를 표시한다. 미리보기·잠금 재확인·대상 상한·PK+rowversion·COMMIT 확인 등 쓰기 안전 장치(ADR-013/018/028)와 SELECT 파서 정책은 그대로다.
- 환경 값(개발/운영)은 표시와 경고 용도로 남는다.

## ADR-030 — 2026-10-29: 연결 그룹(폴더)과 탐색기 접기

좌측 탐색기에서 연결을 그룹(폴더)으로 묶는다. 그룹은 비밀이 아닌 환경설정으로 SQLite settings의 `connectionGroups`(최대 20개, 이름 40자, 그룹당 30개 연결 ID)에 저장한다. 연결 프로필·암호 저장소는 바꾸지 않는다. 연결은 카드의 그룹 선택으로 옮기고, 어느 그룹에도 없는 연결은 '미분류'에 보인다. 그룹을 삭제해도 연결은 남아 미분류로 간다. 삭제된 연결 ID가 그룹에 남아도 표시하지 않는다. 그룹·'미분류'·'연결 목록'·'데이터베이스 객체' 섹션은 접을 수 있고 상태는 `collapsed`(키 최대 60개)에 저장한다. 연결 검색어가 있으면 접힌 그룹도 펼친 것처럼 결과를 보여준다. 탐색기 패널 전체는 제목의 접기 버튼이나 활동 표시줄 맨 위 버튼으로 접고 펼치며 `explorerCollapsed`로 재시작 후에도 유지한다. 그룹 이름 바꾸기·드래그 이동은 아직 없다.

## ADR-029 — 2026-10-29: 테이블 상세 화면에서 가상 관계 설정

가상 관계 설정이 번거롭다는 요청으로, 탐색기에서 테이블을 클릭해 여는 테이블 상세 화면 아래에 기존 관계 편집기(`RelationshipEditor`)를 그대로 넣었다. 클릭한 테이블이 기준 테이블로 고정되고, 이 테이블이 기준이나 연결 쪽인 관계만 목록에 보인다. 연결 테이블을 고르면 이름이 같은 열을 첫 연결 열로 자동 채운다(연결 테이블 PK 우선, 대소문자 무시). 업무명을 비우면 연결 테이블 이름을 쓴다. 저장 형식·검증(실제 테이블/열 재확인)·상한·AI 공유 방식은 ADR-026 그대로이며, 왼쪽 가상 관계 화면도 계속 쓸 수 있다. 테이블의 연결이 현재 연결·같은 DB일 때만 편집기를 보여준다. 같은 화면의 "SELECT를 편집기에서 열기"는 모든 열을 선택해도 `*` 대신 열을 나열한다.

## ADR-028 — 2026-10-29: AI 조회 즉시 실행, AI 쓰기는 미리보기 후 한 번 확인, SELECT * 금지

사용자 지시로 ADR-012의 "제안 → 사용자가 열고 실행" 흐름을 바꾼다. AI가 `db_propose_sql`로 낸 SELECT는 Renderer가 같은 연결/DB 범위일 때 바로 새 SQL 탭("AI 조회")에 열고 기존 review→execute 경로로 실행한다. Main의 SELECT 파서·실제 사용자 테이블 확인·상한·운영 권한 재검사는 그대로이고, MCP 도구는 여전히 SQL을 실행하지 않는다. 결과 행은 AI에 돌려주지 않는다(도구 응답 `autoRunByApp`, `rowsSharedWithAssistant: false`). 여러 SELECT가 오면 각 탭이 화면에 표시될 때 한 번씩 실행된다. 제안 카드는 기록으로 남고 "SQL 다시 열기"는 실행하지 않고 탭만 연다.

AI가 draft=true로 낸 INSERT/UPDATE/DELETE는 새 탭("AI 변경 · 확인 필요")에 열고 쓰기 미리보기를 자동으로 띄운다. 미리보기는 대상 행과 바뀔 값을 보여주고 "N행을 변경합니다. 실행할까요? [실행] [취소]" 한 번만 묻는다. [실행]은 기존 apply(SERIALIZABLE·잠금 재확인·대상 버전/개수 일치 검증)와 commit을 연이어 호출하며, DB 이름 입력 대신 미리보기한 DB 이름을 Renderer가 채운다. 재확인에서 대상이 바뀌면 apply가 실패해 COMMIT하지 않는다. apply 후 commit이 실패하면 기존 미확정 화면(COMMIT/롤백, 30초 자동 롤백)으로 남는다. 사용자가 직접 연 쓰기 미리보기는 기존 검토 체크→적용→DB 이름 입력 COMMIT 3단계를 유지한다. 개발용 제한 쓰기 연결이 아니면 미리보기 없이 안내만 표시한다. 지원 문법·상한·연결 opt-in 등 쓰기 정책(ADR-013/018)은 바꾸지 않았다.

AI 제안 SELECT의 select 목록에 `*` 또는 `별칭.*`가 있으면 Main이 거부하고 열 이름을 명시하라고 응답한다(`ReadQuery.shape.star`, COUNT(*)·곱셈은 해당 없음). 사용자가 직접 작성한 SQL의 `*`는 기존처럼 실행한다. 엑셀 가져오기 화면의 예시 SELECT도 열을 나열한다.

## ADR-027 — 2026-10-29: 결과 전체 파일 내보내기, 엑셀 JOIN 미일치 행 수, 탭 이름 바꾸기

결과 내보내기는 그리드 결과를 저장하지 않는다. 그 결과를 만든 SQL을 기존 review 토큰으로 다시 검증한 뒤 Main이 저장 대화상자로 경로를 받고, 기존 SELECT 파서/실행 정책(운영 권한 재검사·사용자 테이블만·엑셀 #temp)으로 한 번 더 실행해 행을 파일로 스트리밍한다. Renderer는 형식(csv/xlsx)만 보내고 파일 경로·SQL 실행 권한은 받지 않는다. 고정 채널 `db:export-query` 하나만 추가했다. 그리드의 maxRows/4MiB/셀 8192자 상한은 적용하지 않는다. 대신 내보내기 전용 상한 1,048,575행(XLSX 시트 한도, CSV 공통)을 TOP으로 걸고, 넘으면 실패시킨다. 시간 제한은 30분이다. 1MiB 버퍼가 차면 드라이버 스트림을 pause하고 파일 쓰기 후 resume한다. `.partial`에 쓴 뒤 성공했을 때만 이름을 바꾸고, 실패·취소 시 삭제한다.

XLSX는 새 의존성 없이 Node zlib(deflate/crc32)로 최소 OOXML(인라인 문자열, 시트 1개)을 스트리밍 ZIP(data descriptor)으로 쓴다. ZIP64는 지원하지 않아 4GiB를 넘으면 실패한다. Excel 셀 한도 32,767자를 넘는 셀은 자르고 개수를 알린다. XML 금지 제어문자와 짝 없는 서로게이트는 제거한다. CSV는 UTF-8 BOM과 RFC 4180 형식이며 값을 그대로 보존하려고 수식 주입 접두어를 붙이지 않는다(신뢰하지 않는 데이터는 XLSX 권장). 이력에 성공/실패가 남는다.

엑셀 JOIN 쓰기 미리보기는 엑셀 전체 행 수와, UPDATE에서 ON 조건으로 대상과 일치하지 않는 엑셀 행 수를 함께 보여준다. 미일치 수는 잠금 없는 첫 미리보기에서만 `NOT EXISTS` COUNT로 계산한다. 적용 직전의 잠금 재확인에서는 대상 전체에 범위 잠금이 걸리지 않도록 계산하지 않는다. 승인 해시·대상 검증에는 쓰지 않는 표시 정보다. INSERT는 엑셀 전체 행에서 추가 대상 행을 뺀 값을 보여준다.

SQL 탭 제목은 두 번 클릭이나 F2로 바꾼다. 기존 settings 스키마(80자)에 그대로 저장하고, 빈 이름은 무시한다.

## ADR-026 — 2026-10-29: DB 비변경 가상 관계와 업무명 JOIN 힌트

사용자가 FK 없는 실제 연관 테이블의 연결 기준을 저장하고 업무명으로 AI JOIN 조회를 요청했다. 가상 관계는 SQLite 환경설정에 연결 ID/DB별 저장하는 메타데이터다. 업무명/별칭/설명·방향 있는 테이블/복합 동등 열·LEFT/INNER·관계 유형을 지원한다. 실제 FK/DDL/행 변경·자동 추론·임의 ON SQL은 없다. 사용법/상한/주의사항은 VIRTUAL_RELATIONSHIPS.md를 따른다.

기존 고정 settings/DB IPC를 재사용하고 Main이 저장된 관계를 MetadataScope에 결합한다. 기존 7개 MCP 도구 중 db_list_tables에 발견용 힌트, db_get_foreign_keys에 별도 가상 관계와 양쪽 열 존재 상태를 추가한다. 물리 FK와 합치거나 유일성·행 일치가 검증된 제약으로 가장하지 않는다. 메타데이터 예산/신뢰하지 않는 데이터 정책·SELECT 파서·쓰기 승인·행 비공유를 유지한다. 관계 변경 해시는 범위 키·세션 재개/도구/제안을 무효화한다. 기존 SQL 탭/저장 SQL/이력은 재작성하지 않는다. 새 의존성/범용 IPC/AI 실행 도구는 없다.

## ADR-025 — 2026-10-29: 불필요한 대괄호 제거와 저장 가능한 SQL 포맷

사용자의 예시를 기본으로 대문자 키워드·앞쪽 쉼표·4칸 들여쓰기·JOIN ON 정렬·AND/OR 줄바꿈·최소 식별자 인용을 제공한다. 공백·예약어·특수문자와 현재 실행 파서가 인용을 요구하는 이름은 유지한다. 문자열/변수/식별자 대소문자를 임의 치환하지 않는다. `SQL_FORMATTING.md`가 사용법과 경계의 기준이다.

새 의존성 없이 `shared/sqlFormatting.ts`의 표시용 lexer를 사용한다. Main의 실행 AST/정규화·안전 인용은 그대로이며 범용 SQL 실행 문법을 늘리지 않는다. formatter도 잘못된 문법이나 미지원 lexical form은 거부한다. 수동 정리는 실패 시 원문을 유지하고, AI 초안은 실패 안내와 함께 원문을 표시/연다. 실행 정책 fallback은 없다. settings의 새 필드는 기본값으로 구버전 저장값을 읽으며 기존 SQL/저장 쿼리/이력을 재작성하지 않는다.

Renderer는 정리 버튼/Alt+Shift+F, 6개 옵션의 native dialog/미리보기·저장/기본값/취소를 제공한다. AI 카드/새 탭/테이블 SELECT 생성에 같은 함수를 적용한다. 기존 Agent context에 선택적인 bounded `sqlFormatting` DTO를 추가하고 Main이 고정 지시문으로 스타일만 전달한다. 임의 프롬프트/실행 인자/범위 권한을 새 필드로 받지 않는다. 새 IPC 채널·Node renderer 접근·직접 API 과금은 없다.

## ADR-024 — 2026-10-29: 다음 페이지 이동 시 자동 추가 조회

사용자 요청으로 별도 '다음 N행 불러오기' 버튼을 제거한다. 결과 하단의 다음 페이지가 이미 불러온 행을 벗어나거나 부분 페이지만 남은 경우 기존 Main `fetchMore`를 호출하고 요청한 화면 페이지로 이동한다. 이미 불러온 페이지의 이동은 DB를 호출하지 않는다. 서버 배치가 화면 페이지보다 작으면 필요한 화면 페이지를 채울 때까지만 순차 조회한다. 필터가 켜져 있으면 필터 탐색으로 전체 DB를 자동 순회하지 않도록 클릭당 한 서버 배치만 추가하고 가능한 페이지로 이동한다. 정렬·필터는 기존처럼 불러온 행에만 적용하며 DB 전체 정렬은 SQL ORDER BY로 지정한다.

AG Grid Community의 client-side row model과 결과 캐시를 유지하고, [공식 pagination API](https://www.ag-grid.com/react-data-grid/row-pagination/)의 `suppressPaginationPanel`, `onPaginationChanged`, `paginationGoToPage`를 이용한 하단 컨트롤을 제공한다. 가짜 빈 행이나 미확인 전체 건수를 넣지 않는다. 추가 결과가 있으면 현재 불러온 건수/페이지에 `+`를 표시하고 전체 크기를 모르는 동안 마지막 페이지 이동은 비활성이다. 페이지 크기는 50/100/500행이며 DB 배치 상한과 별개다.

Main의 일회성 continuation/연결 세대/기간·행·바이트 상한과 Renderer 100,000행/최근5탭 제한은 유지한다. 중복 클릭은 같은 실행 잠금으로 막고 작은 배치에는 매번 새 request ID를 사용한다. 오류·취소로 소비된 토큰을 자동 재시도하지 않으며 이미 읽은 행은 보존하고 재실행 안내를 표시한다. 탭 변경 후 늦은 결과는 원래 탭에만 반영하고, 다른 탭으로 이동시키거나 원래 연결/DB가 바뀐 상태로 추가 조회하지 않는다. 새 Main/IPC/SQL 정책·의존성은 없다. ADR-020의 별도 추가 조회 버튼만 이 UI로 대체한다.

## ADR-023 — 2026-10-29: 선택 DB 구조 자동 공유, UI 선택 옵션 제거

사용자가 DB 공유를 필수로 지정했으므로 AgentPanel의 공유 체크박스·사용자 토글 상태를 제거한다. 연결된 현재 SQL 탭의 DB를 표시하고, 사용자가 AI 메시지를 보낼 때 기존 context `{ connectionId, shareSchema: true }`를 자동으로 붙인다. 연결/DB 선택·CLI 상태 확인·엑셀 요청 준비만으로 AI를 호출하지 않는다. DB 연결이 없으면 텍스트 대화를 유지하며, 저장 쿼리 이름 호출은 계속 로컬 처리한다.

공유는 현재 연결 세대/DB의 제한 메타데이터 도구에 한정한다. 다른 연결/DB·행·엑셀 셀·SQL 탭·접속 자격 증명을 자동 공유하지 않는다. 연결/DB 변경·단절 시 진행 중 요청을 취소하고 제안을 지우며 Main의 scope key/세대 검증·새 capability·SQL 미실행/쓰기 승인 정책은 유지한다. 내부 `context.shareSchema`는 기존 고정 IPC 프로토콜 필드이지 사용자 선택 옵션이 아니다. 새 Main/IPC/설정 경로를 만들지 않는다. 이 결정이 ADR-012/016/022의 명시적 UI 공유 선택·기본 꺼짐 규칙을 대체한다.

## ADR-022 — 2026-10-29: AI 패널 설명 접기

사용자 피드백에 따라 반복 설명을 기본 닫힌 native `details`의 **사용 안내** 하나로 모은다. 기본 화면에는 provider, 짧은 CLI 상태와 확인 버튼, 명시적 **DB 구조 공유 · 행 데이터 제외**, 공유 중인 연결/DB, 한 줄 빈 대화, 입력창/동작 버튼만 남긴다. 성공 시 긴 CLI 진단은 도움말과 title에서 확인할 수 있고 실패/거부 사유는 기존처럼 화면에 표시한다. 공유 체크박스의 접근성 이름은 유지한다.

저장 조회 사용법·AI 전송/기록·API 자동 대체 없음·쓰기 승인/COMMIT 안내는 펼쳐 읽는다. 제안 카드에는 미실행 여부와 SELECT/쓰기의 차이를 한 줄로 표시한다. 글꼴 축소나 실행/공유/인증/IPC 정책 변경으로 공간을 확보하지 않는다. 접힘 상태는 세션 UI이며 새 설정 저장소/의존성을 추가하지 않는다.

## ADR-021 — 2026-10-29: AI 패널의 로컬 저장 쿼리 호출

사용자의 다음 작업 지시로 남은 저장 쿼리 대화창 호출을 구현한다. `매출` 같은 정확한 이름·별칭, `매출 조회해줘`/`매출 실행해줘`, `저장 쿼리 매출 실행`, `/조회 매출`을 지원한다. 이름 비교·연결 ID+DB 범위는 ADR-019를 재사용하며, 문장 자체 이름과 명령에서 추출한 이름이 서로 다른 쿼리에 해당하면 거부한다. 명시적 `/조회`/`저장 쿼리` 요청의 미일치·부분 일치·타 DB 이름은 로컬 오류다. 그 밖의 저장 이름이 아닌 문장은 기존 AI 대화로 남긴다.

매번 Main 저장소에서 목록을 새로 읽고 현재 SQL 탭에 저장 SQL을 그대로 불러온다. 조회 대기 중 탭/연결 바인딩/편집 내용 변경을 검사하고, Main review가 반환한 DB가 저장 범위와 다른 경우 execute를 호출하지 않는다. SELECT는 기존 `SqlWorkspace.run`의 review→execute, 일회성 토큰/세대/상한/취소/결과·이력을 재사용한다. 새 IPC·MCP 도구·SQL 실행 브리지는 없다. 저장된 쓰기도 Main의 SELECT review가 거부하며 mutation preview/apply/commit을 자동 호출하지 않는다. 쓰기는 SQL 작업 공간에서 기존 검토 경로를 따라야 한다.

저장 쿼리 명령은 provider에 보내지 않으며 CLI 설치·로그인·메타데이터 공유 없이 로컬에서 동작한다. SQL/결과/이름 목록을 AI 프롬프트에 삽입하지 않는다. AI가 생성한 제안은 기존대로 새 탭에만 열리고 자동 실행하지 않는다. 값 보간·파라미터·유사 이름 추론·다중 문장 원자 변경은 이번 범위가 아니다.

## ADR-020 — 2026-10-28: 결과 "더 불러오기" 페이지

한 번의 결과 상한(연결 최대 행·최대5000행·4 MiB)은 유지하고, 잘린 결과는 Main이 발급하는 일회성 continuation 토큰으로 다음 페이지를 받는다. 파서가 `OFFSET n ROWS FETCH NEXT m ROWS ONLY`를 지원하며 페이지 SQL에서는 TOP을 쓰지 않는다. 순서는 사용자 ORDER BY, 없으면 단일 테이블·비집계일 때만 PK 순서를 첫 페이지부터 붙인다. JOIN/GROUP BY/DISTINCT/집계에 ORDER BY가 없거나 사용자 OFFSET이 있으면 토큰을 발급하지 않는다. 토큰은 연결 세대·엑셀 등록 revision·10분 만료에 묶이고 재사용·재접속 후 거부된다(최대50개). 사용자 TOP은 페이지 합계 상한이다. Renderer는 같은 탭에 최대100,000행까지 이어 붙인다. 페이지 사이 데이터 변경이나 고유하지 않은 ORDER BY는 행 중복/누락을 만들 수 있다(스냅샷 일관성 없음). 파일 내보내기는 미구현이다.

## ADR-019 — 2026-10-28: 저장 쿼리 이름·별칭 호출

SQL 탭 위 입력칸에서 "이름, 별칭1, 별칭2"로 현재 SQL을 저장하고, 이름이나 별칭으로 불러와 실행한다. 범위는 탭의 연결 ID + 현재 DB다. 이름은 NFC·공백 정리·대소문자 무시 후 **정확히 일치**할 때만 찾고(`resolveSavedQuery`), 없거나 여러 개면 실행하지 않는다. 부분 일치나 유사도 추측은 하지 않는다. 같은 범위에서 이름·별칭 중복 저장은 거부한다(`assertUniqueQueryNames`). 값 보간·파라미터는 없다. 저장된 SQL을 탭에 넣고 SELECT면 기존 경로(ADR-017, Main 파싱·상한 그대로)로 실행하며, 쓰기 SQL은 불러오기만 하고 기존 미리보기·COMMIT 흐름을 따른다. 저장소는 `database.db`의 `saved_queries`(평문, 최대200개)이며 SQL 탭·이력과 같은 평문 경계다. 당시 범위 밖이던 AI 패널 이름 호출은 ADR-021로 추가했다.

## ADR-018 — 2026-10-28: 엑셀 임시 테이블 JOIN UPDATE/INSERT 실행

사용자 결정: UPDATE JOIN과 INSERT SELECT를 지원하고 상한을 1000행으로 올린다. 새 실행 경로를 만들지 않고 기존 개발 전용 쓰기 흐름(미리보기 → SERIALIZABLE 적용 → DB 이름 확인 COMMIT, 30초 자동 rollback)에 문법만 추가한다. 원문 SQL을 실행하지 않고 파서가 렌더링한 SQL만 실행한다. stage 참조는 파서에서 세션 `#stage_...`로 렌더링하며, 미리보기는 rollback 전용 트랜잭션, 적용은 쓰기 트랜잭션에 각각 적재한다. 등록된 stage 데이터는 변경 불가이며 그 digest를 메타데이터 해시에 묶는다.

UPDATE는 기존 rowversion 집합 검증을 재사용하고 다중 일치를 거부한다. INSERT는 rowversion이 없어 삽입 행 digest와 행 수를 잠금 재조회(LEFT JOIN 대상에 UPDLOCK,HOLDLOCK)로 재검증한다. TRY_CONVERT 실패·빈 값과 문자열이 아닌 열로의 원문 텍스트 암묵 변환은 미리보기에서 거부한다. 상한은 plain UPDATE/DELETE에도 같은 1000행을 적용한다(`mutationRowLimit`). 정책 버전은 `mssql-mutation-v2`다. 실패 사유는 `MutationState.detail`로 표시하며 드라이버 오류는 기존 `databaseError` 수준으로만 노출한다. MERGE·DELETE JOIN·다중 문장 원자 실행·계산식은 범위 밖이다.

## ADR-017 — 2026-10-28: SELECT 별도 승인 화면 제거

사용자 요청으로 쿼리 실행/Ctrl+Enter가 검토 모달 없이 바로 결과를 보여준다. 위험 SQL을 막는 것은 사람의 클릭이 아니라 Main 정책이므로 Main 계약은 바꾸지 않았다. Renderer가 `reviewQuery`→`executeQuery`를 연속 호출하고, Main은 여전히 제한 SELECT 파싱/정규화, 60초 일회성 토큰의 연결·세대 바인딩, 재파싱 일치, 동시 실행1개, timeout·행/바이트/열/셀 상한, 이력을 적용한다. 원문 SQL을 받는 새 실행 IPC는 추가하지 않았다. 완화 범위는 SELECT뿐이며 UPDATE/DELETE 미리보기·적용·DB 이름 확인 COMMIT은 그대로다. AI 제안은 계속 새 SQL 탭에만 열리고 자동 실행되지 않는다.

## ADR-016 — 2026-10-28: 업무 비종속 엑셀 임시 데이터와 SQL 생성

사용자의 최신 정정은 정산 전용 기능이 아니라 **임의 엑셀 업로드 → 임시 테이블 → 자연어로 활용 방법 지시 → SQL 생성**이다. 중간에 만든 정산 컬럼 매핑/기간 분할/전용 commit 서비스와 UI는 제거한다. 업무 규칙은 코드에 고정하지 않는다.

파일 접근은 Main native picker/고정IPC로 제한하고 새 XLSX 의존성 없이 Windows의 고정 PowerShell/.NET ZIP·XML 파서를 사용한다. 파일명·셀 값으로 명령문을 조합하지 않는다. Main memory-only SQLite에 원본을 보관하고 연결별 immutable registry에서 논리 `import.stage_<32hex>` 참조만 소유한다. 기존 실제 import 스키마의 다른 테이블은 숨기지 않는다.

SQL Server #temp는 SELECT마다 짧은 transaction으로 한 물리 연결을 고정하여 batch CREATE/단일파라미터 OPENJSON 적재/파서 FROM·JOIN 치환/조회/rollback한다. 세션이 불확실하면 연결을 폐기한다. 전역 ##temp, 사용자 DB 영구 staging, 범용 SQL/DDL IPC는 만들지 않는다. 명시적 메타데이터 공유만 기존 MCP로 전달하고 Excel 셀은 공유하지 않는다.

AI는 기본 제한 SELECT 제안을 만들며, 사용자가 요청한 수정·추가·복잡한 SQL도 명시적 draft=true 초안으로 표시할 수 있다. 초안은 미검증/미실행이며 기존 DB 실행 정책이나 쓰기 승인을 우회하지 않는다. 제한 TRY_CONVERT AST는 텍스트 임시 컬럼의 숫자/날짜 조회를 지원하지만 기존 mutation 문법을 넓히지 않는다. 실제 값의 Number 표시 정밀도, SELECT 승인 제거/저장 쿼리, 범용 쓰기 실행은 별도 남은 범위다. 구현/사용·제약/증거는 EXCEL_IMPORT.md를 따른다.

## ADR-015 — 2026-10-28: 기본 한국어 UI와 표시 경계 번역

사용자 한글화 요청에 따라 기본 UI를 한국어로 제공한다. 추가 i18n 의존성/언어 선택 설정 없이 기존 화면의 고정 문구와 접근성 이름을 번역하고 상태 표시 사전을 사용한다. IPC·내부 enum·SQL·사용자 콘텐츠·기존 저장소/이력은 유지한다. 알려진 Main 오류/영어 이력은 Renderer 경계에서 번역해 이전 기록과 호환하고, 알 수 없는 외부 진단·AI 답변은 원문을 보존한다. COMMIT/rollback/unknown/미확정 변경을 같은 성공 문구로 합치지 않는다.

Monaco는 설치된0.57.0의 로컬 한국어 리소스를 먼저 로드하고 AG Grid는 localeText로 적용한다. HTML/Chromium/Zod도 한국어를 사용하되 CSP/worker/격리/승인·DB·CLI 정책은 바꾸지 않는다. 근거·번역 용어·검증 파일은 LOCALIZATION.md를 따른다. 기존 데이터 일괄 치환이나 새 실행 기능 추가는 하지 않는다.

## ADR-014 — 2026-10-28: Codex0.165.0 제한 실행 재검증과 실제 DB MCP 수용

설치된 공식 CLI가0.165.0으로 변경돼 기존0.164.0 pin이 요청을 거부했다. 공식 [non-interactive 문서](https://learn.chatgpt.com/docs/non-interactive-mode), [MCP 설정](https://learn.chatgpt.com/docs/extend/mcp), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference)와 로컬0.165.0 exec/resume help·features를 확인했다. 실제 ChatGPT 텍스트 start/resume, MCP fixture 조회·제안·재개, 실제 DB를 사용하는 Electron 전체 경로를 검증하고 정확한 지원 버전을0.165.0으로 갱신한다. 0.164.0/0.166.0 등 다른 버전은 재검증 전 거부한다.

기존 ignore-user-config/ignore-rules/read-only/approval never/강제 ChatGPT·OpenAI, 최소 환경, metadata 공유 시에만 ai_db의 지정7개 도구/code_mode_host, 나머지 도구 비활성 정책은 유지한다. 사용자 설정/인증 토큰 파일을 변경·복제하지 않고 API fallback/임의 실행 경로/모델 자동 대체/새 의존성을 추가하지 않는다.

새 실DB UI 수용 테스트는 준비용 db_owner와 SELECT-only 앱 계정을 분리하고, 프롬프트에 제공하지 않은 무작위 테이블·컬럼을 MCP로 발견해 제안하는지 확인한다. 제안/새 탭/검토 전후 자동 실행이 없고 별도 승인 때만 실제 값·이력이 생기는지 검증한다. 재현/실행 증거는 MCP_TESTING.md의2026-10-28 항목이다. Claude/SHOWPLAN/Production TLS/네트워크 장애 수용/Phase 6로 범위를 넓히지 않는다.

## ADR-001 — 2026-10-27: Phase 1만 실행

전체 제품 구조는 문서로 남기고 DB 드라이버·CLI·MCP 실제 실행은 후속 Phase로 미룬다. 성공을 가장하는 Mock 연결을 만들지 않는다. UI 빈 상태가 실제 상태다.

## ADR-002 — Electron Main 경계

격리된 renderer + sandbox CJS preload + 고정 메서드 IPC를 선택했다. Main은 sender/URL/frame과 Zod 입력을 검증한다. 편의를 위한 범용 invoke/shell/file API는 만들지 않는다.

## ADR-003 — SQLite 환경설정

사용자 스택의 SQLite를 better-sqlite3로 구현한다. 네이티브 ABI는 electron-builder install-app-deps로 맞춘다. 일반 Node와 Electron ABI가 다르므로 저장소 통합 테스트는 Electron 프로세스에서 수행한다. 비밀정보는 후속 단계에서 OS backed safeStorage로 암호화하고 암호화 불가 시 저장 거부한다.

## ADR-004 — 빌드/상태/렌더러

electron-vite는 외부 서버 프레임워크 없이 세 프로세스의 Vite 빌드를 제공한다. Zustand는 편집 UI, TanStack Query는 IPC 비동기 읽기, Main은 설정 저장을 소유한다. Monaco/worker를 로컬 번들링하고 Community AG Grid만 사용한다. shadcn Button은 소스 소유 패턴으로 유지한다.

## ADR-005 — 구독 인증은 보수적으로 검증

직접 API SDK/키 입력 UI 없음. CLI 설치/인증/정책 검사 후에만 요청한다. API 키 환경변수를 자식에 전달하지 않고 API 인증 저장 상태도 검사한다. 구독 OAuth 통합 허용이 확인되지 않으면 비활성화하며 API 자동 fallback 없음. 각 CLI 기능 문서는 제3자 앱 인증 사용 권한을 보장하지 않는다.

다음은 초기 조사 기록이며 최신 정책 확인은 ADR-011로 갱신했다. 공식 [Claude 정책](https://code.claude.com/docs/en/legal-and-compliance)의 Authentication and credential use 확인 결과, 제3자 앱이 사용자를 대신해 Free/Pro/Max credentials로 요청을 중계하는 것은 허용되지 않는다. 요청된 Claude Pro 연동은 지원 대상으로 단정하지 않고 기본 비활성으로 유지한다. Phase 3에서 허용 범위를 다시 확인한다. Phase 1 provider 선택은 환경설정 UI일 뿐 어떤 CLI도 호출하지 않는다.

## ADR-006 — 2026-10-27: MSSQL 읽기 실행을 먼저 제공

Phase 2는 SQL Server 인증/명시 포트/TLS 연결을 구현한다. 연결마다 독립 mssql ConnectionPool을 소유하며, DB 변경은 기존 pool 종료 후 새 DB로 연결하고 권한을 다시 검사한다. Windows 통합 인증/이름 있는 인스턴스 자동 탐색은 아직 제공하지 않는다. PostgreSQL/MySQL은 Phase 6 범위다.

## ADR-007 — 추가 파서 의존성 없는 제한 문법

현재 승인 범위에서 새 SQL 파서 패키지를 추가하지 않고, lexer → expression AST → SELECT 구조 분석 → 정규화 SQL 생성의 작은 양성 허용 문법을 구현했다. 원문은 DB로 전달하지 않는다. 단일 SELECT, AS 별칭, schema.table, JOIN, WHERE, GROUP/HAVING/ORDER와 허용한 내장 함수만 지원한다. 쓰기/배치/변수/CTE/서브쿼리/UNION/힌트/UDF/외부 소스는 기본 거부한다. 이는 완전한 T-SQL 파서가 아니며 SQL 호환성보다 거부 기본값을 우선한다. Phase 5에서 확장 전략을 다시 결정한다. 정규식은 토큰 문자 분류에만 사용한다.

## ADR-008 — 승인과 실제 권한을 함께 검사

Main의 review가 정규화 SQL과 60초 일회성 token을 만든다. token은 연결 세대와 SQL 객체에 묶이고 실행 때 원문을 다시 파싱해 일치 여부를 확인한다. 재접속/단절/종료 시 무효화한다. UI의 별도 승인 후에만 실행한다. 운영 연결은 fn_my_permissions의 서버/DB/스키마/객체 유효 권한을 읽기 허용 목록과 비교하고, 실패/쓰기/EXECUTE/관리 권한이 있으면 연결과 실행을 거부한다. 개발 계정은 초과 권한 경고와 앱 정책을 적용한다. 검사 오류를 읽기 전용 성공으로 처리하지 않는다. 외부 DBA의 권한/객체 변경까지 원자적으로 잠그는 보장은 없으며, 전용 SELECT 계정 운용이 필수다.

## ADR-009 — 연결 프로필과 비밀번호를 OS 암호화

Electron 45의 async safeStorage를 사용한다. 연결의 호스트/사용자/DB 등 프로필과 비밀번호를 각각 BLOB로 저장하고 평문 fallback은 금지한다. Main 시작 시 프로필만 복호화 캐시하고 비밀번호는 연결할 때 복호화한다. Renderer에는 비밀번호가 반환되지 않는다. SQL 탭/이력은 평문으로 유지하므로 비밀값을 SQL에 넣지 않는다. 암호화는 같은 OS 사용자 권한으로 실행되는 악성 앱을 방어하는 경계가 아니다.

## ADR-010 — 결과와 실행 자원에 상한

SELECT TOP을 설정 maxRows+1 이하로 생성하고, mssql arrayRowMode stream에서 행 수/4 MiB 결과/256열을 제한한다. 제한 도달 시 드라이버를 cancel하고 잘린 결과임을 표시한다. Tedious textsize=16384로 큰 LOB의 전송을 제한하고 셀 표시를 8192문자/바이너리2048바이트로 제한한다. 이 제한은 원문 전체 데이터 export 기능이 아니다. UI는 최근 5개 탭 결과만 보유하고 AG Grid 페이지/가상화를 쓴다. 요청별 AbortController와 제한시간, 연결별 동시 쿼리 1개, 종료 전 취소·pool/transaction 정리를 적용한다. 트랜잭션 메서드는 어댑터 내부에만 있고 쓰기/commit IPC는 Phase 5 전 노출하지 않는다.

## ADR-011 — 2026-10-27: Phase 3 CLI 경계와 최신 인증 정책

사용자 지시로 Phase 3만 구현한다. 공식 Codex CLI 0.164.0/native 실행 파일과 ChatGPT login status를 확인한 뒤 exec를 사용한다. API 키 환경/CLI API 인증은 거부하고 forced_login_method=chatgpt로 요청 인증도 제한한다. 다른 버전은 안전한 실행 계약을 재검증하기 전 비활성이다. 앱은 OAuth 토큰을 직접 읽거나 복사하지 않고 공식 CLI가 기존 인증을 사용한다. 자동 API 과금 대체는 없다.

사용자 config/rules를 무시하고 별도 앱 작업 폴더에서 read-only/approval never와 셸·hooks·plugins·apps·브라우저·멀티에이전트·Code Mode 제한을 적용한다. 전역 MCP를 상속하지 않으며 Phase 4 전 DB 도구는 없다. 사용자 메시지만 stdin으로 전달하고 SQL 탭/스키마/DB 자격 증명을 포함하지 않는다. Main이 생성된 provider 세션을 소유하고 Renderer 입력으로 임의 세션/인자/실행 경로를 받지 않는다. 취소/실패 세션은 앱에서 재개하지 않는다. 새 대화는 Main 참조를 지우지만 공식 CLI의 기존 기록을 삭제하지 않는다.

ADR-005의 Claude 인증 정책 기록은 당시 조사 내용이다. 이번 최신 [공식 legal](https://code.claude.com/docs/en/legal-and-compliance)은 제품 내 원본 CLI 실행을 Commercial Terms 준수 등 조건 아래 설명하며, 인증 수단 제한을 금지한다. 과거의 일률적 Free/Pro/Max 제3자 금지를 현재 사실로 반복하지 않는다. 다만 이 앱의 상업 약관 준수와 안전한 구독 격리 경로는 검증되지 않았다. [headless](https://code.claude.com/docs/en/headless)의 bare 모드는 구독 로그인을 사용하지 않아 이 앱의 대안이 아니다. 따라서 Claude 실행/인증 탐지는 비활성(설치 여부는 미확인)이고 -p JSONL 파서만 offline 테스트한다. 활성화·API 전환은 별도 결정 대상이다.

근거: [Codex non-interactive](https://learn.chatgpt.com/docs/non-interactive-mode), [auth](https://learn.chatgpt.com/docs/auth), [config reference](https://learn.chatgpt.com/docs/config-file/config-reference), 로컬 0.164.0 help/version/login status와 실제 구독 start/resume 검증. CLI 사용자 세션 기록에는 메시지가 평문으로 남을 수 있고 앱의 새 대화는 이를 삭제하지 않는다.

## ADR-012 — 2026-10-27: Phase 4의 메타데이터 전용 capability MCP

사용자 승인으로 Phase 4의 지원 경로만 구현한다. 추가 SDK/패키지 없이 기존 Zod와 Node stdio/local IPC로 제한 MCP 하위 집합을 제공한다. 서버는 stdin/stdout relay이며 실제 DB 권한은 Electron Main의 연결 세대·DB scope에 남긴다. TCP/HTTP 포트는 없고 임시 named pipe/Unix socket과 무작위256-bit capability를 턴별로 만들고 폐기한다. Renderer/argv/설정 저장소에는 capability를 전달하지 않는다. 같은 OS 사용자의 악성 프로세스 방어를 보장하지 않는다.

사용자의 명시적 메타데이터 공유 선택이 있어야 연결 scope를 연다. 전역 MCP를 상속하지 않고 ai_db의 지정7개 도구만 enabled_tools로 제공한다. 메타데이터는 untrusted data이며 크기·시간·횟수/캐시 예산이 있다. 범위가 바뀌면 새 CLI 세션으로 시작하고 같은 범위 재개도 새 capability를 사용한다. 실제 0.164.0에서 표준 _meta와 code_mode_host가 필요함을 확인했다. scoped 요청에서만 host를 켜되 code_mode/셸/hooks/plugins/apps/쓰기 제한은 유지한다.

SQL 제안은 기존 제한 SELECT 파서로 정규화하고 참조 테이블을 확인한 뒤 새 탭에 표시한다. 자동 실행/승인 토큰/쓰기 도구는 없다. 오류 분석은 사용자 검토 가능한 입력 복사와 명시적 전송이다. 실제 SHOWPLAN 권한/세션 상태 격리를 검증하지 않아 db_explain_query는 supported:false와 정적 정책 분석만 반환한다. 서버 계획 조회로 가장하지 않는다. Claude는 이전 미지원 상태를 유지하며 fixture를 실제 CLI 성공으로 보고하지 않는다.

근거와 정확한 수용 갭은 MCP_TESTING.md. Phase 5 위험 SQL/트랜잭션을 자동 시작하지 않는다.

## ADR-013 — 2026-10-27: Phase 5 개발 전용 제한 쓰기와 이중 승인

2026-10-28 검증 업데이트: 사용자 승인된 로컬 MSSQLSERVER01을 혼합 인증/loopback TCP14331로 구성하고 준비용 db_owner와 최소 권한 앱/읽기 계정을 분리해 실제 DB·Electron 수용을 통과했다. 직접 rowversion→varchar 변환 실패를 발견해 명시적인 binary(8)→16진수 varchar 변환을 preview/OUTPUT에 동일 적용했다. 회귀 테스트 실패→수정 후 unit182개/실DB 포함 integration6개/Electron7개 통과를 확인했다. Production 쓰기/인증 정책을 완화하거나 Windows 통합 인증·새 의존성을 추가하지 않았다. 초기 구현 때의 아래 미실행 기록은 WRITE_TESTING.md/LIVE_VALIDATION.md의 최신 증거로 갱신한다.

새 의존성 없이 기존 lexer/식 AST를 재사용해 단일 테이블 UPDATE/DELETE 전용 문법을 추가한다. 복잡한 T-SQL/DDL/배치/함수·SET 계산식은 미지원이다. WHERE 누락과 DROP/TRUNCATE는 경고 후 거부한다. 일반 SELECT 실행 브리지를 쓰기 실행으로 넓히지 않고 별도 고정 DTO/IPC를 사용한다.

readOnly 기본true/운영 SELECT-only를 유지하며 개발 프로필의 명시적 opt-in만 허용한다. PK+NOT NULL rowversion, 메타데이터 VIEW DEFINITION/SELECT/해당 DML 권한과 보수적인 테이블 기능 검사가 필요하다. 지원하지 않는 트리거/연쇄 작업/CHECK/RLS/계산·hidden/generated·마스킹·암호화·UDT·LOB 등을 거부하고 자동 권한/스키마 변경을 하지 않는다.

UI 판단 동안 잠금을 유지하는 대안 대신 낙관적 rowversion 미리보기를 선택한다. 적용 시 같은 SERIALIZABLE 트랜잭션에서 UPDLOCK/HOLDLOCK으로 대상과 메타데이터를 다시 읽고, 버전 집합/SQL/스키마 fingerprint가 같은 경우에만 Main이 생성한 version-IN/OUTPUT guard 문장을 실행한다. SHA-256 승인은 정책·연결 세대·DB·실제 SQL·메타데이터·대상에 묶인다.

적용과 COMMIT은 별도 단계다. COMMIT에는 새 토큰과 정확한 DB 이름 확인을 요구하고 idle30초/취소/오류/단절/종료는 rollback한다. rollback 요청 직후 COMMIT은 금지한다. 이미 제출한 COMMIT과 rollback은 경쟁시키지 않는다. ack가 불명확하면 unknown이며 자동 재시도하지 않는다. 종료된 트랜잭션의 pool/session은 폐기해 isolation/session 누수를 피한다. 이력 저장 실패를 DB commit 실패로 오인하지 않는다.

새 패키지/AI 쓰기 도구는 없다. 실제 위험 SQL 검증은 별도 승인된 전용 DB/fixture가 필요하고 이번에는 실행하지 않았다. 구현·대역 테스트와 실DB 수용은 WRITE_TESTING.md/TASKS.md에서 분리한다.
