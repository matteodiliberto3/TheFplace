import { firstFulfilled } from '@/lib/first-fulfilled'
import { getHomeRelayConfig } from '@/lib/db/vixsrc-relay'
import { HOME_RELAY_TIMEOUT_MS, homeRelayCircuit, interpretHomeRelayResponse } from '@/lib/vixsrc-home-relay'
import { rememberVixsrcEpisodeAvailability } from '@/lib/vixsrc-episode-cache'
import { isConfirmedVixsrcMiss } from '@/lib/vixsrc-episode-status'
import { cache } from '@/utils/cache'
import { logger } from '@/utils/logger'
import {
    VIXSRC_PART_PREFIX,
    buildHomeRelayFetchUrl,
    buildVixsrcPlaylistUrl,
    bytesToBase64,
    classifyHlsRef,
    collectDroppedHlsHosts,
    hlsStreamLooksPlayable,
    isAllowedHlsUrl,
    normalizeVixsrcCdnUrl,
    parseVixsrcApiSrc,
    parseVixsrcEmbedHtml,
    readStreamTokenExpiryMs,
    rewriteM3u8Browser,
    unwrapAllOriginsBody,
    unwrapJinaBody,
} from '@/lib/vixsrc-hls'

export interface ResolvedVixsrcHls {
    master: string
    parts: Record<string, string>
    videoId?: number
}

const VIXSRC_BASE_URL = process.env.VIXSRC_BASE_URL || 'https://vixsrc.to'
const CACHE_TTL_SECONDS = 7200
const BROWSER_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

export const VIXSRC_FETCH_HEADERS = {
    'User-Agent': BROWSER_UA,
    Referer: `${VIXSRC_BASE_URL}/`,
    Accept: '*/*',
    'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
} as const

type FetchMode = 'home' | 'direct' | 'allorigins' | 'jina'

function fetchModes(): FetchMode[] {
    return ['direct', 'allorigins', 'jina']
}

export function vixsrcRequestHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(VIXSRC_FETCH_HEADERS)
    if (extra) {
        new Headers(extra).forEach((value, key) => headers.set(key, value))
    }
    return headers
}

function requestSignal(timeoutMs: number, extra?: AbortSignal): AbortSignal {
    if (!extra) return AbortSignal.timeout(timeoutMs)
    const controller = new AbortController()
    const timer = setTimeout(() => {
        if (!controller.signal.aborted) controller.abort()
    }, timeoutMs)
    const onAbort = () => {
        clearTimeout(timer)
        if (!controller.signal.aborted) controller.abort()
    }
    extra.addEventListener('abort', onAbort, { once: true })
    if (extra.aborted) onAbort()
    return controller.signal
}

function isAbortError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))
}

class VixsrcSession {
    constructor(
        private readonly mode: FetchMode,
        private readonly signal?: AbortSignal
    ) {}

    async fetch(url: string, extra?: HeadersInit): Promise<Response> {
        return this.fetchMode(url, extra)
    }

    async fetchText(url: string, extra?: HeadersInit): Promise<string> {
        const response = await this.fetchMode(url, extra)
        const text = await response.text()
        if (!response.ok) {
            throw new Error(`${this.mode} ${response.status}`)
        }
        return text
    }

    async fetchManifest(url: string): Promise<string> {
        const body = await this.fetchText(url)
        if (!body.includes('#EXTM3U') && !body.includes('#EXT-X')) {
            throw new Error(`Manifest VixSrc non valido (${this.mode})`)
        }
        return body
    }

