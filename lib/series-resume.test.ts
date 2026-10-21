import { describe, expect, it } from 'vitest'
import { resolveSeriesResume } from '@/lib/series-resume'

const seasons = [
    {
        season_number: 1,
        episodes: [{ episode_number: 1 }, { episode_number: 2 }],
    },
    {
        season_number: 2,
        episodes: [{ episode_number: 1 }, { episode_number: 5 }],
    },
]

describe('resolveSeriesResume', () => {
    it('preferisce i query param se la puntata esiste', () => {
        expect(
            resolveSeriesResume({
                querySeason: 2,
                queryEpisode: 5,
                lastWatched: { season: 1, episode: 2 },
                seasons,
            })
        ).toEqual({ season: 2, episode: 5 })
    })

    it('usa lo storico se la query non è valida', () => {
        expect(
            resolveSeriesResume({
                querySeason: 9,
                queryEpisode: 9,
                lastWatched: { season: 2, episode: 5 },
                seasons,
            })
        ).toEqual({ season: 2, episode: 5 })
    })

    it('avanza alla puntata successiva se la precedente è completata (progress >= 95)', () => {
        expect(
            resolveSeriesResume({
                lastWatched: { season: 1, episode: 1, progress: 98 },
                seasons,
            })
        ).toEqual({ season: 1, episode: 2 })
    })

    it('avanza alla stagione successiva se l\'ultimo episodio della stagione è completato', () => {
        expect(
            resolveSeriesResume({
                lastWatched: { season: 1, episode: 2, progress: 100 },
                seasons,
            })
        ).toEqual({ season: 2, episode: 1 })
    })

    it('rimane sull\'ultima puntata se è il finale dell\'intera serie', () => {
        expect(
            resolveSeriesResume({
                lastWatched: { season: 2, episode: 5, progress: 100 },
                seasons,
            })
        ).toEqual({ season: 2, episode: 5 })
    })

    it('torna alla prima puntata disponibile come fallback', () => {
        expect(
            resolveSeriesResume({
                querySeason: null,
                queryEpisode: null,
                lastWatched: null,
                seasons,
            })
        ).toEqual({ season: 1, episode: 1 })
    })
})
