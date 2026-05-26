'use client'

import { useEffect, useState } from 'react'
import { BehaviourBadge, RegularityBadge } from '@/components/profile-badges'
import { formatPct } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag } from '@/lib/types'
import { useConfigState } from '@/components/config-provider'
import { toApiParams } from '@/lib/config-params'

interface RiderStats {
  avgAtpMorning: number | null
  avgAtpEvening: number | null
  avgLoginHourMorning: number | null
  avgLoginHourEvening: number | null
  avgDailyEarningsMorning: number | null
  avgDailyEarningsEvening: number | null
  favouriteClusterMorning: string | null
  favouriteClusterEvening: string | null
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtCalDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
interface RiderProfileCardProps {
  rider: {
    riderId: number
    riderName: string
    hub: string
    city: string
    loginBehaviourTag: LoginBehaviourTag
    regularityTag: RegularityTag
    loginRatePct: number
    morningLogins: number
    eveningLogins: number
    firstLoginDate: string
    lastLoginDate: string
    daysSinceLastLogin: number
    activeSinceDays: number
  }
}

function fmtHour(h: number | null): string {
  if (h == null) return '—'
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  const suffix = hh >= 12 ? 'PM' : 'AM'
  const display = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh
  return `${display}:${mm.toString().padStart(2, '0')} ${suffix}`
}

function fmtRupee(n: number | null): string {
  if (n == null) return '—'
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

export function RiderProfileCard({ rider }: RiderProfileCardProps) {
  const { config, configVersion } = useConfigState()
  const [stats, setStats] = useState<RiderStats | null>(null)

  useEffect(() => {
    const params = new URLSearchParams({ riderId: String(rider.riderId) })
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/profiling/rider-stats?${params}`)
      .then(r => r.json())
      .then(setStats)
      .catch(() => {})
  }, [rider.riderId, configVersion])

  const loginDays = Math.round((rider.loginRatePct / 100) * (config.analysisWindowDays ?? 30))
  const windowDays = config.analysisWindowDays ?? 30

  const showMorning = rider.morningLogins > 0
  const showEvening = rider.eveningLogins > 0

  return (
    <tr>
      <td colSpan={11} className="px-0 py-0 border-b border-slate-100">
        <div className="bg-slate-50/80 border-y border-slate-200 px-16 py-4">
          <div className="grid grid-cols-4 gap-6">

            {/* Identity */}
            <div>
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Identity</p>
              <div className="space-y-1.5">
                <Row label="Rider ID" value={String(rider.riderId)} mono />
                <Row label="Hub" value={rider.hub} />
                <Row label="City" value={rider.city} />
                <Row label="First Login" value={fmtCalDate(rider.firstLoginDate) || '—'} mono />
                <Row label="Last Login" value={fmtCalDate(rider.lastLoginDate) || '—'} mono valueClass={rider.daysSinceLastLogin <= 7 ? 'text-emerald-600' : rider.daysSinceLastLogin <= 14 ? 'text-amber-600' : 'text-red-500'} />
              </div>
            </div>

            {/* Login Activity */}
            <div>
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Login Activity (Last {windowDays}d)</p>
              <div className="space-y-1.5">
                <Row label="Days Logged In" value={`${loginDays} / ${windowDays}`} mono />
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Login Rate</span>
                  <span className={`font-mono font-semibold ${rider.loginRatePct >= 80 ? 'text-emerald-600' : rider.loginRatePct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {formatPct(rider.loginRatePct)}
                  </span>
                </div>
                <Row label="Morning Days" value={String(rider.morningLogins)} mono valueClass="text-orange-600" />
                <Row label="Evening Days" value={String(rider.eveningLogins)} mono valueClass="text-indigo-600" />
                <div className="mt-2">
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${rider.loginRatePct >= 80 ? 'bg-emerald-500' : rider.loginRatePct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${Math.min(rider.loginRatePct, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Productivity & Earnings */}
            <div>
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Productivity & Earnings</p>
              {stats == null ? (
                <p className="text-[10px] text-slate-400 italic">Loading…</p>
              ) : (
                <div className="space-y-1.5">
                  {showMorning && <>
                    <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide mt-1">Morning</p>
                    <Row label="Avg ATP" value={stats.avgAtpMorning != null ? `${stats.avgAtpMorning}` : '—'} mono valueClass="text-orange-600" />
                    <Row label="Avg Login Hour" value={fmtHour(stats.avgLoginHourMorning)} mono valueClass="text-orange-600" />
                    <Row label="Avg Daily Earnings" value={fmtRupee(stats.avgDailyEarningsMorning)} mono valueClass="text-orange-600" />
                    {stats.favouriteClusterMorning && <Row label="Fav. Cluster" value={stats.favouriteClusterMorning} />}
                  </>}
                  {showEvening && <>
                    <p className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wide mt-2">Evening / 3MR</p>
                    <Row label="Avg ATP" value={stats.avgAtpEvening != null ? `${stats.avgAtpEvening}` : '—'} mono valueClass="text-indigo-600" />
                    <Row label="Avg Login Hour" value={fmtHour(stats.avgLoginHourEvening)} mono valueClass="text-indigo-600" />
                    <Row label="Avg Daily Earnings" value={fmtRupee(stats.avgDailyEarningsEvening)} mono valueClass="text-indigo-600" />
                    {stats.favouriteClusterEvening && <Row label="Fav. Cluster" value={stats.favouriteClusterEvening} />}
                  </>}
                </div>
              )}
            </div>

            {/* Classification */}
            <div>
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-2">Classification</p>
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] text-slate-400 mb-1">Login Behaviour</p>
                  <BehaviourBadge tag={rider.loginBehaviourTag} />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 mb-1">Regularity</p>
                  <RegularityBadge tag={rider.regularityTag} />
                </div>
                <div className="mt-2 pt-2 border-t border-slate-200">
                  <p className="text-[10px] text-slate-400 mb-1">Pattern</p>
                  <p className="text-xs text-slate-600">
                    {rider.morningLogins > 0 && rider.eveningLogins > 0
                      ? `Works both runs · ${rider.morningLogins}M + ${rider.eveningLogins}E days`
                      : rider.eveningLogins > rider.morningLogins
                      ? `Primarily evening · ${rider.eveningLogins} evening days`
                      : `Primarily morning · ${rider.morningLogins} morning days`}
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </td>
    </tr>
  )
}

function Row({ label, value, mono, valueClass }: { label: string; value: string; mono?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} font-medium ${valueClass ?? 'text-slate-700'} max-w-[60%] text-right truncate`} title={value}>{value}</span>
    </div>
  )
}
