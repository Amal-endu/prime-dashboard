'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ChevronRight, ChevronDown, Search, SlidersHorizontal,
  CheckCircle2, Loader2, TrendingUp, X,
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { StatCard } from '@/components/stat-card'
import { BehaviourBadge, RegularityBadge } from '@/components/profile-badges'
import { DelPctCell } from '@/components/del-pct-cell'
import { formatPct, formatNumber, formatCurrency } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag } from '@/lib/types'

const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'D-1', value: 'd1' },
  { label: 'D-2', value: 'd2' },
  { label: 'D-3', value: 'd3' },
  { label: 'D-4', value: 'd4' },
  { label: 'D-5', value: 'd5' },
  { label: 'D-6', value: 'd6' },
  { label: 'D-7', value: 'd7' },
  { label: 'L7D', value: 'l7d' },
  { label: 'L30D', value: 'l30d' },
]

const BEHAVIOUR_OPTIONS: LoginBehaviourTag[] = ['Evening Rider', 'Cross Utilised', 'Morning Rider']
const REGULARITY_OPTIONS: RegularityTag[] = ['Regular', 'Irregular', 'New Rider']

type TrendPoint = { label: string; riders: number; attemptPct: number; avgEarnings: number }

function TrendCharts({ dateRange, sddMode }: { dateRange: { start: string; end: string } | null; sddMode: '3mr' | 'overall' }) {
  const [mode, setMode] = useState<'l7d' | 'l30d'>('l7d')
  const [city, setCity] = useState('all')
  const [trendData, setTrendData] = useState<{ l7d: TrendPoint[]; l30d: TrendPoint[]; cities: string[] } | null>(null)
  const [loadingTrend, setLoadingTrend] = useState(true)

  useEffect(() => {
    setLoadingTrend(true)
    const params = new URLSearchParams({ mode: sddMode })
    if (city !== 'all') params.set('city', city)
    fetch(`/api/details/trend?${params}`)
      .then(r => r.json())
      .then(d => { setTrendData(d); setLoadingTrend(false) })
      .catch(() => setLoadingTrend(false))
  }, [city, sddMode])

  const points: TrendPoint[] = trendData ? (mode === 'l7d' ? trendData.l7d : trendData.l30d) : []
  const cities = trendData?.cities ?? []

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold text-slate-700">Trends</span>
        </div>
        {/* L7D / L30D toggle */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          {(['l7d', 'l30d'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {m === 'l7d' ? 'Last 7 Days' : 'Last 30 Days'}
            </button>
          ))}
        </div>
        {/* City filter */}
        <select value={city} onChange={e => setCity(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 ml-auto">
          <option value="all">All Cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loadingTrend ? (
        <div className="flex items-center justify-center h-32 text-slate-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading trend data...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Riders logged in */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Riders Logged In</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => [formatNumber(Number(v)), 'Riders']} />
                <Bar dataKey="riders" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Attempt % */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Attempt %</p>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => [`${Number(v)}%`, 'Attempt %']} />
                <Line type="monotone" dataKey="attemptPct" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {/* Avg Earnings */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Avg Earnings / Rider</p>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={points} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${v}`} />
                <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Avg Earnings']} />
                <Line type="monotone" dataKey="avgEarnings" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

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

function RiderDrilldown({ rider, dateRange, onClose }: {
  rider: { riderId: string; riderName: string; hub: string; city: string; loginBehaviourTag: string; regularityTag: string }
  dateRange: { start: string; end: string }
  onClose: () => void
}) {
  const [days, setDays] = useState<JoinedDay[]>([])
  const [summary, setSummary] = useState<JoinedSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
      <td colSpan={14} className="px-0 py-0">
        <div className="mx-4 my-2 bg-blue-50/60 border border-blue-200 rounded-xl p-4 space-y-3">
          {/* Header */}
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
              {/* Summary strip */}
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
                    <div key={s.label} className="bg-white rounded-lg px-3 py-2 border border-blue-100">
                      <p className="text-[10px] text-slate-500">{s.label}</p>
                      <p className="text-sm font-semibold font-mono text-slate-800">{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Daily table */}
              {days.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-white border-b border-blue-100">
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
                    <tbody className="divide-y divide-blue-50">
                      {days.map(d => (
                        <tr key={d.date} className="hover:bg-white/60">
                          <td className="px-3 py-2 font-mono text-slate-700">{d.date}</td>
                          <td className="text-right px-3 py-2 font-mono text-orange-600">
                            {d.morningRunsheetHour != null ? `${String(d.morningRunsheetHour).padStart(2,'0')}:00` : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="text-right px-3 py-2 font-mono text-indigo-600">
                            {d.eveningRunsheetHour != null ? `${String(d.eveningRunsheetHour).padStart(2,'0')}:00` : <span className="text-slate-300">—</span>}
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

export default function RiderDetailsPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [datePreset, setDatePreset] = useState('today')
  const [sddMode, setSddMode] = useState<'3mr' | 'overall'>('3mr')
  const [behaviourFilter, setBehaviourFilter] = useState('all')
  const [regularityFilter, setRegularityFilter] = useState('all')
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set())
  const [expandedHubs, setExpandedHubs] = useState<Set<string>>(new Set())
  const [expandedRiders, setExpandedRiders] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ date: datePreset, mode: sddMode })
    if (behaviourFilter !== 'all') params.set('behaviour', behaviourFilter)
    if (regularityFilter !== 'all') params.set('regularity', regularityFilter)
    fetch(`/api/details?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [datePreset, sddMode, behaviourFilter, regularityFilter])

  const toggleCity = (city: string) => setExpandedCities(prev => { const n = new Set(prev); n.has(city) ? n.delete(city) : n.add(city); return n })
  const toggleHub = (hub: string) => setExpandedHubs(prev => { const n = new Set(prev); n.has(hub) ? n.delete(hub) : n.add(hub); return n })
  const toggleRider = (riderId: string) => setExpandedRiders(prev => { const n = new Set(prev); n.has(riderId) ? n.delete(riderId) : n.add(riderId); return n })

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" />Loading rider details...</div>
  if (!data) return <div className="text-red-600 py-8">Failed to load data</div>

  const { cities = [], hubs = [], riders = [], dateRange } = data
  const totalRiders = cities.reduce((s: number, c: any) => s + c.ridersLoggedIn, 0)
  const totalDelivered = cities.reduce((s: number, c: any) => s + c.delivered3MR, 0)
  const totalAssigned = cities.reduce((s: number, c: any) => s + c.assigned3MR, 0)
  const totalAttempted = cities.reduce((s: number, c: any) => s + c.attempted3MR, 0)
  const grandAttemptPct = totalAssigned > 0 ? (totalAttempted * 100 / totalAssigned) : 0
  const grandDeliveredPct = totalAssigned > 0 ? (totalDelivered * 100 / totalAssigned) : 0
  const totalEarnings = cities.reduce((s: number, c: any) => s + c.totalEarnings3MR, 0)
  const avgEarnings = totalRiders > 0 ? totalEarnings / totalRiders : 0

  const filteredRiders = riders.filter((r: any) =>
    !search || r.riderName.toLowerCase().includes(search.toLowerCase()) || r.riderId.includes(search)
  )

  const isFiltered = behaviourFilter !== 'all' || regularityFilter !== 'all'

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Rider Details</h1>
          <p className="text-sm text-slate-500 mt-0.5">Login activity, productivity and earnings</p>
        </div>
        {/* 3MR / Overall global toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">View:</span>
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {(['3mr', 'overall'] as const).map(m => (
              <button key={m} onClick={() => setSddMode(m)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  sddMode === m
                    ? m === '3mr'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-violet-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}>
                {m === '3mr' ? '3MR' : 'Overall'}
              </button>
            ))}
          </div>
          {sddMode === 'overall' && (
            <span className="text-[10px] text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full font-medium">
              All SDD AWBs
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard label="Riders Active" value={formatNumber(totalRiders)} accent="blue" />
        <StatCard label="Avg Attempt %" value={formatPct(grandAttemptPct)} sub="attempted / assigned" accent="amber" />
        <StatCard label="Avg Del %" value={formatPct(grandDeliveredPct)} sub="delivered / assigned" accent="green" />
        <StatCard label={sddMode === '3mr' ? 'Total 3MR Delivered' : 'Total Delivered'} value={formatNumber(totalDelivered)} />
        <StatCard label={sddMode === '3mr' ? 'Avg 3MR Earnings' : 'Avg Earnings'} value={formatCurrency(avgEarnings)} sub="per active rider" accent="purple" />
        <StatCard label="Avg Attempted" value={(totalRiders > 0 ? totalAttempted / totalRiders : 0).toFixed(1)} sub="per active rider" accent="amber" />
        <StatCard label="Avg Delivered" value={(totalRiders > 0 ? totalDelivered / totalRiders : 0).toFixed(1)} sub="per active rider" accent="green" />
      </div>

      {/* Trend Charts */}
      <TrendCharts dateRange={dateRange ?? null} sddMode={sddMode} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" />

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search rider..."
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 w-48"
          />
        </div>

        <select value={behaviourFilter} onChange={e => setBehaviourFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
          <option value="all">All Behaviours</option>
          {BEHAVIOUR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <select value={regularityFilter} onChange={e => setRegularityFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
          <option value="all">All Regularity</option>
          {REGULARITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        {isFiltered && (
          <button onClick={() => { setBehaviourFilter('all'); setRegularityFilter('all') }}
            className="text-xs text-slate-500 hover:text-slate-800 underline">
            Clear filters
          </button>
        )}

        <div className="ml-auto flex flex-wrap gap-1">
          {DATE_PRESETS.map(p => (
            <button key={p.value} onClick={() => setDatePreset(p.value)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${datePreset === p.value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-400 font-mono -mt-2">
        {formatNumber(riders.length)} riders · {cities.length} cities
        {isFiltered && <span className="text-blue-500 ml-1">(filtered)</span>}
      </p>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-500 uppercase tracking-wide w-60">City / Hub / Rider</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Riders</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Assigned 3MR</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Attempted</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Delivered</th>
                <th className="text-right px-3 py-3 font-medium text-amber-600 uppercase tracking-wide">Attempt %</th>
                <th className="text-right px-3 py-3 font-medium text-emerald-600 uppercase tracking-wide">Del %</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Avg Earnings</th>
                {/* Rider-level only columns — hidden at city/hub level */}
                <th className="text-right px-3 py-3 font-medium text-orange-500 uppercase tracking-wide">Morn Avg Prod</th>
                <th className="text-right px-3 py-3 font-medium text-indigo-500 uppercase tracking-wide">Eve Avg Prod</th>
                <th className="text-right px-3 py-3 font-medium text-orange-400 uppercase tracking-wide">Morn RS Hr</th>
                <th className="text-right px-3 py-3 font-medium text-indigo-400 uppercase tracking-wide">Eve RS Hr</th>
                <th className="px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Shift</th>
                <th className="px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Regularity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cities.map((city: any) => {
                const cityHubs = hubs.filter((h: any) => h.city === city.city)
                const cityExpanded = expandedCities.has(city.city)
                return (
                  <>
                    <tr key={`city-${city.city}`} className="bg-slate-50 hover:bg-slate-100/80 cursor-pointer font-medium transition-colors" onClick={() => toggleCity(city.city)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {cityExpanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                          <span className="font-semibold text-slate-900">{city.city}</span>
                          <span className="text-[10px] text-slate-400 bg-slate-200/70 px-1.5 py-0.5 rounded">{cityHubs.length} hubs</span>
                        </div>
                      </td>
                      <td className="text-right px-3 py-3 font-mono font-semibold text-blue-600">{formatNumber(city.ridersLoggedIn)}</td>
                      <td className="text-right px-3 py-3 font-mono text-slate-600">{formatNumber(city.assigned3MR)}</td>
                      <td className="text-right px-3 py-3 font-mono text-slate-600">{formatNumber(city.attempted3MR)}</td>
                      <td className="text-right px-3 py-3 font-mono font-semibold text-slate-700">{formatNumber(city.delivered3MR)}</td>
                      <td className="text-right px-3 py-3"><DelPctCell value={city.avgAttemptProductivityPct} /></td>
                      <td className="text-right px-3 py-3"><DelPctCell value={city.avgDeliveredProductivityPct} /></td>
                      <td className="text-right px-3 py-3 font-mono font-semibold text-emerald-600">{formatCurrency(city.ridersLoggedIn > 0 ? city.totalEarnings3MR / city.ridersLoggedIn : 0)}</td>
                      <td colSpan={6} className="px-3 py-3 text-slate-300 text-[10px]">—</td>
                    </tr>

                    {cityExpanded && cityHubs.map((hub: any) => {
                      const hubRiders = filteredRiders.filter((r: any) => r.hub === hub.hub)
                      const hubExpanded = expandedHubs.has(hub.hub)
                      return (
                        <>
                          <tr key={`hub-${hub.hub}`} className="bg-white hover:bg-blue-50/40 cursor-pointer transition-colors" onClick={() => toggleHub(hub.hub)}>
                            <td className="px-4 py-2.5 pl-10">
                              <div className="flex items-center gap-2">
                                {hubExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                                <span className="font-medium text-slate-700">{hub.hub}</span>
                                <span className="text-[10px] text-slate-400">{hub.ridersLoggedIn} riders</span>
                              </div>
                            </td>
                            <td className="text-right px-3 py-2.5 font-mono text-blue-500">{formatNumber(hub.ridersLoggedIn)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-slate-500">{formatNumber(hub.assigned3MR)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-slate-500">{formatNumber(hub.attempted3MR)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-slate-700">{formatNumber(hub.delivered3MR)}</td>
                            <td className="text-right px-3 py-2.5"><DelPctCell value={hub.avgAttemptProductivityPct} /></td>
                            <td className="text-right px-3 py-2.5"><DelPctCell value={hub.avgDeliveredProductivityPct} /></td>
                            <td className="text-right px-3 py-2.5 font-mono text-slate-600">{formatCurrency(hub.ridersLoggedIn > 0 ? hub.totalEarnings3MR / hub.ridersLoggedIn : 0)}</td>
                            <td colSpan={6} className="px-3 py-2.5 text-slate-300 text-[10px]">—</td>
                          </tr>

                          {hubExpanded && hubRiders.map((rider: any) => (
                            <>
                              <tr key={rider.riderId}
                                className={`hover:bg-slate-50/50 transition-colors cursor-pointer ${expandedRiders.has(rider.riderId) ? 'bg-blue-50/40' : 'bg-white'}`}
                                onClick={() => toggleRider(rider.riderId)}>
                                <td className="px-4 py-2.5 pl-16">
                                  <div className="flex items-center gap-2">
                                    {expandedRiders.has(rider.riderId)
                                      ? <ChevronDown className="w-3 h-3 text-blue-400 shrink-0" />
                                      : <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
                                    <span className="font-medium text-slate-800">{rider.riderName}</span>
                                    <span className="text-slate-400 font-mono text-[10px]">{rider.riderId}</span>
                                  </div>
                                </td>
                                <td className="text-right px-3 py-2.5">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-auto" />
                                </td>
                                <td className="text-right px-3 py-2.5 font-mono text-slate-700">{rider.assigned3MR}</td>
                                <td className="text-right px-3 py-2.5 font-mono text-slate-700">{rider.attempted3MR}</td>
                                <td className="text-right px-3 py-2.5 font-mono font-semibold text-slate-800">{rider.delivered3MR}</td>
                                <td className="text-right px-3 py-2.5"><DelPctCell value={rider.attemptProductivityPct} /></td>
                                <td className="text-right px-3 py-2.5"><DelPctCell value={rider.deliveredProductivityPct} /></td>
                                <td className="text-right px-3 py-2.5 font-mono font-semibold text-emerald-600">{formatCurrency(rider.earnings3MR)}</td>
                                {/* Rider-level raw_data fields */}
                                <td className="text-right px-3 py-2.5 font-mono text-orange-600">
                                  {rider.avgMorningProductivity != null ? rider.avgMorningProductivity : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="text-right px-3 py-2.5 font-mono text-indigo-600">
                                  {rider.avgEveningProductivity != null ? rider.avgEveningProductivity : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="text-right px-3 py-2.5 font-mono text-orange-500">
                                  {rider.avgMorningRunsheetHr != null ? `${String(Math.floor(rider.avgMorningRunsheetHr)).padStart(2,'0')}:00` : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="text-right px-3 py-2.5 font-mono text-indigo-500">
                                  {rider.avgEveningRunsheetHr != null ? `${String(Math.floor(rider.avgEveningRunsheetHr)).padStart(2,'0')}:00` : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-3 py-2.5"><BehaviourBadge tag={rider.loginBehaviourTag} /></td>
                                <td className="px-3 py-2.5"><RegularityBadge tag={rider.regularityTag} /></td>
                              </tr>
                              {expandedRiders.has(rider.riderId) && dateRange && (
                                <RiderDrilldown
                                  rider={rider}
                                  dateRange={dateRange}
                                  onClose={() => toggleRider(rider.riderId)}
                                />
                              )}
                            </>
                          ))}
                        </>
                      )
                    })}
                  </>
                )
              })}

              {/* Grand total row */}
              {cities.length > 0 && (
                <tr className="bg-slate-900 text-white font-semibold">
                  <td className="px-4 py-3 font-semibold text-xs uppercase tracking-wide">Total</td>
                  <td className="text-right px-3 py-3 font-mono">{formatNumber(totalRiders)}</td>
                  <td className="text-right px-3 py-3 font-mono">{formatNumber(totalAssigned)}</td>
                  <td className="text-right px-3 py-3 font-mono">{formatNumber(totalAttempted)}</td>
                  <td className="text-right px-3 py-3 font-mono">{formatNumber(totalDelivered)}</td>
                  <td className="text-right px-3 py-3 font-mono text-amber-300">{formatPct(grandAttemptPct)}</td>
                  <td className="text-right px-3 py-3 font-mono text-emerald-300">{formatPct(grandDeliveredPct)}</td>
                  <td className="text-right px-3 py-3 font-mono text-emerald-300">{formatCurrency(avgEarnings)}</td>
                  <td colSpan={6} className="px-3 py-3 text-slate-600 text-[10px]">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