    private async fetchMode(url: string, extra?: HeadersInit): Promise<Response> {
        if (this.mode === 'home') {
            const relay = process.env.VIXSRC_RELAY_URL
            const token = process.env.VIXSRC_RELAY_TOKEN
            const proxied = relay ? buildHomeRelayFetchUrl(relay, url) : null
            if (!relay || !token || !proxied) {
                return new Response('Relay di casa non configurato', { status: 503 })
            }
            return fetch(proxied, {
                headers: { 'x-relay-token': token },
                cache: 'no-store',
                redirect: 'follow',
                signal: requestSignal(25000, this.signal),
            })
        }
        if (this.mode === 'direct') {
            return fetch(url, {
                headers: vixsrcRequestHeaders(extra),
                cache: 'no-store',
                redirect: 'follow',
                signal: requestSignal(12000, this.signal),
            })
        }
        if (this.mode === 'allorigins') {
            const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
            const response = await fetch(proxy, {
                cache: 'no-store',
                redirect: 'follow',
                signal: requestSignal(10000, this.signal),
            })
            if (!response.ok) return response
            const buffer = await response.arrayBuffer()
            return new Response(buffer, {
                status: 200,
                headers: { 'content-type': response.headers.get('content-type') || 'application/octet-stream' },
            })
        }
        const jina = await fetch(`https://r.jina.ai/${url}`, {
            headers: { 'X-Return-Format': 'html', Accept: 'text/html' },
            cache: 'no-store',
            signal: requestSignal(10000, this.signal),
        })
        const raw = await jina.text()
        if (!jina.ok) {
            return new Response(raw, { status: jina.status })
        }
        const body = unwrapJinaBody(unwrapAllOriginsBody(raw))
        if (body.includes('AssertionFailureError') || body.includes('unexpected content type')) {
            return new Response(body, { status: 422 })
        }
        return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } })
    }
}

export async function resolveVixsrcHls(input: {
    tmdbId: number
    type: 'movie' | 'tv'
    season?: number
    episode?: number
    lang?: string
    fresh?: boolean
}): Promise<ResolvedVixsrcHls> {
    const lang = input.lang ?? 'it'
    const cacheKey =
        input.type === 'movie'
            ? `vixsrc-hls-v2-movie-${input.tmdbId}-${lang}`
            : `vixsrc-hls-v2-tv-${input.tmdbId}-${input.season}-${input.episode}-${lang}`

    if (!input.fresh) {
        const cached = await cache.get<ResolvedVixsrcHls>(cacheKey)
        if (cached?.master && hlsStreamLooksPlayable(cached)) {
            const expiry = readStreamTokenExpiryMs(cached)
            if (!expiry || expiry - Date.now() > 60_000) {
                return cached
            }
        }
    }

    const persist = async (stream: ResolvedVixsrcHls, mode: string) => {
        if (!hlsStreamLooksPlayable(stream)) {
            throw new Error('Playlist VixSrc senza segmenti')
        }
        const value: ResolvedVixsrcHls = {
            master: stream.master,
            parts: stream.parts,
            videoId: stream.videoId,
        }
        const expiry = readStreamTokenExpiryMs(stream)
        const ttlSeconds = expiry
            ? Math.max(60, Math.min(CACHE_TTL_SECONDS, Math.floor((expiry - Date.now() - 60_000) / 1000)))
            : CACHE_TTL_SECONDS
        await cache.set(cacheKey, value, { ttl: ttlSeconds })
        if (input.type === 'tv' && input.season && input.episode) {
            void rememberVixsrcEpisodeAvailability(input.tmdbId, input.season, input.episode, true)
        }
        logger.info('Playlist VixSrc risolta', {
            tmdbId: input.tmdbId,
            type: input.type,
            videoId: value.videoId,
            mode,
        })
        return value
    }

    const homeAbort = new AbortController()
    const publicAbort = new AbortController()
    let lastError = 'API VixSrc non disponibile (403)'
    let confirmedMissing = false

    const homeTask = (async () => {
        const home = await resolveViaHomeRelay(input, lang, homeAbort.signal)
        if (!home || !hlsStreamLooksPlayable(home)) {
            throw new Error('Relay di casa senza playlist')
        }
        return persist(home, 'home')
    })()

    const publicTask = (async () => {
        const stream = await resolveViaPublicTransports(input, lang, publicAbort.signal, (mode, error) => {
            lastError = error
            if (isConfirmedVixsrcMiss(error)) confirmedMissing = true
            logger.warn('Transport VixSrc fallito', { mode, error, tmdbId: input.tmdbId })
        })
        return persist(stream, stream.mode)
    })()

    void homeTask.catch(() => undefined)
    void publicTask.catch(() => undefined)

    try {
        const stream = await firstFulfilled([homeTask, publicTask])
        homeAbort.abort()
        publicAbort.abort()
        return stream
    } catch {
        if (confirmedMissing && input.type === 'tv' && input.season && input.episode) {
            void rememberVixsrcEpisodeAvailability(input.tmdbId, input.season, input.episode, false)
        }
        throw new Error(lastError)
    }
}

