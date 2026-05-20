'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown, Search, SlidersHorizontal, Loader2, Percent, Hash, X } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { BehaviourBadge, RegularityBadge } from '@/components/profile-badges'
import { formatPct, formatNumber } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag } from '@/lib/types'

const BEHAVIOUR_OPTIONS: LoginBehaviourTag[] = ['Evening Rider', 'Cross Utilised', 'Morning Rider']
const REGULARITY_OPTIONS: RegularityTag[] = ['Regular', 'Irregular', 'New Rider']

interface CityData {
  city: string; zone: string; totalRiders: number
  eveningCount: number; crossUtilCount: number; morningCount: number
  regularCount: number; irregularCount: number; newRiderCount: number
  eveningRiderPct: number; crossUtilisedPct: number; morningRiderPct: number
  regularPct: number; irregularPct: number; newRiderPct: number
}
interface HubData extends CityData { hub: string }
interface RiderData {
  riderId: string; riderName: string; hub: string; city: string
  loginBehaviourTag: LoginBehaviourTag; regularityTag: RegularityTag
  loginRatePct: number; morningLogins: number; eveningLogins: number
  firstLoginDate: string; activeSinceDays: number
}
interface MatrixCell { evening: number; cross: number; morning: number; total: number }
interface ApiData {
  kpi: { totalRiders: number; eveningCount: number; crossUtilCount: number; morningCount: number; regularCount: number; irregularCount: number; newRiderCount: number }
  matrix: { Regular: MatrixCell; Irregular: MatrixCell; 'New Rider': MatrixCell }
  cities: CityData[]
  hubs: HubData[]
  riders: RiderData[]
}

type MatrixData = { matrix: ApiData['matrix']; total: number; cities: string[]; hubs: string[] }

