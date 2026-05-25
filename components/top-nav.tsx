'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Settings, Activity, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConfigDrawer } from '@/components/config-drawer'
import { createClient } from '@/lib/supabase/browser'

const tabs = [
  { label: 'Rider Profile', href: '/' },
  { label: 'Daily Perf', href: '/rider-perf-trend' },
  { label: 'Delivery', href: '/rider-delivery' },
  { label: 'Allocation', href: '/demand' },
]

function timeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffHrs = Math.floor(diffMs / 3600000)
    if (diffHrs < 1) return 'just now'
    if (diffHrs < 24) return `${diffHrs}h ago`
    const diffDays = Math.floor(diffHrs / 24)
    return `${diffDays}d ago`
  } catch {
    return ''
  }
}

export function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [dataDate, setDataDate] = useState<string | null>(null)
  const [maxDateRaw, setMaxDateRaw] = useState<string | null>(null)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        setDataDate(d.maxDate ?? null)
        setMaxDateRaw(d.maxDateRaw ?? null)
      })
      .catch(() => {})
  }, [])

  return (
    <>
      <nav className="bg-white border-b border-slate-200/80 sticky top-0 z-40" style={{ boxShadow: 'var(--shadow-nav)' }}>
        <div className="max-w-[1600px] mx-auto flex items-center px-4 sm:px-6 h-14 gap-6">
          {/* Logo */}
          <div className="flex items-center gap-3 mr-2 shrink-0">
            <Image
              src="/shadowfax-logo.svg"
              alt="Shadowfax"
              width={120}
              height={26}
              priority
              className="h-6 w-auto"
            />
            <div className="h-5 w-px bg-slate-200" />
            <span className="font-semibold text-slate-800 text-[13px] tracking-tight whitespace-nowrap">
              Prime Dashboard
            </span>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-0.5 h-full">
            {tabs.map(tab => {
              const isActive = tab.href === '/'
                ? pathname === '/'
                : pathname.startsWith(tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'relative flex items-center px-3.5 h-full text-[13px] font-medium transition-colors duration-200',
                    isActive
                      ? 'text-[var(--sfx-orange)]'
                      : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {tab.label}
                  {/* Animated underline */}
                  <span
                    className={cn(
                      'absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full transition-all duration-300',
                      isActive
                        ? 'bg-[var(--sfx-orange)] opacity-100 scale-x-100'
                        : 'bg-transparent opacity-0 scale-x-0',
                    )}
                    style={{ transformOrigin: 'center' }}
                  />
                </Link>
              )
            })}
          </div>

          {/* Right side: data freshness + settings */}
          <div className="ml-auto flex items-center gap-2.5">
            {dataDate && (
              <div className="flex items-center gap-1.5 text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                <Activity className="w-3 h-3 text-emerald-500" />
                <span className="text-slate-500">Data:</span>
                <span className="font-semibold text-slate-700">{dataDate}</span>
                {maxDateRaw && (
                  <span className="text-slate-400 ml-0.5">({timeAgo(maxDateRaw)})</span>
                )}
              </div>
            )}
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all duration-200"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={handleSignOut}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all duration-200"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      <ConfigDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  )
}
