import type {
  GlobalKPIs, CityProfile, CityDetail, CityDelivery,
  CityDemand, ClientDemand, SparkPoint
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
          riderId: `R${1000 + i}`,
          riderName: `Rider ${1000 + i}`,
          hub: 'BOM_Andheri', city: 'Mumbai',
          sourceTag: (['Dedicated', 'Cross utilised', 'Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider', 'Cross Utilised', 'Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular', 'Irregular', 'New Rider'] as const)[i % 3],
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
          riderId: `R${2000 + i}`,
          riderName: `Rider ${2000 + i}`,
          hub: 'BOM_Kurla', city: 'Mumbai',
          sourceTag: (['Dedicated', 'Cross utilised', 'Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider', 'Cross Utilised', 'Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular', 'Irregular', 'New Rider'] as const)[i % 3],
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
          riderId: `R${3000 + i}`,
          riderName: `Rider ${3000 + i}`,
          hub: 'DEL_Rohini', city: 'Delhi',
          sourceTag: (['Dedicated', 'Cross utilised', 'Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider', 'Cross Utilised', 'Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular', 'Irregular', 'New Rider'] as const)[i % 3],
          loginRatePct: 65 + (i * 4),
          morningLogins: i % 2 === 0 ? 10 : 0,
          eveningLogins: 20 + i,
          firstLoginDate: '2026-04-10',
          activeSinceDays: 39 + i,
        })),
      },
      {
        hub: 'DEL_Dwarka', city: 'Delhi', totalRiders: 320,
        eveningRiderPct: 31, crossUtilisedPct: 29, morningRiderPct: 40,
        regularPct: 66, irregularPct: 24, newRiderPct: 10,
        riders: Array.from({ length: 5 }, (_, i) => ({
          riderId: `R${3500 + i}`,
          riderName: `Rider ${3500 + i}`,
          hub: 'DEL_Dwarka', city: 'Delhi',
          sourceTag: (['Dedicated', 'Cross utilised', 'Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider', 'Cross Utilised', 'Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular', 'Irregular', 'New Rider'] as const)[i % 3],
          loginRatePct: 62 + (i * 5),
          morningLogins: i % 3 === 0 ? 9 : 0,
          eveningLogins: 17 + i,
          firstLoginDate: '2026-04-18',
          activeSinceDays: 31 + i,
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
          riderId: `R${4000 + i}`,
          riderName: `Rider ${4000 + i}`,
          hub: 'BLR_Whitefield', city: 'Bangalore',
          sourceTag: (['Dedicated', 'Cross utilised', 'Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider', 'Cross Utilised', 'Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular', 'Irregular', 'New Rider'] as const)[i % 3],
          loginRatePct: 58 + (i * 5),
          morningLogins: i % 3 === 1 ? 7 : 0,
          eveningLogins: 22 + i,
          firstLoginDate: '2026-05-13',
          activeSinceDays: 6 + i,
        })),
      },
    ],
  },
  {
    city: 'Chennai', totalRiders: 520,
    eveningRiderPct: 36, crossUtilisedPct: 27, morningRiderPct: 37,
    regularPct: 64, irregularPct: 25, newRiderPct: 11,
    hubs: [
      {
        hub: 'CHN_Sankarapuram', city: 'Chennai', totalRiders: 260,
        eveningRiderPct: 36, crossUtilisedPct: 27, morningRiderPct: 37,
        regularPct: 64, irregularPct: 25, newRiderPct: 11,
        riders: Array.from({ length: 5 }, (_, i) => ({
          riderId: `R${5000 + i}`,
          riderName: `Rider ${5000 + i}`,
          hub: 'CHN_Sankarapuram', city: 'Chennai',
          sourceTag: (['Dedicated', 'Cross utilised', 'Unidentified'] as const)[i % 3],
          loginBehaviourTag: (['Evening Rider', 'Cross Utilised', 'Morning Rider'] as const)[i % 3],
          regularityTag: (['Regular', 'Irregular', 'New Rider'] as const)[i % 3],
          loginRatePct: 63 + (i * 4),
          morningLogins: i % 2 === 0 ? 6 : 0,
          eveningLogins: 16 + i,
          firstLoginDate: '2026-04-25',
          activeSinceDays: 24 + i,
        })),
      },
    ],
  },
]

