'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { formatNumber } from '@/lib/utils'

type MatrixCell = { evening: number; cross: number; morning: number; total: number }
type Matrix = { Regular: MatrixCell; Irregular: MatrixCell; 'New Rider': MatrixCell }
type MatrixData = { matrix: Matrix; total: number; cities: string[]; hubs: string[] }
type MatrixView = 'riders' | 'orders'

const ROWS: { key: keyof Matrix; label: string; color: string }[] = [
  { key: 'Regular',   label: 'Regular',   color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
  { key: 'Irregular', label: 'Irregular', color: 'text-amber-600 bg-amber-50 border-amber-100' },
  { key: 'New Rider', label: 'New Rider', color: 'text-sky-600 bg-sky-50 border-sky-100' },
]
const COLS = [
  { key: 'evening' as const, label: 'Evening',    color: 'text-indigo-600' },
  { key: 'cross'   as const, label: 'Cross Util', color: 'text-violet-600' },
  { key: 'morning' as const, label: 'Morning',    color: 'text-orange-600' },
]

function formatPct(value: number, total: number) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'
}

const emptyMatrix: Matrix = {
  Regular: { evening: 0, cross: 0, morning: 0, total: 0 },
  Irregular: { evening: 0, cross: 0, morning: 0, total: 0 },
  'New Rider': { evening: 0, cross: 0, morning: 0, total: 0 },
}

interface MatrixGridProps {
  matrix: Matrix
  total: number
  loading: boolean
  label: string
  sublabel: string
}

