# 09 - Timeout TLS su vix-content.net e Loop Decoder su Glitch PTS

## Sintomo
Riproducendo serie TV o film sull'app LG webOS (es. *Crystal Lake* S1 E3, TMDB `213562` con `startAt=1071` o al minuto 18:21), la riproduzione va in stallo prolungato con spinner continuo e termina con il messaggio:
> *"Errore riproduzione stream. Torna indietro e riprova."*

## Diagnosi in-vivo su TV LG 65UM7000PLA

1. **Timeout TLS su `vix-content.net` (`net::ERR_TIMED_OUT`)**:
   - `normalizeVixsrcCdnUrl` (in `lib/vixsrc-hls.ts` e `relay.py`) riscriveva forzatamente tutti gli host edge rotanti (`sc-u16-01.<dominio>`) in `https://sc-u16-01.vix-content.net`.
   - VixSrc serve nativamente i segmenti da domini edge proxyati da Cloudflare (es. `sc-u16-01.frozenlagoon85.boats`, IP `172.67.174.53`). Su questi host, il TLS 1.2 ECDHE risponde in 24ms su HTTP/2.
   - `sc-u16-01.vix-content.net` punta invece direttamente a un server Hetzner (`217.147.172.19`) senza proxy Cloudflare, che invia messaggi di TLS renegotiation non gestiti dal webOS 4.x (Chromium 68) e va in timeout costante di 30 secondi (`net::ERR_TIMED_OUT`).
   - I segmenti video non venivano quindi scaricati, mandando in starvation il buffer HLS.

2. **Mancanza del Token nel Relay Diretto TV**:
   - `/api/player/relay` restituiva solo `{ success: true, url }` senza il token.
   - La TV tentava di interrogare direttamente il relay locale, ma riceveva `401 unauthorized`, scattando il circuit breaker e ricadendo sui segmenti Vercel `vix-content.net`.

3. **`ReferenceError: showSpinner is not defined`**:
   - In `public/tv-os.html`, `showSpinner()` era invocato dentro `seekBy` (debounce timer), ma dichiarato dentro `startWith(master, parts)`, fuori dallo scope di `seekBy`.

4. **Loop di Recupero Decoder su Frame Corrotto (1101s)**:
   - All'avvio a 1071s (17:51) con `maxBufferLength: 30`, il buffer raggiunge il secondo 1101 (dove è presente un PTS glitch noto nel file sorgente VixSrc).
   - Il decoder hardware webOS solleva `MEDIA_ERR_DECODE` (codice 3).
   - Il tier 2 di recupero in `attachStream` eseguiva `video.currentTime = ct2 - 6`, portando la testina indietro di 6 secondi e facendola ripiombare ciclicamente sullo stesso frame corrotto fino all'esaurimento dei tentativi (`nativeErrorsCount > 3`).

## Soluzione Applicata

1. **Preservazione Host Cloudflare**:
   - In `lib/vixsrc-hls.ts` e `relay.py`, `normalizeVixsrcCdnUrl` e `normalizeVixsrcCdnInManifest` ora mantengono inalterato l'hostname Cloudflare originale e riscrivono solo l'estensione del chunk (`.html`/`.m4s` in `.ts`).
2. **Esposizione Token Relay**:
   - In `app/api/player/relay/route.ts`, la GET restituisce sia `url` che `token`, e `public/tv-os.html` include `&token=` nella chiamata diretta.
3. **Scope di `showSpinner` e `hideStatus`**:
   - Spostati a livello di `renderPlayer` per essere visibili ovunque (seek, eventi di playback, buffering).
4. **Nudge Forward e Buffer Protetti**:
   - `maxBufferLength: 20`, `maxMaxBufferLength: 40`, `backBufferLength: 10`, `maxBufferHole: 0.8`.
   - Recupero errori tier 2 e listener nativo video ora avanzano la testina di +1.0s / +1.5s per oltrepassare il pacchetto corrotto senza bloccare la riproduzione.
