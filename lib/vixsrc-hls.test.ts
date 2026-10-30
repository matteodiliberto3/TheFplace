import { describe, expect, it } from 'vitest'
import {
    VIXSRC_PART_PREFIX,
    buildHomeRelayFetchUrl,
    buildVixsrcPlaylistUrl,
    classifyHlsRef,
    isAllowedHlsUrl,
    isAllowedRelayPublicUrl,
    isHlsManifestBuffer,
    isM3u8Playlist,
    msUntilHlsRefresh,
    normalizeVixsrcCdnInManifest,
    normalizeVixsrcCdnUrl,
    readHlsTokenExpiryMs,
    readStreamTokenExpiryMs,
    parseVixsrcApiSrc,
    parseVixsrcEmbedHtml,
    hlsStreamLooksPlayable,
    rewriteEdgeCdnThroughProxy,
    rewriteM3u8,
    rewriteM3u8Browser,
    shouldProxyVixsrcCdn,
} from './vixsrc-hls'

const embedHtml = `
        window.video = {
            id: '170060',
            filename: '',
        };
        window.masterPlaylist = {
            params: {
                'token': 'abc123',
                'expires': '1794259445',
                'asn': '',
            },
            url: 'https://vixsrc.to/playlist/170060?b=1',
        }
        window.canPlayFHD = true
        <script>(function(s){s.dataset.zone='10874703',s.src='https://spbgc.com/tag.min.js'})</script>
`

describe('parseVixsrcApiSrc', () => {
    it('legge src da JSON, Jina e AllOrigins', () => {
        expect(parseVixsrcApiSrc('{"src":"\\/embed\\/1?token=a"}')).toBe('/embed/1?token=a')
        expect(parseVixsrcApiSrc('Title:\n\nMarkdown Content:\n{"src":"\\/embed\\/2"}')).toBe('/embed/2')
        expect(parseVixsrcApiSrc('{"contents":"{\\"src\\":\\"/embed/3\\"}"}')).toBe('/embed/3')
        expect(
            parseVixsrcApiSrc(
                '<pre>{"src":"\\/embed\\/777603?token=abc&amp;expires=1&amp;lang=it"}</pre>'
            )
        ).toBe('/embed/777603?token=abc&expires=1&lang=it')
    })
})

describe('parseVixsrcEmbedHtml', () => {
    it('legge token, playlist e id senza eseguire lo script ads', () => {
        expect(parseVixsrcEmbedHtml(embedHtml)).toEqual({
            url: 'https://vixsrc.to/playlist/170060?b=1',
            token: 'abc123',
            expires: '1794259445',
            canPlayFHD: true,
            videoId: 170060,
        })
    })

    it('torna null se manca la playlist', () => {
        expect(parseVixsrcEmbedHtml('<script>window.canPlayFHD = true</script>')).toBeNull()
    })
})

describe('buildVixsrcPlaylistUrl', () => {
    it('firma la playlist come fa lo skin VixSrc', () => {
        const url = buildVixsrcPlaylistUrl({
            url: 'https://vixsrc.to/playlist/170060?b=1',
            token: 'abc123',
            expires: '1794259445',
            canPlayFHD: true,
        })
        const parsed = new URL(url)
        expect(parsed.origin + parsed.pathname).toBe('https://vixsrc.to/playlist/170060')
        expect(parsed.searchParams.get('b')).toBe('1')
        expect(parsed.searchParams.get('token')).toBe('abc123')
        expect(parsed.searchParams.get('expires')).toBe('1794259445')
        expect(parsed.searchParams.get('h')).toBe('1')
        expect(parsed.searchParams.get('lang')).toBe('it')
    })
})

describe('buildHomeRelayFetchUrl', () => {
    it('firma solo host VixSrc verso il relay di casa', () => {
        expect(buildHomeRelayFetchUrl('https://relay.example', 'https://vixsrc.to/api/movie/1')).toBe(
            'https://relay.example/fetch?u=' + encodeURIComponent('https://vixsrc.to/api/movie/1')
        )
        expect(buildHomeRelayFetchUrl('https://relay.example', 'https://spbgc.com/x')).toBeNull()
    })
})

