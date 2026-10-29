import { describe, expect, it } from 'vitest'
import { classifyVixsrcEpisodeProbe, isConfirmedVixsrcMiss } from './vixsrc-episode-status'

describe('classifyVixsrcEpisodeProbe', () => {
    it('distingue file presente, assente e risposta inutilizzabile', () => {
        expect(classifyVixsrcEpisodeProbe(200, '{"src":"/embed/1?token=a"}')).toBe('available')
        expect(classifyVixsrcEpisodeProbe(403, '')).toBe('unknown')
        expect(classifyVixsrcEpisodeProbe(404, '')).toBe('missing')
        expect(classifyVixsrcEpisodeProbe(200, '<html></html>')).toBe('unknown')
        expect(classifyVixsrcEpisodeProbe(503, '')).toBe('unknown')
    })
})

describe('isConfirmedVixsrcMiss', () => {
    it('accetta solo un 403 visto da un transport', () => {
        expect(isConfirmedVixsrcMiss('direct 403')).toBe(true)
        expect(isConfirmedVixsrcMiss('allorigins 404')).toBe(true)
        expect(isConfirmedVixsrcMiss('API VixSrc non disponibile (403)')).toBe(false)
        expect(isConfirmedVixsrcMiss('Risposta API VixSrc senza embed')).toBe(false)
    })
})
