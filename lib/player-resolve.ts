import { isAllowedRelayPublicUrl } from '@/lib/vixsrc-hls'

export const PLAYER_RESOLVE_ATTEMPTS = 3
export const PLAYER_RESOLVE_RETRY_MS = 600
export const RELAY_CONFIG_PATH = '/api/player/relay'
export const RELAY_MAX_TIMEOUT_MS = 8_000
export const RELAY_MOBILE_PROBE_MS = 2_500
export const RELAY_DESKTOP_PROBE_MS = 4_500

export const RELAY_CIRCUIT_KEY = 'vixsrc_relay_circuit'
export const RELAY_CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000 // 15 minuti

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

export function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || ''
    const isTouch = navigator.maxTouchPoints > 1
    const isSmall = typeof window !== 'undefined' && window.innerWidth <= 820
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (isTouch && isSmall)
}

let memoryCircuitState: { open: boolean; at: number } | null = null

export function isRelayCircuitOpen(): boolean {
    if (typeof sessionStorage !== 'undefined') {
        try {
            const raw = sessionStorage.getItem(RELAY_CIRCUIT_KEY)
            if (!raw) return false
            const parsed = JSON.parse(raw) as { open?: boolean; at?: number }
            if (parsed.open && parsed.at && Date.now() - parsed.at < RELAY_CIRCUIT_COOLDOWN_MS) {
                return true
            }
            sessionStorage.removeItem(RELAY_CIRCUIT_KEY)
            return false
        } catch {
            return false
        }
    }
    if (memoryCircuitState && Date.now() - memoryCircuitState.at < RELAY_CIRCUIT_COOLDOWN_MS) {
        return memoryCircuitState.open
    }
    return false
}

export function tripRelayCircuit(): void {
    const state = { open: true, at: Date.now() }
    memoryCircuitState = state
    if (typeof sessionStorage !== 'undefined') {
        try {
            sessionStorage.setItem(RELAY_CIRCUIT_KEY, JSON.stringify(state))
        } catch {
            // ignore storage errors
        }
    }
}

export function resetRelayCircuit(): void {
    memoryCircuitState = null
    if (typeof sessionStorage !== 'undefined') {
        try {
            sessionStorage.removeItem(RELAY_CIRCUIT_KEY)
        } catch {
            // ignore storage errors
        }
    }
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

async function fetchWithTimeout(
    fetchImpl: typeof fetch,
    url: string,
    timeoutMs: number,
    externalSignal?: AbortSignal
): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onExternalAbort = () => controller.abort()
    if (externalSignal) {
        if (externalSignal.aborted) {
            clearTimeout(timer)
            controller.abort()
        } else {
            externalSignal.addEventListener('abort', onExternalAbort, { once: true })
        }
    }
    try {
        return await fetchImpl(url, { cache: 'no-store', signal: controller.signal })
    } finally {
        clearTimeout(timer)
        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    }
}