async function resolveViaPublicTransports(
    input: { tmdbId: number; type: 'movie' | 'tv'; season?: number; episode?: number; lang?: string },
    lang: string,
    signal: AbortSignal,
    onError: (mode: string, error: string) => void
): Promise<ResolvedVixsrcHls & { mode: string }> {
    const apiPath =
        input.type === 'movie'
            ? `/api/movie/${input.tmdbId}?lang=${encodeURIComponent(lang)}`
            : `/api/tv/${input.tmdbId}/${input.season}/${input.episode}?lang=${encodeURIComponent(lang)}`
    const apiUrl = `${VIXSRC_BASE_URL}${apiPath}`

    let lastError = 'API VixSrc non disponibile (403)'
    for (const mode of fetchModes()) {
        if (signal.aborted) throw new Error(lastError)
        const session = new VixsrcSession(mode, signal)
        try {
            const stream = await resolveWithSession(session, apiUrl, lang)
            return { ...stream, mode }
        } catch (error) {
            if (isAbortError(error)) throw error
            lastError = error instanceof Error ? error.message : lastError
            onError(mode, lastError)
        }
    }

    throw new Error(lastError)
}

async function resolveViaHomeRelay(
    input: { tmdbId: number; type: 'movie' | 'tv'; season?: number; episode?: number },
    lang: string,
    signal?: AbortSignal
): Promise<ResolvedVixsrcHls | null> {
    if (!homeRelayCircuit.allow()) {
        logger.warn('Relay di casa in cooldown, uso i fallback', { tmdbId: input.tmdbId })
        return null
    }

    try {
        const relay = await getHomeRelayConfig()
        if (!relay) return null
        const query = new URLSearchParams({ tmdbId: String(input.tmdbId), type: input.type, lang })
        if (input.type === 'tv' && input.season && input.episode) {
            query.set('season', String(input.season))
            query.set('episode', String(input.episode))
        }
        const response = await fetch(`${relay.url}/resolve?${query.toString()}`, {
            headers: { 'x-relay-token': relay.token },
            cache: 'no-store',
            signal: requestSignal(HOME_RELAY_TIMEOUT_MS, signal),
        })
        const outcome = interpretHomeRelayResponse(response.status, await response.text())
        if (outcome.ok) {
            homeRelayCircuit.succeed()
            return outcome.data
        }
        if (outcome.coolDown) {
            homeRelayCircuit.fail()
            logger.warn('Relay di casa non raggiungibile, uso i fallback', {
                tmdbId: input.tmdbId,
                status: response.status,
            })
        } else {
            logger.warn('Relay di casa senza playlist, uso i fallback', {
                tmdbId: input.tmdbId,
                status: response.status,
            })
        }
        return null
    } catch (error) {
        if (isAbortError(error) || signal?.aborted) {
            return null
        }
        homeRelayCircuit.fail()
        logger.warn('Relay di casa non raggiungibile, uso i fallback', {
            tmdbId: input.tmdbId,
            error: error instanceof Error ? error.message : error,
        })
        return null
    }
}

