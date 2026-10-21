'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Maximize, Minimize2, Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { useIsCoarsePointer } from '@/hooks/useMediaQuery'
import {
    isPlayerFullscreen,
    subscribePlayerFullscreen,
    togglePlayerFullscreen,
} from '@/lib/player-fullscreen'
import { cn } from '@/lib/utils'

const INTRO_MS = 1800
const CURSOR_HIDE_MS = 2000
const TOUCH_HIDE_MS = 2000
const SKIP_S = 10

export function shouldHidePlayerCursor(opts: {
    isTouch: boolean
    playing: boolean
    chromeOpen: boolean
    idle: boolean
}) {
    return !opts.isTouch && opts.playing && !opts.chromeOpen && opts.idle
}

export function shouldShowPlayerChrome(opts: {
    chromePaused: boolean
    intro: boolean
    hoverTop: boolean
    hoverBottom: boolean
    tapped: boolean
}) {
    if (opts.chromePaused) return false
    return opts.intro || opts.hoverTop || opts.hoverBottom || opts.tapped
}

export function shouldShowNextButton(opts: {
    chromePaused: boolean
    pinNext: boolean
    chromeOpen: boolean
    hasNext: boolean
}) {
    if (!opts.hasNext || opts.chromePaused) return false
    return opts.chromeOpen || opts.pinNext
}

export function formatCueTime(sec: number) {
    const absSec = Math.abs(sec)
    const sign = sec >= 0 ? '+' : '-'
    if (absSec < 60) {
        return `${sign}${absSec}s`
    }
    const m = Math.floor(absSec / 60)
    const s = absSec % 60
    if (s === 0) return `${sign}${m}m`
    return `${sign}${m}m ${s}s`
}

export function formatMediaTime(total: number) {
    if (!Number.isFinite(total) || total < 0) return '0:00'
    const s = Math.floor(total)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
    const ss = String(sec).padStart(2, '0')
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

function SkipTen({ dir }: { dir: 'back' | 'fwd' }) {
    return (
        <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums">
            {dir === 'back' ? (
                <>
                    <SkipChevrons dir="back" />
                    <span>10</span>
                </>
            ) : (
                <>
                    <span>10</span>
                    <SkipChevrons dir="fwd" />
                </>
            )}
        </span>
    )
}

function SkipChevrons({ dir }: { dir: 'back' | 'fwd' }) {
    return (
        <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            {dir === 'back' ? (
                <>
                    <path d="M11 6 4 12l7 6" />
                    <path d="M19 6l-7 6 7 6" />
                </>
            ) : (
                <>
                    <path d="M13 6l7 6-7 6" />
                    <path d="M5 6l7 6-7 6" />
                </>
            )}
        </svg>
    )
}

function IconHit({
    label,
    onClick,
    children,
    className,
}: {
    label: string
    onClick?: () => void
    children: React.ReactNode
    className?: string
}) {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className={cn(
                'player-skin-hit inline-flex h-11 min-w-11 items-center justify-center text-white',
                className
            )}
        >
            {children}
        </button>
    )
}

interface CinemaOverlayProps {
    videoRef: React.RefObject<HTMLVideoElement | null>
    stageRef: React.RefObject<HTMLElement | null>
    title?: string
    onBack?: () => void
    onNext?: () => void
    nextLabel?: string
    pinNext?: boolean
    chromePaused?: boolean
    resetKey: string
}

