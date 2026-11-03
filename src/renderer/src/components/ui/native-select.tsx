import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function NativeSelect({
  className,
  ...props
}: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0 text-[13px] leading-normal text-[var(--text)] shadow-sm outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/25 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
