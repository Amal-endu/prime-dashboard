'use client'

import { useEffect, useState, useCallback, Fragment } from 'react'
import { ChevronRight, ChevronDown, Loader2, TrendingUp, Download, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { formatNumber, formatCurrency } from '@/lib/utils'
import { toApiParams } from '@/lib/config-params'
import type { Config } from '@/lib/types'

type DayMetrics = { riders: number; avgProductivity: number; avgEarnings: number; delPct: number }
type DateLabel = { date: string; day: string; weekday: string }

type CityRow = { city: string; days: DayMetrics[]; weekAvg: DayMetrics }
type HubRow = { city: string; hub: string; days: DayMetrics[]; weekAvg: DayMetrics }

interface TrendApiResponse {
  dates: DateLabel[]
  cities: CityRow[]
  hubs: HubRow[]
  total: DayMetrics[]
  totalWeekAvg: DayMetrics
}

interface TrendChartsProps {
  sddMode: '3mr' | 'overall'
  configVersion: number
  config: Config
}

type TableKey = 'riders' | 'avgProductivity' | 'avgEarnings' | 'delPct'

const TABLE_CONFIG: { key: TableKey; label: string; fmt: (v: number) => string; color: string }[] = [
  { key: 'riders', label: 'Riders Logged In', fmt: (v) => formatNumber(v), color: 'text-sfx-orange' },
  { key: 'avgProductivity', label: 'Avg Productivity (orders/rider)', fmt: (v) => v.toFixed(1), color: 'text-amber-600' },
  { key: 'avgEarnings', label: 'Avg Earnings / Rider', fmt: (v) => formatCurrency(v), color: 'text-violet-600' },
  { key: 'delPct', label: 'Del % (Delivered / Attempted)', fmt: (v) => `${v.toFixed(1)}%`, color: 'text-emerald-600' },
]

// Delta pill: compares D-1 vs weekly avg of D-2..D-8
function DeltaChip({ d1, weekAvg, metricKey }: { d1: DayMetrics; weekAvg: DayMetrics; metricKey: TableKey }) {
  const current = d1[metricKey]
  const base = weekAvg[metricKey]
  if (!base || !current) return <span className="text-slate-300 text-[10px]">—</span>

  const pct = ((current - base) / base) * 100
  const abs = Math.abs(pct)

  // flat = within 1%
  if (abs < 1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-slate-400">
        <Minus className="w-2.5 h-2.5" /> flat
      </span>
    )
  }

  const up = pct > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${up ? 'text-emerald-600' : 'text-red-500'}`}>
      {up ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
      {abs.toFixed(1)}%
    </span>
  )
}

function exportCsv(
  tableLabel: string,
  dates: DateLabel[],
  cityRow: CityRow,
  hubs: HubRow[],
  key: TableKey,
  expanded: boolean,
) {
  const cityHubs = hubs.filter(h => h.city === cityRow.city)
  const header = ['City/Hub', ...dates.map(d => `${d.day} (${d.weekday})`), 'W-Avg (D2-D8)']
  const rows: string[][] = []
  rows.push([cityRow.city, ...cityRow.days.map(d => String(d[key])), String(cityRow.weekAvg[key])])
  if (expanded) {
    for (const hub of cityHubs) {
      rows.push([`  ${hub.hub}`, ...hub.days.map(d => String(d[key])), String(hub.weekAvg[key])])
    }
  }
  const csv = [header, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tableLabel.replace(/\s+/g, '_')}_${cityRow.city}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportAllCsv(tableLabel: string, dates: DateLabel[], cities: CityRow[], hubs: HubRow[], total: DayMetrics[], totalWeekAvg: DayMetrics, key: TableKey) {
  const header = ['City/Hub', ...dates.map(d => `${d.day} (${d.weekday})`), 'W-Avg (D2-D8)']
  const rows: string[][] = [['All India', ...total.map(d => String(d[key])), String(totalWeekAvg[key])]]
  for (const city of cities) {
    rows.push([city.city, ...city.days.map(d => String(d[key])), String(city.weekAvg[key])])
    const cityHubs = hubs.filter(h => h.city === city.city)
    for (const hub of cityHubs) {
      rows.push([`  ${hub.hub}`, ...hub.days.map(d => String(d[key])), String(hub.weekAvg[key])])
    }
  }
  const csv = [header, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${tableLabel.replace(/\s+/g, '_')}_All.csv`
  a.click()
  URL.revokeObjectURL(url)
}

interface TrendTableProps {
  label: string
  color: string
  metricKey: TableKey
  fmt: (v: number) => string
  dates: DateLabel[]
  cities: CityRow[]
  hubs: HubRow[]
  total: DayMetrics[]
  totalWeekAvg: DayMetrics
}

