'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { PlayerShell } from '@/components/player-shell'
import { VixsrcEmbedPlayer } from '@/components/vixsrc-embed-player'
import { useTrackWatch } from '@/hooks/useTrackWatch'
import { TVShowDetails, Episode } from '@/types'
import { PageSpinner } from '@/components/ui/spinner'
import { NextEpisodeOverlay } from '@/components/next-episode-overlay'
import { TastePrompt, useTastePrompt } from '@/components/taste-prompt'
import { getTMDBImageUrl } from '@/lib/tmdb'
import { getPlayerPath, getSeriesPath } from '@/lib/content-navigation'
import { getLastWatchedEpisode, resolvePlayerStartAt } from '@/lib/watch-history'
import { isNearEnd, parseStartAtParam } from '@/lib/watch-progress'
import { resolveSeriesResume } from '@/lib/series-resume'

interface TVShowSummary {
    id: number
    tmdb_id: number
    name: string
    overview: string
    poster_path?: string
    backdrop_path?: string
    first_air_date: string
    vote_average: number
    number_of_seasons: number
    number_of_episodes: number
    genres: Array<{ id: number; name: string }>
}

function createFallbackShow(tvId: string): TVShowSummary {
    const id = parseInt(tvId, 10)
    return {
        id,
        tmdb_id: id,
        name: `Serie TV ${tvId}`,
        overview: `Serie TV disponibile su vixsrc.to con TMDB ID ${tvId}.`,
        poster_path: '/placeholder-movie.svg',
        backdrop_path: '/placeholder-movie.svg',
        first_air_date: '',
        vote_average: 0,
        number_of_seasons: 1,
        number_of_episodes: 1,
        genres: [],
    }
}

