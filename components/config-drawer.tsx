'use client'

import { useState, useEffect } from 'react'
import { X, RotateCcw, Save, CheckCircle2, AlertTriangle, Settings } from 'lucide-react'
import { defaultConfig } from '@/lib/utils'
import { useConfigState } from '@/components/config-provider'
import type { Config } from '@/lib/types'

interface FieldDef {
  key: keyof Config
  label: string
  description: string
  type: 'number' | 'text'
  min?: number
  max?: number
  latency: 'instant' | 'ingest'
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Rider Classification',
    fields: [
      { key: 'morningEveningCutoff', label: 'Morning / Evening Cutoff Hour', description: 'Hour (0–23) dividing morning from evening logins. Default: 15', type: 'number', min: 0, max: 23, latency: 'ingest' },
      { key: 'analysisWindowDays', label: 'Analysis Window (days)', description: 'Days back from max data date for behaviour classification. Default: 30', type: 'number', min: 1, max: 365, latency: 'instant' },
      { key: 'newRiderWindowDays', label: 'New Rider Window (days)', description: 'Days back to flag a rider as New. Default: 7', type: 'number', min: 1, max: 30, latency: 'instant' },
      { key: 'eveningRiderThreshold', label: 'Evening Rider — Min Evening Login %', description: 'Min % of active days with evening login to classify as Evening Rider. Default: 80', type: 'number', min: 0, max: 100, latency: 'instant' },
      { key: 'crossUtilEveningThreshold', label: 'Cross Utilised — Min Evening Login %', description: 'Min % of active days with evening login to classify as Cross Utilised. Default: 70', type: 'number', min: 0, max: 100, latency: 'instant' },
      { key: 'regularThreshold', label: 'Regular Rider — Min Login %', description: 'Minimum login rate % to be classified as Regular. Default: 80', type: 'number', min: 0, max: 100, latency: 'instant' },
    ],
  },
  {
    title: 'Performance Thresholds',
    fields: [
      { key: 'delPctGreenThreshold', label: 'DEL% Green Threshold', description: 'DEL% at or above this value shown in green. Default: 80', type: 'number', min: 0, max: 100, latency: 'instant' },
      { key: 'delPctAmberThreshold', label: 'DEL% Amber Threshold', description: 'DEL% at or above this (but below green) shown in amber. Default: 60', type: 'number', min: 0, max: 100, latency: 'instant' },
    ],
  },
  {
    title: 'Data Rules',
    fields: [
      { key: 'mr3CutoffHour', label: '3MR Cutoff Hour', description: 'Hour at or after which a shipment is classified as 3MR (evening run). Default: 15', type: 'number', min: 0, max: 23, latency: 'ingest' },
      { key: 'attemptStatusCodes', label: 'Attempted Status Codes', description: 'Comma-separated latest_status values that count as an attempt. Default: DELIVERED, CID, NOT_CONTACTABLE', type: 'text', latency: 'ingest' },
      { key: 'breachFlagValues', label: 'Breach Flag Values', description: 'Comma-separated values in the Breach column that count as a breach. Default: true, 1, yes', type: 'text', latency: 'ingest' },
    ],
  },
]

interface ConfigDrawerProps {
  open: boolean
  onClose: () => void
}

export function ConfigDrawer({ open, onClose }: ConfigDrawerProps) {
  const { config, setConfig, triggerSave } = useConfigState()
  const [draft, setDraft] = useState<Config>(config)
  const [saved, setSaved] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  // Sync draft when config changes externally
  useEffect(() => { setDraft(config) }, [config])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  function handleChange(key: keyof Config, value: string) {
    setDraft(prev => {
      const field = SECTIONS.flatMap(s => s.fields).find(f => f.key === key)
      if (field?.type === 'number') return { ...prev, [key]: Number(value) }
      if (Array.isArray(prev[key])) return { ...prev, [key]: value.split(',').map(v => v.trim()).filter(Boolean) }
      return { ...prev, [key]: value }
    })
    setSaved(false)
  }

  function handleSave() {
    triggerSave(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function handleReset() {
    if (!confirmReset) { setConfirmReset(true); return }
    const d = defaultConfig()
    setDraft(d)
    setConfig(d)
    setSaved(false)
    setConfirmReset(false)
  }

  function displayValue(key: keyof Config): string {
    const val = draft[key]
    if (Array.isArray(val)) return val.join(', ')
    return String(val)
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-slate-500" />
            <span className="font-semibold text-slate-900 text-sm">Settings</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors rounded-md p-1 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="px-5 py-2.5 text-[11px] text-slate-400 border-b border-slate-100 shrink-0">
          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5 font-medium">Instant</span>
          {' '}applies immediately ·{' '}
          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 font-medium">Next Ingest</span>
          {' '}takes effect after next data ingest
        </p>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {SECTIONS.map(section => (
            <div key={section.title} className="border-b border-slate-100">
              <div className="px-5 py-3 bg-slate-50">
                <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{section.title}</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {section.fields.map(field => (
                  <div key={String(field.key)} className="px-5 py-3.5 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <label className="text-xs font-medium text-slate-800">{field.label}</label>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${field.latency === 'instant' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          {field.latency === 'instant' ? 'Instant' : 'Next Ingest'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed">{field.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={displayValue(field.key)}
                        onChange={e => handleChange(field.key, e.target.value)}
                        min={field.min}
                        max={field.max}
                        className="w-36 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sfx-orange/20 focus:border-sfx-orange-light tabular-nums text-right"
                      />
                      {field.type === 'number' && field.min !== undefined && field.max !== undefined && (
                        <p className="text-[10px] text-slate-400 mt-0.5">{field.min}–{field.max}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-slate-200 shrink-0 space-y-2">
          {confirmReset && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>This will reset all settings to factory defaults. Click Reset again to confirm.</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { handleReset(); if (confirmReset) setConfirmReset(false) }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs border rounded-lg transition-colors ${confirmReset ? 'border-amber-400 text-amber-700 bg-amber-50 hover:bg-amber-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <RotateCcw className="w-3 h-3" />
              {confirmReset ? 'Confirm Reset' : 'Reset Defaults'}
            </button>
            {confirmReset && (
              <button onClick={() => setConfirmReset(false)} className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
            )}
            <button
              onClick={handleSave}
              className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${saved ? 'bg-emerald-600 text-white' : 'bg-sfx-orange text-white hover:bg-sfx-orange-dark'}`}
            >
              {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {saved ? 'Saved' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