export function CinemaOverlay({
    videoRef,
    stageRef,
    title,
    onBack,
    onNext,
    nextLabel,
    pinNext = false,
    chromePaused = false,
    resetKey,
}: CinemaOverlayProps) {
    const isTouch = useIsCoarsePointer()
    const [intro, setIntro] = useState(true)
    const [hoverTop, setHoverTop] = useState(false)
    const [hoverBottom, setHoverBottom] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [idle, setIdle] = useState(false)
    const [tapped, setTapped] = useState(false)
    const [muted, setMuted] = useState(false)
    const [fullscreen, setFullscreen] = useState(false)
    const [seekCue, setSeekCue] = useState<{ text: string; dir: 'back' | 'fwd' } | null>(null)
    const fillRef = useRef<HTMLSpanElement>(null)
    const timeRef = useRef<HTMLSpanElement>(null)
    const durationRef = useRef<HTMLSpanElement>(null)
    const trackRef = useRef<HTMLButtonElement>(null)
    const dragging = useRef(false)
    const hideTimerRef = useRef(0)
    const cueTimerRef = useRef(0)
    const pendingSeekTimeRef = useRef<number | null>(null)
    const seekDebounceTimerRef = useRef<number>(0)

    const hideChrome = useCallback(() => {
        window.clearTimeout(hideTimerRef.current)
        setTapped(false)
    }, [])

    const revealChrome = useCallback(() => {
        setTapped(true)
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = window.setTimeout(() => {
            if (dragging.current) return
            const video = videoRef.current
            if (video?.paused) return
            setTapped(false)
        }, TOUCH_HIDE_MS)
    }, [videoRef])

    useEffect(() => {
        setHoverTop(false)
        setHoverBottom(false)
        hideChrome()
        if (isTouch) {
            setIntro(false)
            return
        }
        setIntro(true)
        const timer = window.setTimeout(() => setIntro(false), INTRO_MS)
        return () => window.clearTimeout(timer)
    }, [hideChrome, isTouch, resetKey])

    const open = shouldShowPlayerChrome({
        chromePaused,
        intro,
        hoverTop,
        hoverBottom,
        tapped,
    })
    const nextShown = shouldShowNextButton({
        chromePaused,
        pinNext,
        chromeOpen: open,
        hasNext: Boolean(onNext),
    })
    const hideCursor = shouldHidePlayerCursor({
        isTouch,
        playing,
        chromeOpen: open,
        idle,
    })

    useEffect(() => {
        if (isTouch || chromePaused) {
            setIdle(false)
            return
        }
        const stage = stageRef.current
        if (!stage) return

        let timer = 0
        const bump = () => {
            setIdle(false)
            window.clearTimeout(timer)
            timer = window.setTimeout(() => setIdle(true), CURSOR_HIDE_MS)
        }
        bump()
        stage.addEventListener('mousemove', bump)
        stage.addEventListener('pointerdown', bump)
        return () => {
            window.clearTimeout(timer)
            stage.removeEventListener('mousemove', bump)
            stage.removeEventListener('pointerdown', bump)
        }
    }, [chromePaused, isTouch, resetKey, stageRef])

    useEffect(() => {
        const stage = stageRef.current
        if (!stage) return
        stage.classList.toggle('player-idle-cursor', hideCursor)
        return () => stage.classList.remove('player-idle-cursor')
    }, [hideCursor, stageRef])

    useEffect(() => {
        const video = videoRef.current
        if (!video) return

        const sync = () => {
            setPlaying(!video.paused)
            setMuted(video.muted || video.volume === 0)
        }
        sync()
        video.addEventListener('play', sync)
        video.addEventListener('pause', sync)
        video.addEventListener('volumechange', sync)
        return () => {
            video.removeEventListener('play', sync)
            video.removeEventListener('pause', sync)
            video.removeEventListener('volumechange', sync)
        }
    }, [videoRef, resetKey])

    useEffect(() => {
        return () => {
            window.clearTimeout(hideTimerRef.current)
            window.clearTimeout(cueTimerRef.current)
            window.clearTimeout(seekDebounceTimerRef.current)
        }
    }, [])

    useEffect(() => {
        if (chromePaused) hideChrome()
    }, [chromePaused, hideChrome])

    useEffect(() => {
        const video = videoRef.current
        const sync = () => setFullscreen(isPlayerFullscreen(video))
        sync()
        return subscribePlayerFullscreen(video, sync)
    }, [resetKey, videoRef])

    useEffect(() => {
        let frame = 0
        const tick = () => {
            const video = videoRef.current
            if (video) {
                const duration = Number.isFinite(video.duration) ? video.duration : 0
                const ratio = duration > 0 ? video.currentTime / duration : 0
                if (fillRef.current) fillRef.current.style.width = `${Math.min(100, ratio * 100)}%`
                if (timeRef.current) timeRef.current.textContent = formatMediaTime(video.currentTime)
                if (durationRef.current) durationRef.current.textContent = formatMediaTime(duration)
            }
            frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [videoRef])

    const showCueMessage = useCallback((text: string, dir: 'back' | 'fwd') => {
        setSeekCue({ text, dir })
        window.clearTimeout(cueTimerRef.current)
        cueTimerRef.current = window.setTimeout(() => {
            setSeekCue(null)
        }, 1100)
    }, [])

    const seekFromClientX = useCallback(
        (clientX: number) => {
            const video = videoRef.current
            const track = trackRef.current
            if (!video || !track || !Number.isFinite(video.duration)) return
            const rect = track.getBoundingClientRect()
            const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
            const prev = video.currentTime
            const target = ratio * video.duration
            video.currentTime = target
            const delta = Math.round(target - prev)
            if (Math.abs(delta) >= 2) {
                showCueMessage(formatCueTime(delta), delta >= 0 ? 'fwd' : 'back')
            }
        },
        [showCueMessage, videoRef]
    )

    const skip = useCallback((delta: number) => {
        const video = videoRef.current
        if (!video || !Number.isFinite(video.duration)) return
        const d = video.duration
        const base = pendingSeekTimeRef.current !== null ? pendingSeekTimeRef.current : (video.currentTime || 0)
        let next = base + delta
        if (next < 0) next = 0
        if (d && isFinite(d) && next > d - 0.5) next = Math.max(0, d - 0.5)
        pendingSeekTimeRef.current = next

        const diffFromCurrent = Math.round(next - (video.currentTime || 0))
        showCueMessage(formatCueTime(diffFromCurrent), diffFromCurrent >= 0 ? 'fwd' : 'back')

        window.clearTimeout(seekDebounceTimerRef.current)
        seekDebounceTimerRef.current = window.setTimeout(() => {
            const target = pendingSeekTimeRef.current
            pendingSeekTimeRef.current = null
            if (target !== null && videoRef.current) {
                try {
                    videoRef.current.currentTime = target
                } catch {}
            }
        }, 220)
    }, [showCueMessage, videoRef])

    const togglePlay = () => {
        const video = videoRef.current
        if (!video) return
        if (video.paused) void video.play()
        else video.pause()
    }

    const toggleMute = () => {
        const video = videoRef.current
        if (!video) return
        video.muted = !video.muted
    }

    const toggleFullscreen = () => {
        void togglePlayerFullscreen(stageRef.current, videoRef.current)
    }

    useEffect(() => {
        if (chromePaused) return
        const onKey = (event: KeyboardEvent) => {
            const video = videoRef.current
            if (!video) return
            const target = event.target
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
            if (event.code === 'Space' || event.key === 'k' || event.key === 'K') {
                event.preventDefault()
                if (video.paused) void video.play()
                else video.pause()
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault()
                skip(-SKIP_S)
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault()
                skip(SKIP_S)
            }
            if (event.key === 'm' || event.key === 'M') {
                video.muted = !video.muted
            }
            if (event.key === 'f' || event.key === 'F') {
                void togglePlayerFullscreen(stageRef.current, video)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [chromePaused, stageRef, videoRef])

    return (
        <>
            {seekCue && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center animate-in fade-in zoom-in-90 duration-150">
                    <div className="flex flex-col items-center justify-center rounded-2xl bg-black/75 px-7 py-5 backdrop-blur-md shadow-2xl border border-white/10 text-white">
                        <div className="flex items-center gap-2 mb-1">
                            <SkipChevrons dir={seekCue.dir} />
                            <span className="text-3xl sm:text-4xl font-bold tracking-tight tabular-nums">
                                {seekCue.text}
                            </span>
                            <SkipChevrons dir={seekCue.dir} />
                        </div>
                        <span className="text-xs uppercase tracking-wider text-white/70 font-medium">
                            {seekCue.dir === 'fwd' ? 'Avanti' : 'Indietro'}
                        </span>
                    </div>
                </div>
            )}

            {!playing && !open && !chromePaused && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    <Play className="h-14 w-14 fill-white/80 text-white/80" />
                </div>
            )}

            {isTouch && !chromePaused && (
                <button
                    type="button"
                    className="absolute inset-0 z-[15] bg-transparent"
                    aria-label={open ? 'Nascondi controlli' : 'Mostra controlli'}
                    onClick={() => {
                        if (open) hideChrome()
                        else revealChrome()
                    }}
                />
            )}

            <div
                className={cn(
                    'player-chrome-hit absolute inset-x-0 top-0 z-20 h-20',
                    isTouch && !open && 'pointer-events-none'
                )}
                onMouseEnter={() => setHoverTop(true)}
                onMouseLeave={() => setHoverTop(false)}
                onPointerDown={() => {
                    if (isTouch) revealChrome()
                }}
            >
                <div className="player-skin-chrome player-skin-chrome-top px-4 pb-10 pt-4" data-open={open}>
                    <div
                        className="flex items-center gap-2 sm:gap-3"
                        style={{
                            background: 'linear-gradient(to bottom, rgb(0 0 0 / 0.72), transparent)',
                            margin: '-1rem -1rem 0',
                            padding: '1rem 1rem 2.5rem',
                            paddingRight: onNext ? '13rem' : '1rem',
                        }}
                    >
                        {onBack && (
                            <button
                                type="button"
                                onClick={onBack}
                                className="player-skin-hit inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-white"
                                aria-label="Indietro"
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Indietro
                            </button>
                        )}
                        {title && (
                            <p className="min-w-0 flex-1 truncate text-sm text-white/70">{title}</p>
                        )}
                    </div>
                </div>
                {onNext && (
                    <div
                        className="player-skin-chrome player-skin-chrome-top absolute right-4 top-4 z-30"
                        data-open={nextShown}
                    >
                        <button
                            type="button"
                            onClick={onNext}
                            className={cn(
                                'player-skin-hit inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-white',
                                nextShown && !open && 'bg-black/60'
                            )}
                            aria-label={nextLabel ? `Prossima ${nextLabel}` : 'Puntata successiva'}
                        >
                            Prossima
                            {nextLabel ? ` ${nextLabel}` : ''}
                            <SkipForward className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </div>

            <div
                className={cn(
                    'player-chrome-hit absolute inset-x-0 bottom-0 z-20 h-36',
                    isTouch && !open && 'pointer-events-none'
                )}
                onMouseEnter={() => setHoverBottom(true)}
                onMouseLeave={() => setHoverBottom(false)}
                onPointerDown={() => {
                    if (isTouch) revealChrome()
                }}
            >
                <div className="player-skin-chrome player-skin-chrome-bottom absolute inset-x-0 bottom-0" data-open={open}>
                    <div
                        className="px-8 pb-5 pt-16"
                        style={{
                            background:
                                'linear-gradient(to top, rgb(0 0 0 / 0.88) 0%, rgb(0 0 0 / 0.42) 48%, transparent 100%)',
                        }}
                    >
                        <button
                            ref={trackRef}
                            type="button"
                            aria-label="Avanzamento"
                            className="relative h-[3px] w-full rounded-full bg-white/20"
                            onPointerDown={(event) => {
                                dragging.current = true
                                event.currentTarget.setPointerCapture(event.pointerId)
                                seekFromClientX(event.clientX)
                            }}
                            onPointerMove={(event) => {
                                if (!dragging.current) return
                                seekFromClientX(event.clientX)
                            }}
                            onPointerUp={() => {
                                dragging.current = false
                                if (isTouch) revealChrome()
                            }}
                        >
                            <span
                                ref={fillRef}
                                className="absolute inset-y-0 left-0 rounded-full bg-white"
                                style={{ width: '0%' }}
                            />
                        </button>
                        <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                            <span className="text-[12px] tabular-nums text-white/70">
                                <span ref={timeRef}>0:00</span>
                                {' / '}
                                <span ref={durationRef}>0:00</span>
                            </span>
                            <div className="flex items-center justify-center gap-0.5">
                                <IconHit
                                    label="Indietro 10 secondi"
                                    onClick={() => skip(-SKIP_S)}
                                    className="min-w-[3.5rem]"
                                >
                                    <SkipTen dir="back" />
                                </IconHit>
                                <IconHit
                                    label={playing ? 'Pausa' : 'Play'}
                                    onClick={togglePlay}
                                    className="h-12 w-12 rounded-full bg-white text-black"
                                >
                                    {playing ? (
                                        <Pause className="h-5 w-5 fill-current" />
                                    ) : (
                                        <Play className="h-5 w-5 fill-current" />
                                    )}
                                </IconHit>
                                <IconHit
                                    label="Avanti 10 secondi"
                                    onClick={() => skip(SKIP_S)}
                                    className="min-w-[3.5rem]"
                                >
                                    <SkipTen dir="fwd" />
                                </IconHit>
                            </div>
                            <div className="flex items-center justify-end">
                                <IconHit label={muted ? 'Audio' : 'Muto'} onClick={toggleMute}>
                                    {muted ? (
                                        <VolumeX className="h-5 w-5" strokeWidth={1.75} />
                                    ) : (
                                        <Volume2 className="h-5 w-5" strokeWidth={1.75} />
                                    )}
                                </IconHit>
                                <IconHit
                                    label={fullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
                                    onClick={toggleFullscreen}
                                >
                                    {fullscreen ? (
                                        <Minimize2 className="h-5 w-5" strokeWidth={1.75} />
                                    ) : (
                                        <Maximize className="h-5 w-5" strokeWidth={1.75} />
                                    )}
                                </IconHit>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}
