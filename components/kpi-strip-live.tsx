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

  return (
    <div className="bg-slate-900 text-white border-b border-slate-800">
      <div className="flex items-center h-12 px-6 gap-8">
        <div className="flex items-center gap-2 text-sm">
          <Package className="w-4 h-4 text-slate-400" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Total Demand</span>
          <span className="font-semibold text-white ml-1">{demand ? formatNumber(demand.totalDemand) : '—'}</span>
        </div>
        <div className="w-px h-5 bg-slate-700" />
        <div className="flex items-center gap-2 text-sm">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">3MR Delivered</span>
          <span className="font-semibold text-emerald-400 ml-1">{demand ? formatNumber(demand.delivered3MR) : '—'}</span>
        </div>
        <div className="w-px h-5 bg-slate-700" />
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-sfx-orange-light" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Delivered %</span>
          <span className="font-semibold text-sfx-orange-light ml-1">{demand ? formatPct(demand.delPct) : '—'}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <Clock className="w-3.5 h-3.5" />
          <span>Data as of {status?.maxDate ?? '...'}</span>
        </div>
      </div>
    </div>
  )
}
