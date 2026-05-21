'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, Search, SlidersHorizontal, Loader2, Percent, Hash } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { BehaviourBadge, RegularityBadge } from '@/components/profile-badges'
import { MatrixTable } from '@/components/matrix-table'
import { RiderProfileCard } from '@/components/rider-profile-card'
import { formatPct, formatNumber } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag } from '@/lib/types'
import { useConfigState } from '@/components/config-provider'
import { useToast } from '@/components/toast-provider'
import { toApiParams } from '@/lib/config-params'

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

type SortCol = 'city' | 'totalRiders' | 'eveningCount' | 'crossUtilCount' | 'morningCount' | 'regularCount' | 'irregularCount' | 'newRiderCount'
type SortDir = 'asc' | 'desc'

export default function RiderProfilingPage() {
  const { config, configVersion } = useConfigState()
  const toast = useToast()
  const [data, setData] = useState<ApiData | null>(null)
  const [riders, setRiders] = useState<RiderData[]>([])
  const [ridersLoading, setRidersLoading] = useState(true)
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

  // Phase 1: fetch summary (kpi + matrix + cities + hubs) — fast, renders the table immediately
  useEffect(() => {
    setLoading(true)
    toast.register()
    const params = new URLSearchParams()
    if (behaviourFilter !== 'all') params.set('behaviour', behaviourFilter)
    if (regularityFilter !== 'all') params.set('regularity', regularityFilter)
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/profiling?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); toast.completeOne() })
      .catch(e => { setError(e.message); setLoading(false); toast.failAll() })
  }, [behaviourFilter, regularityFilter, configVersion])

  // Phase 2: fetch riders in the background — unblocks initial render
  useEffect(() => {
    setRidersLoading(true)
    setRiders([])
    const params = new URLSearchParams({ riders: '1' })
    if (behaviourFilter !== 'all') params.set('behaviour', behaviourFilter)
    if (regularityFilter !== 'all') params.set('regularity', regularityFilter)
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/profiling?${params}`)
      .then(r => r.json())
      .then(d => { setRiders(d.riders ?? []); setRidersLoading(false) })
      .catch(() => setRidersLoading(false))
  }, [behaviourFilter, regularityFilter, configVersion])

  const toggleCity = (city: string) => setExpandedCities(prev => { const n = new Set(prev); n.has(city) ? n.delete(city) : n.add(city); return n })
  const toggleHub = (hub: string) => setExpandedHubs(prev => { const n = new Set(prev); n.has(hub) ? n.delete(hub) : n.add(hub); return n })
  const toggleRider = (riderId: string) => setExpandedRiders(prev => { const n = new Set(prev); n.has(riderId) ? n.delete(riderId) : n.add(riderId); return n })

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" />Loading rider profiles...</div>
  if (error || !data) return <div className="text-red-600 py-8">Error: {error}</div>

  const { kpi, cities, hubs } = data
  const total = kpi.totalRiders

  const filteredRiders = riders.filter(r =>
    !search || r.riderName.toLowerCase().includes(search.toLowerCase()) || r.riderId.toLowerCase().includes(search.toLowerCase()),
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
  const fmtTotal = (count: number, denom: number) => showPct ? formatPct(denom > 0 ? (count / denom) * 100 : 0) : formatNumber(count)

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
        <StatCard label="Cross Utilised" value={formatNumber(kpi.crossUtilCount)} sub={formatPct(kpi.crossUtilCount * 100 / total)} accent="sky" />
        <StatCard label="Morning" value={formatNumber(kpi.morningCount)} sub={formatPct(kpi.morningCount * 100 / total)} accent="amber" />
        <StatCard label="Regular" value={formatNumber(kpi.regularCount)} sub={formatPct(kpi.regularCount * 100 / total)} accent="green" />
        <StatCard label="Irregular" value={formatNumber(kpi.irregularCount)} sub={formatPct(kpi.irregularCount * 100 / total)} accent="amber" />
        <StatCard label="New Riders" value={formatNumber(kpi.newRiderCount)} sub={formatPct(kpi.newRiderCount * 100 / total)} accent="sky" />
      </div>

      <MatrixTable />

      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rider..." className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light w-48" />
        </div>
        <select value={behaviourFilter} onChange={e => setBehaviourFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light">
          <option value="all">All Behaviours</option>
          {BEHAVIOUR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={regularityFilter} onChange={e => setRegularityFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light">
          <option value="all">All Regularity</option>
          {REGULARITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {!showAll && <button onClick={() => { setSearch(''); setBehaviourFilter('all'); setRegularityFilter('all') }} className="text-xs text-slate-500 hover:text-slate-800 underline">Clear filters</button>}
        <div className="ml-auto flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button onClick={() => setShowPct(false)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${!showPct ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Hash className="w-3 h-3" />Count</button>
          <button onClick={() => setShowPct(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${showPct ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Percent className="w-3 h-3" />%</button>
        </div>
      </div>

      <p className="text-xs text-slate-400 font-mono -mt-2">
        {showAll
          ? `${formatNumber(total)} riders · ${displayCities.length} cities`
          : hasSearchFilter
            ? ridersLoading
              ? `Searching… · ${displayCities.length} cities shown`
              : `${formatNumber(filteredRiders.length)} of ${formatNumber(total)} riders matching search · ${displayCities.length} cities shown`
            : `${formatNumber(total)} riders (filtered) · ${displayCities.length} cities`}
      </p>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-500 uppercase tracking-wide w-60 cursor-pointer select-none" onClick={() => toggleSort('city')}>City / Hub / Rider<SortIcon col="city" /></th>
                <th className="text-right px-3 py-3 font-medium text-slate-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('totalRiders')}>Avg/Day<SortIcon col="totalRiders" /></th>
                <th className="text-right px-3 py-3 font-medium text-indigo-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('eveningCount')}>Evening{showPct ? ' %' : ''}<SortIcon col="eveningCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-violet-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('crossUtilCount')}>Cross{showPct ? ' %' : ''}<SortIcon col="crossUtilCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-orange-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('morningCount')}>Morning{showPct ? ' %' : ''}<SortIcon col="morningCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-emerald-600 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('regularCount')}>Regular{showPct ? ' %' : ''}<SortIcon col="regularCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-amber-600 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('irregularCount')}>Irregular{showPct ? ' %' : ''}<SortIcon col="irregularCount" /></th>
                <th className="text-right px-3 py-3 font-medium text-sky-500 uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('newRiderCount')}>New{showPct ? ' %' : ''}<SortIcon col="newRiderCount" /></th>
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
                  <CityGroup
                    key={`city-${city.city}`}
                    city={city}
                    cityHubs={cityHubs}
                    cityExpanded={cityExpanded}
                    expandedHubs={expandedHubs}
                    expandedRiders={expandedRiders}
                    hubMap={hubMap}
                    riders={riders}
                    ridersLoading={ridersLoading}
                    showAll={showAll}
                    showPct={showPct}
                    fmt={fmt}
                    onToggleCity={toggleCity}
                    onToggleHub={toggleHub}
                    onToggleRider={toggleRider}
                  />
                )
              })}
              <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold">
                <td className="px-4 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide">Grand Total</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-slate-900">{formatNumber(grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-indigo-700">{fmtTotal(grandTotal.eveningCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-violet-700">{fmtTotal(grandTotal.crossUtilCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-orange-700">{fmtTotal(grandTotal.morningCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-emerald-700">{fmtTotal(grandTotal.regularCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-amber-700">{fmtTotal(grandTotal.irregularCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-sky-700">{fmtTotal(grandTotal.newRiderCount, grandTotal.totalRiders)}</td>
                <td colSpan={4} className="px-3 py-3 text-slate-400 text-[10px]">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

interface CityGroupProps {
  city: CityData
  cityHubs: HubData[]
  cityExpanded: boolean
  expandedHubs: Set<string>
  expandedRiders: Set<string>
  hubMap: Map<string, RiderData[]>
  riders: RiderData[]
  ridersLoading: boolean
  showAll: boolean
  showPct: boolean
  fmt: (count: number, pct: number) => string
  onToggleCity: (city: string) => void
  onToggleHub: (hub: string) => void
  onToggleRider: (riderId: string) => void
}

function CityGroup({
  city, cityHubs, cityExpanded, expandedHubs, expandedRiders,
  hubMap, riders, ridersLoading, showAll, fmt,
  onToggleCity, onToggleHub, onToggleRider,
}: CityGroupProps) {
  return (
    <>
      <tr className="bg-slate-50 hover:bg-slate-100/80 cursor-pointer font-medium transition-colors" onClick={() => onToggleCity(city.city)}>
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
        <td className="text-right px-3 py-3 font-mono text-sky-600">{fmt(city.newRiderCount, city.newRiderPct)}</td>
        <td colSpan={4} className="px-3 py-3 text-slate-300 text-[10px]">—</td>
      </tr>

      {cityExpanded && cityHubs.map(hub => {
        const hubRiders = showAll ? riders.filter(r => r.hub === hub.hub) : (hubMap.get(hub.hub) ?? [])
        const hubExpanded = expandedHubs.has(hub.hub)
        return (
          <HubGroup
            key={`hub-${hub.hub}`}
            hub={hub}
            hubRiders={hubRiders}
            hubExpanded={hubExpanded}
            ridersLoading={ridersLoading}
            expandedRiders={expandedRiders}
            fmt={fmt}
            onToggleHub={onToggleHub}
            onToggleRider={onToggleRider}
          />
        )
      })}
    </>
  )
}

interface HubGroupProps {
  hub: HubData
  hubRiders: RiderData[]
  hubExpanded: boolean
  ridersLoading: boolean
  expandedRiders: Set<string>
  fmt: (count: number, pct: number) => string
  onToggleHub: (hub: string) => void
  onToggleRider: (riderId: string) => void
}

function HubGroup({ hub, hubRiders, hubExpanded, ridersLoading, expandedRiders, fmt, onToggleHub, onToggleRider }: HubGroupProps) {
  return (
    <>
      <tr className="bg-white hover:bg-sfx-orange/5 cursor-pointer transition-colors" onClick={() => onToggleHub(hub.hub)}>
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
        <td className="text-right px-3 py-2.5 font-mono text-sky-500">{fmt(hub.newRiderCount, hub.newRiderPct)}</td>
        <td colSpan={4} className="px-3 py-2.5 text-slate-300 text-[10px]">—</td>
      </tr>

      {hubExpanded && ridersLoading && (
        <tr><td colSpan={12} className="px-4 py-3 pl-16 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin inline-block mr-1" />Loading riders…</td></tr>
      )}
      {hubExpanded && !ridersLoading && hubRiders.map(rider => (
        <RiderRowGroup
          key={`rider-${rider.riderId}`}
          rider={rider}
          expanded={expandedRiders.has(rider.riderId)}
          onToggle={onToggleRider}
        />
      ))}
    </>
  )
}

function RiderRowGroup({ rider, expanded, onToggle }: { rider: RiderData; expanded: boolean; onToggle: (id: string) => void }) {
  return (
    <>
      <tr
        className={`transition-colors cursor-pointer ${expanded ? 'bg-sfx-orange/10' : 'bg-white hover:bg-slate-50/60'}`}
        onClick={() => onToggle(rider.riderId)}
      >
        <td className="px-4 py-2.5 pl-16">
          <div className="flex items-center gap-2">
            {expanded
              ? <ChevronDown className="w-3 h-3 text-sfx-orange shrink-0" />
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
      {expanded && <RiderProfileCard rider={rider} />}
    </>
  )
}
