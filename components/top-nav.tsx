'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard } from 'lucide-react'

const tabs = [
  { label: 'Rider Profiling', href: '/' },
  { label: 'Rider Details', href: '/rider-details' },
  { label: 'Rider Delivery', href: '/rider-delivery' },
  { label: 'Demand Data', href: '/demand' },
  { label: 'Configuration', href: '/configuration' },
]

export function TopNav() {
  const pathname = usePathname()

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="flex items-center px-6 h-14 gap-8">
        <div className="flex items-center gap-2 mr-4 shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <LayoutDashboard className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-slate-900 text-sm tracking-tight">Prime Dashboard</span>
        </div>
        <div className="flex items-center gap-1 h-full">
          {tabs.map((tab) => {
            const isActive = tab.href === '/'
              ? pathname === '/'
              : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'relative flex items-center px-4 h-full text-sm font-medium transition-colors',
                  isActive
                    ? 'text-blue-600'
                    : 'text-slate-500 hover:text-slate-900'
                )}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
