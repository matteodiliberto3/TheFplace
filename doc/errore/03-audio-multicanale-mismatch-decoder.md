# Errore 03: Selezione Euristica Traccia Audio e Mismatch Multicanale 5.1 su Decoder TV

## Descrizione del problema
In streaming con tracce audio multiple (italiano, inglese, stereo a 2 canali e multicanale 5.1 Dolby / AC-3):
1. In condizioni di banda ottima, la TV non passava automaticamente alla traccia audio a massima fedeltà multicanale (5.1).
2. Quando veniva forzata una traccia 5.1 con bitrate elevato, in caso di micro-fluttuazioni di banda o limiti del decoder stereo della TV, la riproduzione subiva desincronizzazione labiale, buffer underrun o silenzio improvviso (muto).

## Cosa lo causava
1. **Assenza di un algoritmo euristico di scoring audio**:
   Hls.js di default seleziona le tracce audio basandosi unicamente sulla lingua o sull'ordine di apparizione nel manifest m3u8, senza ponderare la banda disponibile, lo stato del forward buffer o il numero effettivo di canali.
2. **Bug nel parsing del numero di canali**:
   In fase di calcolo dello score, l'istruzione `parseInt('5.1', 10)` restituiva `5` anziché `6` canali audio, penalizzando le tracce surround 5.1 rispetto a quelle a 6 canali nominali.
3. **Mancanza di vincoli di guardia (Guard Bands)**:
   Non vi erano soglie di sicurezza: una traccia ad alto bitrate veniva mantenuta anche quando il buffer video era inferiore a 2 secondi, portando la TV allo stallo.

## Cosa è stato fatto per risolverlo
È stata implementata e testata la funzione [`scoreAudioTrack`](file:///c:/Users/matti/Documents/TheHustlePlace/utils/hls-config.ts#L152) in [utils/hls-config.ts](file:///c:/Users/matti/Documents/TheHustlePlace/utils/hls-config.ts):

1. **Ponderazione Dinamica per Condizioni di Rete**:
   - Se la banda stimata è $\ge 3.5\text{ Mbps}$ E il buffer accumulato è $\ge 6\text{ secondi}$:
     - Bonus aggressivo per tracce multicanale ($\ge 6$ canali) e codec avanzati (`eac3`, `ac3`, Dolby).
   - Se la banda o il buffer scendono sotto le soglie critiche:
     - Priorità assoluta a tracce stereo standard (2 canali) per prevenire lo stallo del decoder.
2. **Parsing Rigoroso dei Canali**:
   - Corretto il riconoscimento dei canali surround:
     ```typescript
     const numChannels = track.channels?.includes('5.1')
         ? 6
         : parseInt(track.channels || '2', 10) || 2;
     ```
3. **Suite di Test Dedicata**:
   - Creato il file di test [lib/tv-player-media-and-audio.test.ts](file:///c:/Users/matti/Documents/TheHustlePlace/lib/tv-player-media-and-audio.test.ts) con 10 test unitari che verificano tutte le combinazioni di banda, lingua preferita e numero di canali.

### Errori successivi generati
- Il primo refactoring dei test audio ha introdotto un errore di compilazione per l'assegnazione dell'oggetto globale `navigator` su ambiente Node.js di Vitest (risolto definendo la proprietà con `Object.defineProperty`, vedi [07-unit-tests-regression-vitest.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/07-unit-tests-regression-vitest.md)).
