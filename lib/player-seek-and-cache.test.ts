import { describe, expect, it, vi } from 'vitest'
import { HLS_CONFIG } from '@/utils/hls-config'
import { readStreamTokenExpiryMs } from '@/lib/vixsrc-hls'
import { prefetchPlayback } from '@/lib/player-prefetch'

describe('Player Seek & Cache Robustness Suite', () => {
    describe('HLS_CONFIG parameters for seeking and buffer recovery', () => {
        it('has maxBufferHole configured to prevent freezing on keyframe timestamp gaps', () => {
            expect(HLS_CONFIG.maxBufferHole).toBe(0.5)
        })

        it('has nudge properties enabled to auto-advance past MPEG-TS keyframe gaps', () => {
            expect(HLS_CONFIG.nudgeOffset).toBe(0.2)
            expect(HLS_CONFIG.nudgeMaxRetry).toBe(5)
            expect(HLS_CONFIG.nudgeOnVideoHole).toBe(true)
        })

        it('has extended fragment loading timeouts to allow slow CDNs to respond on long seeks', () => {
            expect(HLS_CONFIG.fragLoadingTimeOut).toBe(25000)
            expect(HLS_CONFIG.fragLoadingMaxRetry).toBe(6)
            expect(HLS_CONFIG.fragLoadingRetryDelay).toBe(1000)
        })
    })

    describe('Cache TTL and Token Expiry Calculation', () => {
        it('extracts token expiry correctly from playlist query param', () => {
            const nowSeconds = Math.floor(Date.now() / 1000)
            const futureExpires = nowSeconds + 7200 // 2 hours
            const stream = {
                master: `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nhttps://vix-content.net/hls/test.m3u8?token=abc&expires=${futureExpires}`,
            }
            const expiry = readStreamTokenExpiryMs(stream)
            expect(expiry).toBe(futureExpires * 1000)
        })

        it('calculates safe TTL bounded by 2 hours and token expiration', () => {
            const CACHE_TTL_SECONDS = 7200
            const now = Date.now()
            // Token expiring in 30 minutes
            const expiry30m = now + 1800 * 1000
            const calculatedTtl = Math.max(60, Math.min(CACHE_TTL_SECONDS, Math.floor((expiry30m - now - 60_000) / 1000)))
            expect(calculatedTtl).toBeLessThan(1800)
            expect(calculatedTtl).toBeGreaterThan(1600)

            // Token expiring in 4 hours
            const expiry4h = now + 14400 * 1000
            const calculatedTtlLong = Math.max(60, Math.min(CACHE_TTL_SECONDS, Math.floor((expiry4h - now - 60_000) / 1000)))
            expect(calculatedTtlLong).toBe(CACHE_TTL_SECONDS)
        })
    })

    describe('prefetchPlayback pre-warm helper', () => {
        it('calls fetch with correct URLSearchParams for movies', () => {
            const fetchSpy = vi.fn().mockResolvedValue(new Response('{}'))
            global.fetch = fetchSpy

            prefetchPlayback({ id: 550, type: 'movie' })

            expect(fetchSpy).toHaveBeenCalledTimes(1)
            const calledUrl = fetchSpy.mock.calls[0][0]
            expect(calledUrl).toContain('/api/player/resolve?tmdbId=550&type=movie')
        })

        it('calls fetch with correct URLSearchParams for TV episodes', () => {
            const fetchSpy = vi.fn().mockResolvedValue(new Response('{}'))
            global.fetch = fetchSpy

            prefetchPlayback({ id: 1399, type: 'tv', season: 2, episode: 5 })

            expect(fetchSpy).toHaveBeenCalledTimes(1)
            const calledUrl = fetchSpy.mock.calls[0][0]
            expect(calledUrl).toContain('/api/player/resolve?tmdbId=1399&type=tv&season=2&episode=5')
        })

        it('does not throw when fetch fails', () => {
            const fetchSpy = vi.fn().mockRejectedValue(new Error('Network offline'))
            global.fetch = fetchSpy

            expect(() => prefetchPlayback({ id: 123, type: 'movie' })).not.toThrow()
        })
    })
})
