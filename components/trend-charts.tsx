'use client'

import { useEffect, useState } from 'react'
import { Loader2, TrendingUp } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { formatCurrency, formatNumber } from '@/lib/utils'
import { useToast } from '@/components/toast-provider'
import { toApiParams } from '@/lib/config-params'
import type { Config } from '@/lib/types'

type TrendPoint = { label: string; riders: number; avgProductivity: number; avgEarnings: number }
type TrendApiResponse = { l7d: TrendPoint[]; l30d: TrendPoint[]; cities: string[] }

interface TrendChartsProps {
  sddMode: '3mr' | 'overall'
  configVersion: number
  config: Config
}

export function TrendCharts({ sddMode, configVersion, config }: TrendChartsProps) {
  const toast = useToast()
  const [mode, setMode] = useState<'l7d' | 'l30d'>('l7d')
  const [city, setCity] = useState('all')
  const [trendData, setTrendData] = useState<TrendApiResponse | null>(null)
  const [loadingTrend, setLoadingTrend] = useState(true)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingTrend(true)
    toast.register()
    const params = new URLSearchParams({ mode: sddMode })
    if (city !== 'all') params.set('city', city)
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/details/trend?${params}`)
      .then(r => r.json())
      .then((d: TrendApiResponse) => { setTrendData(d); setLoadingTrend(false); toast.completeOne() })
      .catch(() => { setLoadingTrend(false); toast.failAll() })
  }, [city, sddMode, configVersion, config, toast])

  const points: TrendPoint[] = trendData ? (mode === 'l7d' ? trendData.l7d : trendData.l30d) : []
  const cities = trendData?.cities ?? []

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-sfx-orange" />
          <span className="text-sm font-semibold text-slate-700">Trends</span>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          {(['l7d', 'l30d'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {m === 'l7d' ? 'Last 7 Days' : 'Last 30 Days'}
            </button>
          ))}
        </div>
        <select
          value={city}
          onChange={e => setCity(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light ml-auto"
        >
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
          <ChartPanel title="Riders Logged In">
            <BarChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [formatNumber(Number(v)), 'Riders']} />
              <Bar dataKey="riders" fill="#FF6200" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartPanel>
          <ChartPanel title="Avg Rider Productivity (orders/rider/day)">
            <LineChart data={points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [Number(v).toFixed(1), 'Orders / rider / day']} />
              <Line type="monotone" dataKey="avgProductivity" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ChartPanel>
          <ChartPanel title="Avg Earnings / Rider">
            <LineChart data={points} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `₹${v}`} />
              <Tooltip formatter={(v) => [formatCurrency(Number(v)), 'Avg Earnings']} />
              <Line type="monotone" dataKey="avgEarnings" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ChartPanel>
        </div>
      )}
    </div>
  )
}

function ChartPanel({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={160}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}
