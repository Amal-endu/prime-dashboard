'use client'

import { cn, formatPct } from '@/lib/utils'
import { defaultConfig } from '@/lib/utils'

interface DelPctCellProps {
  value: number
  className?: string
}

export function DelPctCell({ value, className }: DelPctCellProps) {
  const config = defaultConfig()
  const colorClass =
    value >= config.delPctGreenThreshold
      ? 'text-emerald-600'
      : value >= config.delPctAmberThreshold
        ? 'text-amber-600'
        : 'text-red-600'

  return (
    <span className={cn('font-semibold tabular-nums text-sm', colorClass, className)}>
      {formatPct(value)}
    </span>
  )
}
