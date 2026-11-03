# SQL 작성 스타일과 포맷 설정

기본 스타일은 사용자 예시를 따른다. 일반 영문 테이블·컬럼·별칭의 불필요한 `[]`를 제거하고, SELECT는 앞쪽 쉼표, 대문자 키워드, 4칸 들여쓰기, JOIN의 ON 위치 정렬, AND/OR 줄바꿈을 사용한다. 식별자의 대소문자는 바꾸지 않는다.

- 편집기 툴바 **SQL 정리**(마법봉 아이콘) 또는 **Alt+Shift+F**: 현재 탭을 정리한다. 실행하지 않는다. 단축키 편집은 Monaco undo로 되돌릴 수 있다.
- **SQL 포맷 설정**(설정 아이콘): 키워드 대소문자, 쉼표 앞/뒤, 들여쓰기 2/4/8칸, JOIN ON 정렬, AND/OR 줄바꿈, 대괄호 최소화/원문 유지의 6개 설정과 실시간 미리보기를 제공한다.
- 설정은 기존 비밀 없는 SQLite preferences에 저장되고 재시작 후 복원된다. 기본값/취소/Escape를 지원한다. 설정 저장만으로 기존 탭·저장 쿼리·이력을 일괄 변경하지 않는다.
- AI SQL 제안 카드·새 제안 탭·테이블 상세의 SELECT 생성에 적용한다. 선택 DB를 공유하는 AI 요청에도 검증된 스타일 값만 전달한다. SQL 탭이나 결과를 스타일 정보와 함께 자동 전송하지 않는다.

## 식별자와 안전 경계

[SQL Server 식별자 규칙](https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers?view=sql-server-ver17)과 [예약어](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/reserved-keywords-transact-sql?view=sql-server-ver17)에 따라 공백·특수문자·예약어 이름의 인용은 유지한다. 현재 앱 실행 파서가 영문 regular identifier를 지원하므로 한글 이름도 대괄호를 유지한다. 이는 SQL Server 자체가 한글 이름에 항상 대괄호를 요구한다는 뜻이 아니다. 인용된 함수 이름과 따옴표의 의미가 불확실한 경우도 임의로 인용을 제거하지 않는다.

포맷터는 표시/편집용 lexer이며 SQL 실행 파서나 검증기가 아니다. 문자열·숫자·주석·변수의 값과 GO 배치 구분을 보존한다. 닫히지 않은 문자열/주석/괄호·과도한 중첩·알 수 없는 lexical form·200KB 크기 제한은 정리를 거부한다. 수동 정리는 원문을 그대로 두고 오류를 알린다. AI의 미지원 초안은 원문을 표시/열되 정리 실패를 명시적으로 알린다. 조용한 손상이나 실행 fallback은 없다.

Main은 기존 AST의 안전한 대괄호 인용과 정규화 SQL·승인 토큰/쓰기 해시를 그대로 사용한다. 표시에서 대괄호를 줄여도 Main의 SQL 정책은 완화되지 않는다. 사용자 예시의 `@userId`/`@dataTableKey`, 3부분 객체명, 암시적 별칭 등을 **포맷할 수 있다는 것**이 앱에서 해당 SQL을 실행하거나 변수 값을 자동 바인딩할 수 있다는 의미는 아니다. 실행 지원 문법은 MSSQL_TESTING/WRITE_TESTING 문서가 기준이며 새 임의 SQL/DDL/파일 IPC는 없다.
