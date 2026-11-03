import { tw } from '@/lib/styleClasses'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { useEffect, useRef, useState } from 'react'
import {
  defaultSqlFormatting,
  formatSql,
  inferSqlFormatting,
  type SqlFormatting,
} from '@shared/sqlFormatting'
import { useWorkspace } from '../store'
import { Button } from './ui/button'

const example =
  'select [fp].[presetId], [fp].[userId], fp.filterName from Athena.dbo.FilterPreset fp inner join Athena.dbo.Users u on u.id=fp.userId inner join Athena.dbo.Users currentUser on currentUser.id=@userId where fp.isShared=1 and (u.agentId=currentUser.agentId or fp.userId=@userId) order by fp.createdAt desc;'

const preview = (sql: string, format: SqlFormatting): string => {
  try {
    return formatSql(sql, format)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export function SqlFormattingDialog({ onClose }: { onClose: () => void }) {
  const { settings, update, notify } = useWorkspace()
  const [format, setFormat] = useState(settings.sqlFormatting)
  const [sample, setSample] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    // No close() on cleanup: StrictMode's dev re-run would fire `close` → onClose
    // and dismiss the dialog right after opening. Unmount removes it anyway.
    const element = dialog.current!
    if (!element.open) element.showModal()
  }, [])
  const change = (patch: Partial<SqlFormatting>) =>
    setFormat((current) => ({ ...current, ...patch }))
  return (
    <dialog
      ref={dialog}
      className={tw('modal sql-format-dialog')}
      aria-labelledby="sql-format-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <h2 id="sql-format-title">SQL 포맷 설정</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          update({ sqlFormatting: format })
          notify(
            'SQL 포맷 설정을 저장했습니다. 새 쿼리 생성과 SQL 정리에 적용합니다.',
          )
          onClose()
        }}
      >
        <label className={tw('sql-format-sample')}>
          내 스타일 예시 쿼리
          <Textarea
            aria-label="내 스타일 예시 쿼리"
            rows={5}
            spellCheck={false}
            placeholder="평소 쓰는 형태로 정리된 쿼리를 붙여넣으면 그 스타일에 맞게 설정을 고릅니다."
            value={sample}
            onChange={(event) => setSample(event.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={!sample.trim()}
          onClick={() => {
            try {
              setFormat(inferSqlFormatting(sample))
            } catch (error) {
              notify(error instanceof Error ? error.message : String(error))
            }
          }}
        >
          예시에서 설정 추론
        </Button>
        <div className={tw('form-grid')}>
          <label>
            키워드 대소문자
            <NativeSelect
              aria-label="키워드 대소문자"
              value={format.keywordCase}
              onChange={(event) =>
                change({
                  keywordCase: event.target
                    .value as SqlFormatting['keywordCase'],
                })
              }
            >
              <option value="upper">대문자 (SELECT)</option>
              <option value="lower">소문자 (select)</option>
              <option value="preserve">원문 유지</option>
            </NativeSelect>
          </label>
          <label>
            쉼표 위치
            <NativeSelect
              aria-label="쉼표 위치"
              value={format.commaStyle}
              onChange={(event) =>
                change({
                  commaStyle: event.target.value as SqlFormatting['commaStyle'],
                })
              }
            >
              <option value="leading">줄 앞</option>
              <option value="trailing">줄 뒤</option>
            </NativeSelect>
          </label>
          <label>
            들여쓰기
            <NativeSelect
              aria-label="들여쓰기"
              value={format.indentWidth}
              onChange={(event) =>
                change({
                  indentWidth: Number(
                    event.target.value,
                  ) as SqlFormatting['indentWidth'],
                })
              }
            >
              {[2, 4, 8].map((value) => (
                <option key={value} value={value}>
                  {value}칸
                </option>
              ))}
            </NativeSelect>
          </label>
          <label>
            식별자 대괄호
            <NativeSelect
              aria-label="식별자 대괄호"
              value={format.identifierQuotes}
              onChange={(event) =>
                change({
                  identifierQuotes: event.target
                    .value as SqlFormatting['identifierQuotes'],
                })
              }
            >
              <option value="minimal">불필요한 [] 제거</option>
              <option value="preserve">원문 유지</option>
            </NativeSelect>
          </label>
          <label className={tw('checkbox-label')}>
            <input
              type="checkbox"
              checked={format.alignJoinOn}
              onChange={(event) =>
                change({ alignJoinOn: event.target.checked })
              }
            />
            JOIN의 ON 위치 정렬
          </label>
          <label className={tw('checkbox-label')}>
            <input
              type="checkbox"
              checked={format.breakConditions}
              onChange={(event) =>
                change({ breakConditions: event.target.checked })
              }
            />
            AND / OR 줄바꿈
          </label>
          <label className={tw('checkbox-label')}>
            <input
              type="checkbox"
              checked={format.alignKeywords}
              onChange={(event) =>
                change({ alignKeywords: event.target.checked })
              }
            />
            키워드 열 맞춤 (FROM&nbsp;&nbsp;&nbsp;&nbsp;x)
          </label>
        </div>
        <pre
          className={tw('sql-format-preview')}
          aria-label="SQL 포맷 미리보기"
        >
          {preview(sample.trim() || example, format)}
        </pre>
        <div className={tw('modal-actions')}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setFormat(defaultSqlFormatting())}
          >
            기본값
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit">설정 저장</Button>
        </div>
      </form>
    </dialog>
  )
}
