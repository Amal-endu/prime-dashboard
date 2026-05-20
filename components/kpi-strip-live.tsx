'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, Package, CheckCircle2, Clock } from 'lucide-react'
import { formatNumber, formatPct } from '@/lib/utils'

interface StatusData {
  maxDate: string
  totalAwbs: number
  totalRiders: number
}

export function KpiStripLive() {
  const [status, setStatus] = useState<StatusData | null>(null)
  const [demand, setDemand] = useState<{ total3MR: number; delivered3MR: number; delPct: number } | null>(null)

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {})
    fetch('/api/demand?view=city').then(r => r.json()).then((d) => {
      if (d.cities) {
        const total3MR = d.cities.reduce((s: number, c: { demand3MR: number }) => s + c.demand3MR, 0)
        const del3MR = d.cities.reduce((s: number, c: { delivered3MR: number; demand3MR: number; delPct3MR: number }) => {
          return s + (c.demand3MR * (c.delPct3MR / 100))
        }, 0)
        setDemand({ total3MR, delivered3MR: Math.round(del3MR), delPct: del3MR / total3MR * 100 })
      }
    }).catch(() => {})
  }, [])

  return (
    <div className="bg-slate-900 text-white border-b border-slate-800">
      <div className="flex items-center h-12 px-6 gap-8">
        <div className="flex items-center gap-2 text-sm">
          <Package className="w-4 h-4 text-slate-400" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Total Demand</span>
          <span className="font-semibold text-white ml-1">{demand ? formatNumber(demand.total3MR) : '—'}</span>
        </div>
        <div className="w-px h-5 bg-slate-700" />
        <div className="flex items-center gap-2 text-sm">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">3MR Delivered</span>
          <span className="font-semibold text-emerald-400 ml-1">{demand ? formatNumber(demand.delivered3MR) : '—'}</span>
        </div>
        <div className="w-px h-5 bg-slate-700" />
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-blue-400" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Delivered %</span>
          <span className="font-semibold text-blue-400 ml-1">{demand ? formatPct(demand.delPct) : '—'}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <Clock className="w-3.5 h-3.5" />
          <span>Data as of {status?.maxDate ?? '...'}</span>
        </div>
      </div>
    </div>
  )
}
