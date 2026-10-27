/**
 * Helper per chiamate API TMDB
 * Centralizza la configurazione e gestione delle richieste
 */

export interface TMDBResponse<T> {
    page: number
    results: T[]
    total_pages: number
    total_results: number
}

export interface TMDBMovie {
    id: number
    title: string
    original_title: string
    overview: string
    poster_path: string | null
    backdrop_path: string | null
    release_date: string
    vote_average: number
    vote_count: number
    popularity: number
    adult: boolean
    video: boolean
    genre_ids: number[]
    original_language: string
    media_type?: 'movie' | 'tv'
    name?: string
    first_air_date?: string
}

export function getMediaTitle(item: { title?: string; name?: string } | null | undefined): string {
    return item?.title?.trim() || item?.name?.trim() || 'Titolo non disponibile'
}

export interface TMDBTVShow {
    id: number
    name: string
    original_name: string
    overview: string
    poster_path: string | null
    backdrop_path: string | null
    first_air_date: string
    vote_average: number
    vote_count: number
    popularity: number
    adult: boolean
    video: boolean
    genre_ids: number[]
    original_language: string
    origin_country: string[]
}

export interface TMDBVideo {
    id: string
    iso_639_1: string
    iso_3166_1: string
    key: string
    name: string
    official: boolean
    published_at: string
    site: string
    size: number
    type: string
}

export interface TMDBVideosResponse {
    id: number
    results: TMDBVideo[]
}

/**
 * Funzione helper per chiamate API TMDB
 * @param endpoint - Endpoint TMDB (es. 'trending/movie/day')
 * @returns Promise con i dati della risposta
 */
export async function fetchFromTMDB<T>(endpoint: string): Promise<T> {
    const apiKey = process.env.TMDB_API_KEY

    if (!apiKey) {
        throw new Error('TMDB_API_KEY non configurata')
    }

    const baseUrl = 'https://api.themoviedb.org/3'
    const joiner = endpoint.includes('?') ? '&' : '?'
    const url = `${baseUrl}/${endpoint}${joiner}api_key=${apiKey}&language=it-IT&region=IT`

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            next: { revalidate: 3600 } // Cache per 1 ora
        })

        if (!response.ok) {
            throw new Error(`TMDB API Error: ${response.status} ${response.statusText}`)
        }

        const data = await response.json()
        return data as T
    } catch (error) {
        console.error('Errore chiamata TMDB:', error)
        throw error
    }
}

/**
 * Recupera film trending del giorno
 */
export async function getTrendingMoviesDay(): Promise<TMDBResponse<TMDBMovie>> {
    return fetchFromTMDB<TMDBResponse<TMDBMovie>>('trending/movie/day')
}

/**
 * Recupera contenuti trending della settimana
 */
export async function getTrendingAllWeek(): Promise<TMDBResponse<TMDBMovie | TMDBTVShow>> {
    return fetchFromTMDB<TMDBResponse<TMDBMovie | TMDBTVShow>>('trending/all/week')
}

/**
 * Recupera film ora in programmazione
 */
export async function getNowPlayingMovies(): Promise<TMDBResponse<TMDBMovie>> {
    return fetchFromTMDB<TMDBResponse<TMDBMovie>>('movie/now_playing')
}

/**
 * Recupera film in arrivo
 */
export async function getUpcomingMovies(): Promise<TMDBResponse<TMDBMovie>> {
    return fetchFromTMDB<TMDBResponse<TMDBMovie>>('movie/upcoming')
}

/**
 * Recupera trailer di un film
 */
export async function getMovieVideos(movieId: number): Promise<TMDBVideosResponse> {
    return fetchFromTMDB<TMDBVideosResponse>(`movie/${movieId}/videos`)
}

/**
 * Recupera dettagli di un film
 */
export async function getMovieDetails(movieId: number): Promise<TMDBMovie> {
    return fetchFromTMDB<TMDBMovie>(`movie/${movieId}`)
}

function isYouTubePreview(video: TMDBVideo): boolean {
    return (
        video.site === 'YouTube' &&
        (video.type === 'Trailer' || video.type === 'Teaser')
    )
}

function hasItalianName(video: TMDBVideo): boolean {
    return /(^|[^a-z])(ita|italiano|italian)([^a-z]|$)/i.test(video.name ?? '')
}

function trailerLanguageScore(video: TMDBVideo): number {
    let score = 0
    if (video.iso_639_1 === 'it') score += 100
    if (hasItalianName(video)) score += 80
    if (video.iso_3166_1 === 'IT') score += 15
    if (video.type === 'Trailer') score += 10
    if (video.official) score += 5
    if (video.iso_639_1 === 'en') score += 1
    return score
}

