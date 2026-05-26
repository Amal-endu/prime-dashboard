'use client'

import { useState, useEffect, useMemo } from 'react'
import { ChevronRight, ChevronDown, Search, SlidersHorizontal, Loader2, Percent, Hash, Download } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { BehaviourBadge, RegularityBadge } from '@/components/profile-badges'
import { MatrixTable } from '@/components/matrix-table'
import { RiderProfileCard } from '@/components/rider-profile-card'
import { formatPct, formatNumber } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag } from '@/lib/types'
import { useConfigState } from '@/components/config-provider'
import { useToast } from '@/components/toast-provider'
import { toApiParams } from '@/lib/config-params'
import * as XLSX from 'xlsx'

const BEHAVIOUR_OPTIONS: LoginBehaviourTag[] = ['Evening Rider', 'Cross Utilised', 'Morning Rider']
const REGULARITY_OPTIONS: RegularityTag[] = ['Regular', 'Irregular', 'New Rider']

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}


interface CityData {
  city: string; zone: string; totalRiders: number; totalUniqueRiders: number
  eveningCount: number; crossUtilCount: number; morningCount: number
  eveningRiderPct: number; crossUtilisedPct: number; morningRiderPct: number
  avgMorningLoginHr: number | null; avgMorningAtp: number | null
  avgEveningLoginHr: number | null; avgEveningAtp: number | null
}
interface HubData extends CityData { hub: string }
interface RiderData {
  riderId: number; riderName: string; hub: string; city: string
  loginBehaviourTag: LoginBehaviourTag; regularityTag: RegularityTag
  loginRatePct: number; morningLogins: number; eveningLogins: number
  firstLoginDate: string; lastLoginDate: string; daysSinceLastLogin: number; activeSinceDays: number
  avgMorningLoginHr: number | null; avgMorningAtp: number | null
  avgEveningLoginHr: number | null; avgEveningAtp: number | null
}
interface MatrixCell { evening: number; cross: number; morning: number; total: number }
interface ApiData {
  kpi: { totalRiders: number; eveningCount: number; crossUtilCount: number; morningCount: number; regularCount: number; irregularCount: number; newRiderCount: number }
  matrix: { Regular: MatrixCell; Irregular: MatrixCell; 'New Rider': MatrixCell }
  cities: CityData[]
  hubs: HubData[]
  riders: RiderData[]
  anchorDate?: string
}

type SortCol = 'city' | 'totalRiders' | 'eveningCount' | 'crossUtilCount' | 'morningCount' | 'avgMorningAtp' | 'avgEveningAtp'
type SortDir = 'asc' | 'desc'

function sortHubs(hubs: HubData[], col: SortCol, dir: SortDir): HubData[] {
  return [...hubs].sort((a, b) => {
    let av: number | string, bv: number | string
    if (col === 'city') { av = a.hub; bv = b.hub }
    else { av = (a[col] as number | null) ?? -1; bv = (b[col] as number | null) ?? -1 }
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
    return dir === 'asc' ? av - (bv as number) : (bv as number) - av
  })
}

