import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-8 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-0 text-[13px] text-[var(--text)] shadow-sm outline-none transition-colors placeholder:text-[var(--muted)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/25 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