/**
 * Trailer YouTube da mostrare: italiano anche se non ufficiale, poi inglese, poi qualunque.
 */
export function findMainTrailer(videos: TMDBVideo[]): TMDBVideo | null {
    const candidates = videos.filter(isYouTubePreview)
    if (candidates.length === 0) return null

    const italian = candidates.filter(
        (video) => video.iso_639_1 === 'it' || hasItalianName(video)
    )
    const pool = italian.length > 0 ? italian : candidates

    return [...pool].sort((left, right) => trailerLanguageScore(right) - trailerLanguageScore(left))[0] ?? null
}

/**
 * Genera URL immagine TMDB
 */
export function getTMDBImageUrl(path: string | null, size: 'w500' | 'w780' | 'original' = 'w500'): string {
    if (!path) return '/placeholder-movie.svg'
    return `https://image.tmdb.org/t/p/${size}${path}`
}

/**
 * Genera URL YouTube embed
 */
export function getYouTubeEmbedUrl(videoKey: string, autoplay: boolean = true, mute: boolean = true, loop: boolean = false): string {
    const params = new URLSearchParams({
        enablejsapi: '1', // Abilita API JavaScript per ricevere eventi (ended, play, pause, ecc.)
        autoplay: autoplay ? '1' : '0',
        mute: mute ? '1' : '0',
        controls: '0',
        showinfo: '0',
        rel: '0',
        modestbranding: '1',
        origin: typeof window !== 'undefined' ? window.location.origin : ''
    })

    // Loop solo se esplicitamente richiesto (per esempio nella griglia film)
    if (loop) {
        params.append('loop', '1')
        params.append('playlist', videoKey) // playlist è necessario per il loop
    }

    return `https://www.youtube.com/embed/${videoKey}?${params.toString()}`
}

/**
 * Estrae il videoId da una chiave YouTube o URL
 */
export function extractYouTubeVideoId(trailerKey: string): string | null {
    // Se è già un videoId puro
    if (trailerKey && !trailerKey.includes('/') && !trailerKey.includes('?')) {
        return trailerKey
    }
    
    // Se è un URL YouTube completo
    const urlMatch = trailerKey.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/)
    if (urlMatch) {
        return urlMatch[1]
    }
    
    // Se è già una chiave YouTube (formato standard)
    if (trailerKey && trailerKey.length === 11) {
        return trailerKey
    }
    
    console.warn('⚠️ Impossibile estrarre videoId da:', trailerKey)
    return null
}

export interface TMDBTVDetails extends TMDBTVShow {
    next_episode_to_air?: {
        id: number
        name: string
        overview: string
        vote_average: number
        vote_count: number
        air_date: string | null
        episode_number: number
        episode_type?: string
        season_number: number
        show_id: number
        still_path: string | null
    } | null
    last_episode_to_air?: {
        id: number
        name: string
        overview: string
        vote_average: number
        air_date: string | null
        episode_number: number
        season_number: number
        show_id: number
        still_path: string | null
    } | null
    status: string
    number_of_seasons: number
    number_of_episodes: number
    genres: Array<{ id: number; name: string }>
    seasons?: Array<{
        id: number
        name: string
        overview?: string
        air_date: string | null
        episode_count: number
        season_number: number
        poster_path?: string | null
    }>
}

export async function getTVDetails(tvId: number): Promise<TMDBTVDetails> {
    return fetchFromTMDB<TMDBTVDetails>(`tv/${tvId}`)
}

export async function getTVVideos(tvId: number): Promise<TMDBVideosResponse> {
    return fetchFromTMDB<TMDBVideosResponse>(`tv/${tvId}/videos`)
}

export async function getOnTheAirTV(): Promise<TMDBResponse<TMDBTVShow>> {
    return fetchFromTMDB<TMDBResponse<TMDBTVShow>>('tv/on_the_air')
}

export async function discoverUpcomingTV(params: {
    withGenres?: string
    withoutGenres?: string
    airDateGte?: string
    firstAirDateGte?: string
    page?: number
}): Promise<TMDBResponse<TMDBTVShow>> {
    const searchParams = new URLSearchParams({
        sort_by: 'popularity.desc',
        include_adult: 'false',
    })
    if (params.withGenres) {
        searchParams.set('with_genres', params.withGenres)
    }
    if (params.withoutGenres) {
        searchParams.set('without_genres', params.withoutGenres)
    }
    if (params.airDateGte) {
        searchParams.set('air_date.gte', params.airDateGte)
    }
    if (params.firstAirDateGte) {
        searchParams.set('first_air_date.gte', params.firstAirDateGte)
    }
    if (params.page) {
        searchParams.set('page', String(params.page))
    }
    return fetchFromTMDB<TMDBResponse<TMDBTVShow>>(`discover/tv?${searchParams.toString()}`)
}