function MatrixGrid({ matrix, total, loading, label, sublabel }: MatrixGridProps) {
  return (
    <div className="flex-1 min-w-0">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        <div className="text-[10px] text-slate-400 mt-0.5">{sublabel}</div>
      </div>
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          </div>
        )}
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="text-left px-3 py-2 font-medium text-slate-400 w-24 text-[10px]">Behaviour ↓</th>
              {ROWS.map(r => (
                <th key={r.key} className={`text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-wide border-l border-slate-100 ${r.color.split(' ')[0]}`}>
                  {r.label}
                </th>
              ))}
              <th className="text-center px-3 py-2 font-medium text-slate-400 text-[10px] uppercase tracking-wide border-l border-slate-100">
                Row %
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {COLS.map(col => {
              const values = ROWS.map(row => matrix[row.key]?.[col.key] ?? 0)
              const rowTotal = values.reduce((s, v) => s + v, 0)
              return (
                <tr key={col.key} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${col.color}`}>{col.label}</span>
                  </td>
                  {ROWS.map((row, i) => (
                    <td key={row.key} className="px-2 py-2.5 text-center border-l border-slate-100">
                      <div className={`font-mono font-semibold text-xs ${row.color.split(' ')[0]}`}>{formatPct(values[i], total)}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{formatNumber(values[i])}</div>
                    </td>
                  ))}
                  <td className="px-2 py-2.5 text-center border-l border-slate-100">
                    <div className={`font-mono font-bold text-xs ${col.color}`}>{formatPct(rowTotal, total)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{formatNumber(rowTotal)}</div>
                  </td>
                </tr>
              )
            })}
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Col Total</td>
              {ROWS.map(row => {
                const cell = matrix[row.key] ?? { evening: 0, cross: 0, morning: 0, total: 0 }
                return (
                  <td key={row.key} className="px-2 py-2 text-center border-l border-slate-100">
                    <div className={`font-mono font-bold text-xs ${row.color.split(' ')[0]}`}>{formatPct(cell.total, total)}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{formatNumber(cell.total)}</div>
                  </td>
                )
              })}
              <td className="px-2 py-2 text-center border-l border-slate-100">
                <div className="font-mono font-bold text-xs text-slate-900">100%</div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{formatNumber(total)}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function MatrixTable() {
  // L30D state
  const [result, setResult] = useState<MatrixData | null>(null)
  const [volumeResult, setVolumeResult] = useState<MatrixData | null>(null)
  const [loading30, setLoading30] = useState(true)

  // D-1 state
  const [d1Result, setD1Result] = useState<MatrixData | null>(null)
  const [d1VolumeResult, setD1VolumeResult] = useState<MatrixData | null>(null)
  const [loadingD1, setLoadingD1] = useState(true)
  const [d1DateLabel, setD1DateLabel] = useState('')

  const [matrixView, setMatrixView] = useState<MatrixView>('riders')
  const [draftCity, setDraftCity] = useState('all')
  const [draftHub, setDraftHub] = useState('all')
  const [appliedCity, setAppliedCity] = useState('all')
  const [appliedHub, setAppliedHub] = useState('all')

  const isDirty = draftCity !== appliedCity || draftHub !== appliedHub
  const isFiltered = appliedCity !== 'all' || appliedHub !== 'all'

  const fetchAll = useCallback((city: string, hub: string) => {
    setLoading30(true)
    setLoadingD1(true)
    const params = new URLSearchParams()
    if (city !== 'all') params.set('city', city)
    if (hub !== 'all') params.set('hub', hub)

    const d1Params = new URLSearchParams(params)
    d1Params.set('d1Only', 'true')

    Promise.all([
      fetch(`/api/profiling/matrix?${params}`).then(r => r.json()),
      fetch(`/api/profiling/volume-matrix?${params}`).then(r => r.json()),
    ]).then(([profileData, volumeData]) => {
      setResult(profileData)
      setVolumeResult(volumeData)
      setLoading30(false)
    }).catch(() => setLoading30(false))

    Promise.all([
      fetch(`/api/profiling/matrix?${d1Params}`).then(r => r.json()),
      fetch(`/api/profiling/volume-matrix?${d1Params}`).then(r => r.json()),
    ]).then(([profileData, volumeData]) => {
      setD1Result(profileData)
      setD1VolumeResult(volumeData)
      setLoadingD1(false)
    }).catch(() => setLoadingD1(false))
  }, [])

  useEffect(() => { fetchAll('all', 'all') }, [fetchAll])

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      if (d.maxDateRaw) {
        const date = new Date(d.maxDateRaw)
        const label = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        setD1DateLabel(label)
      }
    }).catch(() => {})
  }, [])

  function handleCityChange(city: string) {
    setDraftCity(city)
    setDraftHub('all')
    const params = new URLSearchParams()
    if (city !== 'all') params.set('city', city)
    fetch(`/api/profiling/matrix?${params}`)
      .then(r => r.json())
      .then(d => setResult(prev => prev ? { ...prev, hubs: d.hubs } : d))
      .catch(() => {})
  }

  function handleApply() {
    setAppliedCity(draftCity)
    setAppliedHub(draftHub)
    fetchAll(draftCity, draftHub)
  }

  function handleClear() {
    setDraftCity('all'); setDraftHub('all')
    setAppliedCity('all'); setAppliedHub('all')
    fetchAll('all', 'all')
  }

  const l30dMatrix = matrixView === 'riders'
    ? (result?.matrix ?? emptyMatrix)
    : (volumeResult?.matrix ?? emptyMatrix)
  const l30dTotal = matrixView === 'riders' ? (result?.total ?? 0) : (volumeResult?.total ?? 0)

  const d1Matrix = matrixView === 'riders'
    ? (d1Result?.matrix ?? emptyMatrix)
    : (d1VolumeResult?.matrix ?? emptyMatrix)
  const d1Total = matrixView === 'riders' ? (d1Result?.total ?? 0) : (d1VolumeResult?.total ?? 0)

  const cityOptions = result?.cities ?? []
  const hubOptions = result?.hubs ?? []

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Regularity × Behaviour Matrix</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">L30D classification · compared to D-1 active riders</p>
          </div>

          <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-lg">
            <button
              onClick={() => setMatrixView('riders')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${matrixView === 'riders' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Riders
            </button>
            <button
              onClick={() => setMatrixView('orders')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${matrixView === 'orders' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Orders
            </button>
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

      {/* Two matrices side by side */}
      <div className="overflow-x-auto">
        <div className="flex min-w-[900px] divide-x divide-slate-200">
          <MatrixGrid
            matrix={l30dMatrix}
            total={l30dTotal}
            loading={loading30}
            label="L30D — All Riders"
            sublabel="30-day rolling classification"
          />
          <MatrixGrid
            matrix={d1Matrix}
            total={d1Total}
            loading={loadingD1}
            label={`D-1 — Logged In${d1DateLabel ? ` (${d1DateLabel})` : ''}`}
            sublabel="All riders who logged in · L30D profile classification"
          />
        </div>
      </div>
    </div>
  )
}
