# Errore 02: Blocco Download Segmenti HLS Esterni su Smart TV e Timeout TLS/DNS

## Descrizione del problema
All'avvio della riproduzione di serie TV (come *LOL - Chi ride è fuori*) o contenuti aggregati da provider esterni (tra cui *VixSrc*), la TV mostrava errori di connessione rete, caricamento infinito (spinner bloccato) o interruzione del flusso dopo i primi frammenti video. L'utente ipotizzava una saturazione o lentezza della connessione WiFi domestica.

## Cosa lo causava
Attraverso la suite di test e sonde empiriche di rete (`test_ping_accurate.py`, `test_bandwidth.py`, `tv_network_matrix.py`):
1. **Falso allarme sulla banda WiFi**:
   I test empirici verso la rete locale e verso i CDN hanno dimostrato un throughput reale superiore a 80 Mbps con latenza media di 12ms e 0% packet loss. La rete WiFi non era affatto satura.
2. **Handshake TLS e Risoluzione DNS su webOS**:
   Il browser nativo della TV webOS presentava difficoltà nell'handshake TLS 1.3 con alcuni edge server di streaming esterni, oltre a timeout rigidi nella risoluzione DNS dei domini di relay dei segmenti.
3. **CORS e Blocco Segmenti Diretti**:
   Alcuni segmenti `.ts` / `.m4s` venivano bloccati a monte per policy CORS o rate-limiting dell'origine, senza che il relay interno applicasse retry con backoff esponenziale.

## Cosa è stato fatto per risolverlo
1. **Analisi Telemetrica Obiettiva**:
   - Creati script dedicati di verifica per differenziare la velocità teorica da quella effettivamente erogata ai singoli chunk HLS.
2. **Ottimizzazione Relay dei Segmenti (VixSrc Relay)**:
   - Verificato e corretto il meccanismo di fallback del relay interno dei segmenti in [lib/db/vixsrc-relay.ts](file:///c:/Users/matti/Documents/TheHustlePlace/lib/db/vixsrc-relay.ts) e negli endpoint API dedicati.
   - Introdotti timeout più resilienti e header `User-Agent` compatibili con i requisiti del provider video.
3. **Gestione Fallback Player**:
   - Se un segmento fallisce con errore HTTP 403/404/timeout, Hls.js non interrompe la sessione ma tenta il recupero sul livello di qualità alternativo o sul segmento successivo.

### Errori successivi generati
- La risoluzione dei timeout di caricamento ha permesso al flusso di avviarsi regolarmente, portando successivamente alla luce il problema della saturazione del buffer decoder hardware ai minuti successivi (vedi [01-smart-tv-media-err-decode-1101.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/01-smart-tv-media-err-decode-1101.md)).
