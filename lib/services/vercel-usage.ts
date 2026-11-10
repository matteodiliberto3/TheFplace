import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { systemDomainRouting } from '@/lib/db/schema'

export interface VercelUsageMetrics {
    bandwidth?: { value: number; limit: number }
    serverlessFunctionExecution?: { value: number; limit: number }
    edgeMiddlewareInvocations?: { value: number; limit: number }
}

export interface UsageCheckResult {
    success: boolean
    maxUsagePercent: number
    activeDomain: string
    fplaceUsage: {
        bandwidthPercent: number
        serverlessPercent: number
        edgePercent: number
    }
    hustleUsage?: {
        maxUsagePercent: number
        bandwidthPercent: number
        serverlessPercent: number
        edgePercent: number
    }
    switched: boolean
    error?: string
}

interface VercelDailyData {
    bandwidth_outgoing_bytes?: number
    bandwidth_incoming_bytes?: number
    function_execution_successful_gb_hours?: number
    function_execution_failed_gb_hours?: number
    request_hit_count?: number
    request_miss_count?: number
}

interface VercelRequestsUsageResponse {
    granularity?: string
    lastUpdate?: string
    data?: VercelDailyData[]
}

export const PRIMARY_DOMAIN = 'the-fplace.vercel.app'
export const SECONDARY_DOMAIN = 'the-hustle-place.vercel.app'
export const DEFAULT_THRESHOLD_PERCENT = 75.0

// Progetti Vercel predefiniti
export const DEFAULT_FPLACE_PROJECT_ID = 'prj_DzcGoI2eOUOf09Z52rJvlgSzRN00'
export const DEFAULT_FPLACE_TEAM_ID = 'team_WFQWaPaIHEfaHYT1DdvgmfdF'
export const DEFAULT_HUSTLE_PROJECT_ID = 'prj_wg2yhpv0PDv5StYwebcxgsshPAhn'
export const DEFAULT_HUSTLE_TEAM_ID = 'team_xeVfJQu9nAFDQS3vn0OiJIt5'

// In-memory cache for Edge Middleware & API lookups (TTL 60s)
let memoryActiveDomain = PRIMARY_DOMAIN
let lastDomainFetch = 0
const CACHE_TTL_MS = 60_000

export function calculateMaxUsagePercent(metrics: VercelUsageMetrics): {
    maxPercent: number
    bandwidthPct: number
    serverlessPct: number
    edgePct: number
} {
    const bandwidthPct =
        metrics.bandwidth && metrics.bandwidth.limit > 0
            ? (metrics.bandwidth.value / metrics.bandwidth.limit) * 100
            : 0

    const serverlessPct =
        metrics.serverlessFunctionExecution && metrics.serverlessFunctionExecution.limit > 0
            ? (metrics.serverlessFunctionExecution.value / metrics.serverlessFunctionExecution.limit) * 100
            : 0

    const edgePct =
        metrics.edgeMiddlewareInvocations && metrics.edgeMiddlewareInvocations.limit > 0
            ? (metrics.edgeMiddlewareInvocations.value / metrics.edgeMiddlewareInvocations.limit) * 100
            : 0

    const maxPercent = Math.max(bandwidthPct, serverlessPct, edgePct)
    return { maxPercent, bandwidthPct, serverlessPct, edgePct }
}

