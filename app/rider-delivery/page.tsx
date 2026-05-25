'use client'

import React, { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, SlidersHorizontal, Loader2, Download } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { BehaviourBadge, RegularityBadge } from '@/components/profile-badges'
import { DelPctCell } from '@/components/del-pct-cell'
import { TrendDisplay } from '@/components/trend-display'
import { formatPct, formatNumber } from '@/lib/utils'
import type { LoginBehaviourTag, RegularityTag } from '@/lib/types'
import { useConfigState } from '@/components/config-provider'
import { useToast } from '@/components/toast-provider'
import { toApiParams } from '@/lib/config-params'
import { buildDatePresets } from '@/lib/date-presets'

const BEHAVIOUR_OPTIONS: LoginBehaviourTag[] = ['Evening Rider', 'Cross Utilised', 'Morning Rider']
const REGULARITY_OPTIONS: RegularityTag[] = ['Regular', 'Irregular', 'New Rider']

type CitySortCol = 'city' | 'orders3MR' | 'delivered3MR' | 'delPct' | 'breachCount' | 'breachPct' | 'trend7' | 'trend30'
type SortDir = 'asc' | 'desc'

export default function RiderDeliveryPage() {
  const { config, configVersion } = useConfigState()
  const toast = useToast()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [maxDateRaw, setMaxDateRaw] = useState<string | null>(null)
  const [datePreset, setDatePreset] = useState('today')
  const [behaviourFilter, setBehaviourFilter] = useState<string>('all')
  const [regularityFilter, setRegularityFilter] = useState<string>('all')
  const [primeOnly, setPrimeOnly] = useState(false)
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set())
  const [expandedHubs, setExpandedHubs] = useState<Set<string>>(new Set())
  const [sortCol, setSortCol] = useState<CitySortCol>('orders3MR')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => setMaxDateRaw(d.maxDateRaw ?? null)).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    toast.register()
    const params = new URLSearchParams({ date: datePreset })
    if (behaviourFilter !== 'all') params.set('behaviour', behaviourFilter)
    if (regularityFilter !== 'all') params.set('regularity', regularityFilter)
    if (primeOnly) params.set('prime', 'true')
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/delivery?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); toast.completeOne() })
      .catch(() => { setLoading(false); toast.failAll() })
  }, [datePreset, behaviourFilter, regularityFilter, primeOnly, configVersion])

  const toggleCity = (city: string) => setExpandedCities(prev => { const n = new Set(prev); n.has(city) ? n.delete(city) : n.add(city); return n })
  const toggleHub = (hub: string) => setExpandedHubs(prev => { const n = new Set(prev); n.has(hub) ? n.delete(hub) : n.add(hub); return n })

  if (loading) return <div className="flex items-center gap-2 text-slate-500 py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" />Loading delivery data...</div>
  if (!data) return <div className="text-red-600 py-8">Failed to load data</div>

  const { cities: rawCities = [], hubs = [], riders = [], dateRange } = data
  const dateLabel = dateRange?.start === dateRange?.end
    ? dateRange?.start
    : `${dateRange?.start} → ${dateRange?.end}`

  const totalOrders = rawCities.reduce((s: number, c: any) => s + c.orders3MR, 0)
  const totalDelivered = rawCities.reduce((s: number, c: any) => s + c.delivered3MR, 0)
  const totalBreaches = rawCities.reduce((s: number, c: any) => s + c.breachCount, 0)
  const overallDel = totalOrders > 0 ? (totalDelivered / totalOrders) * 100 : 0

  function toggleSort(col: CitySortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const cities = [...rawCities].sort((a: any, b: any) => {
    let v: number
    if (sortCol === 'city') v = (a.city as string).localeCompare(b.city as string)
    else if (sortCol === 'trend7') v = (a.trend7?.delta ?? 0) - (b.trend7?.delta ?? 0)
    else if (sortCol === 'trend30') v = (a.trend30?.delta ?? 0) - (b.trend30?.delta ?? 0)
    else v = (a[sortCol] as number) - (b[sortCol] as number)
    return sortDir === 'asc' ? v : -v
  })

  const SortIcon = ({ col }: { col: CitySortCol }) => (
    <span className="ml-1 inline-block opacity-50">{sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
  )

  const gt = {
    orders: rawCities.reduce((s: number, c: any) => s + c.orders3MR, 0),
    delivered: rawCities.reduce((s: number, c: any) => s + c.delivered3MR, 0),
    breaches: rawCities.reduce((s: number, c: any) => s + c.breachCount, 0),
  }
  const gtDelPct = gt.orders > 0 ? (gt.delivered / gt.orders) * 100 : 0
  const gtBreachPct = gt.orders > 0 ? (gt.breaches / gt.orders) * 100 : 0

  function exportDeliveryCsv(cityFilter?: string) {
    const header = ['Level', 'City', 'Hub', 'Rider ID', 'Rider Name', 'Behaviour', 'Regularity',
      'Orders', 'Delivered', 'DEL%', 'Breaches', 'Breach%']
    const rows: string[][] = [header]
    const targetCities: any[] = cityFilter ? rawCities.filter((c: any) => c.city === cityFilter) : rawCities
    for (const city of targetCities) {
      const delPct = city.orders3MR > 0 ? ((city.delivered3MR / city.orders3MR) * 100).toFixed(1) + '%' : '0%'
      const bPct = city.orders3MR > 0 ? ((city.breachCount / city.orders3MR) * 100).toFixed(1) + '%' : '0%'
      rows.push(['City', city.city, '', '', '', '', '',
        String(city.orders3MR), String(city.delivered3MR), delPct, String(city.breachCount), bPct])
      for (const hub of hubs.filter((h: any) => h.city === city.city)) {
        const hDelPct = hub.orders3MR > 0 ? ((hub.delivered3MR / hub.orders3MR) * 100).toFixed(1) + '%' : '0%'
        rows.push(['Hub', city.city, hub.hub, '', '', '', '',
          String(hub.orders3MR), String(hub.delivered3MR), hDelPct, String(hub.breachCount), hub.breachPct?.toFixed(1) + '%'])
        for (const rider of riders.filter((r: any) => r.hub === hub.hub)) {
          const rDelPct = rider.orders3MR > 0 ? ((rider.delivered3MR / rider.orders3MR) * 100).toFixed(1) + '%' : '0%'
          rows.push(['Rider', city.city, hub.hub, rider.riderId, rider.riderName,
            rider.behaviourTag ?? '', rider.regularityTag ?? '',
            String(rider.orders3MR), String(rider.delivered3MR), rDelPct, String(rider.breachCount), '—'])
        }
      }
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `Delivery_${cityFilter ?? 'All'}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="animate-fade-in">
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">Rider Delivery</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">3MR delivery performance · {dateLabel}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        <StatCard label="Total 3MR Orders" value={formatNumber(totalOrders)} />
        <StatCard label="Total Delivered" value={formatNumber(totalDelivered)} accent="green" />
        <StatCard label="Overall DEL%" value={formatPct(overallDel)} accent={overallDel >= 80 ? 'green' : overallDel >= 60 ? 'amber' : 'red'} />
        <StatCard label="Total Breaches" value={formatNumber(totalBreaches)} accent="red" />
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
        <select value={behaviourFilter} onChange={e => setBehaviourFilter(e.target.value)} className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow">
          <option value="all">All Behaviours</option>
          {BEHAVIOUR_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={regularityFilter} onChange={e => setRegularityFilter(e.target.value)} className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow">
          <option value="all">All Regularity</option>
          {REGULARITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <button onClick={() => setPrimeOnly(p => !p)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all duration-200 ${primeOnly ? 'bg-[var(--sfx-orange)] text-white border-[var(--sfx-orange)] shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-[var(--sfx-orange-l)]'}`}>C2 Clients</button>

        {(behaviourFilter !== 'all' || regularityFilter !== 'all' || primeOnly) && (
          <div className="flex items-center gap-2">
            {behaviourFilter !== 'all' && <span className="filter-chip">{behaviourFilter}<button onClick={() => setBehaviourFilter('all')}>×</button></span>}
            {regularityFilter !== 'all' && <span className="filter-chip">{regularityFilter}<button onClick={() => setRegularityFilter('all')}>×</button></span>}
            {primeOnly && <span className="filter-chip">C2 Clients Only<button onClick={() => setPrimeOnly(false)}>×</button></span>}
            <button onClick={() => { setBehaviourFilter('all'); setRegularityFilter('all'); setPrimeOnly(false) }} className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors">Clear all</button>
          </div>
        )}

        {/* Date presets pushed to right */}
        <div className="ml-auto flex flex-wrap gap-1 justify-end">
          {buildDatePresets(maxDateRaw).map(p => (
            <button
              key={p.value}
              onClick={() => setDatePreset(p.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${datePreset === p.value ? 'bg-[var(--sfx-orange)] text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
          <span className="text-[10px] text-slate-400 font-mono">{rawCities.length} cities · {hubs.length} hubs · {riders.length} riders</span>
          <button
            onClick={() => exportDeliveryCsv()}
            className="btn-secondary !py-1 !px-2.5 !text-[10px] !gap-1"
          >
            <Download className="w-3 h-3" /> Export All
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left w-44 cursor-pointer select-none" onClick={() => toggleSort('city')}>City / Hub / Rider<SortIcon col="city" /></th>
                <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('orders3MR')}># Orders<SortIcon col="orders3MR" /></th>
                <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('delivered3MR')}># Delivered<SortIcon col="delivered3MR" /></th>
                <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('delPct')}>DEL%<SortIcon col="delPct" /></th>
                <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('breachCount')}>Breaches<SortIcon col="breachCount" /></th>
                <th className="text-right cursor-pointer select-none" onClick={() => toggleSort('breachPct')}>Breach%<SortIcon col="breachPct" /></th>
                <th className="text-left cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('trend7')}>L7D Trend<SortIcon col="trend7" /></th>
                <th className="text-left cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort('trend30')}>L30D Trend<SortIcon col="trend30" /></th>
                <th className="text-left">Behaviour</th>
                <th className="text-left">Regularity</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((city: any) => {
                const cityHubs = hubs.filter((h: any) => h.city === city.city)
                const cityExpanded = expandedCities.has(city.city)
                return (<React.Fragment key={city.city}>
                  <tr className="bg-slate-50 hover:bg-slate-100/80 cursor-pointer font-medium transition-colors" onClick={() => toggleCity(city.city)}>
                    <td className="px-4 py-3"><div className="flex items-center gap-2">{cityExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}<span>{city.city}</span><button onClick={e => { e.stopPropagation(); exportDeliveryCsv(city.city) }} className="ml-1 text-slate-300 hover:text-slate-600 transition-colors" title={`Export ${city.city}`}><Download className="w-3 h-3" /></button></div></td>
                    <td className="text-right px-3 py-3 font-mono text-slate-700">{formatNumber(city.orders3MR)}</td>
                    <td className="text-right px-3 py-3 font-mono text-slate-700">{formatNumber(city.delivered3MR)}</td>
                    <td className="text-right px-3 py-3"><DelPctCell value={city.delPct} /></td>
                    <td className="text-right px-3 py-3 font-mono text-red-600 font-semibold">{formatNumber(city.breachCount)}</td>
                    <td className="text-right px-3 py-3 font-mono text-red-500">{formatPct(city.breachPct)}</td>
                    <td className="px-3 py-3"><TrendDisplay delta={city.trend7?.delta ?? 0} /></td>
                    <td className="px-3 py-3"><TrendDisplay delta={city.trend30?.delta ?? 0} /></td>
                    <td colSpan={2} className="px-3 py-3 text-slate-300 text-xs">—</td>
                  </tr>
                  {cityExpanded && cityHubs.map((hub: any) => {
                    const hubRiders = riders.filter((r: any) => r.hub === hub.hub)
                    const hubExpanded = expandedHubs.has(hub.hub)
                    return (<React.Fragment key={hub.hub}>
                      <tr className="bg-white hover:bg-sfx-orange/5 cursor-pointer transition-colors" onClick={() => toggleHub(hub.hub)}>
                        <td className="px-4 py-2.5 pl-10"><div className="flex items-center gap-2">{hubExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}<span className="font-medium text-slate-700">{hub.hub}</span></div></td>
                        <td className="text-right px-3 py-2.5 font-mono text-slate-600">{formatNumber(hub.orders3MR)}</td>
                        <td className="text-right px-3 py-2.5 font-mono text-slate-600">{formatNumber(hub.delivered3MR)}</td>
                        <td className="text-right px-3 py-2.5"><DelPctCell value={hub.delPct} /></td>
                        <td className="text-right px-3 py-2.5 font-mono text-red-500">{hub.breachCount}</td>
                        <td className="text-right px-3 py-2.5 font-mono text-red-400">{formatPct(hub.breachPct)}</td>
                        <td colSpan={4} className="px-3 py-2.5 text-slate-300 text-xs">—</td>
                      </tr>
                      {hubExpanded && hubRiders.map((rider: any) => (
                        <tr key={rider.riderId} className="bg-white hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2.5 pl-16"><div className="flex items-center gap-2"><span className="font-medium text-slate-800">{rider.riderName}</span><span className="text-slate-400 text-xs">{rider.riderId}</span></div></td>
                          <td className="text-right px-3 py-2.5 font-mono text-slate-700">{rider.orders3MR}</td>
                          <td className="text-right px-3 py-2.5 font-mono text-slate-700">{rider.delivered3MR}</td>
                          <td className="text-right px-3 py-2.5"><DelPctCell value={rider.delPct} /></td>
                          <td className="text-right px-3 py-2.5 font-mono text-red-500">{rider.breachCount}</td>
                          <td className="text-right px-3 py-2.5 font-mono text-slate-400 text-xs">—</td>
                          <td colSpan={2} className="px-3 py-2.5 text-slate-300 text-xs">—</td>
                          <td className="px-3 py-2.5"><BehaviourBadge tag={rider.behaviourTag} /></td>
                          <td className="px-3 py-2.5"><RegularityBadge tag={rider.regularityTag} /></td>
                        </tr>
                      ))}
                    </React.Fragment>)
                  })}
                </React.Fragment>)
              })}
              {/* Grand total */}
              <tr className="grand-total">
                <td className="px-4 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide">Grand Total</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-slate-900">{formatNumber(gt.orders)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-slate-900">{formatNumber(gt.delivered)}</td>
                <td className="text-right px-3 py-3"><DelPctCell value={gtDelPct} /></td>
                <td className="text-right px-3 py-3 font-mono font-bold text-red-700">{formatNumber(gt.breaches)}</td>
                <td className="text-right px-3 py-3 font-mono font-bold text-red-600">{formatPct(gtBreachPct)}</td>
                <td colSpan={4} className="px-3 py-3 text-slate-400 text-xs">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
