import { redirect } from 'next/navigation'
import { tmdbWrapperService } from '@/services/tmdb-wrapper.service'

interface LegacyPlayerPageProps {
    params: Promise<{ id: string }>
}

export default async function LegacyPlayerPage({ params }: LegacyPlayerPageProps) {
    const { id } = await params
    const numericId = parseInt(id, 10)

    if (Number.isFinite(numericId)) {
        try {
            const movie = await tmdbWrapperService.getMovieDetails(numericId)
            if (movie) {
                redirect(`/player/movie/${id}`)
            }
        } catch {
            // Se fallisce, controlliamo se è una serie TV
        }

        try {
            const tv = await tmdbWrapperService.getTVShowDetails(numericId)
            if (tv) {
                redirect(`/player/tv/${id}?season=1&episode=1`)
            }
        } catch {
            // Se fallisce, usiamo il fallback standard su movie
        }
    }

    redirect(`/player/movie/${id}`)
}
