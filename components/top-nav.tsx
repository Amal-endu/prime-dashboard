'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

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
        <div className="flex items-center gap-3 mr-4 shrink-0">
          <Image
            src="/shadowfax-logo.svg"
            alt="Shadowfax"
            width={130}
            height={28}
            priority
            className="h-7 w-auto"
          />
          <span className="font-semibold text-slate-900 text-sm tracking-tight border-l border-slate-200 pl-3">
            Prime Dashboard
          </span>
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
                    ? 'text-sfx-orange'
                    : 'text-slate-500 hover:text-slate-900'
                )}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sfx-orange rounded-t-full" />
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
