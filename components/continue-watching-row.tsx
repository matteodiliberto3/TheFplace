'use client'

import Image from 'next/image'
import { Play, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { getLastWatchedEpisode, updateContinueEntry, WatchHistoryEntry } from '@/lib/watch-history'
import { getContentPosterUrl } from '@/lib/content-display'
import { getPlayerPath } from '@/lib/content-navigation'
import { resumeStartAt } from '@/lib/watch-progress'
import { prefetchPlayback } from '@/lib/player-prefetch'
import { CustomScrollbar } from '@/components/custom-scrollbar'
import { TastePrompt } from '@/components/taste-prompt'
import { FeedbackMoment, Liking, WouldContinue } from '@/lib/taste-ranker'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

type ContinueSheet =
    | { kind: 'dismiss'; entry: WatchHistoryEntry }
    | { kind: 'seen'; entry: WatchHistoryEntry; moment: FeedbackMoment; season: number }

function closingAsk(entry: WatchHistoryEntry): { moment: FeedbackMoment; season: number } {
    if (entry.type === 'tv') {
        return { moment: 'end_season', season: entry.season ?? 0 }
    }
    return { moment: 'end_movie', season: 0 }
}

async function hasClosingFeedback(entry: WatchHistoryEntry): Promise<boolean> {
    const ask = closingAsk(entry)
    const response = await fetch(
        `/api/taste/feedback?tmdbId=${entry.id}&type=${entry.type}&season=${ask.season}&moment=${ask.moment}`
    )
    const data = (await response.json()) as { answered?: boolean }
    return Boolean(data.answered)
}

async function saveFeedback(input: {
    entry: WatchHistoryEntry
    moment: FeedbackMoment
    season: number
    liking: Liking
    wouldContinue?: WouldContinue | null
}) {
    await fetch('/api/taste/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tmdbId: input.entry.id,
            type: input.entry.type,
            season: input.season,
            moment: input.moment,
            liking: input.liking,
            wouldContinue: input.wouldContinue ?? null,
        }),
    }).catch(() => undefined)
}

interface ContinueWatchingRowProps {
    entries: WatchHistoryEntry[]
    upcomingSeriesIds?: Set<number> | number[]
}

