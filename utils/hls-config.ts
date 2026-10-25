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

    // Reduce console noise
    verbose: process.env.NODE_ENV === 'development',

    // Custom error handler
    onError: (event: any, data: any) => {
        if (process.env.NODE_ENV === 'development') {
            console.warn('HLS.js Error:', data)
        }
    }
}

/** Configurazione ottimizzata per Smart TV (webOS / Tizen) con RAM e decoder limitati */
export function getHlsConfigForDevice() {
    const isTV = typeof navigator !== 'undefined' && isWebosUserAgent(navigator.userAgent)
    if (!isTV) {
        return HLS_CONFIG
    }

    return {
        ...HLS_CONFIG,
        // Su Smart TV limitiamo la memoria buffer per evitare crash del media engine
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        backBufferLength: 10,
        nudgeMaxRetry: 8,
        maxBufferHole: 0.6,
    }
}

// Function to configure HLS.js globally
export function configureHLS() {
    if (typeof window !== 'undefined') {
        // Suppress HLS.js debug logs in production
        if (process.env.NODE_ENV === 'production') {
            // Override console methods to filter HLS.js logs
            const originalLog = console.log
            const originalWarn = console.warn
            const originalError = console.error

            console.log = function (...args) {
                if (args[0] && typeof args[0] === 'string' && args[0].includes('[HLS]')) {
                    return
                }
                originalLog.apply(console, args)
            }

            console.warn = function (...args) {
                if (args[0] && typeof args[0] === 'string' && args[0].includes('[HLS]')) {
                    return
                }
                originalWarn.apply(console, args)
            }

            console.error = function (...args) {
                if (args[0] && typeof args[0] === 'string' && args[0].includes('[HLS]')) {
                    return
                }
                originalError.apply(console, args)
            }
        }
    }
}
