# Prime Dashboard — Frontend Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a Next.js 15 dashboard with global KPI strip, top nav, 5 tab views, expandable tree tables, and mock data throughout.

**Architecture:** Next.js 15 App Router in `/Prime Dashboard/`. Each view is a separate page under `app/(dashboard)/`. Mock data lives in `lib/mock-data.ts`. Shared UI primitives in `components/ui/`. View-specific components in `components/views/`.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts, lucide-react

---

### Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`

- [ ] Run scaffold command in Prime Dashboard directory:
```bash
cd "/Users/amalendu/Downloads/Sfx Workings/Claude Scripts/Prime Dashboard"
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --yes
```

- [ ] Install additional dependencies:
```bash
npm install lucide-react recharts class-variance-authority clsx tailwind-merge
npm install @radix-ui/react-select @radix-ui/react-dialog @radix-ui/react-tooltip
npm install @radix-ui/react-tabs @radix-ui/react-collapsible
npx shadcn@latest init --yes --base-color slate --css-variables yes
npx shadcn@latest add badge button card select table tooltip
```

- [ ] Commit:
```bash
git init && git add . && git commit -m "feat: scaffold Next.js 15 project with shadcn/ui"
```

---

### Task 2: Types and mock data

**Files:**
- Create: `lib/types.ts`
- Create: `lib/mock-data.ts`
- Create: `lib/utils.ts`

- [ ] Write `lib/types.ts`:
```typescript
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
  riderId: string
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
  riderId: string
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
  riderId: string
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

export interface SparkPoint { date: string; value: number }

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
```

