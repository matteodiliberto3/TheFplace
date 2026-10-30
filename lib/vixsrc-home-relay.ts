export const HOME_RELAY_TIMEOUT_MS = 30_000
export const HOME_RELAY_COOLDOWN_MS = 60_000

export interface HomeRelayStream {
    master: string
    parts: Record<string, string>
    videoId?: number
}

export type HomeRelayOutcome = { ok: true; data: HomeRelayStream } | { ok: false; coolDown: boolean }

export function interpretHomeRelayResponse(status: number, body: string): HomeRelayOutcome {
    const trimmed = body.trim()
    if (!trimmed.startsWith('{')) {
        return { ok: false, coolDown: true }
    }

    try {
        const payload = JSON.parse(trimmed) as {
            success?: boolean
            error?: unknown
            data?: { master?: string; parts?: Record<string, string>; videoId?: number }
        }
        if (status >= 200 && status < 300 && payload.success && payload.data?.master) {
            return {
                ok: true,
                data: {
                    master: payload.data.master,
                    parts: payload.data.parts ?? {},
                    videoId: payload.data.videoId,
                },
            }
        }

        const error = typeof payload.error === 'string' ? payload.error.toLowerCase() : ''
        if (
            error.includes('occupato') ||
            error.includes('404') ||
            error.includes('non trovata') ||
            error.includes('non trovato') ||
            error.includes('not found') ||
            status === 404
        ) {
            return { ok: false, coolDown: false }
        }
        const coolDown =
            status === 401 ||
            status === 408 ||
            status === 429 ||
            status === 503 ||
            status === 504 ||
            (status >= 520 && status <= 530) ||
            error.includes('unauthorized')
        return { ok: false, coolDown }
    } catch {
        return { ok: false, coolDown: true }
    }
}

export class HomeRelayCircuit {
    private cooldownUntil = 0

    allow(now = Date.now()): boolean {
        return now >= this.cooldownUntil
    }

    succeed() {
        this.cooldownUntil = 0
    }

    fail(now = Date.now(), cooldownMs = HOME_RELAY_COOLDOWN_MS) {
        this.cooldownUntil = now + cooldownMs
    }
}

export const homeRelayCircuit = new HomeRelayCircuit()
