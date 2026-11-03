import { tw } from '@/lib/styleClasses'
import { NativeSelect } from '@/components/ui/native-select'
import { useState } from 'react'
import { Settings } from 'lucide-react'
import { useWorkspace } from '../store'
import { Button } from './ui/button'
import { SqlFormattingDialog } from './SqlFormattingDialog'
import { paletteOptions, themePalettes } from '../lib/themePalettes'
import { cn } from '../lib/utils'

const sizes = (from: number, to: number, step = 1): number[] =>
  Array.from(
    { length: Math.floor((to - from) / step) + 1 },
    (_, i) => from + i * step,
  )

/** All app-wide display and behavior options in one place. */
export function SettingsView() {
  const { settings, update } = useWorkspace()
  const [formatting, setFormatting] = useState(false)
  return (
    <section className={tw('settings-view')} aria-label="설정">
      <h2>
        <Settings size={18} /> 설정
      </h2>
      <div className={tw('settings-group')}>
        <h3>화면</h3>
        <label>
          테마
          <NativeSelect
            aria-label="테마"
            value={settings.theme}
            onChange={(event) =>
              update({ theme: event.target.value as typeof settings.theme })
            }
          >
            <option value="light">밝게</option>
            <option value="dark">어둡게</option>
          </NativeSelect>
        </label>
        <div className="w-full max-w-[520px]" role="group" aria-label="색 조합">
          <p className="mb-2 text-xs text-[var(--sub)]">
            {settings.theme === 'dark' ? '어두운' : '밝은'} 테마 색 조합 ·
            테마별로 따로 저장됩니다
          </p>
          <div className="grid w-full grid-cols-2 gap-2">
            {paletteOptions.map(({ id, label }) => {
              const colors = themePalettes[settings.theme][id]
              const selected = settings.themePalettes[settings.theme] === id
              return (
                <Button
                  key={id}
                  type="button"
                  variant="outline"
                  aria-label={`${label} 색 조합`}
                  aria-pressed={selected}
                  className={cn(
                    'h-auto w-full flex-col items-start gap-2 rounded-lg bg-[var(--panel)] p-3 text-left',
                    selected &&
                      'border-[var(--accent)] ring-1 ring-[var(--accent)]',
                  )}
                  onClick={() =>
                    update({
                      themePalettes: {
                        ...settings.themePalettes,
                        [settings.theme]: id,
                      },
                    })
                  }
                >
                  <span className="font-semibold">{label}</span>
                  <span className="flex gap-1.5" aria-hidden="true">
                    {(['--bg', '--panel', '--raised', '--accent'] as const).map(
                      (key) => (
                        <span
                          key={key}
                          className="size-5 rounded-full border border-[var(--border)]"
                          style={{ backgroundColor: colors[key] }}
                        />
                      ),
                    )}
                  </span>
                </Button>
              )
            })}
          </div>
        </div>
        <label>
          전체 글자 크기
          <NativeSelect
            aria-label="전체 글자 크기"
            value={settings.uiZoom}
            onChange={(event) => update({ uiZoom: Number(event.target.value) })}
          >
            {sizes(80, 150, 10).map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          SQL 편집기 글자 크기
          <NativeSelect
            aria-label="SQL 편집기 글자 크기"
            value={settings.editorFontSize}
            onChange={(event) =>
              update({ editorFontSize: Number(event.target.value) })
            }
          >
            {sizes(10, 24).map((value) => (
              <option key={value} value={value}>
                {value}px
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          결과 표 글자 크기
          <NativeSelect
            aria-label="결과 표 글자 크기"
            value={settings.gridFontSize}
            onChange={(event) =>
              update({ gridFontSize: Number(event.target.value) })
            }
          >
            {sizes(10, 18).map((value) => (
              <option key={value} value={value}>
                {value}px
              </option>
            ))}
          </NativeSelect>
        </label>
        <label>
          결과 페이지당 행 수
          <NativeSelect
            aria-label="페이지당 행 수"
            value={settings.resultPageSize}
            onChange={(event) =>
              update({
                resultPageSize: Number(
                  event.target.value,
                ) as typeof settings.resultPageSize,
              })
            }
          >
            {[50, 100, 500].map((value) => (
              <option key={value} value={value}>
                {value}행
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      <div className={tw('settings-group')}>
        <h3>AI</h3>
        <label>
          AI 패널 위치
          <NativeSelect
            aria-label="AI 패널 위치"
            value={settings.agentDock}
            onChange={(event) =>
              update({
                agentDock: event.target.value as typeof settings.agentDock,
              })
            }
          >
            <option value="bottom">중앙 아래</option>
            <option value="right">오른쪽</option>
          </NativeSelect>
        </label>
        <label className={tw('checkbox-label')}>
          <input
            type="checkbox"
            checked={!settings.agentCollapsed}
            onChange={(event) =>
              update({ agentCollapsed: !event.target.checked })
            }
          />
          AI 패널 표시
        </label>
      </div>
      <div className={tw('settings-group')}>
        <h3>SQL</h3>
        <label className={tw('checkbox-label')}>
          <input
            type="checkbox"
            aria-label="변경 미리보기"
            checked={settings.writePreview}
            onChange={(event) => update({ writePreview: event.target.checked })}
          />
          UPDATE·DELETE·INSERT 실행 전 변경 미리보기
        </label>
        <Button
          size="small"
          variant="outline"
          onClick={() => setFormatting(true)}
        >
          SQL 포맷 설정…
        </Button>
      </div>
      {formatting && (
        <SqlFormattingDialog onClose={() => setFormatting(false)} />
      )}
    </section>
  )
}
