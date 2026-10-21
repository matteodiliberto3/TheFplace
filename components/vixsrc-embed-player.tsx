'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { Button } from '@/components/ui/button'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@/components/ui/spinner'
import { CinemaOverlay } from '@/components/cinema-overlay'
import { usePlayerChrome } from '@/components/player-chrome-context'
import { ContentType } from '@/lib/content-navigation'
import { pickHighestHlsLevel } from '@/lib/hls-quality'
import { HLS_CONFIG } from '@/utils/hls-config'
import { createVixsrcBrowserSource, msUntilHlsRefresh, readStreamTokenExpiryMs } from '@/lib/vixsrc-hls'
import { fetchResolvedPlayback } from '@/lib/player-resolve'
import { VixsrcPlayerEvent } from '@/lib/vixsrc-player-events'
import {
    mediaTransportAction,
    shouldResumeUnexpectedPause,
    userPausedFromTransport,
} from '@/lib/playback-resume'

const STALL_RECOVER_MS = 10000
const MAX_HLS_RECOVERIES = 5
const MAX_HARD_RELOADS = 2

const LOAD_TIMEOUT_MS = 55000

interface VixsrcEmbedPlayerProps {
    tmdbId: number
    type: ContentType
    season?: number
    episode?: number
    title: string
    startAt?: number
    onPlayback?: (playback: VixsrcPlayerEvent) => void
    onEnded?: () => void
    onBack?: () => void
    unavailableTitle?: string
    unavailableDescription?: string
    nativeControls?: boolean
}

