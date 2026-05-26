'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { formatNumber } from '@/lib/utils'

type MatrixCell = { evening: number; cross: number; morning: number; total: number }
type Matrix = { Regular: MatrixCell; Irregular: MatrixCell; 'New Rider': MatrixCell }
type WeekBucket = { matrix: Matrix; total: number }
type WoWData = { weeks: { w3: WeekBucket; w2: WeekBucket; w1: WeekBucket; d1: WeekBucket }; cities: string[]; hubs: string[] }

const ROWS: { key: keyof Matrix; label: string; color: string; bg: string }[] = [
  { key: 'Regular',   label: 'Regular',   color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
  { key: 'Irregular', label: 'Irregular', color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-100'   },
  { key: 'New Rider', label: 'New',       color: 'text-sky-600',     bg: 'bg-sky-50 border-sky-100'       },
]
const COLS = [
  { key: 'evening' as const, label: 'Evening',    color: 'text-indigo-600' },
  { key: 'cross'   as const, label: 'Cross Util', color: 'text-violet-600' },
  { key: 'morning' as const, label: 'Morning',    color: 'text-orange-600' },
]

const emptyCell: MatrixCell = { evening: 0, cross: 0, morning: 0, total: 0 }
const emptyMatrix: Matrix = { Regular: { ...emptyCell }, Irregular: { ...emptyCell }, 'New Rider': { ...emptyCell } }
const emptyBucket: WeekBucket = { matrix: emptyMatrix, total: 0 }

function Delta({ prev, curr }: { prev: number; curr: number }) {
  if (prev === 0) return null
  if (curr > prev) return <span className="ml-1 text-emerald-500 font-bold">↑</span>
  if (curr < prev) return <span className="ml-1 text-red-500 font-bold">↓</span>
  return <span className="ml-1 text-slate-400">→</span>
}

export function MatrixTable() {
  const [data, setData] = useState<WoWData | null>(null)
  const [loading, setLoading] = useState(true)
  const [d1DateLabel, setD1DateLabel] = useState('')

  const [draftCity, setDraftCity] = useState('all')
  const [draftHub, setDraftHub] = useState('all')
  const [appliedCity, setAppliedCity] = useState('all')
  const [appliedHub, setAppliedHub] = useState('all')

  const isDirty = draftCity !== appliedCity || draftHub !== appliedHub
  const isFiltered = appliedCity !== 'all' || appliedHub !== 'all'

  const fetchData = useCallback((city: string, hub: string) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (city !== 'all') params.set('city', city)
    if (hub  !== 'all') params.set('hub', hub)
    fetch(`/api/profiling/matrix?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => { fetchData('all', 'all') }, [fetchData])

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      if (d.maxDateRaw) {
        const date = new Date(d.maxDateRaw)
        setD1DateLabel(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
      }
    }).catch(() => {})
  }, [])

  function handleCityChange(city: string) { setDraftCity(city); setDraftHub('all') }
  function handleApply() { setAppliedCity(draftCity); setAppliedHub(draftHub); fetchData(draftCity, draftHub) }
  function handleClear() { setDraftCity('all'); setDraftHub('all'); setAppliedCity('all'); setAppliedHub('all'); fetchData('all', 'all') }

  const w3 = data?.weeks?.w3 ?? emptyBucket
  const w2 = data?.weeks?.w2 ?? emptyBucket
  const w1 = data?.weeks?.w1 ?? emptyBucket
  const d1 = data?.weeks?.d1 ?? emptyBucket

  const cityOptions = data?.cities ?? []
  const hubOptions  = data?.hubs   ?? []

  const WEEK_COLS = [
    { key: 'w3' as const, label: 'W-3 avg',  bucket: w3, prev: null       },
    { key: 'w2' as const, label: 'W-2 avg',  bucket: w2, prev: w3         },
    { key: 'w1' as const, label: 'W-1 avg',  bucket: w1, prev: w2         },
    { key: 'd1' as const, label: `D-1${d1DateLabel ? ` (${d1DateLabel})` : ''}`, bucket: d1, prev: w1 },
  ]

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Regularity × Behaviour Matrix</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">Week-on-week avg daily riders · W-3 → W-2 → W-1 → D-1 · ↑↓ vs previous week</p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={draftCity}
              onChange={e => handleCityChange(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/20 min-w-[120px]"
            >
              <option value="all">All Cities</option>
              {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={draftHub}
              onChange={e => setDraftHub(e.target.value)}
              disabled={draftCity === 'all' || hubOptions.length === 0}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--sfx-orange)]/20 min-w-[160px] disabled:opacity-40"
            >
              <option value="all">{draftCity === 'all' ? 'All Hubs' : `All Hubs in ${draftCity}`}</option>
              {hubOptions.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <button
              onClick={handleApply}
              disabled={!isDirty}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${isDirty ? 'bg-[var(--sfx-orange)] text-white hover:bg-[var(--sfx-orange-d)]' : 'bg-slate-100 text-slate-400 cursor-default'}`}
            >
              Apply
            </button>
            {isFiltered && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg transition-colors"
              >
                <X className="w-3 h-3" />Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Matrix grid */}
      <div className="overflow-x-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center z-10">
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          </div>
        )}
        <table className="w-full text-xs min-w-[700px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              {/* Row header col */}
              <th className="text-left px-3 py-2.5 font-medium text-slate-400 w-28 text-[10px]">Behaviour ↓</th>
              {/* Regularity columns — each split into 4 week sub-cols */}
              {ROWS.map(row => (
                <th
                  key={row.key}
                  colSpan={4}
                  className={`text-center px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide border-l border-slate-200 ${row.color}`}
                >
                  {row.label}
                </th>
              ))}
              {/* Row total — 4 week sub-cols */}
              <th colSpan={4} className="text-center px-3 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-l border-slate-200">
                Row Total
              </th>
            </tr>
            {/* Week sub-headers */}
            <tr className="bg-slate-50/50 border-b border-slate-100">
              <th className="px-3 py-1.5" />
              {[...ROWS, { key: 'total' as const, label: 'Total', color: 'text-slate-500', bg: '' }].map((row, ri) => (
                WEEK_COLS.map(wc => (
                  <th
                    key={`${row.key}-${wc.key}`}
                    className={`text-center px-1.5 py-1.5 text-[9px] font-medium text-slate-400 ${ri === 0 ? 'border-l border-slate-200' : ''} whitespace-nowrap`}
                  >
                    {wc.label}
                  </th>
                ))
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {COLS.map(col => {
              return (
                <tr key={col.key} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${col.color}`}>{col.label}</span>
                  </td>

                  {/* Per-regularity × per-week cells */}
                  {ROWS.map((row, ri) => (
                    WEEK_COLS.map((wc, wi) => {
                      const curr = (wc.bucket.matrix[row.key] ?? emptyCell)[col.key]
                      const prev = wc.prev ? ((wc.prev.matrix[row.key] ?? emptyCell)[col.key]) : null
                      return (
                        <td
                          key={`${row.key}-${wc.key}`}
                          className={`px-1.5 py-2.5 text-center ${ri === 0 && wi === 0 ? 'border-l border-slate-200' : ''}`}
                        >
                          <div className={`font-mono font-semibold text-xs ${row.color}`}>
                            {formatNumber(curr)}
                            {prev !== null && <Delta prev={prev} curr={curr} />}
                          </div>
                        </td>
                      )
                    })
                  ))}

                  {/* Row totals per week */}
                  {WEEK_COLS.map((wc, wi) => {
                    const rowTotal = ROWS.reduce((s, row) => s + (wc.bucket.matrix[row.key] ?? emptyCell)[col.key], 0)
                    const prevTotal = wc.prev ? ROWS.reduce((s, row) => s + ((wc.prev!.matrix[row.key] ?? emptyCell)[col.key]), 0) : null
                    return (
                      <td
                        key={`total-${wc.key}`}
                        className={`px-1.5 py-2.5 text-center ${wi === 0 ? 'border-l border-slate-200' : ''}`}
                      >
                        <div className={`font-mono font-bold text-xs ${col.color}`}>
                          {formatNumber(rowTotal)}
                          {prevTotal !== null && <Delta prev={prevTotal} curr={rowTotal} />}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}

            {/* Column totals row */}
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-wide">Col Total</td>
              {ROWS.map((row, ri) => (
                WEEK_COLS.map((wc, wi) => {
                  const colTotal = (wc.bucket.matrix[row.key] ?? emptyCell).total
                  const prevColTotal = wc.prev ? ((wc.prev.matrix[row.key] ?? emptyCell).total) : null
                  return (
                    <td
                      key={`coltotal-${row.key}-${wc.key}`}
                      className={`px-1.5 py-2 text-center ${ri === 0 && wi === 0 ? 'border-l border-slate-200' : ''}`}
                    >
                      <div className={`font-mono font-bold text-xs ${row.color}`}>
                        {formatNumber(colTotal)}
                        {prevColTotal !== null && <Delta prev={prevColTotal} curr={colTotal} />}
                      </div>
                    </td>
                  )
                })
              ))}
              {/* Grand total per week */}
              {WEEK_COLS.map((wc, wi) => {
                const grand = ROWS.reduce((s, row) => s + (wc.bucket.matrix[row.key] ?? emptyCell).total, 0)
                const prevGrand = wc.prev ? ROWS.reduce((s, row) => s + ((wc.prev!.matrix[row.key] ?? emptyCell).total), 0) : null
                return (
                  <td key={`grand-${wc.key}`} className={`px-1.5 py-2 text-center ${wi === 0 ? 'border-l border-slate-200' : ''}`}>
                    <div className="font-mono font-bold text-xs text-slate-900">
                      {formatNumber(grand)}
                      {prevGrand !== null && <Delta prev={prevGrand} curr={grand} />}
                    </div>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
