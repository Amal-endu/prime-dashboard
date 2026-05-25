'use client'

import { useEffect, useState, useCallback } from 'react'
import { ChevronRight, ChevronDown, Loader2, Download, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { formatNumber } from '@/lib/utils'

type DayDemand = { totalOverall: number; total3MR: number; delPct3MR: number }
type DateLabel = { date: string; day: string; weekday: string }
type CityRow = { city: string; days: DayDemand[]; weekAvg: DayDemand }

interface TrendApiResponse {
  dates: DateLabel[]
  cities: CityRow[]
  total: DayDemand[]
  totalWeekAvg: DayDemand
}

type MetricKey = 'totalOverall' | 'total3MR' | 'delPct3MR'

const TABLE_CONFIG: { key: MetricKey; label: string; fmt: (v: number) => string; color: string }[] = [
  { key: 'totalOverall', label: 'Total Allocation — Overall (all AWBs)', fmt: formatNumber, color: 'text-slate-700' },
  { key: 'total3MR', label: 'Total Allocation — 3MR', fmt: formatNumber, color: 'text-sfx-orange-dark' },
  { key: 'delPct3MR', label: 'DEL% — 3MR (Delivered / Assigned)', fmt: (v) => `${v.toFixed(1)}%`, color: 'text-emerald-600' },
]

function DeltaChip({ d1Val, avgVal }: { d1Val: number; avgVal: number }) {
  if (!avgVal || !d1Val) return <span className="text-slate-300 text-[10px]">—</span>
  const pct = ((d1Val - avgVal) / avgVal) * 100
  const abs = Math.abs(pct)
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

function exportAllCsv(
  tableLabel: string,
  dates: DateLabel[],
  cities: CityRow[],
  total: DayDemand[],
  totalWeekAvg: DayDemand,
  key: MetricKey,
) {
  const header = ['City', ...dates.map(d => `${d.day} (${d.weekday})`), 'W-Avg (D2-D8)']
  const rows: string[][] = [
    ['All India', ...total.map(d => String(d[key])), String(totalWeekAvg[key])],
  ]
  for (const c of cities) {
    rows.push([c.city, ...c.days.map(d => String(d[key])), String(c.weekAvg[key])])
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

interface DemandTableProps {
  label: string
  color: string
  metricKey: MetricKey
  fmt: (v: number) => string
  dates: DateLabel[]
  cities: CityRow[]
  total: DayDemand[]
  totalWeekAvg: DayDemand
}

function DemandTable({ label, color, metricKey, fmt, dates, cities, total, totalWeekAvg }: DemandTableProps) {
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
      // default to desc for metrics, asc for city name
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
    } else if (sortCol === 'wAvg') {
      aVal = a.weekAvg[metricKey] || 0
      bVal = b.weekAvg[metricKey] || 0
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

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <span className={`text-sm font-semibold ${color}`}>{label}</span>
        <button
          onClick={() => exportAllCsv(label, dates, cities, total, totalWeekAvg, metricKey)}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800 border border-slate-200 rounded px-2 py-0.5 hover:bg-white transition-colors"
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
                  City
                  <SortIcon colKey="city" />
                </div>
              </th>
              {dates.map((d, i) => (
                <th 
                  key={d.date} 
                  className={`text-right px-3 py-1 min-w-[76px] cursor-pointer select-none hover:bg-slate-100 transition-colors ${i === 0 ? 'bg-sfx-orange/5 hover:bg-sfx-orange/10' : ''}`}
                  onClick={() => handleSort(`day_${i}`)}
                >
                  <div className={`text-[11px] flex items-center justify-end gap-0.5 ${i === 0 ? 'font-bold text-slate-800' : 'font-semibold text-slate-600'}`}>
                    <span>{d.day}</span>
                    {i === 0 && <span className="text-[9px] font-bold text-sfx-orange mr-0.5">D-1</span>}
                    <SortIcon colKey={`day_${i}`} />
                  </div>
                  <div className="text-[9px] text-slate-400 pr-3">{d.weekday}</div>
                </th>
              ))}
              <th 
                className="text-right px-3 py-1 min-w-[80px] bg-slate-100/60 cursor-pointer select-none hover:bg-slate-200 transition-colors"
                onClick={() => handleSort('wAvg')}
              >
                <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-end gap-0.5">
                  W-Avg
                  <SortIcon colKey="wAvg" />
                </div>
                <div className="text-[9px] text-slate-400 pr-3">D2–D8</div>
              </th>
              <th 
                className="text-right px-3 py-1 min-w-[64px] cursor-pointer select-none hover:bg-slate-100/80 transition-colors"
                onClick={() => handleSort('delta')}
              >
                <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-end gap-0.5">
                  vs Avg
                  <SortIcon colKey="delta" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {/* All India total */}
            <tr className="bg-sfx-orange/5 border-b border-sfx-orange/10 font-semibold">
              <td className="px-4 py-2.5 sticky left-0 bg-sfx-orange/5 z-10">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">All India</span>
              </td>
              {total.map((d, i) => (
                <td key={i} className={`text-right px-3 py-2.5 font-mono font-bold text-xs ${i === 0 ? 'text-sfx-orange bg-sfx-orange/5' : 'text-slate-700'}`}>
                  {fmt(d[metricKey])}
                </td>
              ))}
              <td className="text-right px-3 py-2.5 font-mono font-bold text-xs text-slate-600 bg-slate-50">
                {fmt(totalWeekAvg[metricKey])}
              </td>
              <td className="text-right px-3 py-2.5">
                <DeltaChip d1Val={total[0][metricKey]} avgVal={totalWeekAvg[metricKey]} />
              </td>
            </tr>

            {sortedCities.map(city => {
              const expanded = expandedCities.has(city.city)
              return (
                <tr
                  key={city.city}
                  className="hover:bg-slate-50/70 cursor-pointer transition-colors"
                  onClick={() => toggle(city.city)}
                >
                  <td className="px-4 py-2 sticky left-0 bg-white z-10 hover:bg-slate-50/70">
                    <div className="flex items-center gap-1.5">
                      {expanded
                        ? <ChevronDown className="w-3 h-3 text-slate-400" />
                        : <ChevronRight className="w-3 h-3 text-slate-400" />}
                      <span className="text-xs font-medium text-slate-700">{city.city}</span>
                    </div>
                  </td>
                  {city.days.map((d, i) => (
                    <td key={i} className={`text-right px-3 py-2 font-mono text-xs ${i === 0 ? 'font-semibold text-slate-800 bg-sfx-orange/5' : 'text-slate-600'}`}>
                      {fmt(d[metricKey])}
                    </td>
                  ))}
                  <td className="text-right px-3 py-2 font-mono text-xs text-slate-500 bg-slate-50/60">
                    {fmt(city.weekAvg[metricKey])}
                  </td>
                  <td className="text-right px-3 py-2">
                    <DeltaChip d1Val={city.days[0][metricKey]} avgVal={city.weekAvg[metricKey]} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface DemandTrendChartsProps {
  mr3CutoffHour?: number
  clientFilter?: string
  primeOnly?: boolean
}

export function DemandTrendCharts({ mr3CutoffHour, clientFilter, primeOnly }: DemandTrendChartsProps) {
  const [data, setData] = useState<TrendApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (mr3CutoffHour !== undefined) params.set('mr3CutoffHour', String(mr3CutoffHour))
    if (clientFilter && clientFilter !== 'all') params.set('client', clientFilter)
    if (primeOnly) params.set('prime', 'true')
    fetch(`/api/demand/trend?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [mr3CutoffHour, clientFilter, primeOnly])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 py-10 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading demand trend...
      </div>
    )
  }
  if (!data) return null

  const { dates, cities, total, totalWeekAvg } = data

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">8-Day Allocation Trend</h2>
        <span className="text-[10px] text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">D-1 vs D2–D8 avg</span>
      </div>
      {TABLE_CONFIG.map(tc => (
        <DemandTable
          key={tc.key}
          label={tc.label}
          color={tc.color}
          metricKey={tc.key}
          fmt={tc.fmt}
          dates={dates}
          cities={cities}
          total={total}
          totalWeekAvg={totalWeekAvg}
        />
      ))}
    </div>
  )
}
