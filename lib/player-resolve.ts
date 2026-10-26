import { isAllowedRelayPublicUrl } from '@/lib/vixsrc-hls'

export const PLAYER_RESOLVE_ATTEMPTS = 3
export const PLAYER_RESOLVE_RETRY_MS = 600
export const RELAY_CONFIG_PATH = '/api/player/relay'
const RELAY_RESOLVE_ATTEMPTS = 2
const RELAY_RESOLVE_TIMEOUT_MS = 35_000

export type ResolvedPlayback = {
    master: string
    parts: Record<string, string>
    videoId?: number
}

export type PlayerResolveResult = {
    data?: ResolvedPlayback
    error: string
    missing: boolean
}

type ResolveJson = {
    success?: boolean
    error?: string
    data?: ResolvedPlayback
}

export function isRetryablePlayerResolveStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500
}

export function isMissingVixsrcStreamError(error?: string): boolean {
    if (!error) return false
    const text = error.toLowerCase()
    return (
        text.includes('senza embed') ||
        text.includes('playlist non trovata') ||
        text.includes("non trovata nell'embed") ||
        text.includes('tmdb id non valido') ||
        text.includes('stagione o episodio')
    )
}

function defaultWait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export function directRelayResolveUrl(relayBase: string, query: URLSearchParams): string | null {
    if (!isAllowedRelayPublicUrl(relayBase)) return null
    return `${relayBase.replace(/\/$/, '')}/resolve?${query.toString()}`
}

async function readRelayBase(fetchImpl: typeof fetch): Promise<string | null> {
    try {
        const response = await fetchImpl(RELAY_CONFIG_PATH, { cache: 'no-store' })
        if (!response.ok) return null
        const json = (await response.json()) as { url?: unknown }
        const url = typeof json.url === 'string' ? json.url.replace(/\/$/, '') : ''
        return url && isAllowedRelayPublicUrl(url) ? url : null
    } catch {
        return null
    }
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetchImpl(url, { cache: 'no-store', signal: controller.signal })
    } finally {
        clearTimeout(timer)
    }
}

/** `fallback` solo se il relay non ha risposto con uno stream: si riprova da Vercel. */
async function attemptResolve(
    fetchImpl: typeof fetch,
    url: string,
    wait: (ms: number) => Promise<void>,
    attempts: number,
    timeoutMs?: number
): Promise<{ fallback: true } | { fallback: false; result: PlayerResolveResult }> {
    let error = 'Stream non disponibile'
    let missing = false

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const response = timeoutMs
                ? await fetchWithTimeout(fetchImpl, url, timeoutMs)
                : await fetchImpl(url, { cache: 'no-store' })
            const json = (await response.json()) as ResolveJson
            if (response.ok && json.success && json.data?.master) {
                return { fallback: false, result: { data: json.data, error: '', missing: false } }
            }

            error = json.error || 'Stream non disponibile'
            missing = isMissingVixsrcStreamError(error)
            const retryable = isRetryablePlayerResolveStatus(response.status)
            if (timeoutMs) {
                if (missing) return { fallback: false, result: { error, missing: true } }
                // Se il relay risponde con 401 Unauthorized o non autorizzato, non ritentare: fallback immediato su Vercel
                if (response.status === 401 || (typeof json.error === 'string' && json.error.toLowerCase().includes('unauthorized'))) {
                    return { fallback: true }
                }
                if (retryable && attempt < attempts) {
                    await wait(PLAYER_RESOLVE_RETRY_MS * attempt)
                    continue
                }
                return { fallback: true }
            }
            if (!retryable || attempt === attempts) {
                return { fallback: false, result: { error, missing } }
            }
        } catch (caught) {
            error = caught instanceof Error ? caught.message : 'Stream non disponibile'
            missing = false
            if (timeoutMs) return { fallback: true }
            if (attempt === attempts) {
                return { fallback: false, result: { error, missing } }
            }
        }

        await wait(PLAYER_RESOLVE_RETRY_MS * attempt)
    }

    return { fallback: false, result: { error, missing } }
}

export async function fetchResolvedPlayback(
    query: URLSearchParams,
    options?: {
        fetch?: typeof fetch
        wait?: (ms: number) => Promise<void>
        attempts?: number
    }
): Promise<PlayerResolveResult> {
    const fetchImpl = options?.fetch ?? fetch
    const wait: (ms: number) => Promise<void> = options?.wait ?? defaultWait
    const attempts = options?.attempts ?? PLAYER_RESOLVE_ATTEMPTS
    const relayBase = await readRelayBase(fetchImpl)
    const direct = relayBase ? directRelayResolveUrl(relayBase, query) : null

    if (direct) {
        const relay = await attemptResolve(fetchImpl, direct, wait, RELAY_RESOLVE_ATTEMPTS, RELAY_RESOLVE_TIMEOUT_MS)
        if (!relay.fallback) return relay.result
    }

    const origin = await attemptResolve(fetchImpl, `/api/player/resolve?${query.toString()}`, wait, attempts)
    return origin.fallback
        ? { error: 'Stream non disponibile', missing: false }
        : origin.result
}
