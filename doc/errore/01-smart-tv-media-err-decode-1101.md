# Errore 01: Crash Riproduzione Smart TV webOS al Secondo 1101 (`MEDIA_ERR_DECODE`)

## Descrizione del problema
Durante la riproduzione di serie TV o film (nello specifico la serie *Crystal Lake* / *TheHustlePlace*) sulla Smart TV LG con webOS, lo streaming si interrompeva sistematicamente intorno al secondo 1101 (circa al minuto 18:21). A schermo la TV mostrava il messaggio d'errore nativo: *"il film non parte, torna indietro o riprova"*, oppure rimaneva su schermo nero permanente senza possibilità di riprendere la visione.

## Cosa lo causava
Attraverso l'ispezione della telemetria live via Chrome DevTools Protocol (CDP) e il monitoraggio dei buffer del player sono state individuate tre concause concatenate:

1. **Saturazione del `SourceBuffer` MSE e memoria decoder webOS**:
   La configurazione globale di Hls.js manteneva limiti di buffer troppo aggressivi (`maxBufferLength` e `maxMaxBufferLength` elevati). I chip decoder hardware delle Smart TV LG hanno una memoria video/MSE dedicata molto ridotta rispetto ai browser desktop. Al secondo 1101, il continuo accumulo di segmenti forward e l'assenza di un prune aggressivo del `backBufferLength` hanno provocato un crash del decoder hardware, sollevando l'errore `MEDIA_ERR_DECODE` (HTMLMediaElement error code 3).
2. **Gestione prematura dell'evento `video.onerror` nativo**:
   Il tag `<video>` registrava un listener `video.addEventListener('error', ...)` che scattava immediatamente all'evento di decode error. Questo listener disegnava subito il banner fatale a tutto schermo, impedendo a Hls.js di eseguire la procedura interna di recupero `hls.recoverMediaError()`.
3. **Discontinuità e Audio Drift**:
   In corrispondenza del cambio segmento o salto temporale attorno al secondo 1100, si verificava una discontinuità nei timestamp tra flusso video e traccia audio (`maxAudioFramesDrift`), che portava il demuxer a perdere la sincronia e a mandare in stallo la pipeline hardware.

## Cosa è stato fatto per risolverlo
Sono state apportate modifiche congiunte in [public/tv-os.html](file:///c:/Users/matti/Documents/TheHustlePlace/public/tv-os.html) e [utils/hls-config.ts](file:///c:/Users/matti/Documents/TheHustlePlace/utils/hls-config.ts):

1. **Taratura conservativa dei buffer per Smart TV**:
   - `maxBufferLength`: ridotto a 20 secondi.
   - `maxMaxBufferLength`: limitato a 40 secondi.
   - `backBufferLength`: impostato a 10 secondi per forzare lo svuotamento continuo della memoria passata.
   - `enableSoftwareAES: true` per ridurre il carico sul chip crittografico hardware.
   - `maxAudioFramesDrift: 1` e `forceKeyFrameOnDiscontinuity: true` per forzare l'allineamento dei keyframe alle discontinuità.
2. **Delega degli errori a Hls.js**:
   - Nel file `public/tv-os.html`, il gestore degli errori nativo del video è stato modificato:
     ```javascript
     if (video._tvHls) {
         // Non mostrare l'errore fatale: lascia che sia Hls.js a tentare la recovery
         return;
     }
     ```
3. **Recovery piramidale a 3 livelli con reset di stabilità**:
   - Livello 1: `hls.recoverMediaError()` immediato.
   - Livello 2: `hls.swapAudioCodec()` se il primo fallisce.
   - Livello 3: Step-down automatico della risoluzione video a una variante con bitrate/risoluzione inferiore.
   - Aggiunto un timer di stabilità: dopo 15 secondi di riproduzione continua senza errori, i contatori di fallimento si azzerano automaticamente.

### Errori successivi generati
- La modifica della taratura dei buffer ha generato discrepanze nei test unitari preesistenti in Vitest, dove `HLS_CONFIG` si aspettava il moltiplicatore storico `0.5` anziché `0.8` (vedi documentazione in [07-unit-tests-regression-vitest.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/07-unit-tests-regression-vitest.md)).
- La gestione del recupero audio ha richiesto una revisione euristica della selezione delle tracce multicanale (vedi [03-audio-multicanale-mismatch-decoder.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/03-audio-multicanale-mismatch-decoder.md)).
