export interface ResumeSeason {
    season_number: number
    episodes: Array<{ episode_number: number }>
}

export interface ResumePosition {
    season: number
    episode: number
    progress?: number
}

function episodeExists(seasons: ResumeSeason[], season: number, episode: number): boolean {
    const seasonData = seasons.find((item) => item.season_number === season)
    return Boolean(seasonData?.episodes.some((item) => item.episode_number === episode))
}

export function findNextResumeEpisode(
    seasons: ResumeSeason[],
    seasonNum: number,
    episodeNum: number
): ResumePosition | null {
    const currentSeason = seasons.find((item) => item.season_number === seasonNum)
    if (currentSeason) {
        const nextInSeason = currentSeason.episodes.find((item) => item.episode_number === episodeNum + 1)
        if (nextInSeason) {
            return { season: seasonNum, episode: episodeNum + 1 }
        }
    }
    const nextSeason = seasons.find((item) => item.season_number === seasonNum + 1)
    if (nextSeason?.episodes?.length) {
        return { season: nextSeason.season_number, episode: nextSeason.episodes[0].episode_number }
    }
    return null
}

export function resolveSeriesResume(input: {
    querySeason?: number | null
    queryEpisode?: number | null
    lastWatched?: ResumePosition | null
    seasons: ResumeSeason[]
}): ResumePosition {
    const hasExplicitQuery = input.querySeason != null && input.queryEpisode != null
    const watchedCandidate =
        !hasExplicitQuery && input.lastWatched && (input.lastWatched.progress ?? 0) >= 95
            ? findNextResumeEpisode(input.seasons, input.lastWatched.season, input.lastWatched.episode) ?? input.lastWatched
            : input.lastWatched

    const candidates: Array<ResumePosition | null | undefined> = [
        hasExplicitQuery ? { season: input.querySeason!, episode: input.queryEpisode! } : null,
        watchedCandidate,
    ]

    for (const candidate of candidates) {
        if (!candidate) continue
        if (candidate.season < 1 || candidate.episode < 1) continue
        if (input.seasons.length === 0 || episodeExists(input.seasons, candidate.season, candidate.episode)) {
            return { season: candidate.season, episode: candidate.episode }
        }
    }

    const firstSeason = input.seasons[0]
    const firstEpisode = firstSeason?.episodes[0]
    return {
        season: firstSeason?.season_number ?? 1,
        episode: firstEpisode?.episode_number ?? 1,
    }
}
