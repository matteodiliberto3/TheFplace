import { VIXSRC_EDGE_CDN_HOST, VIXSRC_ORIGIN_HOST } from './vixsrc-cdn-allowlist'

export interface VixsrcMasterPlaylist {
    url: string
    token: string
    expires: string
    canPlayFHD: boolean
    videoId?: number
}

export function isVixsrcEdgeCdnHost(hostname: string): boolean {
    return VIXSRC_EDGE_CDN_HOST.test(hostname)
}

export function isVixsrcCdnHost(hostname: string): boolean {
    return hostname === 'vix-content.net' || hostname.endsWith('.vix-content.net') || isVixsrcEdgeCdnHost(hostname)
}

export function isAllowedHlsUrl(raw: string): boolean {
    try {
        const url = new URL(raw)
        return url.protocol === 'https:' && (VIXSRC_ORIGIN_HOST.test(url.hostname) || isVixsrcEdgeCdnHost(url.hostname))
    } catch {
        return false
    }
}

/** I segmenti restano sul CDN. Vercel proxano solo playlist e chiavi. */
export function shouldProxyVixsrcCdn(_raw: string): boolean {
    return false
}

export function rewriteEdgeCdnThroughProxy(body: string, _origin: string): string {
    return body
}

/** True se c'è almeno una media playlist con EXTINF e URL di segmenti. */
export function hlsStreamLooksPlayable(stream: { parts: Record<string, string> }): boolean {
    return Object.values(stream.parts).some((text) => {
        const inf = (text.match(/#EXTINF/g) || []).length
        if (inf < 8) return false
        return /https:\/\//.test(text) || text.includes('/api/player/hls?u=')
    })
}

export function collectDroppedHlsHosts(body: string, sourceUrl: string): string[] {
    const hosts = new Set<string>()
    const consider = (ref: string) => {
        if (!ref || ref.startsWith('data:')) return
        try {
            const absolute = new URL(ref, sourceUrl).toString()
            if (isAllowedHlsUrl(absolute)) return
            hosts.add(new URL(absolute).hostname)
        } catch {
            return
        }
    }

    for (const line of body.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        if (trimmed.startsWith('#')) {
            const re = /URI="([^"]+)"/gi
            let match: RegExpExecArray | null = re.exec(trimmed)
            while (match) {
                consider(match[1])
                match = re.exec(trimmed)
            }
            continue
        }
        consider(trimmed)
    }

    return Array.from(hosts)
}

const RELAY_PUBLIC_HOST = /^(?:[a-z0-9-]+\.)+(?:trycloudflare\.com|cfargotunnel\.com)$/i

export function isAllowedRelayPublicUrl(raw: string): boolean {
    try {
        const url = new URL(raw)
        return url.protocol === 'https:' && RELAY_PUBLIC_HOST.test(url.hostname)
    } catch {
        return false
    }
}

export function buildHomeRelayFetchUrl(relayBase: string, target: string): string | null {
    if (!isAllowedHlsUrl(target)) return null
    try {
        const base = new URL(relayBase)
        if (base.protocol !== 'https:' && base.protocol !== 'http:') return null
        return `${base.origin}/fetch?u=${encodeURIComponent(target)}`
    } catch {
        return null
    }
}

export function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
}

export function unwrapJinaBody(text: string): string {
    const marker = 'Markdown Content:'
    const index = text.indexOf(marker)
    return index >= 0 ? text.slice(index + marker.length).trim() : text
}

export function unwrapAllOriginsBody(text: string): string {
    const trimmed = text.trim()
    if (!trimmed.startsWith('{')) return text
    try {
        const json = JSON.parse(trimmed) as { contents?: unknown }
        return typeof json.contents === 'string' ? json.contents : text
    } catch {
        return text
    }
}

