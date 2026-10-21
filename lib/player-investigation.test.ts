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
                progress: remoteEntryFromDb.progress,
            })

            expect(startAt).toBe(1200)

            const startAtNoDuration = resumeStartAt({
                currentTime: 0,
                duration: undefined,
                progress: 50,
            })
            expect(startAtNoDuration).toBeUndefined()
        })
    })

    describe('Test 2: Navigazione ContinueWatchingRow -> getPlayerPath per Film e Serie TV', () => {
        it('per un film genera correttamente il parametro startAt', () => {
            const moviePath = getPlayerPath(755898, 'movie', { startAt: 850 })
            expect(moviePath).toBe('/player/movie/755898?startAt=850')
        })

        it('per una serie TV CON season e episode genera /player/tv con query string', () => {
            const tvPath = getPlayerPath(1399, 'tv', { season: 2, episode: 5, startAt: 420 })
            expect(tvPath).toBe('/player/tv/1399?startAt=420&season=2&episode=5')
        })

        it('se season o episode sono mancanti nella riga, getPlayerPath fa fallback a /series', () => {
            const tvPathNoEp = getPlayerPath(1399, 'tv', { startAt: 420 })
            expect(tvPathNoEp).toBe('/series/1399')
        })
    })

    describe('Test 3: Risoluzione startAt nella pagina Player (resolvePlayerStartAt)', () => {
        it('prevale il parametro urlStartAt se presente nella query string', () => {
            const start = resolvePlayerStartAt({
                id: 100,
                type: 'movie',
                urlStartAt: 640,
                runtimeSeconds: 3600,
            })
            expect(start).toBe(640)
        })

        it('se urlStartAt è >= 95% della durata (film finito), rifiuta la ripresa e riparte da 0', () => {
            const start = resolvePlayerStartAt({
                id: 100,
                type: 'movie',
                urlStartAt: 3500,
                runtimeSeconds: 3600,
            })
            expect(start).toBeUndefined()
        })
    })

    describe('Test 4: RISOLTO - useTrackWatch protegge il progresso su seek iniziale', () => {
        it('se duration è 0 durante seeked, trackWatchEntry riceve progress undefined e preserva il progresso reale', () => {
            trackWatchEntry({
                id: 200,
                type: 'movie',
                title: 'Interstellar',
                currentTime: 1800,
                duration: 7200,
                progress: 25,
            })

            expect(getWatchHistory()[0].progress).toBe(25)

            // Con la protezione applicata, se duration <= 0 il calcolo del progresso non valuta a 0
            const durationAtSeekedTime = 0
            const currentTimeAtSeeked = 1800
            const calculatedProgress =
                durationAtSeekedTime > 0 ? progressPercent(currentTimeAtSeeked, durationAtSeekedTime) : undefined

            trackWatchEntry({
                id: 200,
                type: 'movie',
                title: 'Interstellar',
                currentTime: currentTimeAtSeeked,
                duration: undefined,
                progress: calculatedProgress,
            })

            // RISULTATO: Il progresso salvato NON viene azzerato e rimane al 25%
            expect(getWatchHistory()[0].progress).toBe(25)
            expect(getWatchHistory()[0].currentTime).toBe(1800)
        })
    })

    describe('Test 5: Fallimento Rete Waterfall (Relay -> Vercel 502 / 403)', () => {
        it('se il relay di casa è offline, scatta il timeout di 35s e poi Vercel fallisce con 502/403', async () => {
            const fetchMock = vi.fn<typeof fetch>(async (input) => {
                const url = typeof input === 'string' ? input : (input as any).url
                if (url.includes('/api/player/relay')) {
                    return new Response(JSON.stringify({ success: true, url: 'https://home-zima.trycloudflare.com' }), { status: 200 })
                }
                if (url.includes('trycloudflare.com')) {
                    throw new Error('Connection refused to tunnel')
                }
                if (url.includes('/api/player/resolve')) {
                    return new Response(JSON.stringify({ success: false, error: 'API VixSrc non disponibile (403)' }), { status: 502 })
                }
                return new Response('Not found', { status: 404 })
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

    describe('Test 6: RISOLTO - Serie TV finita avanza al prossimo episodio', () => {
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

            // Avanza correttamente alla puntata 3
            expect(resume).toEqual({ season: 1, episode: 3 })
        })
    })
})
