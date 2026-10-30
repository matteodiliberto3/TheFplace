# API Film e Serie TV - Documentazione Tecnica

> **Versione:** 2.0 (Aggiornata a Ottobre 2026)  
> **Progetto:** TheHustlePlace (TheFplace)  
> **Stack:** Next.js 16 (App Router), TypeScript, TMDB API, VixSrc (Scraper & HLS Engine), Hls.js, Redis (Upstash) / In-Memory Cache, Supabase

---

## Indice

1. [Panoramica del Sistema](#panoramica-del-sistema)
2. [Architettura delle API](#architettura-delle-api)
3. [Diagramma ER e Modello Dati](#diagramma-er-e-modello-dati)
4. [Class Diagram dei Servizi](#class-diagram-dei-servizi)
5. [Flowchart e Flussi Operativi](#flowchart-e-flussi-operativi)
   - [Flusso di Riproduzione Ibrido (HLS / Relay / Iframe)](#flusso-di-riproduzione-ibrido-hls--relay--iframe)
   - [Flusso Raccomandazioni Personalizzate e Discovery](#flusso-raccomandazioni-personalizzate-e-discovery)
   - [Flusso Multi-Tier Cache](#flusso-multi-tier-cache)
6. [Sequence Diagram](#sequence-diagram)
   - [Sequenza di Caricamento e Streaming HLS Nativo](#sequenza-di-caricamento-e-streaming-hls-nativo)
   - [Sequenza di Pre-flight Batch Availability](#sequenza-di-pre-flight-batch-availability)
7. [Catalogo Completo degli Endpoint API](#catalogo-completo-degli-endpoint-api)
   - [Catalogo Base & Popolari](#catalogo-base--popolari)
   - [Discovery, Rails Editoriali e Personal Hub](#discovery-rails-editoriali-e-personal-hub)
   - [Ricerca](#ricerca)
   - [Player & Video Streaming HLS](#player--video-streaming-hls)
   - [TMDB Diretto](#tmdb-diretto)
   - [Household, Profili e TV Pairing](#household-profili-e-tv-pairing)
   - [Cronologia di Visione e Feedback ML](#cronologia-di-visione-e-feedback-ml)
8. [Resilienza, Gestione Errori e Smart TV (WebOS)](#resilienza-gestione-errori-e-smart-tv-webos)
9. [Configurazione e Variabili d'Ambiente](#configurazione-e-variabili-dambiente)
10. [Metriche, Logging e Performance Target](#metriche-logging-e-performance-target)

---

## Panoramica del Sistema

Il sistema multimediale di **TheHustlePlace** gestisce il catalogo, la ricerca, le raccomandazioni e lo streaming per film e serie TV. Supporta sia l'interfaccia Web (desktop/mobile) sia l'ecosistema **Living Room / Smart TV** (WebOS e schermi TV controllati via telecomando D-Pad).

Il sistema integra:
- **TMDB (The Movie Database)**: Metadati, trame, poster, backdrop, crediti, trailer e stagioni/episodi.
- **VixSrc Scraper & HLS Engine**: Estrazione dinamica degli stream `.m3u8`, playlist master e segmenti TS con risoluzione anti-CORS/anti-hotlink.
- **Player HLS Nativo + Relay Proxy**: Streaming video diretto con buffering ottimizzato per decoder TV (fix errore `MEDIA_ERR_DECODE 1101` e audio mismatch).
- **Algoritmo di Raccomandazione & Personal Rails**: Combinazione di cronologia di visione Supabase, affinità generi/registi e pool algoritmico con metriche ML.
- **Cache Multi-Tier**: Cache in memoria LRU locale + Redis per assorbire picchi di traffico e rispettare i rate limit TMDB/VixSrc.
- **Supabase**: Gestione profili per nucleo familiare (Household), cronologia progressiva di riproduzione e associazione dispositivi TV con codice a 6 cifre.

---

## Architettura delle API

```mermaid
graph TB
    subgraph Clients["Client Layer"]
        A["Web UI (React / Next.js)"]
        B["Living TV UI (app/living + tv-os.html)"]
    end

    subgraph APIRoutes["Next.js API Routes (app/api)"]
        C1["/api/catalog/* (Core, Editorial, Personal)"]
        C2["/api/player/* (Movie, TV, HLS, Relay, Resolve)"]
        C3["/api/tmdb/* (Raw Metadata & Trailers)"]
        C4["/api/household/* & /api/device"]
        C5["/api/watch-history & /api/taste/feedback"]
    end

    subgraph Controllers["Controller Layer"]
        D1["CatalogController"]
        D2["PlayerController"]
    end

    subgraph Services["Service Layer"]
        S1["CatalogService"]
        S2["VideoPlayerService & PlayerService"]
        S3["VixsrcHlsService & VixsrcScraperService"]
        S4["AvailabilityService & EpisodeAvailabilityService"]
        S5["TmdbMoviesService & TmdbWrapperService"]
    end

    subgraph DataCache["Cache & Storage Layer"]
        H1["In-Memory Cache (LRU Map)"]
        H2["Redis Cache (Upstash)"]
        H3["Supabase DB (Household, History, Devices)"]
    end

    subgraph External["External Providers"]
        E1["TMDB API"]
        E2["VixSrc Video Provider"]
    end

    A --> APIRoutes
    B --> APIRoutes

    C1 --> D1
    C2 --> D2
    C3 --> S5
    C4 --> H3
    C5 --> H3

    D1 --> S1
    D2 --> S2

    S1 --> S5
    S1 --> S4
    S1 --> H1
    S1 --> H2

    S2 --> S3
    S2 --> S4

    S3 --> E2
    S5 --> E1
```

---

## Diagramma ER e Modello Dati

Il modello integra i metadati on-demand di TMDB/VixSrc con la persistenza relazionale su **Supabase**:

```mermaid
erDiagram
    HOUSEHOLD ||--o{ PROFILE : "possiede"
    PROFILE ||--o{ WATCH_HISTORY : "registra"
    HOUSEHOLD ||--o{ DEVICE_PAIRING : "collega"
    PROFILE ||--o{ TASTE_FEEDBACK : "invia"

    HOUSEHOLD {
        uuid id PK
        string name
        timestamp created_at
    }

    PROFILE {
        uuid id PK
        uuid household_id FK
        string name
        string avatar_url
        boolean is_kids
        timestamp created_at
    }

    WATCH_HISTORY {
        uuid id PK
        uuid profile_id FK
        int tmdb_id
        string content_type "movie | tv"
        int season
        int episode
        int progress_seconds
        int duration_seconds
        boolean completed
        timestamp updated_at
    }

    DEVICE_PAIRING {
        uuid id PK
        uuid household_id FK
        string pair_code "6 caratteri univoci"
        string device_info
        timestamp expires_at
        boolean is_active
    }

    TASTE_FEEDBACK {
        uuid id PK
        uuid profile_id FK
        int tmdb_id
        string rating "like | dislike | skip"
        timestamp created_at
    }

    MOVIE {
        int id PK
        int tmdb_id UK
        string title
        text overview
        string poster_path
        string backdrop_path
        date release_date
        float vote_average
        int vote_count
        array genre_ids
    }

    TVSHOW {
        int id PK
        int tmdb_id UK
        string name
        text overview
        string poster_path
        string backdrop_path
        date first_air_date
        float vote_average
        int number_of_seasons
        int number_of_episodes
    }

    VIDEO_STREAM {
        int tmdb_id PK
        string stream_type "hls_direct | relay | embed"
        string master_m3u8_url
        string direct_stream_url
        array audio_tracks
        boolean available
    }

    MOVIE ||--o| VIDEO_STREAM : "risolto_in"
    TVSHOW ||--o| VIDEO_STREAM : "risolto_in"
```

---

## Class Diagram dei Servizi

```mermaid
classDiagram
    class CatalogService {
        -VIXSRC_BASE_URL: string
        -CACHE_TTL: number
        -vixsrcScraper: VixsrcScraperService
        +getMovies(filters): PaginatedResponse~Movie~
        +getTVShows(filters): PaginatedResponse~TVShow~
        +getPopularMovies(): Movie[]
        +getNowPlayingMovies(): Movie[]
        +getTop10Movies(): Movie[]
        +getTop10Mixed(): Top10Content[]
        +getPlatformTop10(now, customSlug): PlatformTop10
        +getPlatformHub(platform): PlatformHub
        +getComingSoon(limit): Top10Content[]
        +getComingToCinema(limit): Top10Content[]
        +getEditorialRails(preset): EditorialRails
        +getPersonalRails(profileId): PersonalRails
        +searchMovies(query, page): PaginatedResponse~Movie~
        +searchTVShows(query, page): PaginatedResponse~TVShow~
        +getGenres(type): Genre[]
    }

    class VideoPlayerService {
        -VIXSRC_BASE_URL: string
        +checkMovieAvailability(tmdbId): boolean
        +getMovieVideoSource(tmdbId): VideoSource
        +checkTVShowAvailability(tmdbId, season, episode): boolean
        +getTVShowVideoSource(tmdbId, season, episode): VideoSource
        +validatePlayerUrl(url): boolean
    }

    class VixsrcHlsService {
        +resolveHlsStream(tmdbId, type, season?, episode?): StreamResolution
        +fetchMasterPlaylist(url, headers): string
        +rewriteManifestForRelay(manifest, relayBaseUrl): string
        +fetchSegmentProxy(segmentUrl): ReadableStream
    }

    class AvailabilityService {
        +checkBatchAvailability(items): AvailabilityMap
        +isAvailable(tmdbId, type): boolean
    }

    class TMDBMoviesService {
        -TMDB_BASE_URL: string
        -TMDB_API_KEY: string
        +getMovieDetails(tmdbId): Movie
        +getTVShowDetails(tvShowId): TVShow
        +getMovieVideos(tmdbId): VideoTrailer[]
        +getTVShowVideos(tvShowId): VideoTrailer[]
        +getTVSeasons(tvShowId): SeasonDetails[]
        +searchMovies(query, page): SearchResponse
        +searchTVShows(query, page): SearchResponse
    }

    class CatalogController {
        -catalogService: CatalogService
        +getMovies(req): NextResponse
        +getTVShows(req): NextResponse
        +getPopularMovies(req): NextResponse
        +getEditorialRails(req): NextResponse
        +getPersonalRails(req): NextResponse
        +getPlatformHub(req): NextResponse
        +searchMovies(req): NextResponse
    }

    class PlayerController {
        -playerService: PlayerService
        -vixsrcHlsService: VixsrcHlsService
        +getMovieEmbed(req): NextResponse
        +getTVShowEmbed(req): NextResponse
        +resolveHlsStream(req): NextResponse
        +relayStream(req): NextResponse
    }

    CatalogController --> CatalogService : usa
    PlayerController --> VideoPlayerService : usa
    PlayerController --> VixsrcHlsService : usa
    CatalogService --> TMDBMoviesService : usa
    CatalogService --> AvailabilityService : usa
    VideoPlayerService --> VixsrcHlsService : usa
```

---

## Flowchart e Flussi Operativi

### Flusso di Riproduzione Ibrido (HLS / Relay / Iframe)

Il player seleziona dinamicamente la strategia migliore in base al dispositivo (TV o Browser) e alla salute del flusso:

```mermaid
flowchart TD
    A["Richiesta Riproduzione (tmdb_id)"] --> B{"Client è Smart TV (WebOS)?"}
    
    B -->|Sì| C["Richiedi Stream HLS Nativo (/api/player/resolve)"]
    B -->|No| D["Richiedi Stream HLS o Embed standard"]
    
    C --> E{"Stream HLS Estratto con successo?"}
    
    E -->|Sì| F{"Verifica connettività segmenti VixSrc"}
    F -->|DNS / TLS OK| G["Carica Hls.js con buffer TV ottimizzato"]
    F -->|TLS Block / CORS Error| H["Ridirigi attraverso Relay Proxy (/api/player/relay)"]
    
    G --> I{"Errore Decoder TV 1101 o Crash Audio?"}
    I -->|No| J["Riproduzione HLS Fluida"]
    I -->|Sì| K["Forza Downmix Audio Stereo & Trasmuxing Hls.js"]
    K --> J

    E -->|No| L["Fallback su Player Iframe Sicuro"]
    D --> E
    H --> J
```

---

### Flusso Raccomandazioni Personalizzate e Discovery

```mermaid
flowchart TD
    Req["Richiesta /api/catalog/personal"] --> H{"Profilo ha Watch History?"}
    
    H -->|Sì| S["Estrai Seed (ultimi titoli visti con completamento > 50%)"]
    H -->|No| T["Usa Fallback: Top Trending + Editoriali"]
    
    S --> Feat["Estrai Feature TMDB (generi, parole chiave, cast)"]
    Feat --> Pool["Interroga Discovery TMDB (Affinity Pool)"]
    Pool --> Dedup["Rimuovi duplicati e titoli già visti"]
    Dedup --> Avail["Filtra disponibilità VixSrc (Batch check)"]
    Avail --> Rails["Costruisci Rail: 'Perché hai visto X', 'Ispirati a Y'"]
    
    T --> Rails
    Rails --> Ret["Restituisci PersonalRails JSON"]
```

---

### Flusso Multi-Tier Cache

```mermaid
flowchart LR
    In["Chiamata API"] --> L1{"Hit In-Memory LRU?"}
    L1 -->|Sì| Res["Restituisci Dati"]
    L1 -->|No| L2{"Hit Redis Cache?"}
    L2 -->|Sì| SaveL1["Salva in Memoria"] --> Res
    L2 -->|No| Ext["Chiamata TMDB / VixSrc"]
    Ext --> SaveL2["Salva in Redis (TTL 1h)"]
    SaveL2 --> SaveL1
```

---

## Sequence Diagram

### Sequenza di Caricamento e Streaming HLS Nativo

```mermaid
sequenceDiagram
    autonumber
    actor U as Utente (Living TV / Web)
    participant P as Player View (Hls.js)
    participant API as /api/player/resolve
    participant HLS as VixsrcHlsService
    participant VS as VixSrc CDN
    participant HIST as /api/watch-history (Supabase)

    U->>P: Avvia riproduzione film/episodio
    P->>API: GET /api/player/resolve?id=123&type=movie
    API->>HLS: resolveHlsStream(123, 'movie')
    HLS->>VS: Scraping & Estrazione Master Manifest
    VS-->>HLS: URL master.m3u8 + Token
    HLS-->>API: StreamResolution { streamUrl, audioTracks }
    API-->>P: JSON { success: true, url, audioMode }

    P->>VS: Richiesta manifest & chunk TS
    alt Rete diretta bloccata o CORS
        P->>API: GET /api/player/relay?url={segmentUrl}
        API->>VS: Proxy chunk streaming
        VS-->>API: Binary TS stream
        API-->>P: 206 Partial Content
    end

    P->>U: Video in riproduzione
    loop Ogni 15 secondi
        P->>HIST: POST /api/watch-history (timestamp progressivo)
    end
```

---

### Sequenza di Pre-flight Batch Availability

```mermaid
sequenceDiagram
    autonumber
    participant UI as Browse Page (Living TV)
    participant API as /api/player/check-availability/batch
    participant SRV as AvailabilityService
    participant CACHE as In-Memory Cache

    UI->>API: POST { items: [{ id: 101, type: 'movie' }, { id: 102, type: 'tv' }] }
    API->>SRV: checkBatch(items)
    loop Per ogni elemento
        SRV->>CACHE: Controlla stato salvato
        alt Cache Miss
            SRV->>SRV: Verifica rapida HEAD su VixSrc
            SRV->>CACHE: Salva stato (disponibile: bool)
        end
    end
    SRV-->>API: Map { 101: true, 102: false }
    API-->>UI: Risultati badge disponibilità in tempo reale
```

---

## Catalogo Completo degli Endpoint API

Tutti gli endpoint rispondono con JSON standard: `{ "success": boolean, "data": any, "error"?: string }`.  
In Next.js 16, tutti i route handlers dinamici usano `await params`.

### Catalogo Base & Popolari

| Endpoint | Metodo | Descrizione | Parametri Query |
| :--- | :--- | :--- | :--- |
| `/api/catalog/movies` | `GET` | Catalogo film con filtri avanzati | `genre`, `year`, `language`, `sortBy`, `sortOrder`, `page` |
| `/api/catalog/tv` | `GET` | Catalogo serie TV con filtri | `genre`, `year`, `language`, `sortBy`, `sortOrder`, `page` |
| `/api/catalog/popular/movies` | `GET` | Film popolari del momento | `page` |
| `/api/catalog/popular/tv` | `GET` | Serie TV popolari del momento | `page` |
| `/api/catalog/latest/movies` | `GET` | Ultimi film usciti | `page` |
| `/api/catalog/latest/tv` | `GET` | Ultime serie TV aggiunte | `page` |
| `/api/catalog/top-rated/movies`| `GET` | Film con il rating più alto | `page` |
| `/api/catalog/top-rated/tv` | `GET` | Serie TV con il rating più alto | `page` |
| `/api/catalog/now-playing` | `GET` | Film attualmente nelle sale cinematografiche | `page` |
| `/api/catalog/top-10` | `GET` | Top 10 combinata di tendenza | - |

---

### Discovery, Rails Editoriali e Personal Hub

| Endpoint | Metodo | Descrizione | Parametri Query / Body |
| :--- | :--- | :--- | :--- |
| `/api/catalog/editorial` | `GET` | Rail tematiche curate dalla redazione | `preset` (es. `action`, `cult`, `italian`) |
| `/api/catalog/personal` | `GET` | Rail personalizzate algoritmiche | `profileId`, `limit` |
| `/api/catalog/platform-hub` | `GET` | Contenuti aggregati per piattaforma (Netflix, Prime, Disney+, Apple TV) | `platform` |
| `/api/catalog/platform-top10` | `GET` | Top 10 per specifica piattaforma streaming | `platform`, `date` |
| `/api/catalog/coming-soon` | `GET` | Titoli in arrivo su piattaforme digitali | `limit` |
| `/api/catalog/coming-to-cinema`| `GET` | Uscite future confermate nei cinema | `limit` |
| `/api/catalog/genres` | `GET` | Elenco generi ufficiali con ID | `type` (`movie` o `tv`) |

---

### Ricerca

| Endpoint | Metodo | Descrizione | Parametri Query |
| :--- | :--- | :--- | :--- |
| `/api/catalog/search/movies` | `GET` | Ricerca full-text film con debouncing | `query`, `page` |
| `/api/catalog/search/tv` | `GET` | Ricerca full-text serie TV | `query`, `page` |

---

### Player & Video Streaming HLS

| Endpoint | Metodo | Descrizione | Parametri |
| :--- | :--- | :--- | :--- |
| `/api/player/resolve` | `GET` | Risolve e prepara lo stream `.m3u8` diretto | `id` (TMDB), `type`, `season?`, `episode?` |
| `/api/player/hls` | `GET` | Proxy manifest HLS con header anti-CORS | `url` |
| `/api/player/relay` | `GET` | Proxy relay di singoli segmenti video `.ts` | `url` (URL segmento originale) |
| `/api/player/movie/[id]` | `GET` | Video source metadata film | Param path `id` |
| `/api/player/tv/[id]` | `GET` | Video source metadata serie TV (S1 E1) | Param path `id` |
| `/api/player/tv/[id]/[season]/[episode]` | `GET` | Video source specifico episodio | Param path `id`, `season`, `episode` |
| `/api/player/check-availability` | `GET` | Verifica singola disponibilità VixSrc | `tmdbId`, `type`, `season?`, `episode?` |
| `/api/player/check-availability/batch` | `POST` | Verifica batch per schede del catalogo | Body: `{ items: [{ id, type }] }` |
| `/api/player/generate-url` | `GET` | Genera URL player iframe firmato | `tmdbId`, `type`, `season?`, `episode?` |

---

### TMDB Diretto

| Endpoint | Metodo | Descrizione | Parametri |
| :--- | :--- | :--- | :--- |
| `/api/tmdb/movies/[id]` | `GET` | Dettagli completi film TMDB | Param path `id` |
| `/api/tmdb/movies/[id]/videos` | `GET` | Trailer e teaser video ufficiali | Param path `id` |
| `/api/tmdb/tv/[id]` | `GET` | Dettagli completi serie TV TMDB | Param path `id` |
| `/api/tmdb/tv/[id]/seasons` | `GET` | Elenco stagioni ed episodi con trame | Param path `id` |
| `/api/tmdb/tv/[id]/videos` | `GET` | Trailer e teaser video serie TV | Param path `id` |

---

### Household, Profili e TV Pairing

| Endpoint | Metodo | Descrizione | Note |
| :--- | :--- | :--- | :--- |
| `/api/household` | `GET`, `POST` | Recupero e creazione nucleo familiare | Gestito con sessione Supabase |
| `/api/household/profiles` | `GET`, `POST` | Gestione profili utente del nucleo | Supporta flag `is_kids` |
| `/api/household/switch` | `POST` | Cambio profilo attivo | Imposta cookie sicuro di sessione |
| `/api/device` | `GET`, `POST` | Pairing Smart TV via codice a 6 cifre | Valido 15 minuti |

---

### Cronologia di Visione e Feedback ML

| Endpoint | Metodo | Descrizione | Note |
| :--- | :--- | :--- | :--- |
| `/api/watch-history` | `GET`, `POST`, `DELETE` | Timestamp di riproduzione e lista "Continua a guardare" | Heartbeat ogni 15s durante la visione |
| `/api/taste/feedback` | `POST` | Segnali espliciti (like/skip) per affinità | Alimenta l'algoritmo delle Personal Rails |
| `/api/admin/ml-metrics` | `GET` | Statistiche di conversione e click-through delle raccomandazioni | Protetto da middleware admin |

---

## Resilienza, Gestione Errori e Smart TV (WebOS)

Il sistema implementa contromisure specifiche per l'ambiente critico delle Smart TV:

### 1. Fix Errore `MEDIA_ERR_DECODE (Codice 1101)`
- **Causa**: Buffer overflow o time-discontinuity nei segmenti HLS quando il decoder hardware TV non riesce a sincronizzare audio e video.
- **Risoluzione nel codice**:
  - `utils/hls-config.ts` imposta `maxBufferLength: 30`, `maxMaxBufferLength: 60` e `enableWorker: true`.
  - Fallback automatico su `audioPreference: 'stereo'` per prevenire crash su tracce audio multicanale non supportate.

### 2. Risoluzione Segmenti VixSrc e TLS/DNS Block
- **Causa**: Alcuni ISP o Smart TV bloccano la risoluzione DNS o le connessioni TLS dirette verso i domini CDN dei segmenti video.
- **Risoluzione nel codice**:
  - `VixsrcHlsService` riscrive gli URI dei chunk `.ts` nel master manifest reindirizzandoli verso `/api/player/relay`.
  - Il relay Next.js fa da proxy trasparente in streaming binario con header `Accept-Ranges: bytes`.

### 3. Matrice dei Codici di Errore

| Codice | Significato | Comportamento del Sistema |
| :--- | :--- | :--- |
| `400` | ID non valido / Parametri mancanti | Restituisce errore JSON con validazione middleware |
| `404` | Titolo non trovato su TMDB | Fallback su mock locale se configurato |
| `422` | Stream video non disponibile su VixSrc | Il player mostra badge "Non disponibile" e offre alternative |
| `502 / 504` | Gateway Timeout da provider esterno | Attivazione della cache secondaria e tentativo di relay |
| `1101 (Client)` | Decoder Hardware TV in stallo | Riavvio istantaneo Hls.js con buffer ridotto e audio stereo |

---

## Configurazione e Variabili d'Ambiente

File `.env.local` / Environment di Produzione:

```env
# TMDB Configuration
TMDB_API_KEY=your_tmdb_api_key_v3
TMDB_READ_TOKEN=your_tmdb_read_access_token_v4

# VixSrc Configuration
VIXSRC_BASE_URL=https://vixsrc.to

# Cache Configuration
REDIS_URL=redis://default:token@your-redis-upstash.com:6379
CACHE_TTL=3600

# Supabase Persistence
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# App Environment
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=production
```

---

## Metriche, Logging e Performance Target

- **Tempo di risposta API (Cache Hit)**: $< 150\text{ms}$
- **Tempo di risposta API (Cache Miss / TMDB Call)**: $< 1.2\text{s}$
- **Risoluzione Stream HLS**: $< 2.0\text{s}$ dall'inizio richiesta all'avvio buffer
- **Target Cache Hit Rate**: $> 85\%$ sul traffico catalogo
- **Logging Strutturato**: Tramite `utils/logger.ts` con output formattato per cloud monitoring (`INFO`, `WARN`, `ERROR` con metadati e tracing ID).
