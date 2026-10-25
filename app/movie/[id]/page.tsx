'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { MovieDetailView, MovieDetails } from '@/components/movie-detail-view'
import { getDetailsPath, getPlayerPath, isWatchableSearchParam } from '@/lib/content-navigation'
import { toast } from 'sonner'
import { PageSpinner } from '@/components/ui/spinner'

export default function MovieDetailPage() {
    const params = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const movieId = params.id as string
    const watchable = isWatchableSearchParam(searchParams.get('watch'))
    const [movie, setMovie] = useState<MovieDetails | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const fetchMovie = async () => {
            try {
                setLoading(true)
                setError(null)
                const response = await fetch(`/api/tmdb/movies/${movieId}`)
                const data = await response.json()

                if (data.success && data.data) {
                    const m = data.data
                    setMovie({
                        id: m.id,
                        tmdb_id: m.id,
                        title: m.title,
                        overview: m.overview,
                        poster_path: m.poster_path,
                        backdrop_path: m.backdrop_path,
                        release_date: m.release_date,
                        vote_average: m.vote_average,
                        vote_count: m.vote_count ?? 0,
                        genre_ids: m.genre_ids ?? [],
                        adult: m.adult ?? false,
                        original_language: m.original_language ?? 'en',
                        original_title: m.original_title ?? m.title,
                        popularity: m.popularity ?? 0,
                        video: m.video ?? false,
                        runtime: m.runtime,
                        genres: m.genres ?? [],
                    })
                    return
                }

                // Se non è un film, verifica se si tratta di una Serie TV (es. ID di una serie cercato per errore su /movie/[id])
                try {
                    const tvResponse = await fetch(`/api/tmdb/tv/${movieId}`)
                    const tvData = await tvResponse.json()
                    if (tvData.success && tvData.data) {
                        router.replace(getDetailsPath(Number(movieId), 'tv', { watchable }))
                        return
                    }
                } catch {
                    // Ignora errore fallback TV e mostra errore film
                }

                throw new Error('Film non trovato')
            } catch {
                setError('Impossibile caricare il film')
                toast.error('Non siamo riusciti a caricare i dettagli del film.')
            } finally {
                setLoading(false)
            }
        }

        fetchMovie()
    }, [movieId, router, watchable])

    if (loading) {
        return <PageSpinner />
    }

    if (error || !movie) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4 text-center">
                <h1 className="text-2xl font-semibold text-white mb-2">Film non trovato</h1>
                <p className="text-white/60 mb-6">Il titolo richiesto non è disponibile.</p>
                <button type="button" onClick={() => router.back()} className="btn-ghost-outline">
                    Torna indietro
                </button>
            </div>
        )
    }

    return (
        <MovieDetailView
            movie={movie}
            onPlay={
                watchable
                    ? () => router.push(getPlayerPath(parseInt(movieId, 10), 'movie'))
                    : undefined
            }
        />
    )
}
