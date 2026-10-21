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

// Function to configure HLS.js globally
export function configureHLS() {
    if (typeof window !== 'undefined') {
        // Suppress HLS.js debug logs in production
        if (process.env.NODE_ENV === 'production') {
            // Override console methods to filter HLS.js logs
            const originalLog = console.log
            const originalWarn = console.warn

            console.log = (...args: any[]) => {
                const message = args.join(' ')
                if (!message.includes('[log] >') && !message.includes('hls.js')) {
                    originalLog.apply(console, args)
                }
            }

            console.warn = (...args: any[]) => {
                const message = args.join(' ')
                if (!message.includes('[log] >') && !message.includes('hls.js')) {
                    originalWarn.apply(console, args)
                }
            }
        }
    }
}

// Function to clean up HLS.js configuration
export function cleanupHLS() {
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
        // Restore original console methods
        console.log = console.log
        console.warn = console.warn
    }
}



