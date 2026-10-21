'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ContentType } from '@/lib/content-navigation'
import { getContentPosterUrl } from '@/lib/content-display'
import { getTMDBImageUrl } from '@/lib/tmdb'
import { livingHomePath, livingPlayerPath } from '@/tv/lib/paths'
import { TvFocus } from '@/tv/components/TvFocus'
import { TvNav } from '@/tv/components/TvNav'
import { Season } from '@/types'
import { resolvePlayerStartAt } from '@/lib/watch-history'
import { prefetchPlayback } from '@/lib/player-prefetch'
import { useWatchHistory } from '@/hooks/useWatchHistory'

interface TvDetailProps {
    id: number
    type: ContentType
}

interface DetailData {
    title: string
    overview: string
    poster: string | null
    backdrop: string | null
    year?: string
}

export function TvDetail({ id, type }: TvDetailProps) {
    const router = useRouter()
    const { entries } = useWatchHistory()
    const [detail, setDetail] = useState<DetailData | null>(null)
    const [seasons, setSeasons] = useState<Season[]>([])
    const [season, setSeason] = useState(1)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        async function load() {
            try {
                const path = type === 'tv' ? `/api/tmdb/tv/${id}` : `/api/tmdb/movies/${id}`
                const response = await fetch(path)
                const data = await response.json()
                if (!data.success || !data.data) {
                    throw new Error('missing')
                }
                const raw = data.data
                if (cancelled) return
                setDetail({
                    title: raw.title || raw.name,
                    overview: raw.overview ?? '',
                    poster: raw.poster_path,
                    backdrop: raw.backdrop_path,
                    year: (raw.release_date || raw.first_air_date || '').slice(0, 4),
                })
                if (type === 'tv') {
                    const seasonsRes = await fetch(`/api/tmdb/tv/${id}/seasons`)
                    const seasonsData = await seasonsRes.json()
                    if (seasonsData.success && Array.isArray(seasonsData.data)) {
                        const list = (seasonsData.data as Season[]).filter((item) => item.season_number > 0)
                        setSeasons(list)
                        if (list[0]) setSeason(list[0].season_number)
                    }
                }
            } catch {
                if (!cancelled) setError('Impossibile caricare il titolo')
            }
        }
        void load()
        return () => {
            cancelled = true
        }
    }, [id, type])

    const currentSeason = seasons.find((item) => item.season_number === season)
    const history = entries.find((item) => item.id === id && item.type === type)

    useEffect(() => {
        if (!detail) return
        const targetSeason = type === 'tv' ? (history?.season || season || 1) : undefined
        const targetEpisode = type === 'tv' ? (history?.episode || 1) : undefined
        prefetchPlayback({ id, type, season: targetSeason, episode: targetEpisode })
    }, [detail, history, id, season, type])

    function play(nextSeason?: number, episode?: number) {
        const isTargetMatch =
            history &&
            (type !== 'tv' ||
                (history.season === (nextSeason ?? season) && (episode == null || history.episode === episode)))
        const startAt = resolvePlayerStartAt({
            id,
            type,
            season: nextSeason,
            episode,
            urlStartAt: isTargetMatch ? history?.currentTime : undefined,
        })
        router.push(
            livingPlayerPath(id, type, {
                season: nextSeason,
                episode,
                startAt,
            })
        )
    }

    return (
        <div className="flex min-h-screen flex-col gap-8">
            <TvNav />
            {error && <p className="text-2xl text-white/60">{error}</p>}
            {detail && (
                <section className="relative isolate overflow-hidden rounded-2xl bg-zinc-950">
                    {detail.backdrop && (
                        <div
                            className="absolute inset-0 bg-cover bg-center opacity-30"
                            style={{ backgroundImage: `url(${getTMDBImageUrl(detail.backdrop, 'original')})` }}
                        />
                    )}
                    <div className="relative z-10 grid grid-cols-[14rem_minmax(0,1fr)] gap-8 p-8">
                        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-zinc-900">
                            <Image
                                src={getContentPosterUrl(detail.poster)}
                                alt={detail.title}
                                fill
                                className="object-cover"
                                sizes="224px"
                            />
                        </div>
                        <div className="flex flex-col justify-center">
                            <h1 className="text-5xl font-semibold text-white">{detail.title}</h1>
                            {detail.year && <p className="mt-2 text-xl text-white/50">{detail.year}</p>}
                            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-white/70">{detail.overview}</p>
                            <div className="mt-8 flex gap-3">
                                <TvFocus
                                    autoFocusItem
                                    onClick={() =>
                                        play(
                                            type === 'tv' ? (history?.season || season) : undefined,
                                            type === 'tv' ? (history?.episode || 1) : undefined
                                        )
                                    }
                                    className="h-14 rounded-lg bg-white px-8 text-lg font-semibold text-black"
                                >
                                    Riproduci
                                </TvFocus>
                                <TvFocus
                                    onClick={() => router.push(livingHomePath())}
                                    className="h-14 rounded-lg bg-white/15 px-8 text-lg text-white"
                                >
                                    Home
                                </TvFocus>
                            </div>
                        </div>
                    </div>
                </section>
            )}
            {type === 'tv' && seasons.length > 0 && (
                <section className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {seasons.map((item) => (
                            <TvFocus
                                key={item.id}
                                onClick={() => setSeason(item.season_number)}
                                className={`rounded-lg px-4 py-3 text-lg ${
                                    item.season_number === season ? 'bg-white text-black' : 'bg-white/10 text-white'
                                }`}
                            >
                                Stagione {item.season_number}
                            </TvFocus>
                        ))}
                    </div>
                    <div
                        data-tv-loop=""
                        className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {(currentSeason?.episodes ?? []).map((episode) => (
                            <TvFocus
                                key={episode.id}
                                onClick={() => play(season, episode.episode_number)}
                                className="w-64 shrink-0 rounded-lg bg-white/8 p-4 text-left"
                            >
                                <p className="text-sm text-white/45">Ep. {episode.episode_number}</p>
                                <p className="mt-1 text-lg text-white">{episode.name}</p>
                            </TvFocus>
                        ))}
                    </div>
                </section>
            )}
        </div>
    )
}