export default function TVPlayerPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const router = useRouter()
    const tvId = params.id as string
    const season = parseInt(searchParams.get('season') || '1', 10)
    const episode = parseInt(searchParams.get('episode') || '1', 10)

    const [tvShow, setTVShow] = useState<TVShowSummary | null>(null)
    const [tvShowDetails, setTVShowDetails] = useState<TVShowDetails | null>(null)
    const [loading, setLoading] = useState(true)
    const [offerNext, setOfferNext] = useState(false)
    const [nearEnd, setNearEnd] = useState(false)
    const [ended, setEnded] = useState(false)
    const fetchedId = useRef<string | null>(null)
    const handledEndedEpRef = useRef<string | null>(null)
    const isTransitioningRef = useRef(false)

    useEffect(() => {
        if (fetchedId.current === tvId) return
        fetchedId.current = tvId

        const fetchTVShowDetails = async () => {
            try {
                setLoading(true)
                const response = await fetch(`/api/tmdb/tv/${tvId}`)
                const data = await response.json()

                if (data.success && data.data) {
                    const tmdbTVShow = data.data
                    let seasonsData: TVShowDetails['seasons'] = []
                    let actualSeasons = tmdbTVShow.number_of_seasons || 1
                    let actualEpisodes = tmdbTVShow.number_of_episodes || 1

                    try {
                        const seasonsResponse = await fetch(`/api/tmdb/tv/${tvId}/seasons`)
                        const seasonsResult = await seasonsResponse.json()
                        if (seasonsResult.success && Array.isArray(seasonsResult.data)) {
                            seasonsData = seasonsResult.data
                            actualSeasons = seasonsResult.data.length
                            actualEpisodes = seasonsResult.data.reduce(
                                (total: number, s: { episodes?: unknown[] }) =>
                                    total + (s.episodes?.length || 0),
                                0
                            )
                        }
                    } catch {
                        // usa valori TMDB
                    }

                    const summary: TVShowSummary = {
                        id: tmdbTVShow.id,
                        tmdb_id: tmdbTVShow.id,
                        name: tmdbTVShow.name,
                        overview: tmdbTVShow.overview,
                        poster_path: tmdbTVShow.poster_path,
                        backdrop_path: tmdbTVShow.backdrop_path,
                        first_air_date: tmdbTVShow.first_air_date,
                        vote_average: tmdbTVShow.vote_average,
                        number_of_seasons: actualSeasons,
                        number_of_episodes: actualEpisodes,
                        genres: tmdbTVShow.genres || [],
                    }

                    setTVShow(summary)
                    if (seasonsData.length > 0) {
                        setTVShowDetails({
                            ...summary,
                            name: summary.name,
                            vote_count: tmdbTVShow.vote_count ?? 0,
                            genre_ids: tmdbTVShow.genre_ids ?? [],
                            adult: tmdbTVShow.adult ?? false,
                            original_language: tmdbTVShow.original_language ?? 'en',
                            original_name: tmdbTVShow.original_name ?? summary.name,
                            popularity: tmdbTVShow.popularity ?? 0,
                            origin_country: tmdbTVShow.origin_country ?? [],
                            seasons: seasonsData,
                            genres: tmdbTVShow.genres || [],
                        })
                    }
                } else {
                    setTVShow(createFallbackShow(tvId))
                }
            } catch {
                setTVShow(createFallbackShow(tvId))
            } finally {
                setLoading(false)
            }
        }

        fetchTVShowDetails()
    }, [tvId])

    const trackPlayback = useTrackWatch(
        tvShow
            ? {
                  id: tvShow.tmdb_id || tvShow.id,
                  type: 'tv',
                  title: tvShow.name,
                  poster_path: tvShow.poster_path,
                  backdrop_path: tvShow.backdrop_path,
                  season,
                  episode,
              }
            : null
    )

    useEffect(() => {
        setOfferNext(false)
        setNearEnd(false)
        setEnded(false)
        handledEndedEpRef.current = null
        isTransitioningRef.current = false
    }, [season, episode])

    const findEpisode = useCallback(
        (seasonNum: number, episodeNum: number): Episode | null => {
            const seasonData = tvShowDetails?.seasons.find((s) => s.season_number === seasonNum)
            return seasonData?.episodes.find((e) => e.episode_number === episodeNum) ?? null
        },
        [tvShowDetails]
    )

    const findNextEpisode = useCallback(
        (currentSeasonNum: number, currentEpisodeNum: number) => {
            if (!tvShowDetails?.seasons) return null

            const currentSeasonData = tvShowDetails.seasons.find(
                (s) => s.season_number === currentSeasonNum
            )
            if (!currentSeasonData) return null

            const nextInSeason = currentSeasonData.episodes.find(
                (e) => e.episode_number === currentEpisodeNum + 1
            )
            if (nextInSeason) {
                return { season: currentSeasonNum, episode: currentEpisodeNum + 1 }
            }

            const nextSeason = tvShowDetails.seasons.find(
                (s) => s.season_number === currentSeasonNum + 1
            )
            if (nextSeason?.episodes.length) {
                return { season: currentSeasonNum + 1, episode: 1 }
            }

            return null
        },
        [tvShowDetails]
    )

    useEffect(() => {
        if (!tvShowDetails?.seasons?.length || isTransitioningRef.current) return
        const currentEp = findEpisode(season, episode)
        if (!currentEp) {
            const numericId = parseInt(tvId, 10)
            const last = Number.isFinite(numericId) ? getLastWatchedEpisode(numericId) : null
            const resolved = resolveSeriesResume({
                querySeason: season,
                queryEpisode: episode,
                lastWatched: last,
                seasons: tvShowDetails.seasons,
            })
            if (resolved.season !== season || resolved.episode !== episode) {
                router.replace(getPlayerPath(parseInt(tvId, 10), 'tv', resolved))
            }
        }
    }, [episode, findEpisode, router, season, tvId, tvShowDetails])

    const startAt = useMemo(() => {
        const runtime = findEpisode(season, episode)?.runtime
        return resolvePlayerStartAt({
            id: parseInt(tvId, 10),
            type: 'tv',
            season,
            episode,
            urlStartAt: parseStartAtParam(searchParams.get('startAt')),
            runtimeSeconds: runtime && runtime > 0 ? runtime * 60 : undefined,
        })
    }, [episode, findEpisode, searchParams, season, tvId])

    const exitPlayer = useCallback(() => {
        router.replace(getSeriesPath(tvId, { season, episode }))
    }, [episode, router, season, tvId])

    const handleEpisodeEnded = useCallback(() => {
        setEnded(true)
    }, [])

    const goToNextEpisode = useCallback(() => {
        const next = findNextEpisode(season, episode)
        if (!next) {
            exitPlayer()
            return
        }
        isTransitioningRef.current = true
        setEnded(false)
        setOfferNext(false)
        setNearEnd(false)
        router.replace(getPlayerPath(parseInt(tvId, 10), 'tv', next))
    }, [episode, exitPlayer, findNextEpisode, router, season, tvId])

    const handlePlayback = useCallback(
        (playback: Parameters<typeof trackPlayback>[0]) => {
            trackPlayback(playback)
            if (playback.duration <= 0) return
            const next = findNextEpisode(season, episode)
            setNearEnd(Boolean(next) && isNearEnd(playback.currentTime, playback.duration))
        },
        [episode, findNextEpisode, season, trackPlayback]
    )

    const seasonEpisodeCount =
        tvShowDetails?.seasons.find((entry) => entry.season_number === season)?.episodes.length || 0
    const taste = useTastePrompt({
        tmdbId: tvShow?.tmdb_id || tvShow?.id,
        type: 'tv',
        title: tvShow?.name || '',
        season,
        episode,
        episodeCount: seasonEpisodeCount,
        ended,
    })

    useEffect(() => {
        const epKey = `${season}-${episode}`
        if (!ended || taste.pending || handledEndedEpRef.current === epKey) return
        handledEndedEpRef.current = epKey

        const next = findNextEpisode(season, episode)
        if (next) {
            setOfferNext(true)
            return
        }
        exitPlayer()
    }, [ended, episode, exitPlayer, findNextEpisode, season, taste.pending])

    const currentEpisodeData = findEpisode(season, episode)
    const nextRef = findNextEpisode(season, episode)
    const nextEpisodeData = nextRef ? findEpisode(nextRef.season, nextRef.episode) : null

    if (loading) {
        return <PageSpinner />
    }

    if (!tvShow) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="text-white text-xl">Serie TV non trovata</div>
            </div>
        )
    }

    return (
        <PlayerShell
            backdropPath={tvShow.backdrop_path}
            onBack={exitPlayer}
            onNext={nextRef ? goToNextEpisode : undefined}
            nextLabel={nextRef ? `S${nextRef.season} E${nextRef.episode}` : undefined}
            pinNext={nearEnd}
            title={`${tvShow.name} · S${season}E${episode}`}
            chromePaused={offerNext || Boolean(taste.moment)}
            footer={
                <div className="p-8 bg-black">
                    <div className="max-w-4xl mx-auto">
                        <h2 className="text-xl font-semibold mb-6">Trama</h2>
                        <p className="text-sm text-white/45 mb-2">
                            S{season}E{episode}
                            {currentEpisodeData?.name ? ` · ${currentEpisodeData.name}` : ''}
                        </p>
                        <p className="text-white/80 leading-relaxed">
                            {currentEpisodeData?.overview?.trim() ||
                                'Nessuna trama disponibile per questo episodio.'}
                        </p>
                        {tvShow.overview && (
                            <div className="mt-8 pt-6 border-t border-white/10">
                                <h3 className="text-sm font-medium text-white/45 mb-2">La serie</h3>
                                <p className="text-white/60 leading-relaxed">{tvShow.overview}</p>
                            </div>
                        )}
                    </div>
                </div>
            }
        >
            <div className="relative w-full h-full">
                <VixsrcEmbedPlayer
                    key={`${tvId}-${season}-${episode}`}
                    tmdbId={tvShow.tmdb_id || tvShow.id}
                    type="tv"
                    season={season}
                    episode={episode}
                    title={`${tvShow.name} - S${season}E${episode}`}
                    startAt={startAt}
                    onPlayback={handlePlayback}
                    onEnded={handleEpisodeEnded}
                    onBack={exitPlayer}
                    unavailableTitle="Episodio non disponibile"
                    unavailableDescription={`L'episodio ${episode} della stagione ${season} non è disponibile su VixSrc.`}
                />
                {taste.moment && (
                    <TastePrompt
                        title={taste.title}
                        moment={taste.moment}
                        onSubmit={taste.submit}
                        onSkip={taste.skip}
                    />
                )}
                {offerNext && nextRef && (
                    <NextEpisodeOverlay
                        season={nextRef.season}
                        episode={nextRef.episode}
                        title={nextEpisodeData?.name || `Episodio ${nextRef.episode}`}
                        overview={nextEpisodeData?.overview}
                        stillUrl={
                            nextEpisodeData?.still_path
                                ? getTMDBImageUrl(nextEpisodeData.still_path, 'w500')
                                : null
                        }
                        onPlayNow={goToNextEpisode}
                        onCancel={() => setOfferNext(false)}
                    />
                )}
            </div>
        </PlayerShell>
    )
}
