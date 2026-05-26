import type { Config } from './types'

export function toApiParams(config: Config): Record<string, string> {
  return {
    windowDays:       String(config.analysisWindowDays),
    newRiderDays:     String(config.newRiderWindowDays),
    eveningThreshold: String(config.eveningRiderThreshold),
    crossThreshold:   String(config.crossUtilEveningThreshold),
    regularThreshold: String(config.regularThreshold),
    mr3CutoffHour:    String(config.mr3CutoffHour),
    allocationMode:   config.allocationMode ?? 'same_day_received',
  }
}