- [ ] Write `lib/mock-data.ts`:
```typescript
import type {
  GlobalKPIs, CityProfile, CityDetail, CityDelivery,
  CityDemand, ClientDemand, Config
} from './types'

export const mockGlobalKPIs: GlobalKPIs = {
  totalDemand: 284530,
  delivered3MR: 187420,
  deliveredPct: 79.4,
  dataDate: '19 May 2026, 18:50',
}

export const mockCityProfiles: CityProfile[] = [
  {
    city: 'Mumbai', totalRiders: 1240,
    eveningRiderPct: 34, crossUtilisedPct: 28, morningRiderPct: 38,
    regularPct: 62, irregularPct: 26, newRiderPct: 12,
    hubs: [
      {
        hub: 'BOM_Andheri', city: 'Mumbai', totalRiders: 320,
        eveningRiderPct: 38, crossUtilisedPct: 30, morningRiderPct: 32,
        regularPct: 65, irregularPct: 24, newRiderPct: 11,
        riders: Array.from({ length: 8 }, (_, i) => ({
          riderId: `R${1000 + i}`, riderName: `Rider ${1000 + i}`,
          hub: 'BOM_Andheri', city: 'Mumbai',
          sourceTag: (['Dedicated','Cross utilised','Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider','Cross Utilised','Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular','Irregular','New Rider'] as const)[i % 3],
          loginRatePct: 60 + (i * 5),
          morningLogins: i % 3 === 2 ? 12 : 0,
          eveningLogins: 18 + i,
          firstLoginDate: '2026-04-15',
          activeSinceDays: 34 + i,
        })),
      },
      {
        hub: 'BOM_Kurla', city: 'Mumbai', totalRiders: 285,
        eveningRiderPct: 31, crossUtilisedPct: 26, morningRiderPct: 43,
        regularPct: 59, irregularPct: 29, newRiderPct: 12,
        riders: Array.from({ length: 6 }, (_, i) => ({
          riderId: `R${2000 + i}`, riderName: `Rider ${2000 + i}`,
          hub: 'BOM_Kurla', city: 'Mumbai',
          sourceTag: (['Dedicated','Cross utilised','Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider','Cross Utilised','Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular','Irregular','New Rider'] as const)[i % 3],
          loginRatePct: 55 + (i * 6),
          morningLogins: i % 2 === 0 ? 8 : 0,
          eveningLogins: 15 + i,
          firstLoginDate: '2026-04-20',
          activeSinceDays: 29 + i,
        })),
      },
    ],
  },
  {
    city: 'Delhi', totalRiders: 980,
    eveningRiderPct: 29, crossUtilisedPct: 32, morningRiderPct: 39,
    regularPct: 68, irregularPct: 22, newRiderPct: 10,
    hubs: [
      {
        hub: 'DEL_Rohini', city: 'Delhi', totalRiders: 410,
        eveningRiderPct: 27, crossUtilisedPct: 35, morningRiderPct: 38,
        regularPct: 70, irregularPct: 20, newRiderPct: 10,
        riders: Array.from({ length: 6 }, (_, i) => ({
          riderId: `R${3000 + i}`, riderName: `Rider ${3000 + i}`,
          hub: 'DEL_Rohini', city: 'Delhi',
          sourceTag: (['Dedicated','Cross utilised','Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider','Cross Utilised','Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular','Irregular','New Rider'] as const)[i % 3],
          loginRatePct: 65 + (i * 4),
          morningLogins: i % 2 === 0 ? 10 : 0,
          eveningLogins: 20 + i,
          firstLoginDate: '2026-04-10',
          activeSinceDays: 39 + i,
        })),
      },
    ],
  },
  {
    city: 'Bangalore', totalRiders: 760,
    eveningRiderPct: 41, crossUtilisedPct: 24, morningRiderPct: 35,
    regularPct: 57, irregularPct: 30, newRiderPct: 13,
    hubs: [
      {
        hub: 'BLR_Whitefield', city: 'Bangalore', totalRiders: 380,
        eveningRiderPct: 43, crossUtilisedPct: 22, morningRiderPct: 35,
        regularPct: 60, irregularPct: 28, newRiderPct: 12,
        riders: Array.from({ length: 6 }, (_, i) => ({
          riderId: `R${4000 + i}`, riderName: `Rider ${4000 + i}`,
          hub: 'BLR_Whitefield', city: 'Bangalore',
          sourceTag: (['Dedicated','Cross utilised','Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider','Cross Utilised','Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular','Irregular','New Rider'] as const)[i % 3],
          loginRatePct: 58 + (i * 5),
          morningLogins: i % 3 === 1 ? 7 : 0,
          eveningLogins: 22 + i,
          firstLoginDate: '2026-05-13',
          activeSinceDays: 6 + i,
        })),
      },
    ],
  },
]

export const mockCityDetails: CityDetail[] = mockCityProfiles.map(c => ({
  city: c.city,
  ridersLoggedIn: Math.round(c.totalRiders * 0.72),
  avgAttemptProductivityPct: 76 + Math.random() * 10,
  avgDeliveredProductivityPct: 68 + Math.random() * 10,
  totalDelivered3MR: Math.round(c.totalRiders * 28),
  avgEarnings3MR: 420 + Math.random() * 180,
  hubs: c.hubs.map(h => ({
    hub: h.hub,
    city: h.city,
    ridersLoggedIn: Math.round(h.totalRiders * 0.72),
    avgAttemptProductivityPct: 76 + Math.random() * 10,
    avgDeliveredProductivityPct: 68 + Math.random() * 10,
    totalDelivered3MR: Math.round(h.totalRiders * 28),
    avgEarnings3MR: 420 + Math.random() * 180,
    riders: h.riders.map(r => ({
      riderId: r.riderId,
      riderName: r.riderName,
      hub: r.hub,
      city: r.city,
      loginBehaviourTag: r.loginBehaviourTag,
      regularityTag: r.regularityTag,
      loggedIn: Math.random() > 0.2,
      assigned3MR: 30 + Math.round(Math.random() * 20),
      attempted3MR: 22 + Math.round(Math.random() * 15),
      delivered3MR: 18 + Math.round(Math.random() * 12),
      attemptProductivityPct: 72 + Math.random() * 20,
      deliveredProductivityPct: 62 + Math.random() * 25,
      earnings3MR: 380 + Math.random() * 240,
    })),
  })),
}))

export const mockCityDeliveries: CityDelivery[] = mockCityProfiles.map(c => ({
  city: c.city,
  orders3MR: Math.round(c.totalRiders * 32),
  delivered3MR: Math.round(c.totalRiders * 25),
  delPct: 76 + Math.random() * 12,
  breachCount: Math.round(c.totalRiders * 0.8),
  breachPct: 2.4 + Math.random() * 2,
  hubs: c.hubs.map(h => ({
    hub: h.hub,
    city: h.city,
    orders3MR: Math.round(h.totalRiders * 32),
    delivered3MR: Math.round(h.totalRiders * 25),
    delPct: 74 + Math.random() * 14,
    breachCount: Math.round(h.totalRiders * 0.8),
    breachPct: 2 + Math.random() * 3,
    riders: h.riders.map(r => ({
      riderId: r.riderId,
      riderName: r.riderName,
      hub: r.hub,
      city: r.city,
      behaviourTag: r.loginBehaviourTag,
      regularityTag: r.regularityTag,
      orders3MR: 28 + Math.round(Math.random() * 18),
      delivered3MR: 20 + Math.round(Math.random() * 14),
      delPct: 68 + Math.random() * 24,
      breachCount: Math.round(Math.random() * 3),
    })),
  })),
}))

const sparkline = (base: number) =>
  Array.from({ length: 7 }, (_, i) => ({
    date: `May ${13 + i}`,
    value: base + Math.round((Math.random() - 0.4) * base * 0.15),
  }))

export const mockCityDemand: CityDemand[] = [
  { city: 'Mumbai', zone: 'West', totalDemand: 84200, demand3MR: 41300, delPct3MR: 79.2, trendDirection: 'up', trendPct: 8.4, sparkline: sparkline(41300), hubs: [
    { hub: 'BOM_Andheri', totalDemand: 22100, demand3MR: 11200, delPct3MR: 82.1, trendDirection: 'up', trendPct: 6.2 },
    { hub: 'BOM_Kurla', totalDemand: 19800, demand3MR: 9800, delPct3MR: 74.3, trendDirection: 'down', trendPct: 3.1 },
  ]},
  { city: 'Delhi', zone: 'North', totalDemand: 76400, demand3MR: 38100, delPct3MR: 81.5, trendDirection: 'up', trendPct: 5.1, sparkline: sparkline(38100), hubs: [
    { hub: 'DEL_Rohini', totalDemand: 31200, demand3MR: 15600, delPct3MR: 84.2, trendDirection: 'up', trendPct: 7.8 },
  ]},
  { city: 'Bangalore', zone: 'South', totalDemand: 62100, demand3MR: 29800, delPct3MR: 76.8, trendDirection: 'down', trendPct: 2.3, sparkline: sparkline(29800), hubs: [
    { hub: 'BLR_Whitefield', totalDemand: 28400, demand3MR: 13900, delPct3MR: 78.4, trendDirection: 'flat', trendPct: 0.4 },
  ]},
  { city: 'Chennai', zone: 'South', totalDemand: 41800, demand3MR: 19200, delPct3MR: 77.3, trendDirection: 'up', trendPct: 11.2, sparkline: sparkline(19200), hubs: [] },
  { city: 'Hyderabad', zone: 'South', totalDemand: 38200, demand3MR: 17400, delPct3MR: 80.1, trendDirection: 'flat', trendPct: 0.8, sparkline: sparkline(17400), hubs: [] },
]

export const mockClientDemand: ClientDemand[] = [
  { clientName: 'Flipkart', isPrime: true, totalAWBs: 82400, awbs3MR: 38200, delivered: 30800, delPct: 80.6, trendDirection: 'up', trendPct: 6.2 },
  { clientName: 'Meesho', isPrime: false, totalAWBs: 61200, awbs3MR: 28400, delivered: 21900, delPct: 77.1, trendDirection: 'up', trendPct: 3.4 },
  { clientName: 'Myntra', isPrime: true, totalAWBs: 38400, awbs3MR: 17800, delivered: 14900, delPct: 83.7, trendDirection: 'down', trendPct: 1.8 },
  { clientName: 'Decathlon', isPrime: false, totalAWBs: 22100, awbs3MR: 9800, delivered: 7400, delPct: 75.5, trendDirection: 'flat', trendPct: 0.3 },
  { clientName: 'Traya Prime', isPrime: true, totalAWBs: 18600, awbs3MR: 8200, delivered: 6800, delPct: 82.9, trendDirection: 'up', trendPct: 9.1 },
  { clientName: 'Kartrocket', isPrime: false, totalAWBs: 14200, awbs3MR: 5900, delivered: 4200, delPct: 71.2, trendDirection: 'down', trendPct: 4.7 },
]

export const defaultConfig: Config = {
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
}
```

- [ ] Write `lib/utils.ts`:
```typescript
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

function defaultConfig(): Config {
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
  }
}
```

- [ ] Commit:
```bash
git add lib/ && git commit -m "feat: add types, mock data, utils"
```
