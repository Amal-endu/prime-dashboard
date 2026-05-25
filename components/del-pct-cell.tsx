'use client'

import { cn, formatPct } from '@/lib/utils'
import { useConfig } from '@/components/config-provider'

interface DelPctCellProps {
  value: number
  className?: string
  showBackground?: boolean
}

export function DelPctCell({ value, className, showBackground = false }: DelPctCellProps) {
  const config = useConfig()

  const isGreen = value >= config.delPctGreenThreshold
  const isAmber = !isGreen && value >= config.delPctAmberThreshold

  const textColor = isGreen
    ? 'text-emerald-600'
    : isAmber
      ? 'text-amber-600'
      : 'text-red-600'

  const bgColor = showBackground
    ? isGreen
      ? 'heatmap-green'
      : isAmber
        ? 'heatmap-amber'
        : 'heatmap-red'
    : ''

  return (
    <span className={cn(
      'font-semibold tabular-nums text-sm font-mono',
      textColor,
      bgColor && `${bgColor} px-2 py-0.5 rounded`,
      className,
    )}>
      {formatPct(value)}
    </span>
  )
}