async function resolveWithSession(session: VixsrcSession, apiUrl: string, lang: string): Promise<ResolvedVixsrcHls> {
    const src = parseVixsrcApiSrc(await session.fetchText(apiUrl))
    if (!src) {
        throw new Error('Risposta API VixSrc senza embed')
    }

    const embedUrl = new URL(src, VIXSRC_BASE_URL)
    if (embedUrl.origin !== new URL(VIXSRC_BASE_URL).origin) {
        throw new Error('Embed VixSrc su origin non attesa')
    }

    const embedHtml = await session.fetchText(embedUrl.toString())
    const parsed = parseVixsrcEmbedHtml(embedHtml) ?? parseVixsrcEmbedHtml(unwrapJinaBody(embedHtml))
    if (!parsed) {
        throw new Error('Playlist VixSrc non trovata nell\'embed')
    }

    const playlistUrl = buildVixsrcPlaylistUrl(parsed, lang)
    if (!isAllowedHlsUrl(playlistUrl)) {
        throw new Error('Playlist VixSrc su host non consentito')
    }

    return assembleBrowserStream(session, playlistUrl, parsed.videoId)
}

async function assembleBrowserStream(
    session: VixsrcSession,
    masterUrl: string,
    videoId?: number
): Promise<ResolvedVixsrcHls> {
    const partIds = new Map<string, string>()
    const pending = [masterUrl]
    const fetched = new Map<string, string>()
    const droppedHosts = new Set<string>()
    let keyUri: string | null = null

    const partIdFor = (url: string) => {
        const current = partIds.get(url)
        if (current) return current
        const id = `p${partIds.size}`
        partIds.set(url, id)
        pending.push(url)
        return id
    }

    const resolveRef = (absolute: string, kind: 'cdn' | 'playlist' | 'key') => {
        if (kind === 'cdn') return normalizeVixsrcCdnUrl(absolute)
        if (kind === 'key') return keyUri ?? absolute
        return `${VIXSRC_PART_PREFIX}${partIdFor(absolute)}.m3u8`
    }

    while (pending.length) {
        const url = pending.shift()
        if (!url || fetched.has(url)) continue

        const body = await session.fetchManifest(url)
        for (const host of collectDroppedHlsHosts(body, url)) {
            droppedHosts.add(host)
        }
        if (!keyUri) {
            const keyUrl = findKeyUrl(body, url)
            if (keyUrl) {
                const keyResponse = await session.fetch(keyUrl)
                if (!keyResponse.ok) {
                    throw new Error(`Chiave VixSrc non disponibile (${keyResponse.status})`)
                }
                keyUri = `data:application/octet-stream;base64,${bytesToBase64(new Uint8Array(await keyResponse.arrayBuffer()))}`
            }
        }
        fetched.set(url, rewriteM3u8Browser(body, url, resolveRef))
    }

    const master = fetched.get(masterUrl)
    if (!master) throw new Error('Manifest principale VixSrc vuoto')

    const parts: Record<string, string> = {}
    partIds.forEach((id, url) => {
        const text = fetched.get(url)
        if (text) parts[id] = text
    })

    const stream = { master, parts, videoId }
    if (!hlsStreamLooksPlayable(stream)) {
        const droppedList = Array.from(droppedHosts)
        const dropped = droppedList.join(', ')
        logger.warn('Playlist VixSrc senza segmenti', { droppedHosts: droppedList, videoId })
        throw new Error(dropped ? `Playlist VixSrc senza segmenti (${dropped})` : 'Playlist VixSrc senza segmenti')
    }
    if (droppedHosts.size) {
        logger.warn('Host HLS VixSrc scartati ma lo stream resta riproducibile', {
            droppedHosts: Array.from(droppedHosts),
            videoId,
        })
    }
    return stream
}

function findKeyUrl(body: string, sourceUrl: string): string | null {
    const re = /URI="([^"]+)"/gi
    let match: RegExpExecArray | null = re.exec(body)
    while (match) {
        const absolute = new URL(match[1], sourceUrl).toString()
        if (classifyHlsRef(absolute) === 'key') return absolute
        match = re.exec(body)
    }
    return null
}
