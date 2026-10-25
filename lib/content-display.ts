import { ContentType } from '@/lib/content-navigation'
import { Movie, TVShow } from '@/types'
import { getTMDBImageUrl } from '@/lib/tmdb'

export type ContentItem = (Movie | TVShow) & {
    contentType?: ContentType
    tmdb_id?: number
}

export function getContentTitle(item: ContentItem, type: ContentType = 'movie'): string {
    const movieTitle = (item as Movie).title?.trim()
    const showName = (item as TVShow).name?.trim()
    const title = type === 'tv' ? showName || movieTitle : movieTitle || showName
    return title || 'Titolo non disponibile'
}

export function resolveContentType(
    item: {
        contentType?: ContentType
        type?: ContentType
        media_type?: string
        first_air_date?: string
        name?: string
        title?: string
    },
    fallback: ContentType = 'movie'
): ContentType {
    if (item.contentType === 'movie' || item.contentType === 'tv') {
        return item.contentType
    }
    if (item.type === 'movie' || item.type === 'tv') {
        return item.type
    }
    if (item.media_type === 'movie' || item.media_type === 'tv') {
        return item.media_type
    }
    if (item.first_air_date !== undefined || (item.name !== undefined && !item.title)) {
        return 'tv'
    }
    return fallback
}

export function getContentPosterUrl(path?: string | null, size: 'w500' | 'w780' | 'original' = 'w500') {
    if (!path || path === '/placeholder-movie.svg') {
        return '/placeholder-movie.svg'
    }
    return getTMDBImageUrl(path, size)
}
