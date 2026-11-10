import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Cache in memoria edge per azzerare la latenza e proteggere le quote Vercel (TTL 60s)
let cachedActiveDomain = 'the-fplace.vercel.app'
let lastActiveDomainCheck = 0
const CACHE_TTL_MS = 60_000

export async function resolveActiveDomain(request: NextRequest): Promise<string> {
    const now = Date.now()
    if (now - lastActiveDomainCheck < CACHE_TTL_MS) {
        return cachedActiveDomain
    }

    try {
        const protocol = request.nextUrl.protocol
        const host = request.headers.get('host') || 'the-fplace.vercel.app'
        const lookupUrl = `${protocol}//${host}/api/cron/check-usage`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 1200)

        const res = await fetch(lookupUrl, {
            signal: controller.signal,
            headers: { 'x-middleware-lookup': '1' },
        })
        clearTimeout(timeout)

        if (res.ok) {
            const data = await res.json()
            if (data && data.activeDomain) {
                cachedActiveDomain = data.activeDomain
                lastActiveDomainCheck = now
                return cachedActiveDomain
            }
        }
    } catch {
        // Fallback silenzioso: mantieni l'ultimo stato valido conosciuto
    }

    return cachedActiveDomain
}

export async function middleware(request: NextRequest) {
    const host = request.headers.get('host') || ''
    const path = request.nextUrl.pathname

    const isFplace = host.includes('the-fplace.vercel.app')
    const isHustlePlace = host.includes('the-hustle-place.vercel.app')

    // Routing interscambiabile e bidirezionale tra i due domini
    if (isFplace || isHustlePlace) {
        const activeDomain = await resolveActiveDomain(request)
        const targetIsHustle = activeDomain.includes('the-hustle-place.vercel.app')
        const targetIsFplace = activeDomain.includes('the-fplace.vercel.app')

        let shouldRedirect = false
        let targetHost = ''

        // Da the-fplace verso the-hustle-place
        if (isFplace && targetIsHustle) {
            shouldRedirect = true
            targetHost = 'the-hustle-place.vercel.app'
        }
        // Da the-hustle-place verso the-fplace
        else if (isHustlePlace && targetIsFplace) {
            shouldRedirect = true
            targetHost = 'the-fplace.vercel.app'
        }

        if (shouldRedirect) {
            const redirectUrl = new URL(request.url)
            redirectUrl.host = targetHost
            redirectUrl.protocol = 'https'

            // Preservazione identità e profilo TV tramite handoff device_id
            const cookieId = request.cookies.get('thp_device_id')?.value
            const headerId = request.headers.get('x-thp-device-id')
            const deviceId = cookieId || headerId
            if (deviceId && !redirectUrl.searchParams.has('device_id')) {
                redirectUrl.searchParams.set('device_id', deviceId)
            }

            return NextResponse.redirect(redirectUrl, 307)
        }
    }

    if (path === '/living' || path.startsWith('/living/')) {
        return NextResponse.rewrite(new URL('/tv-os.html', request.url))
    }

    return NextResponse.next()
}

export const config = {
    matcher: ['/living', '/living/:path*'],
}
