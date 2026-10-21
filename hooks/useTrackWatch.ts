'use client'

import { useCallback, useEffect, useRef } from 'react'
import { trackWatchEntry, TrackWatchInput } from '@/lib/watch-history'
import {
    PROGRESS_SAVE_MIN_SECONDS,
    TIMEUPDATE_SAVE_MS,
    progressPercent,
} from '@/lib/watch-progress'
import { VixsrcPlayerEvent } from '@/lib/vixsrc-player-events'

/** Aggiorna la cronologia dai secondi reali del player VixSrc. */
export function useTrackWatch(input: TrackWatchInput | null) {
    const lastSavedAt = useRef(0)
    const lastSavedTime = useRef(-1)
    const inputRef = useRef(input)
    inputRef.current = input

    useEffect(() => {
        lastSavedAt.current = 0
        lastSavedTime.current = -1
    }, [input?.id, input?.type, input?.season, input?.episode])

    return useCallback((playback: VixsrcPlayerEvent) => {
        const meta = inputRef.current
        if (!meta?.title || !meta.id) return

        const force =
            playback.event === 'pause' || playback.event === 'seeked' || playback.event === 'ended'

        if (playback.event === 'ended') {
            const duration = playback.duration > 0 ? playback.duration : playback.currentTime
            trackWatchEntry({
                ...meta,
                currentTime: duration,
                duration,
                progress: 100,
            })
            lastSavedAt.current = Date.now()
            lastSavedTime.current = duration
            return
        }

        if (playback.currentTime < PROGRESS_SAVE_MIN_SECONDS) return

        if (playback.event === 'seeked' && (!Number.isFinite(playback.duration) || playback.duration <= 0)) {
            return
        }

        const now = Date.now()
        if (!force) {
            if (now - lastSavedAt.current < TIMEUPDATE_SAVE_MS) return
            if (Math.abs(playback.currentTime - lastSavedTime.current) < 4) return
        }

        lastSavedAt.current = now
        lastSavedTime.current = playback.currentTime
        trackWatchEntry({
            ...meta,
            currentTime: playback.currentTime,
            duration: playback.duration,
            progress:
                playback.duration > 0
                    ? progressPercent(playback.currentTime, playback.duration)
                    : undefined,
        })
    }, [])
}