function seed(i: number, base: number, range: number) {
  return base + ((i * 7 + 13) % range)
}

export const mockCityDetails: CityDetail[] = mockCityProfiles.map((c, ci) => ({
  city: c.city,
  ridersLoggedIn: Math.round(c.totalRiders * 0.72),
  avgAttemptProductivityPct: seed(ci, 74, 16),
  avgDeliveredProductivityPct: seed(ci, 65, 18),
  totalDelivered3MR: Math.round(c.totalRiders * 28),
  avgEarnings3MR: seed(ci, 420, 200),
  hubs: c.hubs.map((h, hi) => ({
    hub: h.hub,
    city: h.city,
    ridersLoggedIn: Math.round(h.totalRiders * 0.72),
    avgAttemptProductivityPct: seed(hi + ci, 72, 18),
    avgDeliveredProductivityPct: seed(hi + ci, 63, 20),
    totalDelivered3MR: Math.round(h.totalRiders * 28),
    avgEarnings3MR: seed(hi + ci, 400, 220),
    riders: h.riders.map((r, ri) => ({
      riderId: r.riderId,
      riderName: r.riderName,
      hub: r.hub,
      city: r.city,
      loginBehaviourTag: r.loginBehaviourTag,
      regularityTag: r.regularityTag,
      loggedIn: ri % 5 !== 0,
      assigned3MR: 30 + (ri * 3),
      attempted3MR: 22 + (ri * 2),
      delivered3MR: 18 + (ri * 2),
      attemptProductivityPct: seed(ri + hi, 70, 22),
      deliveredProductivityPct: seed(ri + hi, 60, 28),
      earnings3MR: seed(ri + hi, 360, 260),
    })),
  })),
}))

export const mockCityDeliveries: CityDelivery[] = mockCityProfiles.map((c, ci) => ({
  city: c.city,
  orders3MR: Math.round(c.totalRiders * 32),
  delivered3MR: Math.round(c.totalRiders * 25),
  delPct: seed(ci, 74, 14),
  breachCount: Math.round(c.totalRiders * 0.8),
  breachPct: 2 + (ci * 0.4),
  hubs: c.hubs.map((h, hi) => ({
    hub: h.hub,
    city: h.city,
    orders3MR: Math.round(h.totalRiders * 32),
    delivered3MR: Math.round(h.totalRiders * 25),
    delPct: seed(hi + ci, 72, 16),
    breachCount: Math.round(h.totalRiders * 0.8),
    breachPct: 1.8 + (hi * 0.5),
    riders: h.riders.map((r, ri) => ({
      riderId: r.riderId,
      riderName: r.riderName,
      hub: r.hub,
      city: r.city,
      behaviourTag: r.loginBehaviourTag,
      regularityTag: r.regularityTag,
      orders3MR: 28 + (ri * 3),
      delivered3MR: 20 + (ri * 2),
      delPct: seed(ri + hi, 66, 26),
      breachCount: ri % 4,
    })),
  })),
}))

function sparkline(base: number, i: number): SparkPoint[] {
  return Array.from({ length: 7 }, (_, d) => ({
    date: `May ${13 + d}`,
    value: base + ((i * d * 3 + d * 11) % Math.round(base * 0.12)) - Math.round(base * 0.05),
  }))
}