export function ContinueWatchingRow({ entries, upcomingSeriesIds }: ContinueWatchingRowProps) {
    const router = useRouter()
    const [sheet, setSheet] = useState<ContinueSheet | null>(null)
    const [launchingId, setLaunchingId] = useState<string | null>(null)

    const upcomingIdsSet = useMemo(() => {
        if (!upcomingSeriesIds) return new Set<number>()
        return upcomingSeriesIds instanceof Set ? upcomingSeriesIds : new Set(upcomingSeriesIds)
    }, [upcomingSeriesIds])

    function dismissWith(entry: WatchHistoryEntry, liking: 'disliked' | 'not_interested') {
        void saveFeedback({ entry, moment: 'dismiss', season: 0, liking })
        updateContinueEntry(entry.id, entry.type, 'dismiss')
        setSheet(null)
    }

    function handleLaunch(entry: WatchHistoryEntry) {
        const tileKey = `${entry.type}-${entry.id}`
        if (launchingId) return
        setLaunchingId(tileKey)

        let season = entry.season
        let episode = entry.episode
        let currentTime = entry.currentTime
        let duration = entry.duration
        let progress = entry.progress

        if (entry.type === 'tv') {
            if (season == null || episode == null) {
                const local = getLastWatchedEpisode(entry.id)
                if (local) {
                    season = local.season
                    episode = local.episode
                    progress = local.progress
                    currentTime = local.currentTime
                }
            }

            if (progress != null && progress >= 95 && season != null && episode != null) {
                episode = episode + 1
                currentTime = 0
                progress = 0
            }
        }

        const targetUrl = getPlayerPath(entry.id, entry.type, {
            season,
            episode,
            startAt: progress != null && progress >= 95 ? undefined : resumeStartAt({
                currentTime,
                duration,
                progress,
            }),
        })

        if (typeof document !== 'undefined' && 'startViewTransition' in document) {
            document.startViewTransition(() => {
                router.push(targetUrl)
            })
        } else {
            router.push(targetUrl)
        }

        setTimeout(() => setLaunchingId(null), 3000)
    }

    const visible = entries.filter((entry) => !entry.continueHidden)
    if (visible.length === 0) return null

    return (
        <CustomScrollbar className="pb-4" containerClassName="gap-3">
            {visible.map((entry, index) => {
                const local =
                    entry.type === 'tv' && (entry.season == null || entry.episode == null)
                        ? getLastWatchedEpisode(entry.id)
                        : null
                const s = entry.season ?? local?.season
                const e = entry.episode ?? local?.episode
                const p = entry.progress ?? local?.progress

                const subtitle =
                    entry.type === 'tv' && s != null && e != null
                        ? p != null && p >= 95
                            ? `Prossimo: S${s} E${e + 1}`
                            : `S${s} E${e}`
                        : entry.type === 'tv'
                          ? 'Serie TV'
                          : 'Film'

                const tileKey = `${entry.type}-${entry.id}`
                const isLaunching = launchingId === tileKey
                const isProtected = entry.type === 'tv' && upcomingIdsSet.has(entry.id)

                return (
                    <motion.div
                        key={tileKey}
                        onMouseEnter={() => prefetchPlayback({ id: entry.id, type: entry.type, season: entry.season, episode: entry.episode })}
                        onFocus={() => prefetchPlayback({ id: entry.id, type: entry.type, season: entry.season, episode: entry.episode })}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                        whileTap={{ scale: 0.985 }}
                        className={cn(
                            'continue-tile group relative flex-shrink-0 w-[clamp(12.5rem,18vw,22rem)] text-left rounded-lg cursor-pointer select-none transition-transform duration-150',
                            isLaunching && 'is-launching'
                        )}
                    >
                        <div className="relative aspect-video rounded-lg overflow-hidden bg-zinc-900 mb-2">
                            <Image
                                src={getContentPosterUrl(entry.backdrop_path || entry.poster_path, 'w780')}
                                alt={entry.title}
                                fill
                                className={cn(
                                    'object-cover transition-all duration-300 group-hover:scale-105',
                                    isLaunching && 'scale-105 brightness-[0.7]'
                                )}
                                sizes="(max-width: 1536px) 220px, 352px"
                            />
                            <div
                                className={cn(
                                    'absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-all duration-300',
                                    isLaunching && 'bg-black/55 backdrop-blur-[1px]'
                                )}
                            />

                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    handleLaunch(entry)
                                }}
                                className="continue-play-btn"
                                aria-label={`Riproduci ${entry.title}`}
                            >
                                <div className="continue-play-icon">
                                    <Play className="h-3.5 w-3.5 fill-current ml-0.5" />
                                </div>
                                <div className="continue-play-script" aria-hidden="true">
                                    <svg viewBox="0 0 72 26" className="w-[72px] h-[26px]">
                                        <path
                                            className="continue-apple-stroke-p"
                                            pathLength={100}
                                            d="M 5 5 L 5 20.5 L 5 5 C 8 3 16 3 16.5 7.5 C 17 12 9.5 13.5 5 13"
                                        />
                                        <path
                                            className="continue-apple-stroke-lay"
                                            pathLength={100}
                                            d="M 17 17 C 19 17 21 10.5 23.5 4.5 C 24.8 3 25.8 3.5 25 6.5 L 22.5 17 C 24.5 17 27.5 15.5 30 11.5 C 27.5 9.5 24.2 11.5 24.2 14 C 24.2 16.8 28 17 30 16.5 L 31.5 10.5 L 31.5 17 C 33.5 17 36.5 15.5 38 11.5 L 39 17 C 39 20 37.5 24.5 33.5 24.5 C 31 24.5 31 21.5 34.5 19 L 43.5 15.5"
                                        />
                                    </svg>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleLaunch(entry)}
                                className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                                aria-label={`Continua ${entry.title}`}
                            />

                            {/* Dismiss and Seen buttons are hidden for protected series with upcoming episodes */}
                            {!isProtected && (
                                <>
                                    <div className="continue-dismiss-zone continue-web-only absolute right-0 top-0 z-30 h-16 w-16 items-start justify-end p-2">
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation()
                                                setSheet({ kind: 'dismiss', entry })
                                            }}
                                            className="continue-dismiss h-7 w-7 items-center justify-center"
                                            aria-label={`Togli ${entry.title} da continua a guardare`}
                                        >
                                            <X className="relative z-10 h-3.5 w-3.5" strokeWidth={2.5} />
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            const ask = closingAsk(entry)
                                            void hasClosingFeedback(entry)
                                                .then((answered) => {
                                                    if (answered) {
                                                        updateContinueEntry(entry.id, entry.type, 'seen')
                                                        return
                                                    }
                                                    setSheet({ kind: 'seen', entry, ...ask })
                                                })
                                                .catch(() => setSheet({ kind: 'seen', entry, ...ask }))
                                        }}
                                        className="continue-seen continue-web-hit group/seen absolute inset-y-0 right-0 z-20 w-[46%]"
                                        aria-label={`Segna ${entry.title} come già visto`}
                                    >
                                        <span className="continue-shade pointer-events-none absolute inset-0">
                                            <span className="continue-shade-glow" />
                                            <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-semibold text-black">
                                                Già visto
                                            </span>
                                        </span>
                                    </button>
                                </>
                            )}

                            <div className="absolute bottom-0 left-0 right-0 z-20 h-1 bg-white/20 pointer-events-none">
                                <div
                                    className="h-full bg-white transition-[width] duration-500"
                                    style={{ width: `${entry.progress}%` }}
                                />
                            </div>
                        </div>
                        <p className="text-sm font-medium text-white line-clamp-1 group-hover:text-white/90">
                            {entry.title}
                        </p>
                        <p className="text-xs text-white/50 mt-0.5">
                            {isLaunching ? 'Avvio in corso...' : subtitle}
                        </p>
                    </motion.div>
                )
            })}
            {sheet &&
                createPortal(
                    <div className="fixed inset-0 z-[80]">
                        {sheet.kind === 'dismiss' ? (
                            <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black via-black/70 to-transparent p-8 md:p-12">
                                <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-black/80 p-6 backdrop-blur-sm">
                                    <p className="text-xs uppercase tracking-[0.18em] text-white/45 mb-3">Un attimo</p>
                                    <h3 className="text-2xl font-semibold text-white leading-snug mb-6">
                                        Come mai lo elimini?
                                    </h3>
                                    <div className="flex flex-col gap-2">
                                        <button
                                            type="button"
                                            onClick={() => dismissWith(sheet.entry, 'disliked')}
                                            className="h-12 rounded-md bg-white/10 text-white font-medium hover:bg-white/20 transition-colors"
                                        >
                                            Non mi è piaciuto
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => dismissWith(sheet.entry, 'not_interested')}
                                            className="h-12 rounded-md bg-white/10 text-white font-medium hover:bg-white/20 transition-colors"
                                        >
                                            Non mi interessa
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSheet(null)}
                                            className="h-12 rounded-md bg-white/10 text-white font-medium hover:bg-white/20 transition-colors"
                                        >
                                            L&apos;ho cliccato per sbaglio
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <TastePrompt
                                title={sheet.entry.title}
                                moment={sheet.moment}
                                onSubmit={(liking, wouldContinue) => {
                                    void saveFeedback({
                                        entry: sheet.entry,
                                        moment: sheet.moment,
                                        season: sheet.season,
                                        liking,
                                        wouldContinue,
                                    }).then(() => {
                                        updateContinueEntry(sheet.entry.id, sheet.entry.type, 'seen')
                                        setSheet(null)
                                    })
                                }}
                                onSkip={() => {
                                    void saveFeedback({
                                        entry: sheet.entry,
                                        moment: sheet.moment,
                                        season: sheet.season,
                                        liking: 'skipped',
                                    }).then(() => {
                                        updateContinueEntry(sheet.entry.id, sheet.entry.type, 'seen')
                                        setSheet(null)
                                    })
                                }}
                            />
                        )}
                    </div>,
                    document.body
                )}
        </CustomScrollbar>
    )
}
