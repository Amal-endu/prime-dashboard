export type LoginBehaviourTag = 'Evening Rider' | 'Cross Utilised' | 'Morning Rider'
export type RegularityTag = 'New Rider' | 'Regular' | 'Irregular'
export type SourceRiderTag = 'Dedicated' | 'Cross utilised' | 'Unidentified'
export type TrendDirection = 'up' | 'down' | 'flat'

export interface GlobalKPIs {
  totalDemand: number
  delivered3MR: number
  deliveredPct: number
  dataDate: string
}

export interface RiderProfile {
  riderId: number
  riderName: string
  hub: string
  city: string
  sourceTag: SourceRiderTag
  loginBehaviourTag: LoginBehaviourTag
  regularityTag: RegularityTag
  loginRatePct: number
  morningLogins: number
  eveningLogins: number
  firstLoginDate: string
  activeSinceDays: number
}

export interface HubProfile {
  hub: string
  city: string
  totalRiders: number
  eveningRiderPct: number
  crossUtilisedPct: number
  morningRiderPct: number
  regularPct: number
  irregularPct: number
  newRiderPct: number
  riders: RiderProfile[]
}

export interface CityProfile {
  city: string
  totalRiders: number
  eveningRiderPct: number
  crossUtilisedPct: number
  morningRiderPct: number
  regularPct: number
  irregularPct: number
  newRiderPct: number
  hubs: HubProfile[]
}

export interface RiderDetail {
  riderId: number
  riderName: string
  hub: string
  city: string
  loginBehaviourTag: LoginBehaviourTag
  regularityTag: RegularityTag
  loggedIn: boolean
  assigned3MR: number
  attempted3MR: number
  delivered3MR: number
  attemptProductivityPct: number
  deliveredProductivityPct: number
  earnings3MR: number
}

export interface HubDetail {
  hub: string
  city: string
  ridersLoggedIn: number
  avgAttemptProductivityPct: number
  avgDeliveredProductivityPct: number
  totalDelivered3MR: number
  avgEarnings3MR: number
  riders: RiderDetail[]
}

export interface CityDetail {
  city: string
  ridersLoggedIn: number
  avgAttemptProductivityPct: number
  avgDeliveredProductivityPct: number
  totalDelivered3MR: number
  avgEarnings3MR: number
  hubs: HubDetail[]
}

export interface RiderDelivery {
  riderId: number
  riderName: string
  hub: string
  city: string
  behaviourTag: LoginBehaviourTag
  regularityTag: RegularityTag
  orders3MR: number
  delivered3MR: number
  delPct: number
  breachCount: number
}

export interface HubDelivery {
  hub: string
  city: string
  orders3MR: number
  delivered3MR: number
  delPct: number
  breachCount: number
  breachPct: number
  riders: RiderDelivery[]
}

export interface CityDelivery {
  city: string
  orders3MR: number
  delivered3MR: number
  delPct: number
  breachCount: number
  breachPct: number
  hubs: HubDelivery[]
}

export interface SparkPoint {
  date: string
  value: number
}

export interface CityDemand {
  city: string
  zone: string
  totalDemand: number
  demand3MR: number
  delPct3MR: number
  trendDirection: TrendDirection
  trendPct: number
  sparkline: SparkPoint[]
  hubs: HubDemand[]
}

export interface HubDemand {
  hub: string
  totalDemand: number
  demand3MR: number
  delPct3MR: number
  trendDirection: TrendDirection
  trendPct: number
}

export interface ClientDemand {
  clientName: string
  isPrime: boolean
  totalAWBs: number
  awbs3MR: number
  delivered: number
  delPct: number
  trendDirection: TrendDirection
  trendPct: number
}

export interface Config {
  morningEveningCutoff: number
  analysisWindowDays: number
  newRiderWindowDays: number
  eveningRiderThreshold: number
  crossUtilEveningThreshold: number
  regularThreshold: number
  attemptStatusCodes: string[]
  breachFlagValues: string[]
  mr3CutoffHour: number
  delPctGreenThreshold: number
  delPctAmberThreshold: number
}
