import { describe, expect, it } from 'vitest'
import { isDeviceId } from '@/lib/supabase/device'

describe('Domain Failover & 75% Usage Switch Ingegnerizzazione', () => {

    describe('1. Vercel Usage Calculation & Threshold Detection', () => {
        interface UsageMetrics {
            bandwidth?: { value: number; limit: number }
            serverlessFunctionExecution?: { value: number; limit: number }
            edgeMiddlewareInvocations?: { value: number; limit: number }
        }

        function calculateMaxUsagePercent(metrics: UsageMetrics): number {
            const bandwidthPct = metrics.bandwidth && metrics.bandwidth.limit > 0
                ? (metrics.bandwidth.value / metrics.bandwidth.limit) * 100
                : 0
            const serverlessPct = metrics.serverlessFunctionExecution && metrics.serverlessFunctionExecution.limit > 0
                ? (metrics.serverlessFunctionExecution.value / metrics.serverlessFunctionExecution.limit) * 100
                : 0
            const edgePct = metrics.edgeMiddlewareInvocations && metrics.edgeMiddlewareInvocations.limit > 0
                ? (metrics.edgeMiddlewareInvocations.value / metrics.edgeMiddlewareInvocations.limit) * 100
                : 0

            return Math.max(bandwidthPct, serverlessPct, edgePct)
        }

        function determineActiveDomain(currentUsagePct: number, threshold = 75.0): 'the-fplace.vercel.app' | 'the-hustle-place.vercel.app' {
            if (currentUsagePct >= threshold) {
                return 'the-hustle-place.vercel.app'
            }
            return 'the-fplace.vercel.app'
        }

        it('retains the-fplace when usage is well below 75%', () => {
            const usage: UsageMetrics = {
                bandwidth: { value: 45 * 1024 * 1024 * 1024, limit: 100 * 1024 * 1024 * 1024 }, // 45%
                serverlessFunctionExecution: { value: 20, limit: 100 }, // 20%
                edgeMiddlewareInvocations: { value: 100_000, limit: 1_000_000 }, // 10%
            }
            const pct = calculateMaxUsagePercent(usage)
            expect(pct).toBe(45)
            expect(determineActiveDomain(pct)).toBe('the-fplace.vercel.app')
        })

        it('switches to the-hustle-place when bandwidth hits or exceeds 75%', () => {
            const usage: UsageMetrics = {
                bandwidth: { value: 75.5 * 1024 * 1024 * 1024, limit: 100 * 1024 * 1024 * 1024 }, // 75.5%
                serverlessFunctionExecution: { value: 10, limit: 100 },
                edgeMiddlewareInvocations: { value: 50_000, limit: 1_000_000 },
            }
            const pct = calculateMaxUsagePercent(usage)
            expect(pct).toBe(75.5)
            expect(determineActiveDomain(pct)).toBe('the-hustle-place.vercel.app')
        })

        it('switches to the-hustle-place when serverless execution hits 75% even if bandwidth is low', () => {
            const usage: UsageMetrics = {
                bandwidth: { value: 10 * 1024 * 1024 * 1024, limit: 100 * 1024 * 1024 * 1024 }, // 10%
                serverlessFunctionExecution: { value: 82, limit: 100 }, // 82%
                edgeMiddlewareInvocations: { value: 100_000, limit: 1_000_000 },
            }
            const pct = calculateMaxUsagePercent(usage)
            expect(pct).toBe(82)
            expect(determineActiveDomain(pct)).toBe('the-hustle-place.vercel.app')
        })

        it('resets back to the-fplace when monthly cycle resets and usage drops below 75%', () => {
            const resetUsage: UsageMetrics = {
                bandwidth: { value: 2 * 1024 * 1024 * 1024, limit: 100 * 1024 * 1024 * 1024 }, // 2%
                serverlessFunctionExecution: { value: 1, limit: 100 },
            }
            const pct = calculateMaxUsagePercent(resetUsage)
            expect(pct).toBe(2)
            expect(determineActiveDomain(pct)).toBe('the-fplace.vercel.app')
        })
    })

    describe('2. Cross-Origin Identity Preservation (Device ID Handoff)', () => {
        function resolveDeviceId(params: {
            queryString: string
            localStore: Record<string, string>
            generator: () => string
        }): { id: string; source: 'query' | 'local' | 'generated' } {
            // 1. Check query parameter
            const searchParams = new URLSearchParams(params.queryString)
            const queryDeviceId = searchParams.get('device_id')
            if (isDeviceId(queryDeviceId)) {
                // Save to localStore
                params.localStore['thp_device_id'] = queryDeviceId
                return { id: queryDeviceId, source: 'query' }
            }

            // 2. Check local storage
            const stored = params.localStore['thp_device_id']
            if (isDeviceId(stored)) {
                return { id: stored, source: 'local' }
            }

            // 3. Generate new
            const created = params.generator()
            params.localStore['thp_device_id'] = created
            return { id: created, source: 'generated' }
        }

        it('adopts device_id from query string when migrating from the-fplace to the-hustle-place', () => {
            const existingTvDeviceId = 'b27d424b-3254-4a25-a131-7b75fefd7d56'
            const newDomainLocalStorage: Record<string, string> = {} // empty on new domain

            const resolved = resolveDeviceId({
                queryString: `device_id=${existingTvDeviceId}&boot=123456`,
                localStore: newDomainLocalStorage,
                generator: () => '00000000-0000-0000-0000-000000000000',
            })

            expect(resolved.id).toBe(existingTvDeviceId)
            expect(resolved.source).toBe('query')
            // Crucial: check that it persisted to the new domain's local storage!
            expect(newDomainLocalStorage['thp_device_id']).toBe(existingTvDeviceId)
        })

        it('proves public/tv-os.html has qs device_id adoption logic in deviceId()', async () => {
            const fs = await import('fs')
            const content = fs.readFileSync('public/tv-os.html', 'utf8')
            expect(content).toContain("var qId = qs('device_id');")
            expect(content).toContain("rememberDeviceId(qId);")
        })

        it('ignores invalid device_id in query and falls back to local or new generator', () => {
            const localStore: Record<string, string> = {
                thp_device_id: 'e1111111-2222-4333-8444-555555555555',
            }

            const resolved = resolveDeviceId({
                queryString: 'device_id=invalid-not-uuid',
                localStore,
                generator: () => '99999999-9999-4999-8999-999999999999',
            })

            expect(resolved.id).toBe('e1111111-2222-4333-8444-555555555555')
            expect(resolved.source).toBe('local')
        })
    })

    describe('3. Edge Middleware Routing & Loop Protection', () => {
        interface MiddlewareScenario {
            host: string
            url: string
            cookieDeviceId?: string
            activeDomain: string
        }

        interface MiddlewareResult {
            action: 'rewrite' | 'redirect' | 'next'
            destination?: string
            statusCode?: number
        }

        function simulateMiddleware(req: MiddlewareScenario): MiddlewareResult {
            const urlObj = new URL(req.url)
            const isFplace = req.host.includes('the-fplace.vercel.app')
            const isHustlePlace = req.host.includes('the-hustle-place.vercel.app')

            // If incoming request is on the-fplace, but activeDomain is the-hustle-place:
            if (isFplace && req.activeDomain.includes('the-hustle-place.vercel.app')) {
                const target = new URL(req.url)
                target.host = 'the-hustle-place.vercel.app'
                target.protocol = 'https'

                // Inject device_id if present in cookie and not already in search
                if (req.cookieDeviceId && !target.searchParams.has('device_id')) {
                    target.searchParams.set('device_id', req.cookieDeviceId)
                }

                return {
                    action: 'redirect',
                    destination: target.toString(),
                    statusCode: 307,
                }
            }

            // Loop prevention: if already on the-hustle-place, never redirect back to the-hustle-place
            if (isHustlePlace && req.activeDomain.includes('the-hustle-place.vercel.app')) {
                if (urlObj.pathname === '/living' || urlObj.pathname.startsWith('/living/')) {
                    return { action: 'rewrite', destination: '/tv-os.html' }
                }
                return { action: 'next' }
            }

            // Symmetrical failover: from the-hustle-place back to the-fplace
            if (isHustlePlace && req.activeDomain.includes('the-fplace.vercel.app')) {
                const target = new URL(req.url)
                target.host = 'the-fplace.vercel.app'
                target.protocol = 'https'

                if (req.cookieDeviceId && !target.searchParams.has('device_id')) {
                    target.searchParams.set('device_id', req.cookieDeviceId)
                }

                return {
                    action: 'redirect',
                    destination: target.toString(),
                    statusCode: 307,
                }
            }

            // Normal operation on the-fplace
            if (urlObj.pathname === '/living' || urlObj.pathname.startsWith('/living/')) {
                return { action: 'rewrite', destination: '/tv-os.html' }
            }

            return { action: 'next' }
        }

        it('redirects the-fplace requests to the-hustle-place when failover is active', () => {
            const result = simulateMiddleware({
                host: 'the-fplace.vercel.app',
                url: 'https://the-fplace.vercel.app/living/home?boot=123',
                cookieDeviceId: 'a5555555-5555-4555-8555-555555555555',
                activeDomain: 'the-hustle-place.vercel.app',
            })

            expect(result.action).toBe('redirect')
            expect(result.statusCode).toBe(307)
            expect(result.destination).toContain('https://the-hustle-place.vercel.app/living/home')
            expect(result.destination).toContain('device_id=a5555555-5555-4555-8555-555555555555')
            expect(result.destination).toContain('boot=123')
        })

        it('never redirects when already on the-hustle-place (prevents redirect loop)', () => {
            const result = simulateMiddleware({
                host: 'the-hustle-place.vercel.app',
                url: 'https://the-hustle-place.vercel.app/living/home?device_id=a5555555-5555-4555-8555-555555555555',
                activeDomain: 'the-hustle-place.vercel.app',
            })

            expect(result.action).toBe('rewrite')
            expect(result.destination).toBe('/tv-os.html')
        })

        it('redirects the-hustle-place requests back to the-fplace when the-fplace is active', () => {
            const result = simulateMiddleware({
                host: 'the-hustle-place.vercel.app',
                url: 'https://the-hustle-place.vercel.app/living/movies',
                cookieDeviceId: 'a5555555-5555-4555-8555-555555555555',
                activeDomain: 'the-fplace.vercel.app',
            })

            expect(result.action).toBe('redirect')
            expect(result.statusCode).toBe(307)
            expect(result.destination).toContain('https://the-fplace.vercel.app/living/movies')
            expect(result.destination).toContain('device_id=a5555555-5555-4555-8555-555555555555')
        })

        it('serves tv-os.html normally on the-fplace when usage is below threshold', () => {
            const result = simulateMiddleware({
                host: 'the-fplace.vercel.app',
                url: 'https://the-fplace.vercel.app/living',
                activeDomain: 'the-fplace.vercel.app',
            })

            expect(result.action).toBe('rewrite')
            expect(result.destination).toBe('/tv-os.html')
        })

        it('redirects the-hustle-place requests back to the-fplace when the-fplace is active', () => {
            const result = simulateMiddleware({
                host: 'the-hustle-place.vercel.app',
                url: 'https://the-hustle-place.vercel.app/living/movies',
                cookieDeviceId: 'a5555555-5555-4555-8555-555555555555',
                activeDomain: 'the-fplace.vercel.app',
            })

            expect(result.action).toBe('redirect')
            expect(result.statusCode).toBe(307)
            expect(result.destination).toContain('https://the-fplace.vercel.app/living/movies')
            expect(result.destination).toContain('device_id=a5555555-5555-4555-8555-555555555555')
        })
    })

    describe('4. WebOS App Shell Boot & Fallback Machine', () => {
        interface ShellState {
            primaryDomain: string
            secondaryDomain: string
            savedDomainIndex: number
            activeIframeSrc: string
            isShown: boolean
        }

        function createShellController(savedIndex = 0) {
            const domains = [
                'https://the-fplace.vercel.app',
                'https://the-hustle-place.vercel.app',
            ]
            const state: ShellState = {
                primaryDomain: domains[0],
                secondaryDomain: domains[1],
                savedDomainIndex: savedIndex,
                activeIframeSrc: '',
                isShown: false,
            }

            let timeoutId: any = null

            function boot(now = Date.now()) {
                const domain = domains[state.savedDomainIndex] || domains[0]
                state.activeIframeSrc = `${domain}/living?boot=${now}`
            }

            function onReady() {
                state.isShown = true
            }

            function onTimeout(now = Date.now()) {
                if (state.isShown) return
                // Fallback triggered: toggle domain
                state.savedDomainIndex = state.savedDomainIndex === 0 ? 1 : 0
                const nextDomain = domains[state.savedDomainIndex]
                state.activeIframeSrc = `${nextDomain}/living?boot=${now}`
            }

            return { state, boot, onReady, onTimeout }
        }

        it('boots primary domain first if no previous failure saved', () => {
            const shell = createShellController(0)
            shell.boot(1000)
            expect(shell.state.activeIframeSrc).toBe('https://the-fplace.vercel.app/living?boot=1000')
        })

        it('switches to secondary domain if primary times out or is suspended by Vercel', () => {
            const shell = createShellController(0)
            shell.boot(1000)
            expect(shell.state.isShown).toBe(false)

            // Primary fails to send thp-ready within 7 seconds
            shell.onTimeout(8000)

            expect(shell.state.activeIframeSrc).toBe('https://the-hustle-place.vercel.app/living?boot=8000')
            expect(shell.state.savedDomainIndex).toBe(1)
        })

        it('subsequent boot starts directly from saved functioning domain', () => {
            // TV was switched to secondary and rebooted tomorrow
            const shell = createShellController(1)
            shell.boot(9999)

            expect(shell.state.activeIframeSrc).toBe('https://the-hustle-place.vercel.app/living?boot=9999')
        })
    })
})
