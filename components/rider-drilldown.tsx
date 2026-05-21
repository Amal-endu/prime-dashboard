'use client'

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { BehaviourBadge, RegularityBadge } from '@/components/profile-badges'
import { DelPctCell } from '@/components/del-pct-cell'
import { formatCurrency, formatNumber, formatPct } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag } from '@/lib/types'

type JoinedDay = {
  date: string; hub: string; riderName: string
  morningRunsheetHour: number | null; eveningRunsheetHour: number | null
  attemptMorning: number | null; attemptEvening: number | null; attemptedTotal: number | null
  assigned3MR: number | null; attempted3MR: number | null; delivered3MR: number | null
  breachCount: number | null; attemptPct: number | null; delPct: number | null; earnings: number | null
}

type JoinedSummary = {
  loginDays: number; daysWithMorning: number; daysWithEvening: number
  totalAssigned: number; totalAttempted3MR: number; totalDelivered: number
  avgAttemptPct: number; avgDelPct: number; totalEarnings: number
}

interface RiderDrilldownProps {
  rider: { riderId: string; riderName: string; hub: string; city: string; loginBehaviourTag: string; regularityTag: string }
  dateRange: { start: string; end: string }
  onClose: () => void
  colSpan: number
}

export function RiderDrilldown({ rider, dateRange, onClose, colSpan }: RiderDrilldownProps) {
  const [days, setDays] = useState<JoinedDay[]>([])
  const [summary, setSummary] = useState<JoinedSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    const params = new URLSearchParams({
      riderId: rider.riderId,
      start: dateRange.start,
      end: dateRange.end,
    })
    fetch(`/api/details/joined?${params}`)
      .then(r => r.json())
      .then(d => { setDays(d.days ?? []); setSummary(d.summary ?? null); setLoading(false) })
      .catch(() => setLoading(false))
  }, [rider.riderId, dateRange.start, dateRange.end])

  return (
    <tr>
      <td colSpan={colSpan} className="px-0 py-0">
        <div className="mx-4 my-2 bg-sfx-orange/5 border border-sfx-orange-light/40 rounded-xl p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-slate-900">{rider.riderName}</span>
                <span className="font-mono text-xs text-slate-400">{rider.riderId}</span>
                <BehaviourBadge tag={rider.loginBehaviourTag as LoginBehaviourTag} />
                <RegularityBadge tag={rider.regularityTag as RegularityTag} />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{rider.hub} · {rider.city}</p>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 text-xs py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading daily breakdown...
            </div>
          ) : (
            <>
              {summary && (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                  {[
                    { label: 'Login Days', value: String(summary.loginDays) },
                    { label: 'Morning Days', value: String(summary.daysWithMorning) },
                    { label: 'Evening Days', value: String(summary.daysWithEvening) },
                    { label: 'Assigned 3MR', value: formatNumber(summary.totalAssigned) },
                    { label: 'Attempted', value: formatNumber(summary.totalAttempted3MR) },
                    { label: 'Delivered', value: formatNumber(summary.totalDelivered) },
                    { label: 'Avg Attempt %', value: formatPct(summary.avgAttemptPct) },
                    { label: 'Total Earnings', value: formatCurrency(summary.totalEarnings) },
                  ].map(s => (
                    <div key={s.label} className="bg-white rounded-lg px-3 py-2 border border-sfx-orange-light/30">
                      <p className="text-[10px] text-slate-500">{s.label}</p>
                      <p className="text-sm font-semibold font-mono text-slate-800">{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {days.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-white border-b border-sfx-orange-light/30">
                        <th className="text-left px-3 py-2 font-medium text-slate-500">Date</th>
                        <th className="text-right px-3 py-2 font-medium text-orange-500">Morning Run</th>
                        <th className="text-right px-3 py-2 font-medium text-indigo-500">Evening Run</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Total Attempts</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Assigned 3MR</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Avg Attempts</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Avg Delivered</th>
                        <th className="text-right px-3 py-2 font-medium text-amber-600">Attempt %</th>
                        <th className="text-right px-3 py-2 font-medium text-emerald-600">Del %</th>
                        <th className="text-right px-3 py-2 font-medium text-slate-500">Earnings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sfx-orange-light/20">
                      {days.map(d => (
                        <tr key={d.date} className="hover:bg-white/60">
                          <td className="px-3 py-2 font-mono text-slate-700">{d.date}</td>
                          <td className="text-right px-3 py-2 font-mono text-orange-600">
                            {d.morningRunsheetHour != null ? `${String(d.morningRunsheetHour).padStart(2, '0')}:00` : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2 font-mono text-indigo-600">
                            {d.eveningRunsheetHour != null ? `${String(d.eveningRunsheetHour).padStart(2, '0')}:00` : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2 font-mono text-slate-600">
                            {d.attemptedTotal != null ? d.attemptedTotal : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2 font-mono text-slate-600">
                            {d.assigned3MR != null ? d.assigned3MR : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2 font-mono text-slate-700">
                            {d.attempted3MR != null ? d.attempted3MR : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2 font-mono font-semibold text-slate-800">
                            {d.delivered3MR != null ? d.delivered3MR : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2">
                            {d.attemptPct != null ? <DelPctCell value={d.attemptPct} /> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2">
                            {d.delPct != null ? <DelPctCell value={d.delPct} /> : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2 font-mono text-emerald-600">
                            {d.earnings != null ? formatCurrency(d.earnings) : <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {days.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">No data found for this rider in the selected date range.</p>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
