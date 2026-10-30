# Errore 07: Regressioni Unit Test Vitest su `tv-os.html` e `hls-config.ts`

## Descrizione del problema
Dopo aver applicato le ottimizzazioni dei buffer HLS e la gestione degli errori per Smart TV nel file [public/tv-os.html](file:///c:/Users/matti/Documents/TheHustlePlace/public/tv-os.html) e in [utils/hls-config.ts](file:///c:/Users/matti/Documents/TheHustlePlace/utils/hls-config.ts), l'esecuzione della suite di regressione con `npm test` ha fallito con 3 errori distinti:
1. `TS2367: This comparison appears to be unintentional because the types 'string' and '"maxBufferLength"' have no overlap.` nel file `tests/unit/tv-player-reverse-engineering.test.ts`.
2. Fallimento di asserzione su `maxBufferLength`: il test base si aspettava il valore `30` (`0.5 * 60`), mentre il valore restituito era `48` (`0.8 * 60`).
3. Fallimento regex su `tv-os.html`: il test `tv-player-reverse-engineering` verificava che la proprietà `startPosition` comparisse nei primi 50 caratteri della dichiarazione `hlsOpts`.

## Cosa lo causava
1. **Tipizzazione rigida di TypeScript (TS2367)**:
   All'interno del test, la chiave dell'oggetto iterato era inferita come unione ristretta di chiavi, e il controllo `key === 'maxBufferLength'` veniva rifiutato dal compilatore TypeScript come confronto impossibile tra tipi disgiunti.
2. **Accoppiamento Globale vs Device-Specific di HLS_CONFIG**:
   La modifica iniziale per aumentare la tolleranza della Smart TV a `0.8` era stata applicata direttamente all'oggetto base `HLS_CONFIG`, rompendo l'aspettativa dei test per i browser standard/desktop che richiedono `0.5`.
3. **Ordine delle Proprietà in `tv-os.html`**:
   L'aggiunta delle nuove opzioni di stabilità (`enableSoftwareAES`, `maxAudioFramesDrift`, `forceKeyFrameOnDiscontinuity`) aveva fatto scalare `startPosition` oltre la soglia dei primi 50 caratteri analizzati dalla regex del test.

## Cosa è stato fatto per risolverlo
1. **Risoluzione TS2367**:
   - Nel test `tests/unit/tv-player-reverse-engineering.test.ts`, è stata aggiunta l'annotazione di tipo esplicita `const key: string` nel ciclo `for...in`.
2. **Separazione della Configurazione Base e per Smart TV**:
   - In `utils/hls-config.ts`, l'oggetto base esportato `HLS_CONFIG` ha mantenuto il valore standard `0.5` per i client generici, preservando la retrocompatibilità.
   - Il valore personalizzato `0.8` è stato incapsulato nella funzione `getHlsConfigForDevice('smart-tv')`.
3. **Riorganizzazione delle Proprietà in `public/tv-os.html`**:
   - La riga `startPosition: opts.startPosition || -1,` è stata collocata come prima proprietà all'interno dell'oggetto `hlsOpts`, soddisfacendo pienamente il vincolo della regex del test.
4. **Verifica della Suite Completa**:
   - È stato rieseguito `npm test`: **46 test files passati**, **256 test passati (100% verde)**, con zero regressioni.

### Errori successivi generati
- Nessun errore successivo: ha garantito che il fix applicato in produzione fosse solido e pronto per il push su `thefplace`.
