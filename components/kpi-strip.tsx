'use client'

import { TrendingUp, Package, CheckCircle2, Clock } from 'lucide-react'
import { formatNumber, formatPct } from '@/lib/utils'
import type { GlobalKPIs } from '@/lib/types'

interface KpiStripProps {
  kpis: GlobalKPIs
}

export function KpiStrip({ kpis }: KpiStripProps) {
  return (
    <div className="bg-slate-900 text-white border-b border-slate-800">
      <div className="flex items-center h-12 px-6 gap-8">
        <div className="flex items-center gap-2 text-sm">
          <Package className="w-4 h-4 text-slate-400" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Total Demand</span>
          <span className="font-semibold text-white ml-1">{formatNumber(kpis.totalDemand)}</span>
        </div>
        <div className="w-px h-5 bg-slate-700" />
        <div className="flex items-center gap-2 text-sm">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">3MR Delivered</span>
          <span className="font-semibold text-emerald-400 ml-1">{formatNumber(kpis.delivered3MR)}</span>
        </div>
        <div className="w-px h-5 bg-slate-700" />
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-4 h-4 text-blue-400" />
          <span className="text-slate-400 text-xs uppercase tracking-wide font-medium">Delivered %</span>
          <span className="font-semibold text-blue-400 ml-1">{formatPct(kpis.deliveredPct)}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <Clock className="w-3.5 h-3.5" />
          <span>Data as of {kpis.dataDate}</span>
        </div>
      </div>
    </div>
  )
}