/** `fallback` solo se il relay non ha risposto con uno stream: si riprova da Vercel. */
async function attemptResolve(
    fetchImpl: typeof fetch,
    url: string,
    wait: (ms: number) => Promise<void>,
    attempts: number,
    timeoutMs?: number,
    externalSignal?: AbortSignal
): Promise<{ fallback: true } | { fallback: false; result: PlayerResolveResult }> {
    let error = 'Stream non disponibile'
    let missing = false

    for (let attempt = 1; attempt <= attempts; attempt++) {
        if (externalSignal?.aborted) {
            return { fallback: true }
        }
        try {
            const response = timeoutMs
                ? await fetchWithTimeout(fetchImpl, url, timeoutMs, externalSignal)
                : await (externalSignal ? fetchImpl(url, { cache: 'no-store', signal: externalSignal }) : fetchImpl(url, { cache: 'no-store' }))
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
        probeBudgetMs?: number
        bypassCircuit?: boolean
    }
): Promise<PlayerResolveResult> {
    const fetchImpl = options?.fetch ?? fetch
    const wait: (ms: number) => Promise<void> = options?.wait ?? defaultWait
    const attempts = options?.attempts ?? PLAYER_RESOLVE_ATTEMPTS
    const isMobile = isMobileDevice()
    const probeBudget = options?.probeBudgetMs ?? (isMobile ? RELAY_MOBILE_PROBE_MS : RELAY_DESKTOP_PROBE_MS)

    // Se il circuito è aperto (relay ha fallito di recente in sessione), vai diretto su Vercel (0ms overhead)
    if (!options?.bypassCircuit && isRelayCircuitOpen()) {
        const origin = await attemptResolve(fetchImpl, `/api/player/resolve?${query.toString()}`, wait, attempts)
        return origin.fallback ? { error: 'Stream non disponibile', missing: false } : origin.result
    }

    const relayBase = await readRelayBase(fetchImpl)
    const direct = relayBase ? directRelayResolveUrl(relayBase, query) : null

    // Se non c'è relay, risolvi direttamente da Vercel
    if (!direct) {
        const origin = await attemptResolve(fetchImpl, `/api/player/resolve?${query.toString()}`, wait, attempts)
        return origin.fallback ? { error: 'Stream non disponibile', missing: false } : origin.result
    }

    // Happy Eyeballs Racing:
    // Lanciamo il Relay con timeout massimo di 8s. Se entro il probeBudget (2.5s mobile / 4.5s TV)
    // il Relay non ha risposto, lanciamo in parallelo Vercel Origin. Chi fornisce master valido per primo vince.
    const relayAbort = new AbortController()
    const originAbort = new AbortController()

    let originStarted = false
    let originPromise: Promise<PlayerResolveResult> | null = null

    const startOrigin = (): Promise<PlayerResolveResult> => {
        if (!originStarted) {
            originStarted = true
            originPromise = (async () => {
                const origin = await attemptResolve(
                    fetchImpl,
                    `/api/player/resolve?${query.toString()}`,
                    wait,
                    attempts,
                    undefined,
                    originAbort.signal
                )
                if (!origin.fallback && origin.result.data?.master) {
                    relayAbort.abort()
                    tripRelayCircuit()
                    return origin.result
                }
                return origin.fallback ? { error: 'Stream non disponibile', missing: false } : origin.result
            })()
        }
        return originPromise!
    }

    const relayPromise = (async (): Promise<PlayerResolveResult | null> => {
        try {
            const res = await attemptResolve(
                fetchImpl,
                direct,
                wait,
                1,
                RELAY_MAX_TIMEOUT_MS,
                relayAbort.signal
            )
            if (res.fallback) {
                tripRelayCircuit()
                return null
            }
            if (res.result.missing) {
                // Titolo sicuramente assente
                return res.result
            }
            if (res.result.data?.master) {
                originAbort.abort()
                resetRelayCircuit()
                return res.result
            }
            tripRelayCircuit()
            return null
        } catch {
            tripRelayCircuit()
            return null
        }
    })()

    // Timer probe budget
    let timerId: ReturnType<typeof setTimeout> | undefined
    const probeTimeout = new Promise<{ probeExpired: true }>((resolve) => {
        timerId = setTimeout(() => resolve({ probeExpired: true }), probeBudget)
    })

    const probeRace = await Promise.race([
        relayPromise.then((result) => ({ probeExpired: false, result })),
        probeTimeout,
    ])

    if (timerId) clearTimeout(timerId)

    // Se il relay ha risposto entro il budget con successo o con un errore definitivo (missing)
    if (!probeRace.probeExpired) {
        if (probeRace.result) {
            return probeRace.result
        }
        // Il relay ha fallito velocemente (es. 401 o 502): lancia immediatamente Vercel
        return await startOrigin()
    }

    // Se il budget è scaduto e il relay sta ancora elaborando o è appeso, lancia Vercel in parallelo
    startOrigin()

    // Corsa finale: il primo tra relay e origin che termina con uno stream valido vince
    return await Promise.race([
        relayPromise.then(async (relayRes) => {
            if (relayRes?.data?.master) {
                originAbort.abort()
                resetRelayCircuit()
                return relayRes
            }
            // Se il relay alla fine fallisce, aspetta il risultato di Vercel
            return await originPromise!
        }),
        originPromise!,
    ])
}