export function parseVixsrcApiSrc(text: string): string | null {
    const body = unwrapJinaBody(unwrapAllOriginsBody(text))
    const match = body.match(/\{"src":"([^"]+)"/)
    if (match?.[1]) return decodeHtmlEntities(match[1].replace(/\\\//g, '/'))
    try {
        const json = JSON.parse(body) as { src?: unknown }
        if (typeof json.src === 'string' && json.src.startsWith('/')) {
            return decodeHtmlEntities(json.src)
        }
    } catch {
        return null
    }
    return null
}

export function parseVixsrcEmbedHtml(html: string): VixsrcMasterPlaylist | null {
    const token = html.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]
    const expires = html.match(/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]
    const url =
        html.match(/masterPlaylist[\s\S]*?url:\s*['"]([^'"]+)['"]/)?.[1] ??
        html.match(/url:\s*['"](https?:\/\/[^'"]*playlist[^'"]*)['"]/)?.[1]
    if (!token || !expires || !url) return null

    const videoIdRaw = html.match(/window\.video\s*=\s*\{[\s\S]*?id:\s*['"](\d+)['"]/)?.[1]
    return {
        url,
        token,
        expires,
        canPlayFHD: /canPlayFHD\s*=\s*true/.test(html),
        videoId: videoIdRaw ? Number(videoIdRaw) : undefined,
    }
}

export function buildVixsrcPlaylistUrl(parsed: VixsrcMasterPlaylist, lang = 'it'): string {
    const playlist = new URL(parsed.url)
    playlist.searchParams.set('token', parsed.token)
    playlist.searchParams.set('expires', parsed.expires)
    playlist.searchParams.set('h', '1')
    playlist.searchParams.set('lang', lang)
    return playlist.toString()
}

export function resolvePlaylistRef(ref: string, sourceUrl: string): string | null {
    try {
        const absolute = new URL(ref, sourceUrl).toString()
        return isAllowedHlsUrl(absolute) ? absolute : null
    } catch {
        return null
    }
}

export function normalizeVixsrcCdnUrl(rawUrl: string): string {
    try {
        const url = new URL(rawUrl)
        if (isVixsrcCdnHost(url.hostname)) {
            url.pathname = url.pathname.replace(/\.(html|m4s)$/i, '.ts')
            return url.toString()
        }
        return rawUrl
    } catch {
        return rawUrl
    }
}

export function normalizeVixsrcCdnInManifest(manifestText: string): string {
    if (!manifestText) return ''
    return manifestText.replace(/\.(html|m4s)(\?|$)/gi, '.ts$2')
}

function rewriteHlsRef(absolute: string, proxyPrefix: string): string {
    const kind = classifyHlsRef(absolute)
    if (kind === 'drop') return ''
    if (kind === 'cdn') return normalizeVixsrcCdnUrl(absolute)
    return `${proxyPrefix}${encodeURIComponent(absolute)}`
}

export function rewriteM3u8(body: string, sourceUrl: string, proxyPrefix: string): string {
    return body
        .split(/\r?\n/)
        .map((line) => {
            const trimmed = line.trim()
            if (!trimmed) return line
            if (trimmed.startsWith('#')) {
                return line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => {
                    try {
                        const rewritten = rewriteHlsRef(new URL(uri, sourceUrl).toString(), proxyPrefix)
                        return rewritten ? `URI="${rewritten}"` : 'URI=""'
                    } catch {
                        return 'URI=""'
                    }
                })
            }
            const absolute = resolvePlaylistRef(trimmed, sourceUrl)
            return absolute ? rewriteHlsRef(absolute, proxyPrefix) : ''
        })
        .join('\n')
}

export function isM3u8Playlist(contentType: string, body: string): boolean {
    if (body.trimStart().startsWith('#EXTM3U')) return true
    const type = contentType.toLowerCase()
    return type.includes('mpegurl') || type.includes('m3u8')
}

export function isHlsManifestBuffer(bytes: Uint8Array): boolean {
    let head = ''
    const limit = Math.min(bytes.length, 32)
    for (let i = 0; i < limit; i++) {
        const code = bytes[i]
        if (code === 0) break
        head += String.fromCharCode(code)
    }
    return head.trimStart().startsWith('#EXTM3U')
}

export const VIXSRC_PART_PREFIX = '__PART__'

export type HlsRefKind = 'cdn' | 'playlist' | 'key' | 'drop'

export function classifyHlsRef(absolute: string): HlsRefKind {
    if (!isAllowedHlsUrl(absolute)) return 'drop'
    const url = new URL(absolute)
    if (isVixsrcCdnHost(url.hostname)) return 'cdn'
    if (url.pathname.includes('/storage/') || url.pathname.endsWith('.key')) return 'key'
    return 'playlist'
}

export function rewriteM3u8Browser(
    body: string,
    sourceUrl: string,
    resolveRef: (absolute: string, kind: Exclude<HlsRefKind, 'drop'>) => string
): string {
    return body
        .split(/\r?\n/)
        .map((line) => {
            const trimmed = line.trim()
            if (!trimmed) return line
            if (trimmed.startsWith('#')) {
                return line.replace(/URI="([^"]+)"/gi, (_match, uri: string) => {
                    const absolute = new URL(uri, sourceUrl).toString()
                    const kind = classifyHlsRef(absolute)
                    if (kind === 'drop') return 'URI=""'
                    return `URI="${resolveRef(absolute, kind)}"`
                })
            }
            const absolute = resolvePlaylistRef(trimmed, sourceUrl)
            if (!absolute) return ''
            const kind = classifyHlsRef(absolute)
            if (kind === 'drop') return ''
            return resolveRef(absolute, kind)
        })
        .join('\n')
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
}

/** Unix seconds o millisecondi da `expires=` nelle URL HLS. */
export function readHlsTokenExpiryMs(text: string): number | null {
    const match = text.match(/[?&]expires=(\d+)/)
    if (!match) return null
    const raw = Number(match[1])
    if (!Number.isFinite(raw) || raw <= 0) return null
    return raw > 1e12 ? raw : raw * 1000
}

export function readStreamTokenExpiryMs(stream: { master: string; parts?: Record<string, string> }): number | null {
    const fromMaster = readHlsTokenExpiryMs(stream.master)
    if (fromMaster) return fromMaster
    for (const part of Object.values(stream.parts ?? {})) {
        const expiry = readHlsTokenExpiryMs(part)
        if (expiry) return expiry
    }
    return null
}

/** Attesa prima di rinfrescare i token, 30s prima della scadenza. Null se è troppo tardi. */
export function msUntilHlsRefresh(expiryMs: number, now = Date.now(), leadMs = 30_000): number | null {
    const wait = expiryMs - leadMs - now
    return wait >= 8_000 ? wait : null
}

export function createVixsrcBrowserSource(input: {
    master: string
    parts: Record<string, string>
    origin?: string
}) {
    const created: string[] = []
    let master = normalizeVixsrcCdnInManifest(input.master)
    for (const [id, text] of Object.entries(input.parts)) {
        const normalized = normalizeVixsrcCdnInManifest(text)
        const url = URL.createObjectURL(new Blob([normalized], { type: 'application/vnd.apple.mpegurl' }))
        created.push(url)
        master = master.split(`${VIXSRC_PART_PREFIX}${id}.m3u8`).join(url)
    }
    const masterUrl = URL.createObjectURL(new Blob([master], { type: 'application/vnd.apple.mpegurl' }))
    created.push(masterUrl)
    return {
        url: masterUrl,
        revoke: () => {
            for (const url of created) URL.revokeObjectURL(url)
        },
    }
}