function TrendTable({ label, color, metricKey, fmt, dates, cities, hubs, total, totalWeekAvg }: TrendTableProps) {
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set())
  const [sortCol, setSortCol] = useState<string>('city')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const toggle = useCallback((city: string) => {
    setExpandedCities(prev => {
      const n = new Set(prev)
      n.has(city) ? n.delete(city) : n.add(city)
      return n
    })
  }, [])

  const handleSort = useCallback((colKey: string) => {
    if (sortCol === colKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(colKey)
      setSortDir(colKey === 'city' ? 'asc' : 'desc')
    }
  }, [sortCol])

  const SortIcon = ({ colKey }: { colKey: string }) => {
    if (sortCol !== colKey) return <span className="ml-1 opacity-30 select-none font-normal">↕</span>
    return sortDir === 'asc' 
      ? <span className="ml-1 text-slate-800 font-bold select-none">↑</span>
      : <span className="ml-1 text-slate-800 font-bold select-none">↓</span>
  }

  // Sort cities based on active selection
  const sortedCities = [...cities].sort((a, b) => {
    let aVal: string | number = 0
    let bVal: string | number = 0

    if (sortCol === 'city') {
      aVal = a.city
      bVal = b.city
    } else if (sortCol === 'delta') {
      const aD1 = a.days[0]?.[metricKey] || 0
      const aAvg = a.weekAvg[metricKey] || 0
      const aPct = aAvg ? ((aD1 - aAvg) / aAvg) * 100 : 0

      const bD1 = b.days[0]?.[metricKey] || 0
      const bAvg = b.weekAvg[metricKey] || 0
      const bPct = bAvg ? ((bD1 - bAvg) / bAvg) * 100 : 0

      aVal = aPct
      bVal = bPct
    } else if (sortCol.startsWith('day_')) {
      const idx = parseInt(sortCol.replace('day_', ''), 10)
      aVal = a.days[idx]?.[metricKey] || 0
      bVal = b.days[idx]?.[metricKey] || 0
    }

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    } else {
      const numA = aVal as number
      const numB = bVal as number
      return sortDir === 'asc' ? numA - numB : numB - numA
    }
  })

  const d1 = dates[0]

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <span className={`text-sm font-semibold ${color}`}>{label}</span>
        <button
          onClick={() => exportAllCsv(label, dates, cities, hubs, total, totalWeekAvg, metricKey)}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-2 py-0.5 hover:bg-white transition-colors"
          title="Export all cities + hubs as CSV"
        >
          <Download className="w-3 h-3" /> Export All
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th 
                className="text-left px-4 py-2 font-medium text-slate-500 uppercase tracking-wide w-48 sticky left-0 bg-slate-50 z-10 cursor-pointer select-none hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('city')}
              >
                <div className="flex items-center gap-1">
                  City / Hub
                  <SortIcon colKey="city" />
                </div>
              </th>
              {dates.map((d, i) => (
                <th 
                  key={d.date} 
                  className={`text-right px-3 py-1 min-w-[72px] cursor-pointer select-none hover:bg-slate-100 transition-colors ${i === 0 ? 'bg-sfx-orange/5 hover:bg-sfx-orange/10' : ''}`}
                  onClick={() => handleSort(`day_${i}`)}
                >
                  <div className={`text-[11px] flex items-center justify-end gap-0.5 ${i === 0 ? 'font-bold text-slate-800' : 'font-semibold text-slate-600'}`}>
                    <span>{d.day}</span>
                    {i === 0 && <span className="text-[9px] font-bold text-sfx-orange mr-0.5">D-1</span>}
                    <SortIcon colKey={`day_${i}`} />
                  </div>
                  <div className={`text-[10px] font-normal pr-3 ${i === 0 ? 'text-sfx-orange/70' : 'text-slate-400'}`}>{d.weekday}</div>
                </th>
              ))}
              {/* vs W-Avg column */}
              <th 
                className="text-right px-3 py-1 min-w-[64px] border-l border-slate-200 cursor-pointer select-none hover:bg-slate-100 transition-colors"
                onClick={() => handleSort('delta')}
              >
                <div className="text-[10px] font-semibold text-slate-500 flex items-center justify-end gap-0.5">
                  vs W-Avg
                  <SortIcon colKey="delta" />
                </div>
                <div className="text-[9px] font-normal text-slate-400 pr-3">D-1 vs D2–D8</div>
              </th>
              <th className="text-right px-3 py-2 font-medium text-slate-400 uppercase tracking-wide text-[10px] w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {/* All India total row */}
            <tr className="bg-slate-900 text-white font-semibold">
              <td className="px-4 py-2.5 font-semibold text-[11px] uppercase tracking-wide sticky left-0 bg-slate-900 z-10">All India</td>
              {total.map((d, i) => (
                <td key={i} className={`text-right px-3 py-2.5 font-mono ${i === 0 ? 'font-bold' : ''}`}>
                  {d[metricKey] > 0 ? fmt(d[metricKey]) : <span className="text-slate-600">—</span>}
                </td>
              ))}
              <td className="text-right px-3 py-2.5 border-l border-slate-700">
                <DeltaChip d1={total[0]} weekAvg={totalWeekAvg} metricKey={metricKey} />
              </td>
              <td className="px-3 py-2.5">
                <button
                  onClick={() => exportAllCsv(label, dates, cities, hubs, total, totalWeekAvg, metricKey)}
                  className="text-slate-500 hover:text-white transition-colors"
                  title="Export all as CSV"
                >
                  <Download className="w-3 h-3" />
                </button>
              </td>
            </tr>

            {sortedCities.map(cityRow => {
              const isExpanded = expandedCities.has(cityRow.city)
              const cityHubs = hubs.filter(h => h.city === cityRow.city)

              return (
                <Fragment key={`city-group-${cityRow.city}`}>
                  <tr
                    className="bg-slate-50 hover:bg-slate-100/80 cursor-pointer font-medium transition-colors"
                    onClick={() => toggle(cityRow.city)}
                  >
                    <td className="px-4 py-2.5 sticky left-0 bg-slate-50 z-10">
                      <div className="flex items-center gap-1.5">
                        {isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                        <span className="font-semibold text-slate-800">{cityRow.city}</span>
                        <span className="text-[9px] text-slate-400 bg-slate-200/80 px-1 py-0.5 rounded">{cityHubs.length}</span>
                      </div>
                    </td>
                    {cityRow.days.map((d, i) => (
                      <td key={i} className={`text-right px-3 py-2.5 font-mono ${i === 0 ? `font-bold ${color}` : `font-semibold ${color}`}`}>
                        {d[metricKey] > 0 ? fmt(d[metricKey]) : <span className="text-slate-300">—</span>}
                      </td>
                    ))}
                    <td className="text-right px-3 py-2.5 border-l border-slate-100">
                      <DeltaChip d1={cityRow.days[0]} weekAvg={cityRow.weekAvg} metricKey={metricKey} />
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          exportCsv(label, dates, cityRow, hubs, metricKey, isExpanded)
                        }}
                        className="text-slate-400 hover:text-slate-700 transition-colors"
                        title={`Export ${cityRow.city}${isExpanded ? ' + hubs' : ''}`}
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>

                  {isExpanded && cityHubs.map(hub => (
                    <tr key={`hub-${hub.hub}`} className="bg-white hover:bg-sfx-orange/5 transition-colors">
                      <td className="px-4 py-2 pl-10 sticky left-0 bg-white z-10">
                        <span className="text-slate-600 font-medium">{hub.hub}</span>
                      </td>
                      {hub.days.map((d, i) => (
                        <td key={i} className={`text-right px-3 py-2 font-mono ${i === 0 ? 'font-bold text-slate-800' : 'text-slate-500'}`}>
                          {d[metricKey] > 0 ? fmt(d[metricKey]) : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                      <td className="text-right px-3 py-2 border-l border-slate-100">
                        <DeltaChip d1={hub.days[0]} weekAvg={hub.weekAvg} metricKey={metricKey} />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => exportCsv(label, dates, cityRow, hubs, metricKey, true)}
                          className="text-slate-300 hover:text-slate-500 transition-colors"
                          title={`Export ${hub.hub}`}
                        >
                          <Download className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {d1 && (
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50">
          <p className="text-[10px] text-slate-400">
            <span className="font-semibold text-sfx-orange">D-1 = {d1.day} ({d1.weekday})</span>
            <span className="ml-3">vs W-Avg = average of D-2 through D-8</span>
          </p>
        </div>
      )}
    </div>
  )
}

export function TrendCharts({ sddMode, configVersion, config }: TrendChartsProps) {
  const [trendData, setTrendData] = useState<TrendApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ mode: sddMode })
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/details/trend?${params}`)
      .then(r => r.json())
      .then((d: TrendApiResponse) => { setTrendData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [sddMode, configVersion, config])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-sfx-orange" />
        <span className="text-sm font-semibold text-slate-700">
          Last 8 Days Trend
          {trendData && (
            <span className="text-slate-400 font-normal ml-2 text-xs">
              D-1 = {trendData.dates[0]?.day} · {trendData.dates[0]?.weekday}
            </span>
          )}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-24 text-slate-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading trend data...
        </div>
      ) : !trendData ? (
        <div className="text-red-500 text-sm py-4">Failed to load trend data</div>
      ) : (
        TABLE_CONFIG.map(t => (
          <TrendTable
            key={t.key}
            label={t.label}
            color={t.color}
            metricKey={t.key}
            fmt={t.fmt}
            dates={trendData.dates}
            cities={trendData.cities}
            hubs={trendData.hubs}
            total={trendData.total}
            totalWeekAvg={trendData.totalWeekAvg}
          />
        ))
      )}
    </div>
  )
}
