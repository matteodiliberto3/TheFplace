/**
 * Pre-warms stream resolution in the background with low priority.
 * Populates server/relay cache so that clicking play starts in < 1s.
 */
export function prefetchPlayback(input: {
    id: number
    type: 'movie' | 'tv'
    season?: number
    episode?: number
}) {
    if (typeof window === 'undefined' && process.env.VITEST !== 'true') return
    const query = new URLSearchParams({
        tmdbId: String(input.id),
        type: input.type,
    })
    if (input.type === 'tv' && input.season && input.episode) {
        query.set('season', String(input.season))
        query.set('episode', String(input.episode))
    }
    try {
        void fetch(`/api/player/resolve?${query.toString()}`, {
            priority: 'low',
        } as RequestInit).catch(() => undefined)
    } catch {
        // Silent catch for prefetch
    }
}
