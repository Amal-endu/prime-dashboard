import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Config } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getDelPctColor(pct: number, config: Config): string {
  if (pct >= config.delPctGreenThreshold) return 'text-emerald-600 font-semibold'
  if (pct >= config.delPctAmberThreshold) return 'text-amber-600 font-semibold'
  return 'text-red-600 font-semibold'
}

export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-IN')
}

export function formatCurrency(value: number): string {
  return `₹${value.toFixed(0)}`
}

export function defaultConfig(): Config {
  return {
    morningEveningCutoff: 15,
    analysisWindowDays: 30,
    newRiderWindowDays: 7,
    eveningRiderThreshold: 80,
    crossUtilEveningThreshold: 70,
    regularThreshold: 80,
    attemptStatusCodes: ['DELIVERED', 'CID', 'NOT_CONTACTABLE'],
    breachFlagValues: ['true', '1', 'yes'],
    mr3CutoffHour: 15,
    delPctGreenThreshold: 80,
    delPctAmberThreshold: 60,
    allocationMode: 'same_day_received',
  }
}

export function loadConfig(): Config {
  if (typeof window === 'undefined') return defaultConfig()
  try {
    const stored = localStorage.getItem('prime-dashboard-config')
    return stored ? { ...defaultConfig(), ...JSON.parse(stored) } : defaultConfig()
  } catch {
    return defaultConfig()
  }
}

export function saveConfig(config: Config): void {
  localStorage.setItem('prime-dashboard-config', JSON.stringify(config))
}
