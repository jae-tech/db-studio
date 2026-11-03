import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <table
      className={cn('w-full text-sm caption-bottom', className)}
      {...props}
    />
  )
}
export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}
export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
  )
}
export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b border-[var(--border)] transition-colors hover:bg-[var(--raised)]',
        className,
      )}
      {...props}
    />
  )
}
export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle font-medium text-[var(--sub)]',
        className,
      )}
      {...props}
    />
  )
}
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('p-3 align-middle', className)} {...props} />
}
