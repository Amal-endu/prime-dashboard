import { cn } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag, SourceRiderTag } from '@/lib/types'

const behaviourStyles: Record<LoginBehaviourTag, string> = {
  'Evening Rider': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Cross Utilised': 'bg-violet-50 text-violet-700 border-violet-200',
  'Morning Rider': 'bg-orange-50 text-orange-700 border-orange-200',
}

const regularityStyles: Record<RegularityTag, string> = {
  'Regular': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Irregular': 'bg-amber-50 text-amber-700 border-amber-200',
  'New Rider': 'bg-blue-50 text-blue-700 border-blue-200',
}

const sourceStyles: Record<SourceRiderTag, string> = {
  'Dedicated': 'bg-slate-100 text-slate-700 border-slate-200',
  'Cross utilised': 'bg-purple-50 text-purple-700 border-purple-200',
  'Unidentified': 'bg-gray-50 text-gray-500 border-gray-200',
}

interface BehaviourBadgeProps { tag: LoginBehaviourTag; className?: string }
interface RegularityBadgeProps { tag: RegularityTag; className?: string }
interface SourceBadgeProps { tag: SourceRiderTag; className?: string }

export function BehaviourBadge({ tag, className }: BehaviourBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
      behaviourStyles[tag], className
    )}>
      {tag}
    </span>
  )
}

export function RegularityBadge({ tag, className }: RegularityBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
      regularityStyles[tag], className
    )}>
      {tag}
    </span>
  )
}

export function SourceBadge({ tag, className }: SourceBadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
      sourceStyles[tag], className
    )}>
      {tag}
    </span>
  )
}
