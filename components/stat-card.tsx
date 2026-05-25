import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'default' | 'green' | 'amber' | 'red' | 'sky' | 'purple' | 'orange'
  className?: string
}

const accentColors = {
  default: { bar: 'bg-slate-300', value: 'text-slate-900', icon: 'bg-slate-100' },
  green: { bar: 'bg-emerald-500', value: 'text-emerald-700', icon: 'bg-emerald-50' },
  amber: { bar: 'bg-amber-400', value: 'text-amber-700', icon: 'bg-amber-50' },
  red: { bar: 'bg-red-500', value: 'text-red-700', icon: 'bg-red-50' },
  sky: { bar: 'bg-sky-500', value: 'text-sky-700', icon: 'bg-sky-50' },
  purple: { bar: 'bg-purple-500', value: 'text-purple-700', icon: 'bg-purple-50' },
  orange: { bar: 'bg-[var(--sfx-orange)]', value: 'text-[var(--sfx-orange-d)]', icon: 'bg-orange-50' },
}

export function StatCard({ label, value, sub, accent = 'default', className }: StatCardProps) {
  const colors = accentColors[accent]

  return (
    <div className={cn('kpi-card min-w-0', className)}>
      {/* Left accent bar */}
      <div className={cn('accent-bar', colors.bar)} />
      <div className="pl-4 pr-3 py-3">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider truncate leading-tight">
          {label}
        </p>
        <p className={cn(
          'text-xl font-bold mt-1.5 tabular-nums font-mono leading-none animate-count-up',
          colors.value,
        )}>
          {value}
        </p>
        {sub && (
          <p className="text-[11px] text-slate-400 mt-1 truncate">{sub}</p>
        )}
      </div>
    </div>
  )
}
