import { describe, it, expect } from 'vitest'
import { getHlsConfigForDevice, HLS_CONFIG, scoreAudioTrack } from '@/utils/hls-config'
import fs from 'fs'

describe('TV Player Audio Quality & Media Error Recovery Suite', () => {
    describe('Audio Track Scoring & Multi-Channel Prioritization', () => {
        it('assigns higher score to higher bitrate audio tracks', () => {
            const trackLow = { id: 0, lang: 'ita', bitrate: 128000, channels: 2 }
            const trackHigh = { id: 1, lang: 'ita', bitrate: 384000, channels: 2 }

            expect(scoreAudioTrack(trackHigh)).toBeGreaterThan(scoreAudioTrack(trackLow))
        })

        it('assigns large bonus to 5.1 / surround sound audio tracks', () => {
            const trackStereo = { id: 0, lang: 'ita', bitrate: 256000, channels: 2 }
            const trackSurround = { id: 1, lang: 'ita', bitrate: 256000, channels: 6, name: 'Italian 5.1' }

            expect(scoreAudioTrack(trackSurround)).toBeGreaterThan(scoreAudioTrack(trackStereo) + 1000)
        })

        it('detects Dolby, AC-3, E-AC3 keywords and prioritizes them', () => {
            const standard = { id: 0, lang: 'ita', bitrate: 192000, channels: 2, name: 'Italian' }
            const dolby = { id: 1, lang: 'ita', bitrate: 192000, channels: 2, name: 'Italian Dolby Digital (AC-3)' }

            expect(scoreAudioTrack(dolby)).toBeGreaterThan(scoreAudioTrack(standard))
        })

        it('handles null or missing track metadata safely and parses 5.1 channels correctly', () => {
            expect(scoreAudioTrack(null)).toBe(-1)
            expect(scoreAudioTrack({})).toBe(0)
            expect(scoreAudioTrack({ channels: '5.1' })).toBeGreaterThanOrEqual(1000)
            expect(scoreAudioTrack({ channels: 6 })).toBeGreaterThanOrEqual(1000)
        })
    })

    describe('Smart TV (webOS) Buffer & Decoder Protection', () => {
        it('ensures Smart TV config stays strictly within safe MSE memory limits', () => {
            const originalDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator')
            try {
                Object.defineProperty(global, 'navigator', {
                    value: { userAgent: 'Mozilla/5.0 (Web0S; SmartTV) AppleWebKit/537.36' },
                    configurable: true,
                    writable: true
                })
                const config = getHlsConfigForDevice()
                expect(config.maxBufferLength).toBe(20)
                expect(config.maxMaxBufferLength).toBe(40)
                expect(config.backBufferLength).toBe(10)
                expect(config.maxBufferHole).toBe(0.8)
                expect(config.maxAudioFramesDrift).toBe(1)
                expect(config.forceKeyFrameOnDiscontinuity).toBe(true)
                expect(config.enableSoftwareAES).toBe(true)
            } finally {
                if (originalDescriptor) {
                    Object.defineProperty(global, 'navigator', originalDescriptor)
                }
            }
        })
    })

    describe('Verification of public/tv-os.html Runtime Protections', () => {
        const html = fs.readFileSync('public/tv-os.html', 'utf8')

        it('includes scoreAudioTrack and setupAudioOptimization in tv-os.html', () => {
            expect(html).toContain('function scoreAudioTrack')
            expect(html).toContain('function setupAudioOptimization')
            expect(html).toContain('setupAudioOptimization(hls, video)')
        })

        it('implements 3-tier media error recovery without premature playback abort', () => {
            expect(html).toContain('mediaErrorInRow === 1')
            expect(html).toContain('hls.recoverMediaError()')
            expect(html).toContain('mediaErrorInRow === 2')
            expect(html).toContain('hls.swapAudioCodec()')
            expect(html).toContain('mediaErrorInRow <= 5')
            expect(html).toContain('hls.currentLevel = lower')
        })

        it('delegates native video errors to Hls.js instead of showing fail screen', () => {
            const errorBlock = html.substring(html.indexOf("video.addEventListener('error'"), html.indexOf("video.addEventListener('error'") + 250)
            expect(errorBlock).toContain('if (video._tvHls)')
            expect(errorBlock).toContain('return;')
        })

        it('prevents fallbackNative from loading blob URLs on webOS native player', () => {
            const fallbackBlock = html.substring(html.indexOf('function fallbackNative'), html.indexOf('function fallbackNative') + 300)
            expect(fallbackBlock).toContain("source.url.indexOf('blob:') === 0")
        })

        it('resets error counters after stable playback period', () => {
            expect(html).toContain("video.addEventListener('playing'")
            expect(html).toContain('mediaErrorInRow = 0')
        })
    })
})