function MatrixTable() {
  const [result, setResult] = useState<MatrixData | null>(null)
  const [loadingMatrix, setLoadingMatrix] = useState(true)

  // Draft state — only committed on Apply
  const [draftCity, setDraftCity] = useState('all')
  const [draftHub, setDraftHub] = useState('all')
  // Applied state — drives fetch
  const [appliedCity, setAppliedCity] = useState('all')
  const [appliedHub, setAppliedHub] = useState('all')

  const isDirty = draftCity !== appliedCity || draftHub !== appliedHub
  const isFiltered = appliedCity !== 'all' || appliedHub !== 'all'

  const fetchMatrix = useCallback((city: string, hub: string) => {
    setLoadingMatrix(true)
    const params = new URLSearchParams()
    if (city !== 'all') params.set('city', city)
    if (hub !== 'all') params.set('hub', hub)
    fetch(`/api/profiling/matrix?${params}`)
      .then(r => r.json())
      .then(d => { setResult(d); setLoadingMatrix(false) })
      .catch(() => setLoadingMatrix(false))
  }, [])

  // Initial load
  useEffect(() => { fetchMatrix('all', 'all') }, [fetchMatrix])

  // When city changes in draft, reset hub draft and re-fetch hub list
  function handleCityChange(city: string) {
    setDraftCity(city)
    setDraftHub('all')
    // Fetch updated hub list for this city (without applying)
    const params = new URLSearchParams()
    if (city !== 'all') params.set('city', city)
    fetch(`/api/profiling/matrix?${params}`)
      .then(r => r.json())
      .then(d => setResult(prev => prev ? { ...prev, hubs: d.hubs } : d))
      .catch(() => {})
  }

  function handleApply() {
    setAppliedCity(draftCity)
    setAppliedHub(draftHub)
    fetchMatrix(draftCity, draftHub)
  }

  function handleClear() {
    setDraftCity('all')
    setDraftHub('all')
    setAppliedCity('all')
    setAppliedHub('all')
    fetchMatrix('all', 'all')
  }

  const ROWS: { key: keyof ApiData['matrix']; label: string; color: string }[] = [
    { key: 'Regular',    label: 'Regular',    color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    { key: 'Irregular',  label: 'Irregular',  color: 'text-amber-700 bg-amber-50 border-amber-200' },
    { key: 'New Rider',  label: 'New Rider',  color: 'text-blue-700 bg-blue-50 border-blue-200' },
  ]
  const COLS = [
    { key: 'evening' as const, label: 'Evening',    color: 'text-indigo-700' },
    { key: 'cross'   as const, label: 'Cross Util', color: 'text-violet-700' },
    { key: 'morning' as const, label: 'Morning',    color: 'text-orange-700' },
  ]

  const matrix = result?.matrix ?? { Regular: { evening:0, cross:0, morning:0, total:0 }, Irregular: { evening:0, cross:0, morning:0, total:0 }, 'New Rider': { evening:0, cross:0, morning:0, total:0 } }
  const total = result?.total ?? 0
  const cityOptions = result?.cities ?? []
  const hubOptions = result?.hubs ?? []

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header + filter bar */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Regularity × Behaviour Matrix</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">Last 30 days · Login rate = days logged in / 30 calendar days</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* City dropdown */}
            <select
              value={draftCity}
              onChange={e => handleCityChange(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 min-w-[120px]"
            >
              <option value="all">All Cities</option>
              {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Hub dropdown — scoped to selected city */}
            <select
              value={draftHub}
              onChange={e => setDraftHub(e.target.value)}
              disabled={hubOptions.length === 0}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 min-w-[160px] disabled:opacity-40"
            >
              <option value="all">{draftCity === 'all' ? 'All Hubs' : `All Hubs in ${draftCity}`}</option>
              {hubOptions.map(h => <option key={h} value={h}>{h}</option>)}
            </select>

            {/* Apply button — only active when draft differs from applied */}
            <button
              onClick={handleApply}
              disabled={!isDirty}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${isDirty ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400 cursor-default'}`}
            >
              Apply
            </button>

            {/* Clear — only visible when a filter is applied */}
            {isFiltered && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors"
              >
                <X className="w-3 h-3" />Clear
              </button>
            )}

            {/* Scope label */}
            {isFiltered && (
              <span className="text-[10px] text-slate-400 font-mono">
                {appliedCity !== 'all' ? appliedCity : ''}
                {appliedCity !== 'all' && appliedHub !== 'all' ? ' › ' : ''}
                {appliedHub !== 'all' ? appliedHub : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto relative">
        {loadingMatrix && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          </div>
        )}
        {/* Transposed: Behaviour = rows, Regularity = columns */}
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-medium text-slate-500 w-36">Behaviour ↓ / Regularity →</th>
              {ROWS.map(r => (
                <th key={r.key} className={`text-center px-4 py-2.5 font-semibold uppercase tracking-wide ${r.color.split(' ')[0]}`}>{r.label}</th>
              ))}
              <th className="text-center px-4 py-2.5 font-medium text-slate-500 uppercase tracking-wide">Row Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {COLS.map(col => {
              // For this behaviour row, collect count per regularity bucket
              const regValues = ROWS.map(row => (matrix[row.key]?.[col.key] ?? 0))
              const rowTotal = regValues.reduce((s, v) => s + v, 0)
              return (
                <tr key={col.key} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                      col.key === 'evening' ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
                      : col.key === 'cross' ? 'text-violet-700 bg-violet-50 border-violet-200'
                      : 'text-orange-700 bg-orange-50 border-orange-200'
                    }`}>
                      {col.label}
                    </span>
                  </td>
                  {ROWS.map((row, i) => (
                    <td key={row.key} className="px-4 py-3 text-center">
                      <div className={`font-mono font-semibold text-sm ${row.color.split(' ')[0]}`}>{regValues[i].toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{total > 0 ? ((regValues[i] / total) * 100).toFixed(1) : '0.0'}%</div>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center">
                    <div className={`font-mono font-bold text-sm ${col.color}`}>{rowTotal.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{total > 0 ? ((rowTotal / total) * 100).toFixed(1) : '0.0'}%</div>
                  </td>
                </tr>
              )
            })}
            {/* Column totals = Regularity totals */}
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="px-4 py-2.5 text-xs font-bold text-slate-600 uppercase tracking-wide">Col Total</td>
              {ROWS.map(row => {
                const cell = matrix[row.key] ?? { evening: 0, cross: 0, morning: 0, total: 0 }
                return (
                  <td key={row.key} className="px-4 py-2.5 text-center">
                    <div className={`font-mono font-bold text-sm ${row.color.split(' ')[0]}`}>{cell.total.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{total > 0 ? ((cell.total / total) * 100).toFixed(1) : '0.0'}%</div>
                  </td>
                )
              })}
              <td className="px-4 py-2.5 text-center">
                <div className="font-mono font-bold text-sm text-slate-900">{total.toLocaleString()}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">100%</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RiderDetailCard({ rider }: { rider: RiderData }) {
  const totalWindow = 30
  const loginDays = Math.round((rider.loginRatePct / 100) * totalWindow)
  return (
    <tr>
      <td colSpan={12} className="px-0 py-0 border-b border-slate-100">
        <div className="bg-slate-50/80 border-y border-slate-200 px-16 py-4">
          <div className="grid grid-cols-3 gap-6">
            {/* Identity */}
            <div>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-2">Identity</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Rider ID</span>
                  <span className="font-mono font-medium text-slate-700">{rider.riderId}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Hub</span>
                  <span className="font-medium text-slate-700">{rider.hub}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">City</span>
                  <span className="font-medium text-slate-700">{rider.city}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">First Login</span>
                  <span className="font-mono text-slate-600">{rider.firstLoginDate || '—'}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Active Since</span>
                  <span className="font-mono text-slate-600">{rider.activeSinceDays}d ago</span>
                </div>
              </div>
            </div>

            {/* Login Stats */}
            <div>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-2">Login Activity (Last 30 Days)</p>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Days Logged In</span>
                  <span className="font-mono font-semibold text-slate-800">{loginDays} / {totalWindow}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Login Rate</span>
                  <span className={`font-mono font-semibold ${rider.loginRatePct >= 80 ? 'text-emerald-600' : rider.loginRatePct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{formatPct(rider.loginRatePct)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Morning Days</span>
                  <span className="font-mono text-orange-600">{rider.morningLogins}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500">Evening Days</span>
                  <span className="font-mono text-indigo-600">{rider.eveningLogins}</span>
                </div>
                {/* Login rate progress bar */}
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

            {/* Classification */}
            <div>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-2">Classification</p>
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

type SortCol = 'city' | 'totalRiders' | 'eveningCount' | 'crossUtilCount' | 'morningCount' | 'regularCount' | 'irregularCount' | 'newRiderCount'
type SortDir = 'asc' | 'desc'

export default function RiderProfilingPage() {
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set())
  const [expandedHubs, setExpandedHubs] = useState<Set<string>>(new Set())
  const [expandedRiders, setExpandedRiders] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [behaviourFilter, setBehaviourFilter] = useState<string>('all')
  const [regularityFilter, setRegularityFilter] = useState<string>('all')
  const [showPct, setShowPct] = useState(false)
  const [sortCol, setSortCol] = useState<SortCol>('totalRiders')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (behaviourFilter !== 'all') params.set('behaviour', behaviourFilter)
    if (regularityFilter !== 'all') params.set('regularity', regularityFilter)
    fetch(`/api/profiling?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [behaviourFilter, regularityFilter])

  function toggleCity(city: string) {
    setExpandedCities(prev => { const n = new Set(prev); n.has(city) ? n.delete(city) : n.add(city); return n })
  }
  function toggleHub(hub: string) {
    setExpandedHubs(prev => { const n = new Set(prev); n.has(hub) ? n.delete(hub) : n.add(hub); return n })
  }
  function toggleRider(riderId: string) {
    setExpandedRiders(prev => { const n = new Set(prev); n.has(riderId) ? n.delete(riderId) : n.add(riderId); return n })
  }

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" />Loading rider profiles...</div>
  if (error || !data) return <div className="text-red-600 py-8">Error: {error}</div>

  const { kpi, cities, hubs, riders } = data
  const total = kpi.totalRiders

  // API handles behaviour/regularity filters — only search is client-side
  const filteredRiders = riders.filter(r =>
    !search || r.riderName.toLowerCase().includes(search.toLowerCase()) || r.riderId.toLowerCase().includes(search.toLowerCase())
  )

  const hubMap = new Map<string, typeof filteredRiders>()
  for (const r of filteredRiders) {
    if (!hubMap.has(r.hub)) hubMap.set(r.hub, [])
    hubMap.get(r.hub)!.push(r)
  }

  const hasSearchFilter = search.length > 0
  const visibleCities = cities.filter(c => hubs.some(h => h.city === c.city && hubMap.has(h.hub) && (hubMap.get(h.hub)?.length ?? 0) > 0))
  const unsortedCities = hasSearchFilter ? visibleCities : cities
  const showAll = !hasSearchFilter && behaviourFilter === 'all' && regularityFilter === 'all'

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const displayCities = [...unsortedCities].sort((a, b) => {
    const v = sortCol === 'city' ? a.city.localeCompare(b.city) : (a[sortCol] as number) - (b[sortCol] as number)
    return sortDir === 'asc' ? v : -v
  })

  // Grand total across all visible cities
  const grandTotal = {
    totalRiders: displayCities.reduce((s, c) => s + c.totalRiders, 0),
    eveningCount: displayCities.reduce((s, c) => s + c.eveningCount, 0),
    crossUtilCount: displayCities.reduce((s, c) => s + c.crossUtilCount, 0),
    morningCount: displayCities.reduce((s, c) => s + c.morningCount, 0),
    regularCount: displayCities.reduce((s, c) => s + c.regularCount, 0),
    irregularCount: displayCities.reduce((s, c) => s + c.irregularCount, 0),
    newRiderCount: displayCities.reduce((s, c) => s + c.newRiderCount, 0),
  }

  const fmt = (count: number, pct: number) => showPct ? formatPct(pct) : formatNumber(count)
  const fmtTotal = (count: number, total: number) =>
    showPct ? formatPct(total > 0 ? (count / total) * 100 : 0) : formatNumber(count)

  const SortIcon = ({ col }: { col: SortCol }) => (
    <span className="ml-1 inline-block opacity-50">
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Rider Profiling</h1>
        <p className="text-sm text-slate-500 mt-0.5">Login behaviour and regularity classification · Last 30 days</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Total Riders" value={formatNumber(total)} />
        <StatCard label="Evening" value={formatNumber(kpi.eveningCount)} sub={formatPct(kpi.eveningCount * 100 / total)} accent="purple" />
        <StatCard label="Cross Utilised" value={formatNumber(kpi.crossUtilCount)} sub={formatPct(kpi.crossUtilCount * 100 / total)} accent="blue" />
        <StatCard label="Morning" value={formatNumber(kpi.morningCount)} sub={formatPct(kpi.morningCount * 100 / total)} accent="amber" />
        <StatCard label="Regular" value={formatNumber(kpi.regularCount)} sub={formatPct(kpi.regularCount * 100 / total)} accent="green" />
        <StatCard label="Irregular" value={formatNumber(kpi.irregularCount)} sub={formatPct(kpi.irregularCount * 100 / total)} accent="amber" />
        <StatCard label="New Riders" value={formatNumber(kpi.newRiderCount)} sub={formatPct(kpi.newRiderCount * 100 / total)} accent="blue" />
      </div>

      <MatrixTable />

      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rider..." className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 w-48" />
        </div>
        <select value={behaviourFilter} onChange={e => setBehaviourFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
          <option value="all">All Behaviours</option>
          {BEHAVIOUR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={regularityFilter} onChange={e => setRegularityFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400">
          <option value="all">All Regularity</option>
          {REGULARITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {!showAll && <button onClick={() => { setSearch(''); setBehaviourFilter('all'); setRegularityFilter('all') }} className="text-xs text-slate-500 hover:text-slate-800 underline">Clear filters</button>}
        <div className="ml-auto flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button onClick={() => setShowPct(false)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${!showPct ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Hash className="w-3 h-3" />Count</button>
          <button onClick={() => setShowPct(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${showPct ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Percent className="w-3 h-3" />%</button>
        </div>
      </div>

      {/* Result count */}
      <p className="text-xs text-slate-400 font-mono -mt-2">
        {showAll
          ? `${formatNumber(total)} riders · ${displayCities.length} cities`
          : hasSearchFilter
            ? `${formatNumber(filteredRiders.length)} of ${formatNumber(total)} riders matching search · ${displayCities.length} cities shown`
            : `${formatNumber(total)} riders (filtered) · ${displayCities.length} cities`}
      </p>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-500 uppercase tracking-wide w-60 cursor-pointer select-none" onClick={() => toggleSort('city')}>City / Hub / Rider<SortIcon col="city" /></th>
                <th className="text-right px-3 py-3 font-medium text-slate-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('totalRiders')}>Riders<SortIcon col="totalRiders" /></th>
                <th className="text-right px-3 py-3 font-medium text-indigo-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('eveningCount')}>Evening{showPct ? ' %' : ''}<SortIcon col="eveningCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-violet-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('crossUtilCount')}>Cross Util{showPct ? ' %' : ''}<SortIcon col="crossUtilCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-orange-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('morningCount')}>Morning{showPct ? ' %' : ''}<SortIcon col="morningCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-emerald-600 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('regularCount')}>Regular{showPct ? ' %' : ''}<SortIcon col="regularCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-amber-600 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('irregularCount')}>Irregular{showPct ? ' %' : ''}<SortIcon col="irregularCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-blue-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('newRiderCount')}>New{showPct ? ' %' : ''}<SortIcon col="newRiderCount" /></th>
                <th className="px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Behaviour</th>
                <th className="px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Regularity</th>
                <th className="text-right px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Login Rate</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500 uppercase tracking-wide">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayCities.map(city => {
                const cityHubs = hubs.filter(h => h.city === city.city)
                const cityExpanded = expandedCities.has(city.city)
                return (
                  <>
                    {/* City row */}
                    <tr key={`city-${city.city}`} className="bg-slate-50 hover:bg-slate-100/80 cursor-pointer font-medium transition-colors" onClick={() => toggleCity(city.city)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {cityExpanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                          <span className="text-slate-900 font-semibold">{city.city}</span>
                          <span className="text-[10px] text-slate-400 bg-slate-200/70 px-1.5 py-0.5 rounded">{cityHubs.length} hubs</span>
                        </div>
                      </td>
                      <td className="text-right px-3 py-3 font-mono font-semibold text-slate-800">{formatNumber(city.totalRiders)}</td>
                      <td className="text-right px-3 py-3 font-mono text-indigo-600">{fmt(city.eveningCount, city.eveningRiderPct)}</td>
                      <td className="text-right px-3 py-3 font-mono text-violet-600">{fmt(city.crossUtilCount, city.crossUtilisedPct)}</td>
                      <td className="text-right px-3 py-3 font-mono text-orange-600">{fmt(city.morningCount, city.morningRiderPct)}</td>
                      <td className="text-right px-3 py-3 font-mono text-emerald-600">{fmt(city.regularCount, city.regularPct)}</td>
                      <td className="text-right px-3 py-3 font-mono text-amber-600">{fmt(city.irregularCount, city.irregularPct)}</td>
                      <td className="text-right px-3 py-3 font-mono text-blue-600">{fmt(city.newRiderCount, city.newRiderPct)}</td>
                      <td colSpan={4} className="px-3 py-3 text-slate-300 text-[10px]">—</td>
                    </tr>

                    {cityExpanded && cityHubs.map(hub => {
                      const hubRiders = showAll ? riders.filter(r => r.hub === hub.hub) : (hubMap.get(hub.hub) ?? [])
                      const hubExpanded = expandedHubs.has(hub.hub)
                      return (
                        <>
                          {/* Hub row */}
                          <tr key={`hub-${hub.hub}`} className="bg-white hover:bg-blue-50/40 cursor-pointer transition-colors" onClick={() => toggleHub(hub.hub)}>
                            <td className="px-4 py-2.5 pl-10">
                              <div className="flex items-center gap-2">
                                {hubExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                                <span className="text-slate-700 font-medium">{hub.hub}</span>
                                <span className="text-[10px] text-slate-400">{hub.totalRiders} riders</span>
                              </div>
                            </td>
                            <td className="text-right px-3 py-2.5 font-mono text-slate-700">{formatNumber(hub.totalRiders)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-indigo-500">{fmt(hub.eveningCount, hub.eveningRiderPct)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-violet-500">{fmt(hub.crossUtilCount, hub.crossUtilisedPct)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-orange-500">{fmt(hub.morningCount, hub.morningRiderPct)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-emerald-500">{fmt(hub.regularCount, hub.regularPct)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-amber-500">{fmt(hub.irregularCount, hub.irregularPct)}</td>
                            <td className="text-right px-3 py-2.5 font-mono text-blue-500">{fmt(hub.newRiderCount, hub.newRiderPct)}</td>
                            <td colSpan={4} className="px-3 py-2.5 text-slate-300 text-[10px]">—</td>
                          </tr>

                          {hubExpanded && hubRiders.map(rider => (
                            <>
                              {/* Rider row — clickable to expand detail */}
                              <tr
                                key={`rider-${rider.riderId}`}
                                className={`transition-colors cursor-pointer ${expandedRiders.has(rider.riderId) ? 'bg-blue-50/60' : 'bg-white hover:bg-slate-50/60'}`}
                                onClick={() => toggleRider(rider.riderId)}
                              >
                                <td className="px-4 py-2.5 pl-16">
                                  <div className="flex items-center gap-2">
                                    {expandedRiders.has(rider.riderId)
                                      ? <ChevronDown className="w-3 h-3 text-blue-400 shrink-0" />
                                      : <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
                                    <span className="font-medium text-slate-800">{rider.riderName}</span>
                                    <span className="text-slate-400 font-mono text-[10px]">{rider.riderId}</span>
                                  </div>
                                </td>
                                <td className="text-right px-3 py-2.5 text-slate-300 text-[10px]">—</td>
                                <td colSpan={6} className="px-3 py-2.5 text-slate-300 text-[10px]">—</td>
                                <td className="px-3 py-2.5"><BehaviourBadge tag={rider.loginBehaviourTag} /></td>
                                <td className="px-3 py-2.5"><RegularityBadge tag={rider.regularityTag} /></td>
                                <td className={`text-right px-3 py-2.5 font-mono font-semibold ${rider.loginRatePct >= 80 ? 'text-emerald-600' : rider.loginRatePct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                  {formatPct(rider.loginRatePct)}
                                </td>
                                <td className="text-right px-4 py-2.5 font-mono text-slate-500">{rider.activeSinceDays}d</td>
                              </tr>

                              {/* Rider detail expand */}
                              {expandedRiders.has(rider.riderId) && (
                                <RiderDetailCard rider={rider} />
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
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold">
                <td className="px-4 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide">Grand Total</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-slate-900">{formatNumber(grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-indigo-700">{fmtTotal(grandTotal.eveningCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-violet-700">{fmtTotal(grandTotal.crossUtilCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-orange-700">{fmtTotal(grandTotal.morningCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-emerald-700">{fmtTotal(grandTotal.regularCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-amber-700">{fmtTotal(grandTotal.irregularCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-blue-700">{fmtTotal(grandTotal.newRiderCount, grandTotal.totalRiders)}</td>
                <td colSpan={4} className="px-3 py-3 text-slate-400 text-[10px]">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
