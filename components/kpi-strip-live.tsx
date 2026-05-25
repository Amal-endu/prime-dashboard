'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, Package, CheckCircle2, Clock } from 'lucide-react'
import { formatNumber, formatPct } from '@/lib/utils'
import { useConfigState } from '@/components/config-provider'
import { toApiParams } from '@/lib/config-params'

interface StatusData {
  maxDate: string
  totalAwbs: number
  totalRiders: number
}

export function KpiStripLive() {
  const { config, configVersion } = useConfigState()
  const [status, setStatus] = useState<StatusData | null>(null)
  const [demand, setDemand] = useState<{ totalDemand: number; total3MR: number; delivered3MR: number; delPct: number } | null>(null)

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {})
    const params = new URLSearchParams({ view: 'city' })
    Object.entries(toApiParams(config)).forEach(([k, v]) => params.set(k, v))
    fetch(`/api/demand?${params}`).then(r => r.json()).then((d) => {
      if (d.cities) {
        const totalDemand = d.cities.reduce((s: number, c: { totalDemand: number }) => s + c.totalDemand, 0)
        const total3MR = d.cities.reduce((s: number, c: { demand3MR: number }) => s + c.demand3MR, 0)
        const delivered3MR = d.cities.reduce((s: number, c: { delivered3MR: number }) => s + c.delivered3MR, 0)
        setDemand({ totalDemand, total3MR, delivered3MR, delPct: total3MR > 0 ? delivered3MR / total3MR * 100 : 0 })
      }
    }).catch(() => {})
  }, [configVersion])

  const delColor = demand
    ? demand.delPct >= 80 ? 'text-emerald-600' : demand.delPct >= 60 ? 'text-amber-600' : 'text-red-600'
    : 'text-slate-400'

  return (
    <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="max-w-[1600px] mx-auto flex items-center h-10 px-4 sm:px-6 gap-6 text-[12px]">
        <div className="flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">Demand</span>
          <span className="font-bold text-white ml-0.5 font-mono">{demand ? formatNumber(demand.totalDemand) : '—'}</span>
        </div>
        <div className="w-px h-4 bg-slate-700/80" />
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">3MR Del</span>
          <span className="font-bold text-emerald-400 ml-0.5 font-mono">{demand ? formatNumber(demand.delivered3MR) : '—'}</span>
        </div>
        <div className="w-px h-4 bg-slate-700/80" />
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-orange-400" />
          <span className="text-slate-400 font-medium uppercase tracking-wide text-[10px]">DEL%</span>
          <span className={`font-bold ml-0.5 font-mono ${demand ? (demand.delPct >= 80 ? 'text-emerald-400' : demand.delPct >= 60 ? 'text-amber-400' : 'text-red-400') : 'text-slate-500'}`}>
            {demand ? formatPct(demand.delPct) : '—'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
          <Clock className="w-3 h-3" />
          <span>{status?.maxDate ?? '...'}</span>
        </div>
      </div>
    </div>
  )
}
