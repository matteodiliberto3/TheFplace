import { test, expect } from '@playwright/test'

test.describe('Live Player Streaming & Episode Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Ensure browser allows media autoplay
        await page.addInitScript(() => {
            Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', {
                configurable: true,
                get() {
                    return true
                },
            })
        })
    })

    test('carica e avvia lo streaming di S1 E1', async ({ page }) => {
        await page.goto('/player/tv/203857?season=1&episode=1', {
            waitUntil: 'domcontentloaded',
        })

        const video = page.locator('video')
        await expect(video).toBeVisible({ timeout: 20_000 })

        // Attendi che il video inizi la riproduzione (currentTime > 0 o readyState >= 2)
        await page.waitForFunction(
            () => {
                const v = document.querySelector('video')
                return Boolean(v && v.currentTime > 0 && !v.paused)
            },
            null,
            { timeout: 35_000 }
        )

        const videoStats = await page.evaluate(() => {
            const v = document.querySelector('video')
            return {
                currentTime: v?.currentTime ?? 0,
                duration: v?.duration ?? 0,
                paused: v?.paused ?? true,
                readyState: v?.readyState ?? 0,
            }
        })

        expect(videoStats.currentTime).toBeGreaterThan(0)
        expect(videoStats.duration).toBeGreaterThan(60)
        expect(videoStats.paused).toBe(false)

        // Verifica che non sia presente nessun messaggio di errore
        const errorText = page.locator('text="Episodio non disponibile"')
        await expect(errorText).toHaveCount(0)
    })

    test('naviga al prossimo episodio (S1 E2) e continua la riproduzione', async ({ page }) => {
        await page.goto('/player/tv/203857?season=1&episode=1', {
            waitUntil: 'domcontentloaded',
        })

        const video = page.locator('video')
        await expect(video).toBeVisible({ timeout: 20_000 })

        // Attendi che l'episodio 1 sia in riproduzione
        await page.waitForFunction(
            () => {
                const v = document.querySelector('video')
                return Boolean(v && v.currentTime > 0)
            },
            null,
            { timeout: 35_000 }
        )

        // Muovi il cursore per risvegliare l'overlay dei controlli (CinemaOverlay)
        await page.mouse.move(400, 300)
        await page.mouse.move(500, 30)

        // Cerca il pulsante "Prossima" (es. "Prossima S1 E2")
        const nextButton = page.locator('button[aria-label*="Prossima"]')
        await expect(nextButton).toBeVisible({ timeout: 10_000 })

        // Clicca per andare al prossimo episodio
        await nextButton.click({ force: true })

        // Verifica cambio URL verso episode=2
        await page.waitForURL(/episode=2/, { timeout: 15_000 })
        expect(page.url()).toContain('episode=2')

        // Verifica assenza di schermata di errore
        const errorMsg = page.locator('text="Episodio non disponibile"')
        await expect(errorMsg).toHaveCount(0)

        // Attendi che l'episodio 2 si avvii correttamente
        await page.waitForFunction(
            () => {
                const v = document.querySelector('video')
                return Boolean(v && v.currentTime > 0 && !v.paused)
            },
            null,
            { timeout: 35_000 }
        )

        const ep2Stats = await page.evaluate(() => {
            const v = document.querySelector('video')
            return {
                currentTime: v?.currentTime ?? 0,
                duration: v?.duration ?? 0,
                paused: v?.paused ?? true,
            }
        })

        expect(ep2Stats.currentTime).toBeGreaterThan(0)
        expect(ep2Stats.paused).toBe(false)
    })

    test('apertura diretta deep link di S1 E2 funziona senza errori', async ({ page }) => {
        await page.goto('/player/tv/203857?season=1&episode=2', {
            waitUntil: 'domcontentloaded',
        })

        const video = page.locator('video')
        await expect(video).toBeVisible({ timeout: 20_000 })

        await page.waitForFunction(
            () => {
                const v = document.querySelector('video')
                return Boolean(v && v.currentTime > 0 && !v.paused)
            },
            null,
            { timeout: 35_000 }
        )

        const stats = await page.evaluate(() => {
            const v = document.querySelector('video')
            return {
                currentTime: v?.currentTime ?? 0,
                duration: v?.duration ?? 0,
                paused: v?.paused ?? true,
            }
        })

        expect(stats.currentTime).toBeGreaterThan(0)
        expect(stats.paused).toBe(false)
        await expect(page.locator('text="Episodio non disponibile"')).toHaveCount(0)
    })
})
