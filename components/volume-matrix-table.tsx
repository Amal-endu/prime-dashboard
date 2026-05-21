'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { formatNumber } from '@/lib/utils'

type MatrixCell = { evening: number; cross: number; morning: number; total: number }
type Matrix = { Regular: MatrixCell; Irregular: MatrixCell; 'New Rider': MatrixCell }
type MatrixData = { matrix: Matrix; total: number; cities: string[]; hubs: string[] }

const ROWS: { key: keyof Matrix; label: string; color: string }[] = [
  { key: 'Regular',    label: 'Regular',    color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  { key: 'Irregular',  label: 'Irregular',  color: 'text-amber-600 bg-amber-50 border-amber-100' },
  { key: 'New Rider',  label: 'New Rider',  color: 'text-sky-600 bg-sky-50 border-sky-100' },
]
const COLS = [
  { key: 'evening' as const, label: 'Evening',    color: 'text-indigo-600' },
  { key: 'cross'   as const, label: 'Cross Util', color: 'text-violet-600' },
  { key: 'morning' as const, label: 'Morning',    color: 'text-orange-600' },
]

function formatPct(value: number, total: number) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'
}

export function VolumeMatrixTable() {
  const [result, setResult] = useState<MatrixData | null>(null)
  const [loadingMatrix, setLoadingMatrix] = useState(true)
  const [draftCity, setDraftCity] = useState('all')
  const [draftHub, setDraftHub] = useState('all')
  const [appliedCity, setAppliedCity] = useState('all')
  const [appliedHub, setAppliedHub] = useState('all')

  const isDirty    = draftCity !== appliedCity || draftHub !== appliedHub
  const isFiltered = appliedCity !== 'all' || appliedHub !== 'all'

  const fetchMatrix = useCallback((city: string, hub: string) => {
    setLoadingMatrix(true)
    const params = new URLSearchParams()
    if (city !== 'all') params.set('city', city)
    if (hub  !== 'all') params.set('hub',  hub)
    fetch(`/api/profiling/volume-matrix?${params}`)
      .then(r => r.json())
      .then(d => { setResult(d); setLoadingMatrix(false) })
      .catch(() => setLoadingMatrix(false))
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchMatrix('all', 'all') }, [fetchMatrix])

  function handleCityChange(city: string) {
    setDraftCity(city)
    setDraftHub('all')
    const params = new URLSearchParams()
    if (city !== 'all') params.set('city', city)
    fetch(`/api/profiling/volume-matrix?${params}`)
      .then(r => r.json())
      .then(d => setResult(prev => prev ? { ...prev, hubs: d.hubs } : d))
      .catch(() => {})
  }

  function handleApply() {
    setAppliedCity(draftCity)
    setAppliedHub(draftHub)
    fetchMatrix(draftCity, draftHub)
  }

  function handleClear() {
    setDraftCity('all'); setDraftHub('all')
    setAppliedCity('all'); setAppliedHub('all')
    fetchMatrix('all', 'all')
  }

  const matrix: Matrix = result?.matrix ?? {
    Regular:     { evening: 0, cross: 0, morning: 0, total: 0 },
    Irregular:   { evening: 0, cross: 0, morning: 0, total: 0 },
    'New Rider': { evening: 0, cross: 0, morning: 0, total: 0 },
  }
  const total      = result?.total ?? 0
  const cityOptions = result?.cities ?? []
  const hubOptions  = result?.hubs ?? []

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Volume Matrix — Orders Attempted</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">Last 30 days · Orders attempted by regularity × behaviour segment</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={draftCity}
              onChange={e => handleCityChange(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light min-w-[120px]"
            >
              <option value="all">All Cities</option>
              {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={draftHub}
              onChange={e => setDraftHub(e.target.value)}
              disabled={hubOptions.length === 0}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light min-w-[160px] disabled:opacity-40"
            >
              <option value="all">{draftCity === 'all' ? 'All Hubs' : `All Hubs in ${draftCity}`}</option>
              {hubOptions.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <button
              onClick={handleApply}
              disabled={!isDirty}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${isDirty ? 'bg-sfx-orange text-white hover:bg-sfx-orange-dark' : 'bg-slate-100 text-slate-400 cursor-default'}`}
            >
              Apply
            </button>
            {isFiltered && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors"
              >
                <X className="w-3 h-3" />Clear
              </button>
            )}
            {isFiltered && (
              <span className="text-[10px] text-slate-400 font-mono">
                {appliedCity !== 'all' ? appliedCity : ''}
                {appliedCity !== 'all' && appliedHub !== 'all' ? ' › ' : ''}
                {appliedHub !== 'all' ? appliedHub : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto relative">
        {loadingMatrix && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          </div>
        )}
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-4 py-2.5 font-medium text-slate-500 w-36">Behaviour ↓ / Regularity →</th>
              {ROWS.map(r => (
                <th key={r.key} className={`text-center px-4 py-2.5 font-semibold uppercase tracking-wide ${r.color.split(' ')[0]}`}>{r.label}</th>
              ))}
              <th className="text-center px-4 py-2.5 font-medium text-slate-500 uppercase tracking-wide">Row Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {COLS.map(col => {
              const regValues = ROWS.map(row => (matrix[row.key]?.[col.key] ?? 0))
              const rowTotal  = regValues.reduce((s, v) => s + v, 0)
              return (
                <tr key={col.key} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${col.color}`}>
                      {col.label}
                    </span>
                  </td>
                  {ROWS.map((row, i) => (
                    <td key={row.key} className="px-4 py-3 text-center">
                      <div className={`font-mono font-semibold text-sm ${row.color.split(' ')[0]}`}>{formatPct(regValues[i], total)}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{formatNumber(regValues[i])}</div>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center">
                    <div className={`font-mono font-bold text-sm ${col.color}`}>{formatPct(rowTotal, total)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{formatNumber(rowTotal)}</div>
                  </td>
                </tr>
              )
            })}
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="px-4 py-2.5 text-xs font-bold text-slate-600 uppercase tracking-wide">Col Total</td>
              {ROWS.map(row => {
                const cell = matrix[row.key] ?? { evening: 0, cross: 0, morning: 0, total: 0 }
                return (
                  <td key={row.key} className="px-4 py-2.5 text-center">
                    <div className={`font-mono font-bold text-sm ${row.color.split(' ')[0]}`}>{formatPct(cell.total, total)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{formatNumber(cell.total)}</div>
                  </td>
                )
              })}
              <td className="px-4 py-2.5 text-center">
                <div className="font-mono font-bold text-sm text-slate-900">100%</div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{formatNumber(total)}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
