import { NextRequest, NextResponse } from 'next/server'
import { resolveVixsrcHls } from '@/services/vixsrc-hls.service'
import { isConfirmedVixsrcMiss } from '@/lib/vixsrc-episode-status'
import { isMissingVixsrcStreamError } from '@/lib/player-resolve'

export const runtime = 'nodejs'
export const preferredRegion = ['fra1', 'cdg1']
export const maxDuration = 60

export async function GET(request: NextRequest) {
    const tmdbId = Number(request.nextUrl.searchParams.get('tmdbId'))
    const type = request.nextUrl.searchParams.get('type') === 'tv' ? 'tv' : 'movie'
    const season = Number(request.nextUrl.searchParams.get('season'))
    const episode = Number(request.nextUrl.searchParams.get('episode'))

    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
        return NextResponse.json({ success: false, error: 'TMDB ID non valido' }, { status: 400 })
    }
    if (type === 'tv' && (!Number.isInteger(season) || !Number.isInteger(episode) || season <= 0 || episode <= 0)) {
        return NextResponse.json({ success: false, error: 'Stagione o episodio mancanti' }, { status: 400 })
    }

    try {
        const resolved = await resolveVixsrcHls({
            tmdbId,
            type,
            season: type === 'tv' ? season : undefined,
            episode: type === 'tv' ? episode : undefined,
            fresh: request.nextUrl.searchParams.get('fresh') === '1',
        })

        return NextResponse.json({
            success: true,
            data: {
                master: resolved.master,
                parts: resolved.parts,
                videoId: resolved.videoId,
            },
        })
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                error: (error instanceof Error ? error.message : 'Impossibile risolvere lo stream'),
                missing: isConfirmedVixsrcMiss(error instanceof Error ? error.message : '') || isMissingVixsrcStreamError(error instanceof Error ? error.message : ''),
            },
            { status: (isConfirmedVixsrcMiss(error instanceof Error ? error.message : '') || isMissingVixsrcStreamError(error instanceof Error ? error.message : '')) ? 404 : 502 }
        )
    }
}