function sortRiders(riders: RiderData[], col: SortCol, dir: SortDir): RiderData[] {
  return [...riders].sort((a, b) => {
    let av: number | string, bv: number | string
    switch (col) {
      case 'city':          av = a.riderName;          bv = b.riderName;          break
      case 'totalRiders':   av = a.loginRatePct;       bv = b.loginRatePct;       break
      case 'eveningCount':  av = a.eveningLogins;       bv = b.eveningLogins;      break
      case 'crossUtilCount':av = a.morningLogins + a.eveningLogins; bv = b.morningLogins + b.eveningLogins; break
      case 'morningCount':  av = a.morningLogins;       bv = b.morningLogins;      break
      case 'avgMorningAtp': av = a.avgMorningAtp ?? -1; bv = b.avgMorningAtp ?? -1; break
      case 'avgEveningAtp': av = a.avgEveningAtp ?? -1; bv = b.avgEveningAtp ?? -1; break
    }
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
    return dir === 'asc' ? av - (bv as number) : (bv as number) - av
  })
}

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
  const [expandedRiders, setExpandedRiders] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState('')
  const [behaviourFilter, setBehaviourFilter] = useState<string>('all')
  const [regularityFilter, setRegularityFilter] = useState<string>('all')
  const [showPct, setShowPct] = useState(false)
  const [sortCol, setSortCol] = useState<SortCol>('totalRiders')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [anchorDate, setAnchorDate] = useState<string | null>(null)

  // City/Hub filter state — draft (UI) vs applied (API)
  const [draftCity, setDraftCity] = useState('all')
  const [draftHub, setDraftHub] = useState('all')
  const [appliedCity, setAppliedCity] = useState('all')
  const [appliedHub, setAppliedHub] = useState('all')

  const isDirty = draftCity !== appliedCity || draftHub !== appliedHub
  const isFiltered = appliedCity !== 'all' || appliedHub !== 'all' || behaviourFilter !== 'all' || regularityFilter !== 'all' || search.length > 0

  // Fetch anchor date once
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      if (d.maxDateRaw) setAnchorDate(d.maxDateRaw)
    }).catch(() => {})
  }, [])

  // Derive available hubs for selected draft city
  const availableHubs = useMemo(() => {
    if (!data?.hubs) return []
    if (draftCity === 'all') return data.hubs.map(h => h.hub)
    return data.hubs.filter(h => h.city === draftCity).map(h => h.hub)
  }, [data, draftCity])

  // Phase 1: fetch summary (kpi + matrix + cities + hubs)
  useEffect(() => {
    setLoading(true)
    toast.register()
    const params = new URLSearchParams()
    if (behaviourFilter !== 'all') params.set('behaviour', behaviourFilter)
    if (regularityFilter !== 'all') params.set('regularity', regularityFilter)
    if (appliedCity !== 'all') params.set('city', appliedCity)
    if (appliedHub !== 'all') params.set('hub', appliedHub)
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/profiling?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); toast.completeOne() })
      .catch(e => { setError(e.message); setLoading(false); toast.failAll() })
  }, [behaviourFilter, regularityFilter, appliedCity, appliedHub, configVersion])

  // Phase 2: fetch riders in background
  useEffect(() => {
    setRidersLoading(true)
    setRiders([])
    const params = new URLSearchParams({ riders: '1' })
    if (behaviourFilter !== 'all') params.set('behaviour', behaviourFilter)
    if (regularityFilter !== 'all') params.set('regularity', regularityFilter)
    if (appliedCity !== 'all') params.set('city', appliedCity)
    if (appliedHub !== 'all') params.set('hub', appliedHub)
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/profiling?${params}`)
      .then(r => r.json())
      .then(d => { setRiders(d.riders ?? []); setRidersLoading(false) })
      .catch(() => setRidersLoading(false))
  }, [behaviourFilter, regularityFilter, appliedCity, appliedHub, configVersion])

  const toggleCity = (city: string) => setExpandedCities(prev => { const n = new Set(prev); n.has(city) ? n.delete(city) : n.add(city); return n })
  const toggleHub = (hub: string) => setExpandedHubs(prev => { const n = new Set(prev); n.has(hub) ? n.delete(hub) : n.add(hub); return n })
  const toggleRider = (riderId: number) => setExpandedRiders(prev => { const n = new Set(prev); n.has(riderId) ? n.delete(riderId) : n.add(riderId); return n })

  function handleCityChange(city: string) {
    setDraftCity(city)
    setDraftHub('all')
  }

  function handleApply() {
    setAppliedCity(draftCity)
    setAppliedHub(draftHub)
  }

  function handleClearFilters() {
    setSearch(''); setBehaviourFilter('all'); setRegularityFilter('all')
    setDraftCity('all'); setDraftHub('all')
    setAppliedCity('all'); setAppliedHub('all')
  }

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" />Loading rider profiles...</div>
  if (error || !data?.kpi) return <div className="text-red-600 py-8">Error: {error ?? 'No data returned from API'}</div>

  const { kpi, cities, hubs } = data
  const total = kpi.totalRiders

  const filteredRiders = riders.filter(r =>
    !search || r.riderName.toLowerCase().includes(search.toLowerCase()) || String(r.riderId).includes(search),
  )

  const hubMap = new Map<string, typeof filteredRiders>()
  for (const r of filteredRiders) {
    if (!hubMap.has(r.hub)) hubMap.set(r.hub, [])
    hubMap.get(r.hub)!.push(r)
  }

  const hasSearchFilter = search.length > 0
  const visibleCities = cities.filter(c => hubs.some(h => h.city === c.city && hubMap.has(h.hub) && (hubMap.get(h.hub)?.length ?? 0) > 0))
  const unsortedCities = hasSearchFilter ? visibleCities : cities
  const showAll = !hasSearchFilter && behaviourFilter === 'all' && regularityFilter === 'all' && appliedCity === 'all' && appliedHub === 'all'

  const cityOptions = [...new Set(cities.map(c => c.city))].sort()

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const displayCities = [...unsortedCities].sort((a, b) => {
    if (sortCol === 'city') return sortDir === 'asc' ? a.city.localeCompare(b.city) : b.city.localeCompare(a.city)
    const av = (a[sortCol] as number | null) ?? -1
    const bv = (b[sortCol] as number | null) ?? -1
    return sortDir === 'asc' ? av - bv : bv - av
  })

  const grandTotal = {
    totalRiders: displayCities.reduce((s, c) => s + c.totalRiders, 0),
    eveningCount: displayCities.reduce((s, c) => s + c.eveningCount, 0),
    crossUtilCount: displayCities.reduce((s, c) => s + c.crossUtilCount, 0),
    morningCount: displayCities.reduce((s, c) => s + c.morningCount, 0),
  }

  const fmt = (count: number, pct: number) => showPct ? formatPct(pct) : formatNumber(count)
  const fmtTotal = (count: number, denom: number) => showPct ? formatPct(denom > 0 ? (count / denom) * 100 : 0) : formatNumber(count)

  function fmtHr(h: number | null): string {
    if (h == null) return '—'
    const hh = Math.floor(h)
    const mm = Math.round((h - hh) * 60)
    const suffix = hh >= 12 ? 'PM' : 'AM'
    const display = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
    return `${display}:${mm.toString().padStart(2, '0')} ${suffix}`
  }

  const SortIcon = ({ col }: { col: SortCol }) => (
    <span className="ml-1 inline-block opacity-50">
      {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  // ── XLSX Export ──────────────────────────────────────────────────────────────
  function exportXlsx() {
    const dateTag = anchorDate ? fmtDate(anchorDate).replace(' ', '') : 'Export'
    const cityTag = appliedCity !== 'all' ? `_${appliedCity}` : ''
    const filename = `RiderProfile${cityTag}_${dateTag}.xlsx`

    const allHubData: HubData[] = data?.hubs ?? []
    const targetCities = displayCities

    // Sheet 1 — Current View (hierarchical)
    const s1Headers = ['Level', 'City', 'Hub', 'Rider ID', 'Rider Name', 'Behaviour', 'Regularity',
      'Login Rate %', 'Avg/Day', 'Evening', 'Cross', 'Morning', 'M.ATP', 'E.ATP', 'Last Login']
    const s1Rows: (string | number)[][] = [s1Headers]

    for (const city of targetCities) {
      s1Rows.push(['City', city.city, '', '', '', '', '', '',
        city.totalRiders, city.eveningCount, city.crossUtilCount,
        city.morningCount, city.avgMorningAtp ?? '', city.avgEveningAtp ?? '', ''])
      for (const hub of allHubData.filter(h => h.city === city.city)) {
        s1Rows.push(['Hub', city.city, hub.hub, '', '', '', '', '',
          hub.totalRiders, hub.eveningCount, hub.crossUtilCount,
          hub.morningCount, hub.avgMorningAtp ?? '', hub.avgEveningAtp ?? '', ''])
        const hubRiders = riders.filter(r => r.hub === hub.hub)
        for (const rider of hubRiders) {
          s1Rows.push(['Rider', city.city, hub.hub, rider.riderId, rider.riderName,
            rider.loginBehaviourTag, rider.regularityTag,
            parseFloat(rider.loginRatePct.toFixed(1)),
            1, rider.eveningLogins, '', rider.morningLogins,
            rider.avgMorningAtp ?? '', rider.avgEveningAtp ?? '',
            fmtDate(rider.lastLoginDate)])
        }
      }
    }

    // Sheet 2 — All Rider Details (flat)
    const s2Headers = ['Rider ID', 'Rider Name', 'Hub', 'City', 'Behaviour', 'Regularity',
      'Login Rate %', 'Morning Days', 'Evening Days', 'Avg M.ATP', 'Avg E.ATP', 'Last Login', 'First Login']
    const sortedRiders = [...riders].sort((a, b) =>
      a.city.localeCompare(b.city) || a.hub.localeCompare(b.hub) || a.riderName.localeCompare(b.riderName)
    )
    const s2Rows: (string | number)[][] = [s2Headers]
    for (const r of sortedRiders) {
      s2Rows.push([r.riderId, r.riderName, r.hub, r.city,
        r.loginBehaviourTag, r.regularityTag,
        parseFloat(r.loginRatePct.toFixed(1)),
        r.morningLogins, r.eveningLogins,
        r.avgMorningAtp ?? '', r.avgEveningAtp ?? '',
        fmtDate(r.lastLoginDate),
        fmtDate(r.firstLoginDate)])
    }

    const wb = XLSX.utils.book_new()
    const ws1 = XLSX.utils.aoa_to_sheet(s1Rows)
    const ws2 = XLSX.utils.aoa_to_sheet(s2Rows)
    XLSX.utils.book_append_sheet(wb, ws1, 'Current View')
    XLSX.utils.book_append_sheet(wb, ws2, 'All Rider Details')
    XLSX.writeFile(wb, filename)
  }

  const exportLabel = isFiltered ? 'Export Filtered' : 'Export'

  return (
    <div className="space-y-5">
      <div className="animate-fade-in">
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Rider Profile</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">Login behaviour and regularity classification · Last 30 days</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 stagger-children">
        <StatCard label="Total Active Riders" value={formatNumber(total)} />
        <StatCard label="Morning" value={formatPct(kpi.morningCount * 100 / total)} sub={formatNumber(kpi.morningCount) + ' riders'} accent="amber" />
        <StatCard label="Evening" value={formatPct(kpi.eveningCount * 100 / total)} sub={formatNumber(kpi.eveningCount) + ' riders'} accent="purple" />
        <StatCard label="Cross Utilised" value={formatPct(kpi.crossUtilCount * 100 / total)} sub={formatNumber(kpi.crossUtilCount) + ' riders'} accent="sky" />
        <StatCard label="Regular Riders" value={formatPct(kpi.regularCount * 100 / total)} sub={formatNumber(kpi.regularCount) + ' of ' + formatNumber(total)} accent="green" />
        <StatCard label="Irregular Riders" value={formatPct(kpi.irregularCount * 100 / total)} sub={formatNumber(kpi.irregularCount) + ' riders'} accent="red" />
        <StatCard label="New Riders" value={formatPct(kpi.newRiderCount * 100 / total)} sub={formatNumber(kpi.newRiderCount) + ' riders'} accent="amber" />
      </div>

      <MatrixTable />

      {/* ── Filter Bar ── */}
      <div className="filter-bar">
        <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" />

        {/* City filter */}
        <select
          value={draftCity}
          onChange={e => handleCityChange(e.target.value)}
          className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow"
        >
          <option value="all">All Cities</option>
          {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Hub filter — only enabled when city is selected */}
        <select
          value={draftHub}
          onChange={e => setDraftHub(e.target.value)}
          disabled={draftCity === 'all'}
          className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <option value="all">{draftCity === 'all' ? 'All Hubs' : `All Hubs in ${draftCity}`}</option>
          {availableHubs.map(h => <option key={h} value={h}>{h}</option>)}
        </select>

        <select value={behaviourFilter} onChange={e => setBehaviourFilter(e.target.value)} className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow">
          <option value="all">All Behaviours</option>
          {BEHAVIOUR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={regularityFilter} onChange={e => setRegularityFilter(e.target.value)} className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow">
          <option value="all">All Regularity</option>
          {REGULARITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rider..." className="pl-8 pr-3 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] w-48 transition-shadow" />
        </div>

        {/* Apply button — triggers city/hub API fetch */}
        <button
          onClick={handleApply}
          disabled={!isDirty}
          className={`px-3 py-1.5 text-[13px] font-semibold rounded-lg border transition-all ${isDirty ? 'bg-[var(--sfx-orange)] text-white border-[var(--sfx-orange)] hover:bg-[var(--sfx-orange-d)]' : 'bg-slate-100 text-slate-400 border-slate-200 cursor-default'}`}
        >
          Apply
        </button>

        {/* Active filter chips + clear */}
        {isFiltered && (
          <div className="flex items-center gap-2">
            {appliedCity !== 'all' && <span className="filter-chip">{appliedCity}{appliedHub !== 'all' ? ` › ${appliedHub}` : ''}<button onClick={() => { setDraftCity('all'); setDraftHub('all'); setAppliedCity('all'); setAppliedHub('all') }}>×</button></span>}
            {behaviourFilter !== 'all' && <span className="filter-chip">{behaviourFilter}<button onClick={() => setBehaviourFilter('all')}>×</button></span>}
            {regularityFilter !== 'all' && <span className="filter-chip">{regularityFilter}<button onClick={() => setRegularityFilter('all')}>×</button></span>}
            {search && <span className="filter-chip">&quot;{search}&quot;<button onClick={() => setSearch('')}>×</button></span>}
            <button onClick={handleClearFilters} className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors">Clear all</button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg">
          <button onClick={() => setShowPct(false)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${!showPct ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Hash className="w-3 h-3" />Count</button>
          <button onClick={() => setShowPct(true)} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${showPct ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Percent className="w-3 h-3" />%</button>
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

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
          <span className="text-[10px] text-slate-400 font-mono">{displayCities.length} cities · {(data?.hubs ?? []).length} hubs · {riders.length} riders</span>
          <button
            onClick={exportXlsx}
            className="flex items-center gap-1.5 py-1 px-2.5 text-[11px] font-semibold rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors"
          >
            <Download className="w-3 h-3" /> {exportLabel}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left w-60 cursor-pointer" onClick={() => toggleSort('city')}>City / Hub / Rider<SortIcon col="city" /></th>
                <th className="text-right cursor-pointer" onClick={() => toggleSort('totalRiders')}>Avg/Day<SortIcon col="totalRiders" /></th>
                <th className="text-right cursor-pointer !text-indigo-500" onClick={() => toggleSort('eveningCount')}>Evening{showPct ? ' %' : ''}<SortIcon col="eveningCount" /></th>
                <th className="text-right cursor-pointer !text-violet-500" onClick={() => toggleSort('crossUtilCount')}>Cross{showPct ? ' %' : ''}<SortIcon col="crossUtilCount" /></th>
                <th className="text-right cursor-pointer !text-orange-500" onClick={() => toggleSort('morningCount')}>Morning{showPct ? ' %' : ''}<SortIcon col="morningCount" /></th>
                <th className="text-right cursor-pointer !text-orange-400" onClick={() => toggleSort('avgMorningAtp')}>M. ATP<SortIcon col="avgMorningAtp" /></th>
                <th className="text-right cursor-pointer !text-indigo-400" onClick={() => toggleSort('avgEveningAtp')}>E. ATP<SortIcon col="avgEveningAtp" /></th>
                <th>Behaviour</th>
                <th>Regularity</th>
                <th className="text-right">Login Rate</th>
                <th className="text-right">Last Login</th>
              </tr>
            </thead>
            <tbody>
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
                    sortCol={sortCol}
                    sortDir={sortDir}
                    fmt={fmt}
                    fmtHr={fmtHr}
                    onToggleCity={toggleCity}
                    onToggleHub={toggleHub}
                    onToggleRider={toggleRider}
                  />
                )
              })}
              <tr className="grand-total">
                <td className="px-4 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide">Grand Total</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-slate-900">{formatNumber(grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-indigo-700">{fmtTotal(grandTotal.eveningCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-violet-700">{fmtTotal(grandTotal.crossUtilCount, grandTotal.totalRiders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-orange-700">{fmtTotal(grandTotal.morningCount, grandTotal.totalRiders)}</td>
                <td colSpan={6} className="px-3 py-3 text-slate-400 text-[10px]">—</td>
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
  expandedRiders: Set<number>
  hubMap: Map<string, RiderData[]>
  riders: RiderData[]
  ridersLoading: boolean
  showAll: boolean
  showPct: boolean
  sortCol: SortCol
  sortDir: SortDir
  fmt: (count: number, pct: number) => string
  fmtHr: (h: number | null) => string
  onToggleCity: (city: string) => void
  onToggleHub: (hub: string) => void
  onToggleRider: (riderId: number) => void
}

function CityGroup({
  city, cityHubs, cityExpanded, expandedHubs, expandedRiders,
  hubMap, riders, ridersLoading, showAll, sortCol, sortDir, fmt, fmtHr,
  onToggleCity, onToggleHub, onToggleRider,
}: CityGroupProps) {
  return (
    <>
      <tr className="bg-slate-50/80 hover:bg-slate-100/80 cursor-pointer transition-colors" onClick={() => onToggleCity(city.city)}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {cityExpanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
            <span className="font-semibold text-slate-700 text-sm">{city.city}</span>
            <span className="text-[10px] text-slate-400 bg-slate-200/70 px-1.5 py-0.5 rounded">{cityHubs.length} hubs</span>
          </div>
        </td>
        <td className="text-right px-3 py-3 font-mono font-semibold text-slate-800 text-sm">{formatNumber(city.totalRiders)}</td>
        <td className="text-right px-3 py-3 font-mono text-indigo-600 text-sm">{fmt(city.eveningCount, city.eveningRiderPct)}</td>
        <td className="text-right px-3 py-3 font-mono text-violet-600 text-sm">{fmt(city.crossUtilCount, city.crossUtilisedPct)}</td>
        <td className="text-right px-3 py-3 font-mono text-orange-600 text-sm">{fmt(city.morningCount, city.morningRiderPct)}</td>
        <td className="text-right px-3 py-3 font-mono text-orange-500 text-sm">{city.avgMorningAtp != null ? city.avgMorningAtp.toFixed(1) : '—'}</td>
        <td className="text-right px-3 py-3 font-mono text-indigo-500 text-sm">{city.avgEveningAtp != null ? city.avgEveningAtp.toFixed(1) : '—'}</td>
        <td colSpan={4} className="px-3 py-3 text-slate-300 text-[10px]">—</td>
      </tr>

      {cityExpanded && sortHubs(cityHubs, sortCol, sortDir).map(hub => {
        const hubRiders = showAll ? riders.filter(r => r.hub === hub.hub) : (hubMap.get(hub.hub) ?? [])
        const hubExpanded = expandedHubs.has(hub.hub)
        const uniqueRiderCount = ridersLoading ? hub.totalUniqueRiders : hubRiders.length
        return (
          <HubGroup
            key={`hub-${hub.hub}`}
            hub={hub}
            hubRiders={hubRiders}
            uniqueRiderCount={uniqueRiderCount}
            hubExpanded={hubExpanded}
            ridersLoading={ridersLoading}
            expandedRiders={expandedRiders}
            sortCol={sortCol}
            sortDir={sortDir}
            fmt={fmt}
            fmtHr={fmtHr}
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
  uniqueRiderCount: number
  hubExpanded: boolean
  ridersLoading: boolean
  expandedRiders: Set<number>
  sortCol: SortCol
  sortDir: SortDir
  fmt: (count: number, pct: number) => string
  fmtHr: (h: number | null) => string
  onToggleHub: (hub: string) => void
  onToggleRider: (riderId: number) => void
}

function HubGroup({ hub, hubRiders, uniqueRiderCount, hubExpanded, ridersLoading, expandedRiders, sortCol, sortDir, fmt, fmtHr, onToggleHub, onToggleRider }: HubGroupProps) {
  return (
    <>
      <tr className="bg-white hover:bg-orange-50/40 cursor-pointer transition-colors" onClick={() => onToggleHub(hub.hub)}>
        <td className="px-4 py-2.5 pl-10">
          <div className="flex items-center gap-2">
            {hubExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
            <span className="text-slate-600 font-medium text-sm">{hub.hub}</span>
            <span className="text-[10px] text-slate-400">{uniqueRiderCount} riders</span>
          </div>
        </td>
        <td className="text-right px-3 py-2.5 font-mono text-slate-700 text-sm">{formatNumber(hub.totalRiders)}</td>
        <td className="text-right px-3 py-2.5 font-mono text-indigo-500 text-sm">{fmt(hub.eveningCount, hub.eveningRiderPct)}</td>
        <td className="text-right px-3 py-2.5 font-mono text-violet-500 text-sm">{fmt(hub.crossUtilCount, hub.crossUtilisedPct)}</td>
        <td className="text-right px-3 py-2.5 font-mono text-orange-500 text-sm">{fmt(hub.morningCount, hub.morningRiderPct)}</td>
        <td className="text-right px-3 py-2.5 font-mono text-orange-400 text-sm">{hub.avgMorningAtp != null ? hub.avgMorningAtp.toFixed(1) : '—'}</td>
        <td className="text-right px-3 py-2.5 font-mono text-indigo-400 text-sm">{hub.avgEveningAtp != null ? hub.avgEveningAtp.toFixed(1) : '—'}</td>
        <td colSpan={4} className="px-3 py-2.5 text-slate-300 text-[10px]">—</td>
      </tr>

      {hubExpanded && ridersLoading && (
        <tr><td colSpan={12} className="px-4 py-3 pl-16 text-xs text-slate-400"><Loader2 className="w-3 h-3 animate-spin inline-block mr-1" />Loading riders…</td></tr>
      )}
      {hubExpanded && !ridersLoading && sortRiders(hubRiders, sortCol, sortDir).map(rider => (
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

function RiderRowGroup({ rider, expanded, onToggle }: { rider: RiderData; expanded: boolean; onToggle: (id: number) => void }) {
  const loginDateStr = fmtDate(rider.lastLoginDate)
  const loginColor = rider.daysSinceLastLogin <= 7
    ? 'text-emerald-600'
    : rider.daysSinceLastLogin <= 14
    ? 'text-amber-600'
    : 'text-red-500'

  return (
    <>
      <tr
        className={`transition-colors cursor-pointer font-sans ${expanded ? 'bg-orange-50/60' : 'bg-white hover:bg-orange-50/40'}`}
        onClick={() => onToggle(rider.riderId)}
      >
        <td className="px-4 py-2.5 pl-16">
          <div className="flex items-center gap-2">
            {expanded
              ? <ChevronDown className="w-3 h-3 text-[var(--sfx-orange)] shrink-0" />
              : <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />}
            <span className="font-medium text-slate-800 text-sm">{rider.riderName}</span>
            <span className="text-slate-400 font-mono text-[10px]">{rider.riderId}</span>
          </div>
        </td>
        <td className="text-right px-3 py-2.5 text-slate-300 text-[10px]">—</td>
        <td className="text-right px-3 py-2.5 text-slate-300 text-[10px]">—</td>
        <td className="text-right px-3 py-2.5 text-slate-300 text-[10px]">—</td>
        <td className="text-right px-3 py-2.5 font-mono text-orange-400 text-sm">{rider.avgMorningAtp != null ? rider.avgMorningAtp.toFixed(1) : '—'}</td>
        <td className="text-right px-3 py-2.5 font-mono text-indigo-400 text-sm">{rider.avgEveningAtp != null ? rider.avgEveningAtp.toFixed(1) : '—'}</td>
        <td className="px-3 py-2.5"><BehaviourBadge tag={rider.loginBehaviourTag} /></td>
        <td className="px-3 py-2.5"><RegularityBadge tag={rider.regularityTag} /></td>
        <td className={`text-right px-3 py-2.5 font-mono font-semibold text-sm ${rider.loginRatePct >= 80 ? 'text-emerald-600' : rider.loginRatePct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
          {formatPct(rider.loginRatePct)}
        </td>
        <td className={`text-right px-4 py-2.5 font-mono text-sm font-medium ${loginColor}`}>{loginDateStr}</td>
      </tr>
      {expanded && <RiderProfileCard rider={rider} />}
    </>
  )
}
