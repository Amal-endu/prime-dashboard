import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TrendDirection } from '@/lib/types'

interface TrendBadgeProps {
  direction: TrendDirection
  pct: number
  className?: string
}

export function TrendBadge({ direction, pct, className }: TrendBadgeProps) {
  if (direction === 'flat') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs font-medium text-slate-500', className)}>
        <Minus className="w-3 h-3" />
        {pct.toFixed(1)}%
      </span>
    )
  }

  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
      direction === 'up' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      className
    )}>
      {direction === 'up'
        ? <TrendingUp className="w-3 h-3" />
        : <TrendingDown className="w-3 h-3" />
      }
      {pct.toFixed(1)}%
    </span>
  )
}
