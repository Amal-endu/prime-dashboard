'use client'

import { useEffect, useState } from 'react'
import {
  ChevronRight, ChevronDown, Search, SlidersHorizontal,
  CheckCircle2, Loader2,
} from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { BehaviourBadge, RegularityBadge } from '@/components/profile-badges'
import { DelPctCell } from '@/components/del-pct-cell'
import { TrendCharts } from '@/components/trend-charts'
import { RiderDrilldown } from '@/components/rider-drilldown'
import { formatPct, formatNumber, formatCurrency } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag } from '@/lib/types'
import { useConfigState } from '@/components/config-provider'
import { useToast } from '@/components/toast-provider'
import { toApiParams } from '@/lib/config-params'

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

const RIDER_TABLE_COL_SPAN = 14

interface CityRow {
  city: string; ridersLoggedIn: number; assigned3MR: number; attempted3MR: number
  delivered3MR: number; avgAttemptProductivityPct: number; avgDeliveredProductivityPct: number
  totalEarnings3MR: number
}
interface HubRow extends CityRow { hub: string }
interface RiderRow {
  riderId: string; riderName: string; hub: string; city: string
  loginBehaviourTag: LoginBehaviourTag; regularityTag: RegularityTag
  assigned3MR: number; attempted3MR: number; delivered3MR: number
  attemptProductivityPct: number; deliveredProductivityPct: number; earnings3MR: number
  avgMorningProductivity: number | null; avgEveningProductivity: number | null
  avgMorningRunsheetHr: number | null; avgEveningRunsheetHr: number | null
}
interface ApiData {
  cities: CityRow[]; hubs: HubRow[]; riders: RiderRow[]
  dateRange: { start: string; end: string } | null
}

