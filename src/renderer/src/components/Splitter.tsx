import { tw } from '@/lib/styleClasses'
import { useRef } from 'react'

/**
 * Draggable boundary between two panes. `invert` is for a pane on the right/bottom
 * side, whose size grows when the pointer moves left/up. Arrow keys step by 16px.
 */
export function Splitter({
  label,
  value,
  min,
  max,
  onChange,
  axis = 'x',
  invert = false,
  current,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  axis?: 'x' | 'y'
  invert?: boolean
  // Rendered size at drag start; CSS may clamp the pane below the stored value.
  current?: () => number
}) {
  const drag = useRef<{ start: number; value: number } | null>(null)
  const clamp = (next: number): number =>
    Math.round(Math.min(max, Math.max(min, next)))
  const position = (event: { clientX: number; clientY: number }): number =>
    axis === 'x' ? event.clientX : event.clientY
  const [less, more] =
    axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  return (
    <div
      className={tw(`splitter splitter-${axis}`)}
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { start: position(event), value: current?.() ?? value }
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        const delta = position(event) - drag.current.start
        onChange(clamp(drag.current.value + (invert ? -delta : delta)))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={(event) => {
        const step =
          event.key === more ? 16 : event.key === less ? -16 : undefined
        if (step === undefined) return
        event.preventDefault()
        onChange(clamp((current?.() ?? value) + (invert ? -step : step)))
      }}
    />
  )
}