describe('isAllowedRelayPublicUrl', () => {
    it('accetta solo hostname Cloudflare del tunnel di casa', () => {
        expect(isAllowedRelayPublicUrl('https://abc.trycloudflare.com')).toBe(true)
        expect(isAllowedRelayPublicUrl('http://abc.trycloudflare.com')).toBe(false)
        expect(isAllowedRelayPublicUrl('https://evil.example')).toBe(false)
    })
})

describe('isAllowedHlsUrl', () => {
    it('accetta solo host VixSrc / CDN film', () => {
        expect(isAllowedHlsUrl('https://vixsrc.to/playlist/1')).toBe(true)
        expect(isAllowedHlsUrl('https://sc-u11-01.vix-content.net/hls/a.ts')).toBe(true)
        expect(isAllowedHlsUrl('https://sc-u2-01.swiftsalmon96.fun/hls/a.html')).toBe(true)
        expect(isAllowedHlsUrl('https://sc-u17-01.redzebra93.fun/hls/a.m4s')).toBe(true)
        expect(isAllowedHlsUrl('https://sc-u15-01.frozenfox90.fun/hls/a.m4s')).toBe(true)
        expect(isAllowedHlsUrl('https://sc-u15-01.blueorca88.xyz/hls/a.m4s')).toBe(true)
        expect(isAllowedHlsUrl('https://swiftsalmon96.fun/hls/a.html')).toBe(false)
        expect(isAllowedHlsUrl('https://spbgc.com/tag.min.js')).toBe(false)
        expect(isAllowedHlsUrl('https://evil.example/playlist')).toBe(false)
        expect(isAllowedHlsUrl('http://vixsrc.to/playlist/1')).toBe(false)
    })
})

describe('rewriteM3u8', () => {
    it('riscrive URI e varianti verso il proxy, scarta host esterni', () => {
        const source = 'https://vixsrc.to/playlist/170060?b=1'
        const body = [
            '#EXTM3U',
            '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://vixsrc.to/playlist/170060?type=audio"',
            '#EXT-X-STREAM-INF:BANDWIDTH=1000',
            'https://vixsrc.to/playlist/170060?type=video&rendition=720p',
            'https://spbgc.com/ad.ts',
        ].join('\n')

        const rewritten = rewriteM3u8(body, source, '/api/player/hls?u=')
        expect(rewritten).toContain(
            `URI="/api/player/hls?u=${encodeURIComponent('https://vixsrc.to/playlist/170060?type=audio')}"`
        )
        expect(rewritten).toContain(
            `/api/player/hls?u=${encodeURIComponent('https://vixsrc.to/playlist/170060?type=video&rendition=720p')}`
        )
        expect(rewritten).not.toContain('spbgc.com')
    })

    it('proxano ancora playlist e chiavi, non i segmenti', () => {
        const source = 'https://vixsrc.to/playlist/1'
        const body = [
            '#EXTM3U',
            '#EXT-X-KEY:METHOD=AES-128,URI="https://vixsrc.to/storage/enc.key"',
            '#EXT-X-STREAM-INF:BANDWIDTH=1000',
            'https://vixsrc.to/playlist/1?type=video',
            'https://sc-u15-01.blueorca88.xyz/hls/a.m4s',
        ].join('\n')
        const rewritten = rewriteM3u8(body, source, '/api/player/hls?u=')
        expect(rewritten).toContain(
            `URI="/api/player/hls?u=${encodeURIComponent('https://vixsrc.to/storage/enc.key')}"`
        )
        expect(rewritten).toContain(
            `/api/player/hls?u=${encodeURIComponent('https://vixsrc.to/playlist/1?type=video')}`
        )
        expect(rewritten).toContain('https://sc-u15-01.blueorca88.xyz/hls/a.ts')
        expect(rewritten).not.toContain(
            `/api/player/hls?u=${encodeURIComponent('https://sc-u15-01.vix-content.net/hls/a.ts')}`
        )
    })

    it('mantiene i segmenti sugli edge ruotati preservando l\'host Cloudflare senza passare dal proxy', () => {
        const source = 'https://vixsrc.to/playlist/1'
        const body = ['#EXTM3U', '#EXTINF:4,', 'https://sc-u15-01.blueorca88.xyz/hls/a.m4s'].join('\n')
        const rewritten = rewriteM3u8(body, source, '/api/player/hls?u=')
        expect(rewritten).toContain('https://sc-u15-01.blueorca88.xyz/hls/a.ts')
        expect(rewritten).not.toContain('/api/player/hls')
    })
})