export default function RiderDetailsPage() {
  const { config, configVersion } = useConfigState()
  const toast = useToast()
  const [data, setData] = useState<ApiData | null>(null)
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
    toast.register()
    const params = new URLSearchParams({ date: datePreset, mode: sddMode })
    if (behaviourFilter !== 'all') params.set('behaviour', behaviourFilter)
    if (regularityFilter !== 'all') params.set('regularity', regularityFilter)
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/details?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); toast.completeOne() })
      .catch(() => { setLoading(false); toast.failAll() })
  }, [datePreset, sddMode, behaviourFilter, regularityFilter, configVersion])

  const toggleCity = (city: string) => setExpandedCities(prev => { const n = new Set(prev); n.has(city) ? n.delete(city) : n.add(city); return n })
  const toggleHub = (hub: string) => setExpandedHubs(prev => { const n = new Set(prev); n.has(hub) ? n.delete(hub) : n.add(hub); return n })
  const toggleRider = (riderId: string) => setExpandedRiders(prev => { const n = new Set(prev); n.has(riderId) ? n.delete(riderId) : n.add(riderId); return n })

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" />Loading rider details...</div>
  if (!data) return <div className="text-red-600 py-8">Failed to load data</div>

  const { cities, hubs, riders, dateRange } = data
  const totalRiders = cities.reduce((s, c) => s + c.ridersLoggedIn, 0)
  const totalDelivered = cities.reduce((s, c) => s + c.delivered3MR, 0)
  const totalAssigned = cities.reduce((s, c) => s + c.assigned3MR, 0)
  const totalAttempted = cities.reduce((s, c) => s + c.attempted3MR, 0)
  const grandAttemptPct = totalAssigned > 0 ? (totalAttempted * 100 / totalAssigned) : 0
  const grandDeliveredPct = totalAssigned > 0 ? (totalDelivered * 100 / totalAssigned) : 0
  const totalEarnings = cities.reduce((s, c) => s + c.totalEarnings3MR, 0)
  const avgEarnings = totalRiders > 0 ? totalEarnings / totalRiders : 0

  const filteredRiders = riders.filter(r =>
    !search || r.riderName.toLowerCase().includes(search.toLowerCase()) || r.riderId.includes(search),
  )

  const isFiltered = behaviourFilter !== 'all' || regularityFilter !== 'all'

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Rider Details</h1>
          <p className="text-sm text-slate-500 mt-0.5">Login activity, productivity and earnings</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">View:</span>
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {(['3mr', 'overall'] as const).map(m => (
              <button
                key={m}
                onClick={() => setSddMode(m)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  sddMode === m
                    ? m === '3mr'
                      ? 'bg-sfx-orange text-white shadow-sm'
                      : 'bg-violet-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
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
        <StatCard label="Riders Active" value={formatNumber(totalRiders)} accent="orange" />
        <StatCard label="Avg Attempt %" value={formatPct(grandAttemptPct)} sub="attempted / assigned" accent="amber" />
        <StatCard label="Avg Del %" value={formatPct(grandDeliveredPct)} sub="delivered / assigned" accent="green" />
        <StatCard label={sddMode === '3mr' ? 'Total 3MR Delivered' : 'Total Delivered'} value={formatNumber(totalDelivered)} />
        <StatCard label={sddMode === '3mr' ? 'Avg 3MR Earnings' : 'Avg Earnings'} value={formatCurrency(avgEarnings)} sub="per active rider" accent="purple" />
        <StatCard label="Avg Attempted" value={(totalRiders > 0 ? totalAttempted / totalRiders : 0).toFixed(1)} sub="per active rider" accent="amber" />
        <StatCard label="Avg Delivered" value={(totalRiders > 0 ? totalDelivered / totalRiders : 0).toFixed(1)} sub="per active rider" accent="green" />
      </div>

      <TrendCharts sddMode={sddMode} configVersion={configVersion} config={config} />

      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
        <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search rider..."
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light w-48"
          />
        </div>
        <select
          value={behaviourFilter}
          onChange={e => setBehaviourFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light"
        >
          <option value="all">All Behaviours</option>
          {BEHAVIOUR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select
          value={regularityFilter}
          onChange={e => setRegularityFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light"
        >
          <option value="all">All Regularity</option>
          {REGULARITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {isFiltered && (
          <button
            onClick={() => { setBehaviourFilter('all'); setRegularityFilter('all') }}
            className="text-xs text-slate-500 hover:text-slate-800 underline"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto flex flex-wrap gap-1">
          {DATE_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => setDatePreset(p.value)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${datePreset === p.value ? 'bg-sfx-orange text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-400 font-mono -mt-2">
        {formatNumber(riders.length)} riders · {cities.length} cities
        {isFiltered && <span className="text-sfx-orange ml-1">(filtered)</span>}
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
                <th className="text-right px-3 py-3 font-medium text-orange-500 uppercase tracking-wide">Morn Avg Prod</th>
                <th className="text-right px-3 py-3 font-medium text-indigo-500 uppercase tracking-wide">Eve Avg Prod</th>
                <th className="text-right px-3 py-3 font-medium text-orange-400 uppercase tracking-wide">Morn RS Hr</th>
                <th className="text-right px-3 py-3 font-medium text-indigo-400 uppercase tracking-wide">Eve RS Hr</th>
                <th className="px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Shift</th>
                <th className="px-3 py-3 font-medium text-slate-500 uppercase tracking-wide">Regularity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cities.map(city => {
                const cityHubs = hubs.filter(h => h.city === city.city)
                const cityExpanded = expandedCities.has(city.city)
                return (
                  <CitySection
                    key={`city-${city.city}`}
                    city={city}
                    cityHubs={cityHubs}
                    cityExpanded={cityExpanded}
                    expandedHubs={expandedHubs}
                    expandedRiders={expandedRiders}
                    filteredRiders={filteredRiders}
                    dateRange={dateRange}
                    onToggleCity={toggleCity}
                    onToggleHub={toggleHub}
                    onToggleRider={toggleRider}
                  />
                )
              })}

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

interface CitySectionProps {
  city: CityRow
  cityHubs: HubRow[]
  cityExpanded: boolean
  expandedHubs: Set<string>
  expandedRiders: Set<string>
  filteredRiders: RiderRow[]
  dateRange: { start: string; end: string } | null
  onToggleCity: (city: string) => void
  onToggleHub: (hub: string) => void
  onToggleRider: (riderId: string) => void
}

function CitySection({
  city, cityHubs, cityExpanded, expandedHubs, expandedRiders,
  filteredRiders, dateRange,
  onToggleCity, onToggleHub, onToggleRider,
}: CitySectionProps) {
  return (
    <>
      <tr className="bg-slate-50 hover:bg-slate-100/80 cursor-pointer font-medium transition-colors" onClick={() => onToggleCity(city.city)}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {cityExpanded ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
            <span className="font-semibold text-slate-900">{city.city}</span>
            <span className="text-[10px] text-slate-400 bg-slate-200/70 px-1.5 py-0.5 rounded">{cityHubs.length} hubs</span>
          </div>
        </td>
        <td className="text-right px-3 py-3 font-mono font-semibold text-sfx-orange-dark">{formatNumber(city.ridersLoggedIn)}</td>
        <td className="text-right px-3 py-3 font-mono text-slate-600">{formatNumber(city.assigned3MR)}</td>
        <td className="text-right px-3 py-3 font-mono text-slate-600">{formatNumber(city.attempted3MR)}</td>
        <td className="text-right px-3 py-3 font-mono font-semibold text-slate-700">{formatNumber(city.delivered3MR)}</td>
        <td className="text-right px-3 py-3"><DelPctCell value={city.avgAttemptProductivityPct} /></td>
        <td className="text-right px-3 py-3"><DelPctCell value={city.avgDeliveredProductivityPct} /></td>
        <td className="text-right px-3 py-3 font-mono font-semibold text-emerald-600">
          {formatCurrency(city.ridersLoggedIn > 0 ? city.totalEarnings3MR / city.ridersLoggedIn : 0)}
        </td>
        <td colSpan={6} className="px-3 py-3 text-slate-300 text-[10px]">—</td>
      </tr>

      {cityExpanded && cityHubs.map(hub => {
        const hubRiders = filteredRiders.filter(r => r.hub === hub.hub)
        const hubExpanded = expandedHubs.has(hub.hub)
        return (
          <HubSection
            key={`hub-${hub.hub}`}
            hub={hub}
            hubRiders={hubRiders}
            hubExpanded={hubExpanded}
            expandedRiders={expandedRiders}
            dateRange={dateRange}
            onToggleHub={onToggleHub}
            onToggleRider={onToggleRider}
          />
        )
      })}
    </>
  )
}

interface HubSectionProps {
  hub: HubRow
  hubRiders: RiderRow[]
  hubExpanded: boolean
  expandedRiders: Set<string>
  dateRange: { start: string; end: string } | null
  onToggleHub: (hub: string) => void
  onToggleRider: (riderId: string) => void
}

function HubSection({ hub, hubRiders, hubExpanded, expandedRiders, dateRange, onToggleHub, onToggleRider }: HubSectionProps) {
  return (
    <>
      <tr className="bg-white hover:bg-sfx-orange/5 cursor-pointer transition-colors" onClick={() => onToggleHub(hub.hub)}>
        <td className="px-4 py-2.5 pl-10">
          <div className="flex items-center gap-2">
            {hubExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
            <span className="font-medium text-slate-700">{hub.hub}</span>
            <span className="text-[10px] text-slate-400">{hub.ridersLoggedIn} riders</span>
          </div>
        </td>
        <td className="text-right px-3 py-2.5 font-mono text-sfx-orange">{formatNumber(hub.ridersLoggedIn)}</td>
        <td className="text-right px-3 py-2.5 font-mono text-slate-500">{formatNumber(hub.assigned3MR)}</td>
        <td className="text-right px-3 py-2.5 font-mono text-slate-500">{formatNumber(hub.attempted3MR)}</td>
        <td className="text-right px-3 py-2.5 font-mono text-slate-700">{formatNumber(hub.delivered3MR)}</td>
        <td className="text-right px-3 py-2.5"><DelPctCell value={hub.avgAttemptProductivityPct} /></td>
        <td className="text-right px-3 py-2.5"><DelPctCell value={hub.avgDeliveredProductivityPct} /></td>
        <td className="text-right px-3 py-2.5 font-mono text-slate-600">
          {formatCurrency(hub.ridersLoggedIn > 0 ? hub.totalEarnings3MR / hub.ridersLoggedIn : 0)}
        </td>
        <td colSpan={6} className="px-3 py-2.5 text-slate-300 text-[10px]">—</td>
      </tr>

      {hubExpanded && hubRiders.map(rider => (
        <RiderSection
          key={rider.riderId}
          rider={rider}
          expanded={expandedRiders.has(rider.riderId)}
          dateRange={dateRange}
          onToggleRider={onToggleRider}
        />
      ))}
    </>
  )
}

interface RiderSectionProps {
  rider: RiderRow
  expanded: boolean
  dateRange: { start: string; end: string } | null
  onToggleRider: (riderId: string) => void
}

function RiderSection({ rider, expanded, dateRange, onToggleRider }: RiderSectionProps) {
  return (
    <>
      <tr
        className={`hover:bg-slate-50/50 transition-colors cursor-pointer ${expanded ? 'bg-sfx-orange/5' : 'bg-white'}`}
        onClick={() => onToggleRider(rider.riderId)}
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
        <td className="text-right px-3 py-2.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 ml-auto" />
        </td>
        <td className="text-right px-3 py-2.5 font-mono text-slate-700">{rider.assigned3MR}</td>
        <td className="text-right px-3 py-2.5 font-mono text-slate-700">{rider.attempted3MR}</td>
        <td className="text-right px-3 py-2.5 font-mono font-semibold text-slate-800">{rider.delivered3MR}</td>
        <td className="text-right px-3 py-2.5"><DelPctCell value={rider.attemptProductivityPct} /></td>
        <td className="text-right px-3 py-2.5"><DelPctCell value={rider.deliveredProductivityPct} /></td>
        <td className="text-right px-3 py-2.5 font-mono font-semibold text-emerald-600">{formatCurrency(rider.earnings3MR)}</td>
        <td className="text-right px-3 py-2.5 font-mono text-orange-600">
          {rider.avgMorningProductivity != null ? rider.avgMorningProductivity : <span className="text-slate-300">—</span>}
        </td>
        <td className="text-right px-3 py-2.5 font-mono text-indigo-600">
          {rider.avgEveningProductivity != null ? rider.avgEveningProductivity : <span className="text-slate-300">—</span>}
        </td>
        <td className="text-right px-3 py-2.5 font-mono text-orange-500">
          {rider.avgMorningRunsheetHr != null ? `${String(Math.floor(rider.avgMorningRunsheetHr)).padStart(2, '0')}:00` : <span className="text-slate-300">—</span>}
        </td>
        <td className="text-right px-3 py-2.5 font-mono text-indigo-500">
          {rider.avgEveningRunsheetHr != null ? `${String(Math.floor(rider.avgEveningRunsheetHr)).padStart(2, '0')}:00` : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-3 py-2.5"><BehaviourBadge tag={rider.loginBehaviourTag} /></td>
        <td className="px-3 py-2.5"><RegularityBadge tag={rider.regularityTag} /></td>
      </tr>
      {expanded && dateRange && (
        <RiderDrilldown
          rider={rider}
          dateRange={dateRange}
          onClose={() => onToggleRider(rider.riderId)}
          colSpan={RIDER_TABLE_COL_SPAN}
        />
      )}
    </>
  )
}