export const mockCityDemand: CityDemand[] = [
  {
    city: 'Mumbai', zone: 'West',
    totalDemand: 84200, demand3MR: 41300, delPct3MR: 79.2,
    trendDirection: 'up', trendPct: 8.4,
    sparkline: sparkline(41300, 1),
    hubs: [
      { hub: 'BOM_Andheri', totalDemand: 22100, demand3MR: 11200, delPct3MR: 82.1, trendDirection: 'up', trendPct: 6.2 },
      { hub: 'BOM_Kurla', totalDemand: 19800, demand3MR: 9800, delPct3MR: 74.3, trendDirection: 'down', trendPct: 3.1 },
    ],
  },
  {
    city: 'Delhi', zone: 'North',
    totalDemand: 76400, demand3MR: 38100, delPct3MR: 81.5,
    trendDirection: 'up', trendPct: 5.1,
    sparkline: sparkline(38100, 2),
    hubs: [
      { hub: 'DEL_Rohini', totalDemand: 31200, demand3MR: 15600, delPct3MR: 84.2, trendDirection: 'up', trendPct: 7.8 },
      { hub: 'DEL_Dwarka', totalDemand: 28100, demand3MR: 13800, delPct3MR: 78.9, trendDirection: 'up', trendPct: 3.2 },
    ],
  },
  {
    city: 'Bangalore', zone: 'South',
    totalDemand: 62100, demand3MR: 29800, delPct3MR: 76.8,
    trendDirection: 'down', trendPct: 2.3,
    sparkline: sparkline(29800, 3),
    hubs: [
      { hub: 'BLR_Whitefield', totalDemand: 28400, demand3MR: 13900, delPct3MR: 78.4, trendDirection: 'flat', trendPct: 0.4 },
    ],
  },
  {
    city: 'Chennai', zone: 'South',
    totalDemand: 41800, demand3MR: 19200, delPct3MR: 77.3,
    trendDirection: 'up', trendPct: 11.2,
    sparkline: sparkline(19200, 4),
    hubs: [
      { hub: 'CHN_Sankarapuram', totalDemand: 18400, demand3MR: 8900, delPct3MR: 79.1, trendDirection: 'up', trendPct: 9.8 },
    ],
  },
  {
    city: 'Hyderabad', zone: 'South',
    totalDemand: 38200, demand3MR: 17400, delPct3MR: 80.1,
    trendDirection: 'flat', trendPct: 0.8,
    sparkline: sparkline(17400, 5),
    hubs: [],
  },
]

export const mockClientDemand: ClientDemand[] = [
  { clientName: 'Flipkart', isPrime: true, totalAWBs: 82400, awbs3MR: 38200, delivered: 30800, delPct: 80.6, trendDirection: 'up', trendPct: 6.2 },
  { clientName: 'Meesho', isPrime: false, totalAWBs: 61200, awbs3MR: 28400, delivered: 21900, delPct: 77.1, trendDirection: 'up', trendPct: 3.4 },
  { clientName: 'Myntra', isPrime: true, totalAWBs: 38400, awbs3MR: 17800, delivered: 14900, delPct: 83.7, trendDirection: 'down', trendPct: 1.8 },
  { clientName: 'Decathlon', isPrime: false, totalAWBs: 22100, awbs3MR: 9800, delivered: 7400, delPct: 75.5, trendDirection: 'flat', trendPct: 0.3 },
  { clientName: 'Traya Prime', isPrime: true, totalAWBs: 18600, awbs3MR: 8200, delivered: 6800, delPct: 82.9, trendDirection: 'up', trendPct: 9.1 },
  { clientName: 'Kartrocket Express', isPrime: false, totalAWBs: 14200, awbs3MR: 5900, delivered: 4200, delPct: 71.2, trendDirection: 'down', trendPct: 4.7 },
  { clientName: 'Nykaa', isPrime: true, totalAWBs: 12800, awbs3MR: 5400, delivered: 4600, delPct: 85.2, trendDirection: 'up', trendPct: 13.4 },
  { clientName: 'Ajio', isPrime: false, totalAWBs: 11200, awbs3MR: 4800, delivered: 3500, delPct: 72.9, trendDirection: 'flat', trendPct: 0.6 },
]
