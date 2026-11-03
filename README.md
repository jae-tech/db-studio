# AI DB Studio

**AI DB Studio**는 SQL Server를 조회하고 데이터를 살펴보기 위한 로컬 데스크톱 앱입니다. Electron·React로 만들었으며, 화면의 기본 언어는 한국어입니다. 데이터베이스 연결, SQL 편집, 결과 탐색, 엑셀 가져오기와 AI 보조 기능을 한 작업 공간에서 제공합니다.

> 현재 지원 DBMS는 **Microsoft SQL Server**입니다. PostgreSQL·MySQL, Windows 통합 인증, 임의의 T-SQL 실행은 지원하지 않습니다.

## 주요 기능

- **연결과 탐색**: SQL Server 연결을 저장하고 데이터베이스·스키마·테이블·열·인덱스·외래 키를 살펴봅니다. 연결 그룹과 테이블 검색을 지원합니다.
- **SQL 편집**: Monaco 편집기에서 키워드·함수·테이블·열을 자동완성합니다. 접근 가능한 같은 서버의 다른 DB도 `DB.스키마.테이블`과 테이블 별칭의 열까지 완성합니다. 맨 앞에 테이블 이름만 입력해 `Ctrl+Space`로 완성하면 `SELECT * FROM`을 붙입니다.
- **조회 결과**: 결과 표는 TanStack Table·Virtual로 정렬·필터·페이지 이동·열 크기 조절을 제공합니다. 정렬과 필터는 **현재 불러온 행**에만 적용됩니다. CSV·XLSX로 결과 SQL을 다시 실행해 파일로 내보낼 수도 있습니다.
- **제한 쓰기**: 연결별로 명시적으로 허용한 경우에만 제한된 `UPDATE`·`DELETE`·`INSERT`를 미리보기 → 적용 → 별도 확정(COMMIT) 절차로 처리합니다. 실제 가능 여부는 DB 계정 권한과 대상 테이블의 안전 조건에 따릅니다. 기본 연결은 읽기 전용입니다.
- **엑셀과 가상 관계**: XLSX 시트를 로컬 임시 테이블로 가져와 조회·JOIN에 활용하고, DB 스키마를 바꾸지 않는 가상 관계를 저장합니다.
- **AI 보조**: 공식 Codex 또는 GitHub Copilot CLI의 로그인 상태를 확인해 대화와 SQL 제안을 사용합니다. 저장 쿼리는 이름으로 로컬 호출할 수 있습니다. API 키 과금 방식으로 자동 전환하지 않습니다.
- **화면 설정**: shadcn/ui 소스 소유 컴포넌트와 Tailwind 기반 화면, 다크·라이트별 에메랄드·오션·바이올렛·앰버 팔레트, 글자 크기·패널 위치·SQL 포맷 설정을 제공합니다.

## 시작하기

Windows x64 개발 환경을 우선 지원합니다. Node.js **22.12 이상**과 **pnpm 11.5.2**가 필요합니다. 개발용 Vite 서버 외에 별도 API 서버는 필요하지 않습니다.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

앱에서 SQL Server 연결을 만들고 계정·DB·TLS 설정을 입력한 뒤 연결하세요. 서버와 계정은 사용자가 직접 준비해야 합니다. 비밀번호를 저장소나 SQL 탭에 넣지 마세요. 설치 파일 생성 명령은 `pnpm dist:win`이지만, 배포·서명·설치 수용 검증은 아직 남아 있습니다.

### 자주 쓰는 조작

| 동작                          | 방법                         |
| ----------------------------- | ---------------------------- |
| 새 SQL 탭                     | `Ctrl+N`                     |
| 현재 문장 또는 선택 영역 실행 | `Ctrl+Enter`                 |
| 모든 문장 순서대로 실행       | `Alt+X`                      |
| SQL 자동완성                  | `Ctrl+Space` 또는 `.` 입력   |
| SQL 정리                      | `Alt+Shift+F`                |
| SQL 탭 이름 변경              | 탭 제목 두 번 클릭 또는 `F2` |

`Ctrl+Enter`는 커서가 있는 문장만 실행합니다. `Alt+X`는 `;` 또는 빈 줄로 나뉜 문장을 차례로 실행하고 결과 탭을 만듭니다. SQL은 제한된 문법으로 분석·재구성한 뒤 실행하므로 CTE·서브쿼리·저장 프로시저·DDL 등 임의의 T-SQL을 실행하는 도구는 아닙니다. 다른 DB에 대한 **직접 작성 SELECT**는 지원하지만 다른 DB 쓰기와 AI 메타데이터 조회는 지원하지 않습니다.

## 데이터와 권한

- 연결 정보와 비밀번호는 OS 암호화를 거쳐 로컬 SQLite에 저장합니다. 암호화를 사용할 수 없으면 평문으로 저장하지 않습니다.
- **SQL 탭 내용과 쿼리 이력은 평문으로 로컬 저장**됩니다. SQL에 비밀번호나 토큰을 적지 마세요.
- AI 메시지를 보내면 연결된 **현재 DB의 제한된 테이블·열 메타데이터를 자동 공유**합니다. 연결만 선택해도 AI가 호출되지는 않으며, 결과 행·엑셀 셀·접속 비밀번호는 자동 전송하지 않습니다. AI가 제안한 SELECT는 앱 정책 검증을 통과하면 별도 탭에서 자동 실행되고, 쓰기는 미리보기와 별도 확정 절차를 거칩니다.
- 쓰기 허용은 계정 권한을 대체하지 않습니다. 특히 운영 데이터에 쓸 수 있는 연결에서는 미리보기와 확정 내용을 신중히 확인하세요.
- CSV 값이 `=` 등으로 시작하면 스프레드시트에서 수식으로 해석될 수 있습니다. 신뢰할 수 없는 데이터는 XLSX 내보내기를 권장합니다.

## 개발 및 검증

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm test:db
pnpm format:check
```

`pnpm test:e2e`는 Electron GUI가 필요합니다. `pnpm test:db`와 실제 DB·AI E2E 사례는 전용 환경변수와 계정이 없으면 건너뜁니다. 대역 테스트 통과를 실제 SQL Server·AI 계정 검증 완료로 해석하지 마세요. 다른 DB 자동완성의 실제 SQL Server 카탈로그 검증, 운영 TLS 환경과 배포 수용 등은 남아 있습니다.

## 더 알아보기

- [개발 규칙과 실행 환경](docs/DEVELOPMENT.md) · [현재 진행 상황](docs/PROGRESS.md) · [남은 작업](docs/TASKS.md)
- [SQL Server 연결·조회](docs/MSSQL_TESTING.md) · [제한 쓰기](docs/WRITE_TESTING.md) · [엑셀 가져오기](docs/EXCEL_IMPORT.md)
- [AI CLI](docs/AGENT_TESTING.md) · [AI 메타데이터 도구](docs/MCP_TESTING.md) · [SQL 포맷](docs/SQL_FORMATTING.md)
- [가상 관계](docs/VIRTUAL_RELATIONSHIPS.md) · [설계 결정](docs/DECISIONS.md)