describe('normalizeVixsrcCdnUrl', () => {
    it('preserva l\'host Cloudflare del TLD ruotato e ripristina estensione .ts', () => {
        expect(normalizeVixsrcCdnUrl('https://sc-u14-01.nobletiger60.boats/hls/video/0000.html?token=abc')).toBe(
            'https://sc-u14-01.nobletiger60.boats/hls/video/0000.ts?token=abc'
        )
        expect(normalizeVixsrcCdnUrl('https://sc-u11-01.bravecastle98.boats/hls/audio/0001.m4s')).toBe(
            'https://sc-u11-01.bravecastle98.boats/hls/audio/0001.ts'
        )
        expect(normalizeVixsrcCdnUrl('https://sc-u14-01.vix-content.net/hls/video/0000.ts')).toBe(
            'https://sc-u14-01.vix-content.net/hls/video/0000.ts'
        )
    })

    it('normalizza intere playlist m3u8 con normalizeVixsrcCdnInManifest', () => {
        const input = '#EXTINF:4,\nhttps://sc-u11-01.bravecastle98.boats/hls/audio/0000.html?token=x'
        const output = normalizeVixsrcCdnInManifest(input)
        expect(output).toBe('#EXTINF:4,\nhttps://sc-u11-01.bravecastle98.boats/hls/audio/0000.ts?token=x')
    })
})

describe('classifyHlsRef', () => {
    it('separa CDN, playlist, chiave e host esterni', () => {
        expect(classifyHlsRef('https://sc-u10-01.vix-content.net/hls/a.ts')).toBe('cdn')
        expect(classifyHlsRef('https://sc-u2-01.swiftsalmon96.fun/hls/a.html')).toBe('cdn')
        expect(classifyHlsRef('https://sc-u15-01.blueorca88.xyz/hls/a.m4s')).toBe('cdn')
        expect(classifyHlsRef('https://vixsrc.to/playlist/1?type=video')).toBe('playlist')
        expect(classifyHlsRef('https://vixsrc.to/storage/enc.key')).toBe('key')
        expect(classifyHlsRef('https://spbgc.com/ad.ts')).toBe('drop')
    })
})

describe('rewriteM3u8Browser', () => {
    it('lascia i segmenti sul CDN, inlinea la chiave e marca le playlist figlie', () => {
        const source = 'https://vixsrc.to/playlist/170060?type=video'
        const body = [
            '#EXTM3U',
            '#EXT-X-KEY:METHOD=AES-128,URI="https://vixsrc.to/storage/enc.key"',
            '#EXTINF:8,',
            'https://sc-u10-01.vix-content.net/hls/0000.ts?token=abc',
            'https://spbgc.com/ad.ts',
        ].join('\n')

        const rewritten = rewriteM3u8Browser(body, source, (absolute, kind) => {
            if (kind === 'cdn') return absolute
            if (kind === 'key') return 'data:application/octet-stream;base64,QQ=='
            return `${VIXSRC_PART_PREFIX}p0`
        })

        expect(rewritten).toContain('URI="data:application/octet-stream;base64,QQ=="')
        expect(rewritten).toContain('https://sc-u10-01.vix-content.net/hls/0000.ts?token=abc')
        expect(rewritten).not.toContain('spbgc.com')
        expect(rewritten).not.toContain('/api/player/hls')
    })

    it('tiene i segmenti sugli edge ruotati di VixSrc, qualunque TLD', () => {
        const source = 'https://vixsrc.to/playlist/629782?type=video'
        const body = [
            '#EXTM3U',
            '#EXTINF:8,',
            'https://sc-u15-01.blueorca88.xyz/hls/0000.html?token=abc',
        ].join('\n')

        const rewritten = rewriteM3u8Browser(body, source, (absolute, kind) => {
            if (kind === 'cdn') return absolute
            return `${VIXSRC_PART_PREFIX}p0`
        })

        expect(rewritten).toContain('https://sc-u15-01.blueorca88.xyz/hls/0000.html?token=abc')
    })
})

