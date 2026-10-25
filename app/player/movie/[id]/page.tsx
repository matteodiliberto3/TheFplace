'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ErrorBoundary } from '@/components/error-boundary'
import { PlayerShell } from '@/components/player-shell'
import { VixsrcEmbedPlayer } from '@/components/vixsrc-embed-player'
import { TastePrompt, useTastePrompt } from '@/components/taste-prompt'
import { useTrackWatch } from '@/hooks/useTrackWatch'
import { resolvePlayerStartAt } from '@/lib/watch-history'
import { parseStartAtParam } from '@/lib/watch-progress'
import { getPlayerPath } from '@/lib/content-navigation'
import { Movie } from '@/types'
import { PageSpinner } from '@/components/ui/spinner'

interface MovieDetails extends Movie {
    runtime?: number
    genres?: Array<{ id: number; name: string }>
}

function createFallbackMovie(movieId: string): MovieDetails {
    const id = parseInt(movieId, 10)
    return {
        id,
        tmdb_id: id,
        title: `Film ${movieId}`,
        overview: `Film disponibile su vixsrc.to con TMDB ID ${movieId}.`,
        poster_path: '/placeholder-movie.svg',
        backdrop_path: '/placeholder-movie.svg',
        release_date: '',
        vote_average: 0,
        vote_count: 0,
        genre_ids: [],
        adult: false,
        original_language: 'it',
        original_title: `Film ${movieId}`,
        popularity: 0,
        video: false,
        runtime: 0,
        genres: [],
    }
}

export default function MoviePlayerPage() {
    const params = useParams()
    const searchParams = useSearchParams()
    const router = useRouter()
    const movieId = params.id as string
    const [movie, setMovie] = useState<MovieDetails | null>(null)
    const [loading, setLoading] = useState(true)
    const [ended, setEnded] = useState(false)
    const fetchedId = useRef<string | null>(null)

    useEffect(() => {
        if (fetchedId.current === movieId) return
        fetchedId.current = movieId

        const fetchMovieDetails = async () => {
            try {
                setLoading(true)
                const response = await fetch(`/api/tmdb/movies/${movieId}`)
                const data = await response.json()

                if (data.success && data.data) {
                    const tmdbMovie = data.data
                    setMovie({
                        id: tmdbMovie.id,
                        tmdb_id: tmdbMovie.id,
                        title: tmdbMovie.title,
                        overview: tmdbMovie.overview,
                        poster_path: tmdbMovie.poster_path,
                        backdrop_path: tmdbMovie.backdrop_path,
                        release_date: tmdbMovie.release_date,
                        vote_average: tmdbMovie.vote_average,
                        vote_count: tmdbMovie.vote_count ?? 0,
                        genre_ids: tmdbMovie.genre_ids ?? [],
                        adult: tmdbMovie.adult ?? false,
                        original_language: tmdbMovie.original_language ?? 'en',
                        original_title: tmdbMovie.original_title ?? tmdbMovie.title,
                        popularity: tmdbMovie.popularity ?? 0,
                        video: tmdbMovie.video ?? false,
                        runtime: tmdbMovie.runtime || 0,
                        genres: tmdbMovie.genres || [],
                    })
                    return
                }

                // Se la chiamata a movies fallisce, verifichiamo se l'ID appartiene a una serie TV
                try {
                    const tvResponse = await fetch(`/api/tmdb/tv/${movieId}`)
                    const tvData = await tvResponse.json()
                    if (tvData.success && tvData.data) {
                        const startAt = parseStartAtParam(searchParams.get('startAt'))
                        router.replace(
                            getPlayerPath(parseInt(movieId, 10), 'tv', {
                                season: 1,
                                episode: 1,
                                startAt,
                            })
                        )
                        return
                    }
                } catch {
                    // Fallback a film generico se la verifica TV fallisce
                }

                setMovie(createFallbackMovie(movieId))
            } catch {
                setMovie(createFallbackMovie(movieId))
            } finally {
                setLoading(false)
            }
        }

        fetchMovieDetails()
    }, [movieId, router, searchParams])

    const tmdbId = movie?.tmdb_id || movie?.id
    const startAt = useMemo(
        () =>
            tmdbId
                ? resolvePlayerStartAt({
                      id: tmdbId,
                      type: 'movie',
                      urlStartAt: parseStartAtParam(searchParams.get('startAt')),
                      runtimeSeconds: movie?.runtime ? movie.runtime * 60 : undefined,
                  })
                : undefined,
        [movie?.runtime, searchParams, tmdbId]
    )

    const trackPlayback = useTrackWatch(
        movie && tmdbId
            ? {
                  id: tmdbId,
                  type: 'movie',
                  title: movie.title,
                  poster_path: movie.poster_path,
                  backdrop_path: movie.backdrop_path,
              }
            : null
    )

    useEffect(() => {
        setEnded(false)
    }, [movieId])

    const taste = useTastePrompt({
        tmdbId,
        type: 'movie',
        title: movie?.title || '',
        ended,
    })

    const handleEnded = useCallback(() => setEnded(true), [])

    if (loading) {
        return <PageSpinner />
    }

    if (!movie) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="text-white text-xl">Film non trovato</div>
            </div>
        )
    }

    return (
        <ErrorBoundary>
            <PlayerShell
                backdropPath={movie.backdrop_path}
                onBack={() => router.back()}
                chromePaused={Boolean(taste.moment)}
                footer={
                    <div className="p-8 bg-black">
                        <div className="max-w-4xl mx-auto">
                            <h2 className="text-2xl font-bold mb-4">Informazioni</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <h3 className="text-lg font-semibold mb-2">Trama</h3>
                                    <p className="text-gray-300 leading-relaxed">{movie.overview}</p>
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold mb-2">Dettagli</h3>
                                    <div className="space-y-2 text-sm text-gray-300">
                                        <div>
                                            <span className="text-gray-400">Data di uscita:</span>{' '}
                                            {movie.release_date || 'Non disponibile'}
                                        </div>
                                        <div>
                                            <span className="text-gray-400">Valutazione:</span>{' '}
                                            {movie.vote_average.toFixed(1)}/10
                                        </div>
                                        {movie.genres && movie.genres.length > 0 && (
                                            <div>
                                                <span className="text-gray-400">Generi:</span>{' '}
                                                {movie.genres.map((g) => g.name).join(', ')}
                                            </div>
                                        )}
                                        {movie.runtime ? (
                                            <div>
                                                <span className="text-gray-400">Durata:</span> {movie.runtime} min
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                }
            >
                {tmdbId ? (
                    <VixsrcEmbedPlayer
                        key={tmdbId}
                        tmdbId={tmdbId}
                        type="movie"
                        title={movie.title}
                        startAt={startAt}
                        onPlaybackProgress={trackPlayback}
                        onEnded={handleEnded}
                    />
                ) : null}
                <TastePrompt
                    moment={taste.moment}
                    onRate={taste.rate}
                    onDismiss={taste.dismiss}
                />
            </PlayerShell>
        </ErrorBoundary>
    )
}
