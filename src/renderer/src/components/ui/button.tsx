import { tw } from '@/lib/styleClasses'
// Source-owned shadcn/ui Button pattern; variants adapted for desktop toolbars.
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
const variants = cva(
  'button inline-flex items-center justify-center gap-[7px] whitespace-nowrap rounded-[5px] border border-transparent text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--accent)] text-[var(--on-accent)] hover:brightness-108',
        ghost:
          'bg-transparent text-[var(--sub)] hover:bg-[var(--raised)] hover:text-[var(--text)]',
        outline: 'border-[var(--border)] bg-[var(--raised)] text-[var(--text)]',
      },
      size: {
        default: 'h-8 px-3',
        icon: 'size-7 p-0',
        small: 'h-[29px] px-3 text-[length:var(--font-size-label)]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      className={tw(cn(variants({ variant, size }), className))}
      {...props}
    />
  )
}
