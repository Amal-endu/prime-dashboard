import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TrendDirection } from '@/lib/types'

type Variant = 'pill' | 'inline'

interface BaseProps {
  variant?: Variant
  className?: string
}

interface DirectionProps extends BaseProps {
  // Pill mode: explicit direction + magnitude (e.g. 5.2% up).
  direction: TrendDirection
  pct: number
  delta?: never
  unit?: '%' | 'pp'
}

interface DeltaProps extends BaseProps {
  // Inline mode: signed delta in percentage points (e.g. +1.4pp).
  delta: number
  direction?: never
  pct?: never
  unit?: '%' | 'pp'
}

type TrendDisplayProps = DirectionProps | DeltaProps

export function TrendDisplay(props: TrendDisplayProps) {
  const variant = props.variant ?? ('delta' in props && props.delta !== undefined ? 'inline' : 'pill')
  const unit = props.unit ?? (variant === 'inline' ? 'pp' : '%')

  if (variant === 'inline') {
    const delta = (props as DeltaProps).delta
    if (Math.abs(delta) < 0.5) {
      return (
        <span className={cn('text-slate-400 text-xs flex items-center gap-0.5', props.className)}>
          <Minus className="w-3 h-3" />—
        </span>
      )
    }
    const positive = delta > 0
    return (
      <span className={cn(
        'text-xs font-mono font-medium flex items-center gap-0.5',
        positive ? 'text-emerald-600' : 'text-red-500',
        props.className,
      )}>
        {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {positive ? '+' : ''}{delta.toFixed(1)}{unit}
      </span>
    )
  }

  // pill variant
  const { direction, pct } = props as DirectionProps
  if (direction === 'flat') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-medium text-slate-500', props.className)}>
        <Minus className="w-3 h-3" />{pct.toFixed(1)}{unit}
      </span>
    )
  }

  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
      direction === 'up' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      props.className,
    )}>
      {direction === 'up' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {pct.toFixed(1)}{unit}
    </span>
  )
}

// Backwards-compatible alias — both old call sites used a `TrendBadge` with
// `direction` and `pct`. Keep the old export name so we don't have to touch
// every consumer.
export const TrendBadge = TrendDisplay
