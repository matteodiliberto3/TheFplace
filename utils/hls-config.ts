import { isWebosUserAgent } from '@/tv/lib/paths'

// HLS.js configuration utility
// This helps reduce debug noise and improve performance

export const HLS_CONFIG = {
    // Disable debug logs in production
    debug: process.env.NODE_ENV === 'development',

    // Performance optimizations
    enableWorker: true,
    enableSoftwareAES: true,

    // Error handling
    maxLoadingDelay: 4,
    maxBufferLength: 30,
    maxMaxBufferLength: 600,

    // Network optimizations
    lowLatencyMode: false,
    backBufferLength: 90,

    // Adaptive Bitrate (ABR) intelligente e resiliente
    testBandwidth: true,
    capLevelToPlayerSize: true,
    abrEwmaDefaultEstimate: 3_000_000,
    abrBandWidthFactor: 0.85,
    abrBandWidthUpFactor: 0.7,
    abrMaxWithRealBitrate: true,

    // Seek & buffer gap recovery
    maxBufferHole: 0.5,
    highBufferWatchdogPeriod: 2,
    nudgeOffset: 0.2,
    nudgeMaxRetry: 5,
    nudgeOnVideoHole: true,
    maxFragLookUpTolerance: 0.25,
    fragLoadingTimeOut: 25000,
    manifestLoadingTimeOut: 45000,
    levelLoadingTimeOut: 45000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1000,

    // Audio fidelity & sync optimizations
    maxAudioFramesDrift: 1,
    forceKeyFrameOnDiscontinuity: true,

    // Reduce console noise
    verbose: process.env.NODE_ENV === 'development',

    // Custom error handler
    onError: (event: any, data: any) => {
        if (process.env.NODE_ENV === 'development') {
            console.warn('HLS.js Error:', data)
        }
    }
}

/** Configurazione ottimizzata per Smart TV (webOS / Tizen) o Mobile (smartphone/tablet su rete cellulare) */
export function getHlsConfigForDevice() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    const isTV = isWebosUserAgent(ua)
    if (isTV) {
        return {
            ...HLS_CONFIG,
            // Su Smart TV limitiamo la memoria buffer per evitare crash del media engine
            maxBufferLength: 20,
            maxMaxBufferLength: 40,
            backBufferLength: 10,
            nudgeMaxRetry: 8,
            maxBufferHole: 0.8,
            maxAudioFramesDrift: 1,
            forceKeyFrameOnDiscontinuity: true,
            enableSoftwareAES: true,
        }
    }

    const isTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1
    const isSmall = typeof window !== 'undefined' && window.innerWidth <= 820
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (isTouch && isSmall)

    if (isMobile) {
        return {
            ...HLS_CONFIG,
            capLevelToPlayerSize: true,
            abrEwmaDefaultEstimate: 1_200_000,
            maxBufferLength: 15,
            maxMaxBufferLength: 30,
            backBufferLength: 10,
            fragLoadingTimeOut: 15000,
            manifestLoadingTimeOut: 15000,
            levelLoadingTimeOut: 15000,
            fragLoadingMaxRetry: 4,
            fragLoadingRetryDelay: 500,
            maxBufferHole: 0.5,
            nudgeOnVideoHole: true,
        }
    }

    return HLS_CONFIG
}

let originalConsoleLog: typeof console.log | null = null
let originalConsoleWarn: typeof console.warn | null = null
let originalConsoleError: typeof console.error | null = null

// Function to configure HLS.js globally
export function configureHLS() {
    if (typeof window !== 'undefined') {
        // Suppress HLS.js debug logs in production
        if (process.env.NODE_ENV === 'production' && !originalConsoleLog) {
            originalConsoleLog = console.log
            originalConsoleWarn = console.warn
            originalConsoleError = console.error

            console.log = function (...args) {
                if (args[0] && typeof args[0] === 'string' && args[0].includes('[HLS]')) {
                    return
                }
                originalConsoleLog?.apply(console, args)
            }

            console.warn = function (...args) {
                if (args[0] && typeof args[0] === 'string' && args[0].includes('[HLS]')) {
                    return
                }
                originalConsoleWarn?.apply(console, args)
            }

            console.error = function (...args) {
                if (args[0] && typeof args[0] === 'string' && args[0].includes('[HLS]')) {
                    return
                }
                originalConsoleError?.apply(console, args)
            }
        }
    }
}

// Function to clean up HLS.js configuration
export function cleanupHLS() {
    if (typeof window !== 'undefined' && originalConsoleLog) {
        console.log = originalConsoleLog
        if (originalConsoleWarn) console.warn = originalConsoleWarn
        if (originalConsoleError) console.error = originalConsoleError
        originalConsoleLog = null
        originalConsoleWarn = null
        originalConsoleError = null
    }
}

export function scoreAudioTrack(track: any): number {
    if (!track) return -1
    let score = 0
    const bitrate = Number(track.bitrate) || 0
    if (bitrate > 0) {
        score += Math.round(bitrate / 1000)
    }
    let ch = 0
    if (track.channels) {
        const chStr = String(track.channels)
        if (chStr.includes('5.1')) {
            ch = 6
        } else if (chStr.includes('7.1')) {
            ch = 8
        } else {
            ch = parseInt(chStr, 10) || 2
        }
    }
    if (ch >= 6) {
        score += 1000
    } else if (ch >= 2) {
        score += 100
    }
    const text = (String(track.name || '') + ' ' + String(track.audioCodec || '')).toLowerCase()
    if (text.includes('5.1') || text.includes('surround')) score += 500
    if (text.includes('dolby') || text.includes('ac-3') || text.includes('ec-3') || text.includes('eac3')) score += 400
    if (text.includes('hq') || text.includes('high') || text.includes('hd')) score += 200
    return score
}
