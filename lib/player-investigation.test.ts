import { describe, expect, it, vi, beforeEach } from 'vitest'
import { resumeStartAt, progressPercent } from './watch-progress'
import {
    resolvePlayerStartAt,
    getResumeStartAt,
    trackWatchEntry,
    getWatchHistory,
    setWatchHistoryProfile,
    WatchHistoryEntry,
} from './watch-history'
import { getPlayerPath } from './content-navigation'
import { resolveSeriesResume } from './series-resume'
import { fetchResolvedPlayback } from './player-resolve'
import { resolveContentType } from './content-display'

describe('REVERSE ENGINEERING SUITE: Diagnosi Riproduzione e Continua a Guardare', () => {
    beforeEach(() => {
        const store: Record<string, string> = {}
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
        vi.stubGlobal('localStorage', {
            getItem(key: string) {
                return store[key] ?? null
            },
            setItem(key: string, value: string) {
                store[key] = value
            },
            removeItem(key: string) {
                delete store[key]
            },
        })
        vi.stubGlobal('window', {
            dispatchEvent: vi.fn(),
        })
        setWatchHistoryProfile(null)
    })

    describe('Test 1: Calcolo resumeStartAt e gestione duration', () => {
        it('quando un record arriva da Supabase, duration non esiste nel DB', () => {
            const remoteEntryFromDb: WatchHistoryEntry = {
                id: 100,
                type: 'movie',
                title: 'Dune Part 2',
                currentTime: 1200,
                progress: 25,
                duration: undefined,
                continueHidden: false,
                watchedAt: Date.now() - 10000,
            }

            const startAt = resumeStartAt({
                currentTime: remoteEntryFromDb.currentTime,
                duration: remoteEntryFromDb.duration,
            })

            expect(startAt).toBe(1200)
        })

        it('se la riproduzione è quasi alla fine (>= 95%), resumeStartAt restituisce undefined per riavviare da capo', () => {
            const finishedMovie: WatchHistoryEntry = {
                id: 100,
                type: 'movie',
                title: 'Dune Part 2',
                currentTime: 98,
                duration: 100,
                progress: 98,
                continueHidden: false,
                watchedAt: Date.now(),
            }

            const startAt = resumeStartAt({
                currentTime: finishedMovie.currentTime,
                duration: finishedMovie.duration,
            })

            expect(startAt).toBeUndefined()
        })
    })

    describe('Test 2: Navigazione ContinueWatchingRow -> getPlayerPath per Film e Serie TV', () => {
        it('costruisce correttamente il percorso di riproduzione con startAt', () => {
            const moviePath = getPlayerPath(755898, 'movie', { startAt: 850 })
            expect(moviePath).toBe('/player/movie/755898?startAt=850')

            const tvPath = getPlayerPath(1399, 'tv', { season: 2, episode: 5, startAt: 420 })
            expect(tvPath).toBe('/player/tv/1399?startAt=420&season=2&episode=5')
        })

        it('se season o episode sono mancanti nella riga, getPlayerPath fa fallback a /series', () => {
            const tvPathNoEp = getPlayerPath(1399, 'tv', { startAt: 420 })
            expect(tvPathNoEp).toBe('/series/1399')
        })
    })

    describe('Test 3: Riproduzione The Diplomat (TV Show 203857) e routing dei tipi', () => {
        it('risolve correttamente il tipo "tv" per The Diplomat anche da rail mista', () => {
            const itemFromMixedShelf = {
                id: 203857,
                name: 'The Diplomat',
                first_air_date: '2023-04-20',
                media_type: 'tv',
            }

            const contentType = resolveContentType(itemFromMixedShelf, 'movie')
            expect(contentType).toBe('tv')

            const playPath = getPlayerPath(itemFromMixedShelf.id, contentType, { season: 1, episode: 1 })
            expect(playPath).toBe('/player/tv/203857?season=1&episode=1')
        })

        it('identifica come "tv" un elemento che possiede solo first_air_date o name', () => {
            const item = {
                id: 203857,
                name: 'The Diplomat',
                first_air_date: '2023-04-20',
            }
            expect(resolveContentType(item, 'movie')).toBe('tv')
        })
    })

    describe('Test 4: Recupero e fallback riproduzione VixSrc', () => {
        it('fetchResolvedPlayback effettua retry con backoff e recupera il risultato', async () => {
            let calls = 0
            const fetchMock = vi.fn().mockImplementation(async () => {
                calls++
                if (calls === 1) {
                    return new Response(JSON.stringify({ success: false, error: 'Temporary failure' }), { status: 500 })
                }
                return new Response(
                    JSON.stringify({
                        success: true,
                        data: {
                            master: 'https://vixsrc.to/hls/master.m3u8',
                            fallback: null,
                        },
                    }),
                    { status: 200 }
                )
            })

            const result = await fetchResolvedPlayback(new URLSearchParams({ tmdbId: '755898', type: 'movie' }), {
                fetch: fetchMock,
                wait: async () => undefined,
                attempts: 3,
            })

            expect(result.data).toBeDefined()
            expect(result.data?.master).toBe('https://vixsrc.to/hls/master.m3u8')
            expect(calls).toBe(2)
        })

        it('fetchResolvedPlayback identifica risposta 403 e non la marca come contenuto mancante', async () => {
            const fetchMock = vi.fn().mockImplementation(async () => {
                return new Response(JSON.stringify({ success: false, error: 'API VixSrc non disponibile (403)' }), { status: 502 })
            })

            const result = await fetchResolvedPlayback(new URLSearchParams({ tmdbId: '755898', type: 'movie' }), {
                fetch: fetchMock,
                wait: async () => undefined,
                attempts: 2,
            })

            expect(result.data).toBeUndefined()
            expect(result.error).toBe('API VixSrc non disponibile (403)')
            expect(result.missing).toBe(false)
        })
    })

    describe('Test 5: RISOLTO - Serie TV finita avanza al prossimo episodio', () => {
        it('resolveSeriesResume seleziona automaticamente la puntata successiva se la precedente è finita (>= 95%)', () => {
            const seasons = [
                {
                    season_number: 1,
                    episodes: [{ episode_number: 1 }, { episode_number: 2 }, { episode_number: 3 }],
                },
            ]

            const lastWatched = { season: 1, episode: 2, progress: 100 }

            const resume = resolveSeriesResume({
                lastWatched,
                seasons,
            })

            expect(resume).toEqual({ season: 1, episode: 3 })
        })
    })
})
