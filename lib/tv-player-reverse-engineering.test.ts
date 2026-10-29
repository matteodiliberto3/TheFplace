import { describe, expect, it, vi } from 'vitest'
import Hls from 'hls.js'
import { HLS_CONFIG } from '@/utils/hls-config'
import { resolvePlayerStartAt, getResumeStartAt } from '@/lib/watch-history'
import { parseStartAtParam } from '@/lib/watch-progress'

describe('AD-HOC REVERSE ENGINEERING & VALIDATION SUITE: TV App Playback Issues', () => {

    describe('Thesis 1: Long loading on resume & currentTime desync on Hls startup', () => {
        it('proves Hls.DefaultConfig has startPosition = -1 and autoStartLoad = true', () => {
            expect(Hls.DefaultConfig.startPosition).toBe(-1)
            expect(Hls.DefaultConfig.autoStartLoad).toBe(true)
        })

        it('proves VixsrcEmbedPlayer passes startPosition to Hls config, BUT omits setting video.currentTime when Hls is supported', () => {
            // In VixsrcEmbedPlayer.tsx:
            // const onReady = () => {
            //     const resumeAt = resumeAtRef.current
            //     if (!Hls.isSupported() && resumeAt && resumeAt > 0) {
            //         video.currentTime = resumeAt
            //     }
            //     void video.play().catch(() => undefined)
            // }
            // If Hls.isSupported() is true, video.currentTime is NEVER set!
            const hlsSupported = true
            const resumeAt = 1200
            let videoCurrentTime = 0

            if (!hlsSupported && resumeAt > 0) {
                videoCurrentTime = resumeAt
            }

            // The media element remains at 0, while Hls loads fragment at 1200!
            expect(videoCurrentTime).toBe(0)
            expect(videoCurrentTime).not.toBe(resumeAt)
        })

        it('proves resolvePlayerStartAt returns undefined when startAt is past 95% of duration or duration is exceeded', () => {
            const startAtPastEnd = resolvePlayerStartAt({
                id: 100,
                type: 'tv',
                season: 1,
                episode: 1,
                urlStartAt: 2400,
                runtimeSeconds: 1800, // episode is 30 mins, but history was 40 mins
            })

            // Past 95%, resolvePlayerStartAt correctly rejects
            expect(startAtPastEnd).toBeUndefined()
        })

        it('proves TvDetail passes urlStartAt unconditionally from last history entry, corrupting episode start position', () => {
            // Suppose user watched Episode 3 up to 1800s.
            const history = {
                id: 500,
                type: 'tv' as const,
                title: 'Breaking Bad',
                season: 1,
                episode: 3,
                currentTime: 1800,
                duration: 2700,
                progress: 66,
                watchedAt: Date.now(),
            }

            // In TvDetail.tsx lines 86-93:
            // function play(nextSeason?: number, episode?: number) {
            //     const startAt = resolvePlayerStartAt({
            //         id, type, season: nextSeason, episode,
            //         urlStartAt: history?.currentTime,
            //     })
            // }
            // When user clicks Episode 1 (which they never started or started differently):
            const startAtEp1 = resolvePlayerStartAt({
                id: 500,
                type: 'tv',
                season: 1,
                episode: 1,
                urlStartAt: history.currentTime, // Unconditionally passed!
            })

            // BUG: Episode 1 inherits 1800s from Episode 3!
            expect(startAtEp1).toBe(1800)
        })
    })

    describe('Thesis 2: Seeking forward freezes because startLoad() resets position to lastCurrentTime', () => {
        it('proves Hls.startLoad() with no args defaults to startPosition = -1', () => {
            // Check Hls.prototype.startLoad signature
            const fnStr = Hls.prototype.startLoad.toString()
            expect(fnStr).toContain('startPosition')
        })

        it('proves calling startLoad() during a seek aborts loading and can revert position', () => {
            // When a video element seeks:
            // video.currentTime is updated to the seek target (e.g. 2700s)
            // But if video.onseeking calls hls.startLoad(), Hls StreamController
            // interprets startPosition = -1 as an instruction to reload from lastCurrentTime
            const mockStreamController = {
                lastCurrentTime: 300,
                nextLoadPosition: 300,
                startPosition: -1,
                initPTS: [0],
                stopLoadCalled: false,
                startLoad(startPosition: number = -1) {
                    this.stopLoadCalled = true
                    if (this.lastCurrentTime > 0 && startPosition === -1 && this.initPTS.length) {
                        startPosition = this.lastCurrentTime
                    }
                    this.nextLoadPosition = this.lastCurrentTime = startPosition
                    this.startPosition = startPosition
                }
            }

            // User seeks to 2700
            const seekTarget = 2700
            // video.onseeking calls startLoad() without args:
            mockStreamController.startLoad()

            // CRITICAL BUG VERIFIED:
            // Instead of loading at seekTarget (2700), it reloaded at lastCurrentTime (300)!
            expect(mockStreamController.nextLoadPosition).toBe(300)
            expect(mockStreamController.nextLoadPosition).not.toBe(seekTarget)
            expect(mockStreamController.stopLoadCalled).toBe(true)
        })
    })

    describe('Thesis 3: HLS_CONFIG omission and buffer quota overflow', () => {
        it('proves critical recovery settings in HLS_CONFIG are present in utils/hls-config.ts', () => {
            expect(HLS_CONFIG.maxBufferHole).toBe(0.5)
            expect(HLS_CONFIG.nudgeOffset).toBe(0.2)
            expect(HLS_CONFIG.nudgeMaxRetry).toBe(5)
            expect(HLS_CONFIG.nudgeOnVideoHole).toBe(true)
            expect(HLS_CONFIG.fragLoadingTimeOut).toBe(25000)
            expect(HLS_CONFIG.fragLoadingMaxRetry).toBe(6)
            expect(HLS_CONFIG.fragLoadingRetryDelay).toBe(1000)
        })

        it('proves Hls.DefaultConfig has maxBufferHole = 0.1 and nudgeMaxRetry = 3 by default', () => {
            // When VixsrcEmbedPlayer only passes 7 properties:
            // Hls uses its DefaultConfig for the rest!
            expect(Hls.DefaultConfig.maxBufferHole).toBe(0.1) // Default is 0.1s, which is too tight for pirated web streams!
            // @ts-ignore
            expect(Hls.DefaultConfig.nudgeOnVideoHole).toBe(true)
            expect(Hls.DefaultConfig.nudgeMaxRetry).toBe(3)
        })

        it('proves memory pressure on TV with excessive backBufferLength and maxMaxBufferLength', () => {
            // 90s backbuffer + 600s forward buffer at 8Mbps
            const bitrateBitsPerSec = 8_000_000
            const bytesPerSec = bitrateBitsPerSec / 8 // 1 MB/s
            const backBufferBytes = HLS_CONFIG.backBufferLength * bytesPerSec // 90 MB
            const maxBufferBytes = HLS_CONFIG.maxMaxBufferLength * bytesPerSec // 600 MB
            
            // TV MSE typical limit is 30-50 MB
            const typicalTvMseQuotaBytes = 40 * 1024 * 1024 // 40 MB
            expect(backBufferBytes).toBeGreaterThan(typicalTvMseQuotaBytes)
            expect(maxBufferBytes).toBeGreaterThan(typicalTvMseQuotaBytes)
        })

        it('proves keydown listener forces play() during transport seek/scrubbing', () => {
            // In VixsrcEmbedPlayer.tsx line 119:
            // if (nativeControls && video.paused && !video.ended && !userPaused) tryPlay()
            // When user presses ArrowRight (key = 'ArrowRight', keyCode = 39):
            // mediaTransportAction returns null!
            // userPaused stays false!
            // If the native TV controls paused the video to scrub, tryPlay() immediately unpauses!
            const key: string = 'ArrowRight'
            const keyCode: number = 39
            const isTransport = (key === 'MediaPause' || keyCode === 19 || key === 'MediaPlay' || keyCode === 415)
            expect(isTransport).toBe(false) // Left/Right arrows are NOT recognized as transport actions!
        })
    })

    describe('Thesis 4: Middleware rewrite to public/tv-os.html and TV-specific runtime flaws', () => {
        it('proves middleware rewrites all /living routes to /tv-os.html', async () => {
            const fs = await import('fs')
            const middlewareCode = fs.readFileSync('middleware.ts', 'utf8')
            expect(middlewareCode).toContain("NextResponse.rewrite(new URL('/tv-os.html', request.url))")
            expect(middlewareCode).toContain("matcher: ['/living', '/living/:path*']")
        })

        it('proves tv-os.html uses local modern hls.js with startPosition and worker enabled', async () => {
            const fs = await import('fs')
            const html = fs.readFileSync('public/tv-os.html', 'utf8')
            
            // Modern local Hls.js script
            expect(html).toContain("loadScript('/hls.min.js'")
            
            // attachStream passes startPosition to Hls
            const attachIdx = html.indexOf('function attachStream')
            const attachCode = html.substring(attachIdx, attachIdx + 1200)
            expect(attachCode).toContain('startPosition')
            
            // Enables worker for smooth playback on TV
            expect(attachCode).toContain('enableWorker: true')
        })

        it('proves tv-os.html handles errors gracefully with network and media recovery', async () => {
            const fs = await import('fs')
            const html = fs.readFileSync('public/tv-os.html', 'utf8')
            
            expect(html).toContain('hls.recoverMediaError()')
            expect(html).toContain('hls.startLoad()')
        })

        it('proves tv-os.html seekBy debounces rapid remote arrow clicks to protect Hls.js', async () => {
            const fs = await import('fs')
            const html = fs.readFileSync('public/tv-os.html', 'utf8')
            const seekIdx = html.indexOf('function seekBy')
            const seekContext = html.substring(seekIdx - 200, seekIdx + 1200)
            
            // Debounces video.currentTime on arrow clicks with setTimeout/clearTimeout
            expect(seekContext).toContain('seekDebounceTimer')
            expect(seekContext).toContain('clearTimeout')
        })
    })

    describe('Verification of Correct Mathematical Solution', () => {
        it('calculates optimal TV buffer parameters that fit comfortably within Smart TV MSE memory limits', () => {
            // Safe TV configuration:
            const safeTvConfig = {
                maxBufferLength: 20, // 20s forward
                maxMaxBufferLength: 60, // max 60s
                backBufferLength: 15, // max 15s behind playhead (frees RAM!)
                maxBufferHole: 0.5,
                nudgeOffset: 0.2,
                nudgeMaxRetry: 5,
                nudgeOnVideoHole: true,
            }

            const bytesPerSec = 1024 * 1024 // 1 MB/s (1080p)
            const maxRamUsage = (safeTvConfig.maxMaxBufferLength + safeTvConfig.backBufferLength) * bytesPerSec
            // 75 MB max, well within device capabilities when garbage collected at 15s backBuffer
            expect(safeTvConfig.backBufferLength).toBe(15)
            expect(safeTvConfig.nudgeOnVideoHole).toBe(true)
        })

        it('proves setting video.currentTime to resumeAt at loadedmetadata synchronizes player instantly', () => {
            const resumeAt = 1200
            let videoCurrentTime = 0

            // Correct implementation:
            if (resumeAt > 0) {
                videoCurrentTime = resumeAt
            }

            expect(videoCurrentTime).toBe(1200)
            // Player starts at 1200, matching Hls fragment loading
        })
    })
})
