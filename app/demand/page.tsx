'use client'

import React, { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, SlidersHorizontal, AlertCircle, Loader2, Search } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { TrendDisplay } from '@/components/trend-display'
import { DelPctCell } from '@/components/del-pct-cell'
import { DemandTrendCharts } from '@/components/demand-trend-charts'
import { formatNumber, formatPct } from '@/lib/utils'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import type { TrendDirection } from '@/lib/types'
import { useConfigState } from '@/components/config-provider'
import { useToast } from '@/components/toast-provider'
import { toApiParams } from '@/lib/config-params'

type SubView = 'city' | 'client'
type CitySortCol = 'city' | 'totalDemand' | 'demand3MR' | 'delPct3MR'
type ClientSortCol = 'clientName' | 'totalAWBs' | 'awbs3MR' | 'delivered' | 'delPct'
type SortDir = 'asc' | 'desc'

interface FilterMeta {
  clientTypes: string[]
  clientBuckets: string[]
  criticalCount: number
}

export default function DemandPage() {
  const { config, configVersion } = useConfigState()
  const toast = useToast()
  const [subView, setSubView] = useState<SubView>('city')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set())

  // Client-segment filters (client view only)
  const [clientType, setClientType]     = useState('')
  const [clientBucket, setClientBucket] = useState('')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [clientFilter, setClientFilter] = useState('all')

  // Sort state per view
  const [citySortCol, setCitySortCol]     = useState<CitySortCol>('demand3MR')
  const [citySortDir, setCitySortDir]     = useState<SortDir>('desc')
  const [clientSortCol, setClientSortCol] = useState<ClientSortCol>('awbs3MR')
  const [clientSortDir, setClientSortDir] = useState<SortDir>('desc')

  const filterMeta: FilterMeta = data?.filterMeta ?? { clientTypes: [], clientBuckets: [], criticalCount: 0 }

  useEffect(() => {
    setLoading(true)
    toast.register()
    const params = new URLSearchParams({ view: subView })
    if (clientType)   params.set('clientType', clientType)
    if (clientBucket) params.set('clientBucket', clientBucket)
    if (criticalOnly) params.set('critical', 'true')
    if (clientFilter !== 'all') params.set('client', clientFilter)
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/demand?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); toast.completeOne() })
      .catch(() => { setLoading(false); toast.failAll() })
  }, [subView, clientType, clientBucket, criticalOnly, clientFilter, configVersion])

  const toggleCity = (city: string) =>
    setExpandedCities(prev => { const n = new Set(prev); n.has(city) ? n.delete(city) : n.add(city); return n })

  function toggleCitySort(col: CitySortCol) {
    if (citySortCol === col) setCitySortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setCitySortCol(col); setCitySortDir('desc') }
  }
  function toggleClientSort(col: ClientSortCol) {
    if (clientSortCol === col) setClientSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setClientSortCol(col); setClientSortDir('desc') }
  }

  function clearAllFilters() {
    setClientType(''); setClientBucket(''); setCriticalOnly(false)
    setClientSearch(''); setClientFilter('all')
  }

  const rawCities: any[] = data?.cities ?? []
  const rawClients: any[] = data?.clients ?? []
  const clientList: string[] = data?.clientList ?? []

  const cities = [...rawCities].sort((a, b) => {
    const v = citySortCol === 'city'
      ? a.city.localeCompare(b.city)
      : (a[citySortCol] as number) - (b[citySortCol] as number)
    return citySortDir === 'asc' ? v : -v
  })

  const filteredClients = rawClients.filter(c =>
    !clientSearch || c.clientName.toLowerCase().includes(clientSearch.toLowerCase())
  )
  const clients = [...filteredClients].sort((a, b) => {
    const v = clientSortCol === 'clientName'
      ? a.clientName.localeCompare(b.clientName)
      : (a[clientSortCol] as number) - (b[clientSortCol] as number)
    return clientSortDir === 'asc' ? v : -v
  })

  const totalDemand = subView === 'city'
    ? rawCities.reduce((s: number, c: any) => s + c.totalDemand, 0)
    : rawClients.reduce((s: number, c: any) => s + c.totalAWBs, 0)
  const total3MR = subView === 'city'
    ? rawCities.reduce((s: number, c: any) => s + c.demand3MR, 0)
    : rawClients.reduce((s: number, c: any) => s + c.awbs3MR, 0)
  const totalDelivered3MR = subView === 'city'
    ? rawCities.reduce((s: number, c: any) => s + (c.delivered3MR ?? 0), 0)
    : rawClients.reduce((s: number, c: any) => s + c.delivered, 0)
  const avgDel = total3MR > 0 ? (totalDelivered3MR / total3MR) * 100 : 0
  const uptickCount = subView === 'city'
    ? rawCities.filter((c: any) => c.trendDirection === 'up').length
    : rawClients.filter((c: any) => c.trendDirection === 'up').length
  const uptickTotal = subView === 'city' ? rawCities.length : rawClients.length

  const cityGT = {
    totalDemand: cities.reduce((s, c) => s + c.totalDemand, 0),
    demand3MR: cities.reduce((s, c) => s + c.demand3MR, 0),
    delivered3MR: cities.reduce((s, c) => s + (c.delivered3MR ?? 0), 0),
  }
  const cityGTDelPct = cityGT.demand3MR > 0 ? (cityGT.delivered3MR / cityGT.demand3MR) * 100 : 0

  const clientGT = {
    totalAWBs: clients.reduce((s, c) => s + c.totalAWBs, 0),
    awbs3MR: clients.reduce((s, c) => s + c.awbs3MR, 0),
    delivered: clients.reduce((s, c) => s + c.delivered, 0),
  }
  const clientGTDelPct = clientGT.awbs3MR > 0 ? (clientGT.delivered / clientGT.awbs3MR) * 100 : 0

  const hasActiveFilters = clientType || clientBucket || criticalOnly || clientFilter !== 'all' || clientSearch
  const activeClientSegment = criticalOnly || clientType || clientBucket

  const CitySortIcon = ({ col }: { col: CitySortCol }) => (
    <span className="ml-1 inline-block opacity-50">{citySortCol === col ? (citySortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
  )
  const ClientSortIcon = ({ col }: { col: ClientSortCol }) => (
    <span className="ml-1 inline-block opacity-50">{clientSortCol === col ? (clientSortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
  )

  // Badge for client type/bucket
  function ClientTypeBadge({ type }: { type: string | null }) {
    if (!type) return <span className="text-slate-300 text-xs">—</span>
    const colors: Record<string, string> = {
      'C2': 'bg-violet-50 text-violet-700 border-violet-200',
      'C1': 'bg-blue-50 text-blue-700 border-blue-200',
      'PPMP': 'bg-amber-50 text-amber-700 border-amber-200',
      'Nykaa': 'bg-pink-50 text-pink-700 border-pink-200',
      'Flipkart': 'bg-yellow-50 text-yellow-700 border-yellow-200',
      'Ajio': 'bg-orange-50 text-orange-700 border-orange-200',
    }
    return (
      <span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-semibold border ${colors[type] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
        {type}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 animate-fade-in">
        <div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Allocation</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">8-day allocation trend · city and client breakdown · {data?.date}</p>
        </div>
        <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-lg shrink-0">
          <button onClick={() => setSubView('city')} className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${subView === 'city' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>City Level</button>
          <button onClick={() => setSubView('client')} className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${subView === 'client' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Client Level</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 stagger-children">
        <StatCard label={config.allocationMode === 'same_day_received' ? 'Total Allocation (SDD)' : 'Total Allocation (All OFD)'} value={formatNumber(totalDemand)} />
        <StatCard label="3MR Allocation" value={formatNumber(total3MR)} accent="orange" />
        <StatCard label="Avg 3MR DEL%" value={formatPct(avgDel)} accent={avgDel >= 80 ? 'green' : avgDel >= 60 ? 'amber' : 'red'} />
        <StatCard label={subView === 'city' ? 'Cities Trending ▲' : 'Clients Trending ▲'} value={`${uptickCount} / ${uptickTotal}`} accent="green" />
      </div>

      <DemandTrendCharts mr3CutoffHour={config.mr3CutoffHour} clientFilter={clientFilter} clientType={clientType} clientBucket={clientBucket} criticalOnly={criticalOnly} allocationMode={config.allocationMode} />

      {loading && <div className="flex items-center gap-2 text-slate-500 py-8 justify-center"><Loader2 className="w-5 h-5 animate-spin" />Loading...</div>}

      {!loading && subView === 'city' && (
        <>
          {/* City view has no client segment filters — just informational */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left w-52 cursor-pointer select-none" onClick={() => toggleCitySort('city')}>City / Hub<CitySortIcon col="city" /></th>
                    <th className="text-right cursor-pointer select-none" onClick={() => toggleCitySort('totalDemand')}>Total Allocation<CitySortIcon col="totalDemand" /></th>
                    <th className="text-right cursor-pointer select-none" onClick={() => toggleCitySort('demand3MR')}>3MR Allocation<CitySortIcon col="demand3MR" /></th>
                    <th className="text-right cursor-pointer select-none" onClick={() => toggleCitySort('delPct3MR')}>3MR DEL%<CitySortIcon col="delPct3MR" /></th>
                    <th className="text-left">D-1 Δ</th>
                    <th className="text-left">7-Day Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {cities.map((city: any) => (
                    <React.Fragment key={city.city}>
                      <tr className="bg-slate-50 hover:bg-slate-100/80 cursor-pointer font-medium transition-colors" onClick={() => city.hubs?.length > 0 && toggleCity(city.city)}>
                        <td className="px-4 py-3"><div className="flex items-center gap-2">{city.hubs?.length > 0 ? (expandedCities.has(city.city) ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />) : <span className="w-4" />}<span>{city.city}</span></div></td>
                        <td className="text-right px-3 py-3 text-slate-700 font-mono">{formatNumber(city.totalDemand)}</td>
                        <td className="text-right px-3 py-3 text-sfx-orange-dark font-semibold font-mono">{formatNumber(city.demand3MR)}</td>
                        <td className="text-right px-3 py-3"><DelPctCell value={city.delPct3MR} /></td>
                        <td className="px-3 py-3"><TrendDisplay direction={city.trendDirection as TrendDirection} pct={city.trendPct} /></td>
                        <td className="px-4 py-3 w-28">
                          {city.sparkline?.length > 0 && <ResponsiveContainer width="100%" height={32}>
                            <LineChart data={city.sparkline}>
                              <Line type="monotone" dataKey="value" stroke="var(--sfx-orange)" strokeWidth={1.5} dot={false} />
                              <Tooltip contentStyle={{ fontSize: 10, padding: '2px 6px', borderRadius: 4 }} formatter={(v) => [formatNumber(Number(v)), '3MR']} />
                            </LineChart>
                          </ResponsiveContainer>}
                        </td>
                      </tr>
                      {expandedCities.has(city.city) && city.hubs?.map((hub: any) => (
                        <tr key={hub.hub} className="bg-white hover:bg-sfx-orange/5 transition-colors">
                          <td className="px-4 py-2.5 pl-10"><div className="flex items-center gap-2"><span className="w-3.5" /><span className="text-slate-700 font-medium">{hub.hub}</span></div></td>
                          <td className="text-right px-3 py-2.5 text-slate-600 font-mono">{formatNumber(hub.totalDemand ?? hub.demand3MR)}</td>
                          <td className="text-right px-3 py-2.5 text-sfx-orange font-mono">{formatNumber(hub.demand3MR)}</td>
                          <td className="text-right px-3 py-2.5"><DelPctCell value={hub.delPct3MR} /></td>
                          <td className="px-3 py-2.5"><TrendDisplay direction={hub.trendDirection as TrendDirection} pct={hub.trendPct} /></td>
                          <td className="px-4 py-2.5 text-slate-300 text-xs">—</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  <tr className="grand-total">
                    <td className="px-4 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide">Grand Total</td>
                    <td className="text-right px-3 py-3 font-mono font-bold text-slate-900">{formatNumber(cityGT.totalDemand)}</td>
                    <td className="text-right px-3 py-3 font-mono font-bold text-sfx-orange-dark">{formatNumber(cityGT.demand3MR)}</td>
                    <td className="text-right px-3 py-3"><DelPctCell value={cityGTDelPct} /></td>
                    <td colSpan={2} className="px-3 py-3 text-slate-400 text-xs">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && subView === 'client' && (
        <>
          <div className="filter-bar">
            <SlidersHorizontal className="w-4 h-4 text-slate-400 shrink-0" />

            {/* Critical clients toggle */}
            <button
              onClick={() => setCriticalOnly(p => !p)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${criticalOnly ? 'bg-red-500 text-white border-red-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-red-300'}`}
            >
              <AlertCircle className="w-3 h-3" />Critical
              {filterMeta.criticalCount > 0 && !criticalOnly && (
                <span className="ml-0.5 text-[10px] text-slate-400">({filterMeta.criticalCount})</span>
              )}
            </button>

            {/* Client Type dropdown */}
            <select
              value={clientType}
              onChange={e => setClientType(e.target.value)}
              className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow"
            >
              <option value="">All Types</option>
              {filterMeta.clientTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Client Bucket dropdown */}
            <select
              value={clientBucket}
              onChange={e => setClientBucket(e.target.value)}
              className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow"
            >
              <option value="">All Buckets</option>
              {filterMeta.clientBuckets.map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            {/* Individual client dropdown */}
            <select
              value={clientFilter}
              onChange={e => setClientFilter(e.target.value)}
              className="text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] transition-shadow"
            >
              <option value="all">All Clients</option>
              {clientList.map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Search client..."
                className="pl-8 pr-3 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/15 focus:border-[var(--sfx-orange-l)] w-40 transition-shadow"
              />
            </div>

            {/* Active filter chips */}
            {hasActiveFilters && (
              <div className="flex items-center gap-2 flex-wrap">
                {criticalOnly && <span className="filter-chip">Critical Only<button onClick={() => setCriticalOnly(false)}>×</button></span>}
                {clientType && <span className="filter-chip">{clientType}<button onClick={() => setClientType('')}>×</button></span>}
                {clientBucket && <span className="filter-chip">{clientBucket}<button onClick={() => setClientBucket('')}>×</button></span>}
                {clientFilter !== 'all' && <span className="filter-chip">{clientFilter}<button onClick={() => setClientFilter('all')}>×</button></span>}
                {clientSearch && <span className="filter-chip">&quot;{clientSearch}&quot;<button onClick={() => setClientSearch('')}>×</button></span>}
                <button onClick={clearAllFilters} className="text-[11px] text-slate-400 hover:text-slate-700 transition-colors">Clear all</button>
              </div>
            )}

            {clientSearch && (
              <p className="text-xs text-slate-400 font-mono ml-auto">{clients.length} of {rawClients.length} clients</p>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left cursor-pointer select-none" onClick={() => toggleClientSort('clientName')}>Client<ClientSortIcon col="clientName" /></th>
                    <th className="text-left w-20">Type</th>
                    <th className="text-right cursor-pointer select-none" onClick={() => toggleClientSort('totalAWBs')}>Total AWBs<ClientSortIcon col="totalAWBs" /></th>
                    <th className="text-right cursor-pointer select-none" onClick={() => toggleClientSort('awbs3MR')}>3MR AWBs<ClientSortIcon col="awbs3MR" /></th>
                    <th className="text-right cursor-pointer select-none" onClick={() => toggleClientSort('delivered')}>Delivered<ClientSortIcon col="delivered" /></th>
                    <th className="text-right cursor-pointer select-none" onClick={() => toggleClientSort('delPct')}>DEL%<ClientSortIcon col="delPct" /></th>
                    <th className="text-left">D-1 Δ</th>
                    <th className="text-left">7-Day Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client: any) => (
                    <tr key={client.clientName} className={`hover:bg-slate-50 transition-colors ${client.isCritical ? 'border-l-2 border-l-red-400' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        <div className="flex items-center gap-1.5">
                          {client.isCritical && <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />}
                          {client.clientName}
                        </div>
                      </td>
                      <td className="px-3 py-3"><ClientTypeBadge type={client.clientType} /></td>
                      <td className="text-right px-3 py-3 font-mono text-slate-700">{formatNumber(client.totalAWBs)}</td>
                      <td className="text-right px-3 py-3 font-mono text-sfx-orange-dark font-semibold">{formatNumber(client.awbs3MR)}</td>
                      <td className="text-right px-3 py-3 font-mono text-slate-700">{formatNumber(client.delivered)}</td>
                      <td className="text-right px-3 py-3"><DelPctCell value={client.delPct} /></td>
                      <td className="px-3 py-3"><TrendDisplay direction={client.trendDirection as TrendDirection} pct={client.trendPct} /></td>
                      <td className="px-4 py-3 w-28">
                        {client.sparkline?.length > 0 && <ResponsiveContainer width="100%" height={32}>
                          <LineChart data={client.sparkline}>
                            <Line type="monotone" dataKey="value" stroke="var(--sfx-orange)" strokeWidth={1.5} dot={false} />
                            <Tooltip contentStyle={{ fontSize: 10, padding: '2px 6px', borderRadius: 4 }} formatter={(v) => [formatNumber(Number(v)), '3MR']} />
                          </LineChart>
                        </ResponsiveContainer>}
                      </td>
                    </tr>
                  ))}
                  <tr className="grand-total">
                    <td className="px-4 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide" colSpan={2}>
                      Grand Total {(hasActiveFilters) && <span className="font-normal text-slate-500 normal-case">(filtered)</span>}
                    </td>
                    <td className="text-right px-3 py-3 font-mono font-bold text-slate-900">{formatNumber(clientGT.totalAWBs)}</td>
                    <td className="text-right px-3 py-3 font-mono font-bold text-sfx-orange-dark">{formatNumber(clientGT.awbs3MR)}</td>
                    <td className="text-right px-3 py-3 font-mono font-bold text-slate-900">{formatNumber(clientGT.delivered)}</td>
                    <td className="text-right px-3 py-3"><DelPctCell value={clientGTDelPct} /></td>
                    <td colSpan={2} className="px-3 py-3 text-slate-400 text-xs">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