describe('hlsStreamLooksPlayable', () => {
    it('scarta playlist con EXTINF senza URL di segmenti', () => {
        const emptyInf = ['#EXTM3U', '#EXTINF:4,', '', '#EXTINF:4,', '', '#EXTINF:4,', ''].join('\n')
        expect(hlsStreamLooksPlayable({ parts: { p0: emptyInf.repeat(4) } })).toBe(false)
    })

    it('accetta una media playlist con segmenti https', () => {
        const lines = ['#EXTM3U']
        for (let i = 0; i < 8; i++) {
            lines.push('#EXTINF:4,', 'https://sc-u15-01.frozenfox90.fun/hls/a.m4s')
        }
        expect(hlsStreamLooksPlayable({ parts: { p0: lines.join('\n') } })).toBe(true)
    })
})

describe('rewriteEdgeCdnThroughProxy', () => {
    it('non proxano i segmenti: restano sul CDN di origine', () => {
        const body = [
            'https://sc-u2-01.swiftsalmon96.fun/hls/0000.html?token=abc',
            'https://sc-u15-01.blueorca88.xyz/hls/0000.m4s?token=abc',
            'https://sc-b2-28.vix-content.net/hls/0000.ts?token=abc',
        ].join('\n')

        const rewritten = rewriteEdgeCdnThroughProxy(body, 'https://the-hustle-place.vercel.app')
        expect(shouldProxyVixsrcCdn('https://sc-u2-01.swiftsalmon96.fun/hls/0000.html')).toBe(false)
        expect(shouldProxyVixsrcCdn('https://sc-u15-01.blueorca88.xyz/hls/0000.m4s')).toBe(false)
        expect(shouldProxyVixsrcCdn('https://sc-b2-28.vix-content.net/hls/0000.ts')).toBe(false)
        expect(rewritten).toBe(body)
        expect(rewritten).not.toContain('/api/player/hls')
    })
})

describe('readHlsTokenExpiryMs', () => {
    it('legge expires unix e calcola quando rinfrescare', () => {
        expect(readHlsTokenExpiryMs('https://cdn.example/a.ts?token=a&expires=1700000000')).toBe(1_700_000_000_000)
        expect(readHlsTokenExpiryMs('#EXTM3U\nhttps://cdn.example/a.ts')).toBeNull()
        expect(
            readStreamTokenExpiryMs({
                master: '#EXTM3U',
                parts: { p0: 'https://cdn.example/a.ts?expires=1700000000' },
            })
        ).toBe(1_700_000_000_000)
        expect(msUntilHlsRefresh(10_000_000, 9_960_000)).toBe(10_000)
        expect(msUntilHlsRefresh(10_000_000, 9_995_000)).toBeNull()
    })
})

describe('isM3u8Playlist', () => {
    it('riconosce il manifest dal content-type o dal body', () => {
        expect(isM3u8Playlist('application/vnd.apple.mpegurl', 'nope')).toBe(true)
        expect(isM3u8Playlist('application/octet-stream', '#EXTM3U\n#EXT-X-VERSION:3')).toBe(true)
        expect(isM3u8Playlist('video/MP2T', 'binary')).toBe(false)
        expect(isM3u8Playlist('text/html', '<!doctype html>')).toBe(false)
        expect(isHlsManifestBuffer(new Uint8Array([0x23, 0x45, 0x58, 0x54, 0x4d, 0x33, 0x55]))).toBe(true)
        expect(isHlsManifestBuffer(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe(false)
    })
})
