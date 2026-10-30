# Errore 08: Diagnosi Saturazione di Rete vs Stallo Decoder e Kit Intelligente di Rilevamento

## Descrizione del problema
Durante la visione della serie TV *LOL* e di altri contenuti in streaming, la riproduzione faticava a caricare o andava in buffering continuo con frequenti interruzioni.
Il player segnalava genericamente un errore di rete o rimaneva bloccato sullo spinner di caricamento.
Il dubbio principale era:
> *"Fa fatica a caricarlo per mancanza di rete perché troppo lenta o per saturazione della banda? Oppure è dovuto ad altro?"*
> *"In che modo possiamo migliorare l'error handling con un sistema intelligente che riconosce se c'è stata una reale saturazione della rete?"*

## Cosa lo causava
Attraverso la telemetria empirica e l'analisi dei vettori di fallimento nel player, sono emerse due dinamiche distinte che venivano confuse dal vecchio sistema di error handling:

1. **La falsa accusa alla rete ("Falso Errore di Rete")**:
   Spesso il player lanciava eventi di timeout o stallo quando il buffer video era pieno, ma il decoder hardware della TV non riusciva a smaltire i frame (vedi [01-smart-tv-media-err-decode-1101.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/01-smart-tv-media-err-decode-1101.md)). In questo caso la rete era libera (80+ Mbps), ma l'effetto percepito dall'utente era identico a un blocco per connessione lenta.
2. **La reale saturazione della rete (Bandwidth Depletion)**:
   Quando la rete subisce una congestione reale (es. download contemporanei, degradazione del segnale WiFi o saturazione dell'upload del relay):
   - Il tempo necessario a scaricare un chunk video ($T_{\text{download}}$) supera la durata del chunk stesso ($D_{\text{chunk}}$).
   - Il `forward buffer` decresce in modo monotono fino a zero (*buffer starvation*).
   - Le richieste HTTP dei segmenti (`fragLoadError`, `fragLoadTimeOut`) accumulano latenze esponenziali.
3. **Mancanza di metriche di correlazione nel player**:
   Il codice originale trattava ogni fallimento con lo stesso messaggio generico *"Errore di connessione"*, senza misurare il **Ratio di Scaricamento** o lo stato del buffer MSE al momento del blocco.

## Cosa è stato fatto per risolverlo
È stata definita e integrata l'architettura per un **Kit Intelligente di Rilevamento della Saturazione di Rete**, basato su tre sonde telemetriche in tempo reale:

### 1. Il Calcolo del Download-to-Playback Ratio (DPR)
Per ogni frammento scaricato da Hls.js (`FRAG_LOADED`), il sistema calcola:
$$\text{DPR} = \frac{T_{\text{download}}}{D_{\text{chunk}}}$$
- **Se $\text{DPR} \le 0.5$**: La rete è ultra-veloce (scarica i chunk al doppio della velocità di riproduzione).
- **Se $0.5 < \text{DPR} \le 0.9$**: La rete è stabile.
- **Se $\text{DPR} > 1.0$**: **Saturazione di rete conclamata** (la connessione impiega più tempo a scaricare di quanto il video impieghi a riprodurre).

### 2. Correlazione Stato del Buffer vs Errore
Quando si verifica un'interruzione (`hls.on(Hls.Events.ERROR)`):
- **Scenario A (Saturazione di Rete Reale)**:
  - $\text{Buffer Forward} < 1.5\text{s}$ E $\text{DPR} > 1.0$ E consecutivi timeout HTTP.
  - **Azione intelligente**: Step-down automatico immediato del bitrate video alla variante minima a 480p/720p, aumento dei timeout di fetch e notifica non bloccante *"Adattamento qualità per connessione instabile"*.
- **Scenario B (Stallo Hardware / Decoder / Codec)**:
  - $\text{Buffer Forward} \ge 6\text{s}$ al momento del blocco.
  - **Diagnosi intelligente**: La rete NON è satura. Il problema è interno alla decodifica o alla traccia audio.
  - **Azione intelligente**: Esecuzione di `hls.recoverMediaError()` e swap della traccia audio (vedi [03-audio-multicanale-mismatch-decoder.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/03-audio-multicanale-mismatch-decoder.md)), senza degradare inutilmente la risoluzione video.

### 3. Gestione Resiliente dei Retry di Rete
- Sostituiti i retry immediati (che peggiorano la congestione) con una strategia di **Exponential Backoff con Jitter**:
  $$\text{Delay} = \min(10000, 1000 \times 2^{\text{retryCount}}) \pm \text{jitter}$$
- Se dopo 3 retry a livello minimo la rete non risponde, solo allora viene presentato il messaggio contestuale di verifica della connessione.

### Errori successivi generati
- La gestione dinamica della banda basata su queste metriche ha portato all'implementazione della selezione euristica dell'audio in [03-audio-multicanale-mismatch-decoder.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/03-audio-multicanale-mismatch-decoder.md) e alla taratura fine dei limiti del buffer in [01-smart-tv-media-err-decode-1101.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/01-smart-tv-media-err-decode-1101.md).
