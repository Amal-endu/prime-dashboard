import { cn } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag, SourceRiderTag } from '@/lib/types'

const behaviourStyles: Record<LoginBehaviourTag, string> = {
  'Evening Rider': 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
  'Cross Utilised': 'bg-violet-50 text-violet-700 border-violet-200/80',
  'Morning Rider': 'bg-orange-50 text-orange-700 border-orange-200/80',
}

const regularityStyles: Record<RegularityTag, string> = {
  'Regular': 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  'Irregular': 'bg-amber-50 text-amber-700 border-amber-200/80',
  'New Rider': 'bg-sky-50 text-sky-700 border-sky-200/80',
}

const sourceStyles: Record<SourceRiderTag, string> = {
  'Dedicated': 'bg-slate-50 text-slate-700 border-slate-200/80',
  'Cross utilised': 'bg-purple-50 text-purple-700 border-purple-200/80',
  'Unidentified': 'bg-gray-50 text-gray-500 border-gray-200/80',
}

interface BehaviourBadgeProps { tag: LoginBehaviourTag; className?: string }
interface RegularityBadgeProps { tag: RegularityTag; className?: string }
interface SourceBadgeProps { tag: SourceRiderTag; className?: string }

export function BehaviourBadge({ tag, className }: BehaviourBadgeProps) {
  return (
    <span className={cn('badge', behaviourStyles[tag], className)}>
      {tag}
    </span>
  )
}

export function RegularityBadge({ tag, className }: RegularityBadgeProps) {
  return (
    <span className={cn('badge', regularityStyles[tag], className)}>
      {tag}
    </span>
  )
}

export function SourceBadge({ tag, className }: SourceBadgeProps) {
  return (
    <span className={cn('badge', sourceStyles[tag], className)}>
      {tag}
    </span>
  )
}
