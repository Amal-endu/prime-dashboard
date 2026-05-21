import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'default' | 'green' | 'amber' | 'red' | 'sky' | 'purple' | 'orange'
  className?: string
}

const accentBar = {
  default: 'bg-slate-300',
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
  sky: 'bg-sky-500',
  purple: 'bg-purple-500',
  orange: 'bg-sfx-orange',
}

const valueClasses = {
  default: 'text-slate-900',
  green: 'text-emerald-700',
  amber: 'text-amber-700',
  red: 'text-red-700',
  sky: 'text-sky-700',
  purple: 'text-purple-700',
  orange: 'text-sfx-orange-dark',
}

export function StatCard({ label, value, sub, accent = 'default', className }: StatCardProps) {
  return (
    <div className={cn(
      'rounded-xl border border-slate-200 bg-white overflow-hidden min-w-0 relative',
      className,
    )}>
      <div className={cn('h-0.5 w-full', accentBar[accent])} />
      <div className="p-4">
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider truncate">{label}</p>
        <p className={cn('text-2xl font-bold mt-1 tabular-nums font-mono', valueClasses[accent])}>{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
