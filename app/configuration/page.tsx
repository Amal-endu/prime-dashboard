'use client'

import { useState, useEffect } from 'react'
import { RotateCcw, Save, CheckCircle2 } from 'lucide-react'
import { loadConfig, saveConfig, defaultConfig } from '@/lib/utils'
import type { Config } from '@/lib/types'

interface FieldDef {
  key: keyof Config
  label: string
  description: string
  type: 'number' | 'text'
  min?: number
  max?: number
}

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Rider Classification',
    fields: [
      { key: 'morningEveningCutoff', label: 'Morning / Evening Cutoff Hour', description: 'Hour (0–23) dividing morning from evening logins. Default: 15 (3:00 PM)', type: 'number', min: 0, max: 23 },
      { key: 'analysisWindowDays', label: 'Analysis Window (days)', description: 'Number of days back from max data date for behaviour classification. Default: 30', type: 'number', min: 1, max: 365 },
      { key: 'newRiderWindowDays', label: 'New Rider Window (days)', description: 'Days back from max data date to flag a rider as New. Default: 7', type: 'number', min: 1, max: 30 },
      { key: 'eveningRiderThreshold', label: 'Evening Rider — Min Evening Login %', description: 'Minimum % of active days with evening login to classify as Evening Rider. Default: 80', type: 'number', min: 0, max: 100 },
      { key: 'crossUtilEveningThreshold', label: 'Cross Utilised — Min Evening Login %', description: 'Minimum % of active days with evening login to classify as Cross Utilised. Default: 70', type: 'number', min: 0, max: 100 },
      { key: 'regularThreshold', label: 'Regular Rider — Min Login %', description: 'Minimum login rate % to be classified as Regular. Default: 80', type: 'number', min: 0, max: 100 },
    ],
  },
  {
    title: 'Performance Thresholds',
    fields: [
      { key: 'delPctGreenThreshold', label: 'DEL% Green Threshold', description: 'DEL% at or above this value is shown in green. Default: 80', type: 'number', min: 0, max: 100 },
      { key: 'delPctAmberThreshold', label: 'DEL% Amber Threshold', description: 'DEL% at or above this value (but below green) is shown in amber. Default: 60', type: 'number', min: 0, max: 100 },
    ],
  },
  {
    title: 'Data Rules',
    fields: [
      { key: 'mr3CutoffHour', label: '3MR Cutoff Hour (received_at_hub_time)', description: 'Hour at or after which a shipment is classified as 3MR (evening run). Default: 15', type: 'number', min: 0, max: 23 },
      { key: 'attemptStatusCodes', label: 'Attempted Status Codes', description: 'Comma-separated list of latest_status values that count as an attempt. Default: DELIVERED, CID, NOT_CONTACTABLE', type: 'text' },
      { key: 'breachFlagValues', label: 'Breach Flag Values', description: 'Comma-separated values in the Breach column that count as a breach. Default: true, 1, yes', type: 'text' },
    ],
  },
]

export default function ConfigurationPage() {
  const [config, setConfig] = useState<Config>(defaultConfig())
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setConfig(loadConfig())
  }, [])

  function handleChange(key: keyof Config, value: string) {
    setConfig(prev => {
      const field = SECTIONS.flatMap(s => s.fields).find(f => f.key === key)
      if (field?.type === 'number') {
        return { ...prev, [key]: Number(value) }
      }
      if (Array.isArray(prev[key])) {
        return { ...prev, [key]: value.split(',').map(v => v.trim()).filter(Boolean) }
      }
      return { ...prev, [key]: value }
    })
    setSaved(false)
  }

  function handleSave() {
    saveConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function handleReset() {
    const d = defaultConfig()
    setConfig(d)
    saveConfig(d)
    setSaved(false)
  }

  function displayValue(key: keyof Config): string {
    const val = config[key]
    if (Array.isArray(val)) return val.join(', ')
    return String(val)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Configuration</h1>
          <p className="text-sm text-slate-500 mt-0.5">Business rules and classification thresholds · Changes apply immediately across all views</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Defaults
          </button>
          <button onClick={handleSave} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${saved ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
            {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.title} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-700">{section.title}</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {section.fields.map((field) => (
              <div key={String(field.key)} className="px-5 py-4 flex items-start gap-6">
                <div className="flex-1 min-w-0">
                  <label className="block text-sm font-medium text-slate-800 mb-0.5">{field.label}</label>
                  <p className="text-xs text-slate-400 leading-relaxed">{field.description}</p>
                </div>
                <div className="shrink-0">
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={displayValue(field.key)}
                    onChange={e => handleChange(field.key, e.target.value)}
                    min={field.min}
                    max={field.max}
                    className="w-44 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 tabular-nums text-right"
                  />
                  {field.type === 'number' && field.min !== undefined && field.max !== undefined && (
                    <p className="text-xs text-slate-400 text-right mt-1">{field.min}–{field.max}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