export function VixsrcEmbedPlayer({
    tmdbId,
    type,
    season,
    episode,
    title,
    startAt,
    onPlayback,
    onEnded,
    onBack,
    unavailableTitle = 'Contenuto non disponibile',
    unavailableDescription = 'Questo titolo non è attualmente disponibile su vixsrc.to',
    nativeControls = false,
}: VixsrcEmbedPlayerProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const stageRef = useRef<HTMLDivElement | null>(null)
    const shell = usePlayerChrome()
    const hlsRef = useRef<Hls | null>(null)
    const resumeAtRef = useRef(startAt ?? 0)
    const onPlaybackRef = useRef(onPlayback)
    const onEndedRef = useRef(onEnded)
    onPlaybackRef.current = onPlayback
    onEndedRef.current = onEnded
    const [error, setError] = useState(false)
    const [streamMissing, setStreamMissing] = useState(false)
    const [ready, setReady] = useState(false)
    const [buffering, setBuffering] = useState(false)
    const [reloadKey, setReloadKey] = useState(0)
    const hardReloadsRef = useRef(0)
    const isSeekingRef = useRef(false)

    const emit = useCallback((event: VixsrcPlayerEvent['event'], video: HTMLVideoElement, videoId?: number) => {
        const playback: VixsrcPlayerEvent = {
            event,
            currentTime: video.currentTime,
            duration: Number.isFinite(video.duration) ? video.duration : 0,
            video_id: videoId,
        }
        onPlaybackRef.current?.(playback)
        if (event === 'ended') onEndedRef.current?.()
    }, [])

    useEffect(() => {
        const video = videoRef.current
        if (!video) return

        let cancelled = false
        let revokeSource: (() => void) | undefined
        let timeout = 0
        let stallTimer = 0
        let refreshTimer = 0
        let playOkTimer = 0
        let userPaused = false
        let lastUserInputAt = 0
        const rememberPosition = () => {
            if (video.currentTime > 1) resumeAtRef.current = video.currentTime
        }
        const reloadFresh = () => {
            rememberPosition()
            if (hardReloadsRef.current >= MAX_HARD_RELOADS) {
                fail(false, 'Impossibile caricare il player')
                return
            }
            hardReloadsRef.current += 1
            setReloadKey((value) => value + 1)
        }
        const tryPlay = () => {
            if (cancelled || video.ended || userPaused) return
            void video.play().catch(() => undefined)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            lastUserInputAt = Date.now()
            const key = event.key || ''
            const action = mediaTransportAction(key, event.keyCode || event.which || 0)
            if (action) {
                userPaused = userPausedFromTransport(action, video.paused)
            }
            const isSeekKey = key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Left' || key === 'Right'
            if (nativeControls && video.paused && !video.ended && !userPaused && !isSeekKey) tryPlay()
        }
        const onVisible = () => {
            if (nativeControls && document.visibilityState === 'visible') tryPlay()
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('visibilitychange', onVisible)
        const fail = (missing: boolean, message: string) => {
            if (cancelled) return
            window.clearTimeout(timeout)
            setStreamMissing(missing)
            setError(true)
            toast.error(message)
        }

        timeout = window.setTimeout(() => {
            fail(false, 'Il player non si è caricato in tempo')
        }, LOAD_TIMEOUT_MS)

        const query = new URLSearchParams({ tmdbId: String(tmdbId), type })
        if (type === 'tv' && season && episode) {
            query.set('season', String(season))
            query.set('episode', String(episode))
        }
        if (reloadKey > 0) query.set('fresh', '1')

        setError(false)
        setStreamMissing(false)
        if (reloadKey === 0) setReady(false)

        const start = async () => {
            try {
                const payload = await fetchResolvedPlayback(query)
                if (!payload.data?.master) {
                    fail(payload.missing, payload.error || 'Stream non disponibile')
                    return
                }
                if (cancelled) return

                const source = createVixsrcBrowserSource({
                    master: payload.data.master,
                    parts: payload.data.parts ?? {},
                    origin: window.location.origin,
                })
                revokeSource = source.revoke
                const playlist = source.url
                const videoId = payload.data.videoId
                const onReady = () => {
                    if (cancelled) return
                    window.clearTimeout(timeout)
                    setReady(true)
                    const resumeAt = resumeAtRef.current
                    if (resumeAt && resumeAt > 0) {
                        video.currentTime = resumeAt
                    }
                    void video.play().catch(() => undefined)
                }
                const expiry = readStreamTokenExpiryMs(payload.data)
                const refreshIn = expiry ? msUntilHlsRefresh(expiry) : null
                if (refreshIn != null) {
                    refreshTimer = window.setTimeout(() => {
                        if (cancelled || video.ended) return
                        rememberPosition()
                        setReloadKey((value) => value + 1)
                    }, refreshIn)
                }

                video.onplay = () => {
                    userPaused = false
                    setBuffering(false)
                    emit('play', video, videoId)
                }
                video.onpause = () => {
                    emit('pause', video, videoId)
                    if (
                        nativeControls &&
                        shouldResumeUnexpectedPause({
                            ended: video.ended,
                            userPaused,
                            lastUserInputAt,
                            now: Date.now(),
                        })
                    ) {
                        window.setTimeout(tryPlay, 400)
                    }
                }
                video.onseeking = () => {
                    isSeekingRef.current = true
                    setBuffering(true)
                }
                video.onseeked = () => {
                    isSeekingRef.current = false
                    window.clearTimeout(stallTimer)
                    setBuffering(false)
                    emit('seeked', video, videoId)
                    tryPlay()
                }
                video.onended = () => {
                    setBuffering(false)
                    emit('ended', video, videoId)
                }
                video.ontimeupdate = () => {
                    rememberPosition()
                    emit('timeupdate', video, videoId)
                }
                video.onwaiting = () => {
                    setBuffering(true)
                    window.clearTimeout(stallTimer)
                    const stuckAt = video.currentTime
                    const wasSeeking = isSeekingRef.current || video.seeking
                    const delay = wasSeeking ? 20000 : STALL_RECOVER_MS
                    stallTimer = window.setTimeout(() => {
                        if (cancelled || video.ended || userPaused) return
                        hlsRef.current?.startLoad()
                        tryPlay()
                        stallTimer = window.setTimeout(() => {
                            if (cancelled || video.ended || userPaused) return
                            if (!video.paused && video.currentTime > stuckAt + 0.25) return
                            if (!isSeekingRef.current && !video.seeking) {
                                reloadFresh()
                            } else {
                                hlsRef.current?.startLoad()
                            }
                        }, delay)
                    }, delay)
                }
                video.onplaying = () => {
                    isSeekingRef.current = false
                    setBuffering(false)
                    window.clearTimeout(stallTimer)
                    window.clearTimeout(playOkTimer)
                    playOkTimer = window.setTimeout(() => {
                        hardReloadsRef.current = 0
                    }, 20000)
                }
                video.onloadedmetadata = onReady

                if (Hls.isSupported()) {
                    const hls = new Hls({
                        ...HLS_CONFIG,
                        maxBufferLength: 45,
                        maxMaxBufferLength: 120,
                        backBufferLength: 60,
                        fragLoadingTimeOut: 45000,
                        fragLoadingMaxRetry: 6,
                        fragLoadingRetryDelay: 1000,
                        manifestLoadingTimeOut: 45000,
                        levelLoadingTimeOut: 45000,
                        startLevel: -1, // Modalità Auto: scala automaticamente
                        autoStartLoad: true,
                        ...(resumeAtRef.current && resumeAtRef.current > 5 ? { startPosition: resumeAtRef.current } : {}),
                    })
                    hlsRef.current = hls
                    hls.loadSource(playlist)
                    hls.attachMedia(video)
                    let recoveries = 0
                    hls.on(Hls.Events.FRAG_LOADED, () => {
                        recoveries = 0
                    })
                    hls.on(Hls.Events.ERROR, (_event, data) => {
                        if (!data.fatal || cancelled) return
                        if (recoveries < MAX_HLS_RECOVERIES && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                            recoveries += 1
                            hls.startLoad()
                            return
                        }
                        if (recoveries < MAX_HLS_RECOVERIES && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                            recoveries += 1
                            hls.recoverMediaError()
                            return
                        }
                        reloadFresh()
                    })
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = playlist
                } else {
                    fail(false, 'HLS non supportato')
                }
            } catch (error) {
                fail(false, error instanceof Error ? error.message : 'Impossibile caricare il player')
            }
        }

        void start()

        return () => {
            cancelled = true
            window.clearTimeout(timeout)
            window.clearTimeout(stallTimer)
            window.clearTimeout(refreshTimer)
            window.clearTimeout(playOkTimer)
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('visibilitychange', onVisible)
            video.onplay = null
            video.onpause = null
            video.onseeking = null
            video.onseeked = null
            video.onended = null
            video.ontimeupdate = null
            video.onwaiting = null
            video.onplaying = null
            video.onloadedmetadata = null
            hlsRef.current?.destroy()
            hlsRef.current = null
            revokeSource?.()
            video.removeAttribute('src')
            video.load()
        }
    }, [emit, episode, nativeControls, reloadKey, season, tmdbId, type])

    useEffect(() => {
        resumeAtRef.current = startAt ?? 0
        hardReloadsRef.current = 0
    }, [episode, season, startAt, tmdbId, type])

    const overlayBack = shell?.onBack ?? onBack
    const overlayTitle = shell?.title ?? title

    return (
        <div ref={stageRef} className="relative z-10 h-full w-full bg-black">
            {error && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
                    <div className="text-center max-w-2xl mx-auto px-8">
                        <h1 className="text-4xl font-bold mb-4 text-white">{title}</h1>
                        <p className="text-xl text-gray-300 mb-2">
                            {streamMissing ? unavailableTitle : 'Impossibile caricare lo stream'}
                        </p>
                        <p className="text-lg text-gray-400 mb-8">
                            {streamMissing
                                ? unavailableDescription
                                : 'Lo stream risulta presente su VixSrc, ma il player non è riuscito a ottenerlo. Riprova.'}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <Button
                                size="lg"
                                onClick={() => {
                                    setError(false)
                                    setReloadKey((value) => value + 1)
                                }}
                                className="bg-red-600 hover:bg-red-700 text-white"
                            >
                                <Play className="w-5 h-5 mr-2" />
                                Riprova
                            </Button>
                            {onBack && (
                                <Button
                                    size="lg"
                                    variant="outline"
                                    onClick={onBack}
                                    className="border-white/30 text-white hover:bg-white/10"
                                >
                                    Torna indietro
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            {(!ready || buffering) && !error && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/40 transition-opacity duration-200">
                    <Spinner size="md" />
                </div>
            )}
            <video
                ref={videoRef}
                className="h-full w-full bg-black object-contain"
                controls={nativeControls}
                crossOrigin="anonymous"
                playsInline
                autoPlay
                aria-label={title}
                onClick={() => {
                    if (nativeControls) return
                    const video = videoRef.current
                    if (!video) return
                    if (video.paused) void video.play()
                    else video.pause()
                }}
            />
            {!nativeControls && !error && (
                <CinemaOverlay
                    videoRef={videoRef}
                    stageRef={stageRef}
                    title={overlayTitle}
                    onBack={overlayBack}
                    onNext={shell?.onNext}
                    nextLabel={shell?.nextLabel}
                    pinNext={shell?.pinNext}
                    chromePaused={shell?.chromePaused}
                    resetKey={`${tmdbId}-${season ?? 0}-${episode ?? 0}-${reloadKey}`}
                />
            )}
        </div>
    )
}