export async function fetchVercelUsage(options?: {
    token?: string
    projectId?: string
    teamId?: string
}): Promise<VercelUsageMetrics> {
    const token = options?.token || process.env.VERCEL_API_TOKEN
    const projectId = options?.projectId || process.env.VERCEL_FPLACE_PROJECT_ID || DEFAULT_FPLACE_PROJECT_ID
    const teamId = options?.teamId || process.env.VERCEL_TEAM_ID || DEFAULT_FPLACE_TEAM_ID

    if (!token || !projectId) {
        throw new Error('Credenziali Vercel non configurate (token o projectId assente)')
    }

    const now = new Date()
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    const to = now.toISOString()

    const url = new URL('https://api.vercel.com/v2/usage')
    url.searchParams.set('projectId', projectId)
    url.searchParams.set('from', from)
    url.searchParams.set('to', to)
    url.searchParams.set('type', 'requests')
    if (teamId) {
        url.searchParams.set('teamId', teamId)
    }

    const response = await fetch(url.toString(), {
        headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'TheHustlePlace-DomainWatcher/1.0',
        },
    })

    if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Errore API Vercel HTTP ${response.status}: ${errText}`)
    }

    const json = (await response.json()) as VercelRequestsUsageResponse

    let totalBytes = 0
    let totalGbHours = 0
    let totalRequests = 0

    if (Array.isArray(json.data)) {
        for (const day of json.data) {
            totalBytes += (day.bandwidth_outgoing_bytes || 0) + (day.bandwidth_incoming_bytes || 0)
            totalGbHours +=
                (day.function_execution_successful_gb_hours || 0) +
                (day.function_execution_failed_gb_hours || 0)
            totalRequests += (day.request_hit_count || 0) + (day.request_miss_count || 0)
        }
    }

    // Limiti standard piano Hobby Vercel: 100 GB Bandwidth, 100 GB-Hours Function Execution, 1M Edge Invocations
    const BANDWIDTH_LIMIT_BYTES = 100 * 1024 * 1024 * 1024 // 100 GB
    const FUNCTION_LIMIT_GB_HOURS = 100 // 100 GB-Hrs
    const REQUESTS_LIMIT = 1_000_000 // 1M Requests

    return {
        bandwidth: { value: totalBytes, limit: BANDWIDTH_LIMIT_BYTES },
        serverlessFunctionExecution: { value: totalGbHours, limit: FUNCTION_LIMIT_GB_HOURS },
        edgeMiddlewareInvocations: { value: totalRequests, limit: REQUESTS_LIMIT },
    }
}

export async function getActiveDomain(): Promise<string> {
    const now = Date.now()
    if (now - lastDomainFetch < CACHE_TTL_MS) {
        return memoryActiveDomain
    }

    try {
        const db = getDb()
        if (db) {
            const [record] = await db
                .select()
                .from(systemDomainRouting)
                .where(eq(systemDomainRouting.id, 'production'))
                .limit(1)

            if (record && record.activeDomain) {
                memoryActiveDomain = record.activeDomain
                lastDomainFetch = now
                return memoryActiveDomain
            }
        }
    } catch (err) {
        console.warn('[domain-routing] Fallback cache errore lettura db:', err)
    }

    return memoryActiveDomain
}

export async function checkAndUpdateVercelUsage(): Promise<UsageCheckResult> {
    const db = getDb()
    let autoFailoverEnabled = true
    let threshold = DEFAULT_THRESHOLD_PERCENT
    let previousActiveDomain = PRIMARY_DOMAIN

    if (db) {
        try {
            const [record] = await db
                .select()
                .from(systemDomainRouting)
                .where(eq(systemDomainRouting.id, 'production'))
                .limit(1)

            if (record) {
                autoFailoverEnabled = record.autoFailoverEnabled
                threshold = Number(record.thresholdPercent) || DEFAULT_THRESHOLD_PERCENT
                previousActiveDomain = record.activeDomain || PRIMARY_DOMAIN
            }
        } catch (dbErr) {
            console.warn('[domain-routing] Impossibile recuperare record iniziale:', dbErr)
        }
    }

    // 1. Rilevamento usage the-fplace
    const fplaceMetrics = await fetchVercelUsage({
        token: process.env.VERCEL_API_TOKEN,
        projectId: process.env.VERCEL_FPLACE_PROJECT_ID || DEFAULT_FPLACE_PROJECT_ID,
        teamId: process.env.VERCEL_TEAM_ID || DEFAULT_FPLACE_TEAM_ID,
    })
    const fplaceCalc = calculateMaxUsagePercent(fplaceMetrics)

    // 2. Rilevamento usage the-hustle-place (se configurato con token)
    let hustleCalc: ReturnType<typeof calculateMaxUsagePercent> | null = null
    const hustleToken = process.env.VERCEL_HUSTLE_API_TOKEN || process.env.VERCEL_API_TOKEN
    const hustleProjectId = process.env.VERCEL_HUSTLE_PROJECT_ID || DEFAULT_HUSTLE_PROJECT_ID
    const hustleTeamId = process.env.VERCEL_HUSTLE_TEAM_ID || DEFAULT_HUSTLE_TEAM_ID

    if (hustleToken) {
        try {
            const hustleMetrics = await fetchVercelUsage({
                token: hustleToken,
                projectId: hustleProjectId,
                teamId: hustleTeamId,
            })
            hustleCalc = calculateMaxUsagePercent(hustleMetrics)
        } catch {
            // Silenzioso se il token per il secondo account non è ancora configurato
        }
    }

    // 3. Calcolo bidirezionale del dominio attivo
    let nextActiveDomain = previousActiveDomain
    if (autoFailoverEnabled) {
        const fplaceExceeded = fplaceCalc.maxPercent >= threshold
        const hustleExceeded = hustleCalc ? hustleCalc.maxPercent >= threshold : false

        if (fplaceExceeded && !hustleExceeded) {
            // the-fplace ha superato il 75% -> passa a the-hustle-place
            nextActiveDomain = SECONDARY_DOMAIN
        } else if (hustleExceeded && !fplaceExceeded) {
            // the-hustle-place ha superato il 75% -> torna su the-fplace
            nextActiveDomain = PRIMARY_DOMAIN
        } else if (!fplaceExceeded) {
            // the-fplace è sotto il 75% (es. nuovo mese) -> torna sul primario
            nextActiveDomain = PRIMARY_DOMAIN
        }
    }

    const switched = nextActiveDomain !== previousActiveDomain

    if (db) {
        try {
            await db
                .insert(systemDomainRouting)
                .values({
                    id: 'production',
                    primaryDomain: PRIMARY_DOMAIN,
                    secondaryDomain: SECONDARY_DOMAIN,
                    activeDomain: nextActiveDomain,
                    fplaceUsagePercent: fplaceCalc.maxPercent.toFixed(2),
                    thresholdPercent: threshold.toFixed(2),
                    autoFailoverEnabled,
                    lastCheckedAt: new Date(),
                    updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: systemDomainRouting.id,
                    set: {
                        activeDomain: nextActiveDomain,
                        fplaceUsagePercent: fplaceCalc.maxPercent.toFixed(2),
                        lastCheckedAt: new Date(),
                        updatedAt: new Date(),
                    },
                })
        } catch (updateErr) {
            console.error('[domain-routing] Errore salvataggio routing su DB:', updateErr)
        }
    }

    memoryActiveDomain = nextActiveDomain
    lastDomainFetch = Date.now()

    return {
        success: true,
        maxUsagePercent: Number(fplaceCalc.maxPercent.toFixed(2)),
        activeDomain: nextActiveDomain,
        fplaceUsage: {
            bandwidthPercent: Number(fplaceCalc.bandwidthPct.toFixed(2)),
            serverlessPercent: Number(fplaceCalc.serverlessPct.toFixed(2)),
            edgePercent: Number(fplaceCalc.edgePct.toFixed(2)),
        },
        ...(hustleCalc
            ? {
                  hustleUsage: {
                      maxUsagePercent: Number(hustleCalc.maxPercent.toFixed(2)),
                      bandwidthPercent: Number(hustleCalc.bandwidthPct.toFixed(2)),
                      serverlessPercent: Number(hustleCalc.serverlessPct.toFixed(2)),
                      edgePercent: Number(hustleCalc.edgePct.toFixed(2)),
                  },
              }
            : {}),
        switched,
    }
}
