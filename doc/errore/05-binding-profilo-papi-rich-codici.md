# Errore 05: Sfasamento Profilo PAPI vs RICH (Bug di Focus/Binding della UI del Codice)

## Descrizione del problema
Tutte le serie TV e i film guardati dal fratello dell'utente sul suo iPad da 12" (*Modern Family*, *The O.C.*, l'intera saga degli 8 film di *Harry Potter*, *Desperate Housewives*) venivano registrati all'interno della cronologia del profilo del padre (**PAPI**) anziché nel profilo personale di suo fratello (**RICH**). 
Questo comportava:
- La sovrascrittura o contaminazione della cronologia del padre con i contenuti guardati dal fratello.
- Il profilo RICH risultava completamente vuoto (0 elementi visualizzati), pur essendo attivo e configurato nella schermata della TV.

## Cosa lo causava
Attraverso l'ispezione analitica del database PostgreSQL e delle tabelle `watch_profiles`, `watch_devices` e `watch_history`:

1. **Bug logico nel componente TV per la visualizzazione del codice di accoppiamento**:
   Quando l'utente apriva la schermata del codice per associare un nuovo dispositivo (l'iPad), la logica di visualizzazione selezionava di default il primo elemento dell'array dei profili (`shown[0]`, che era PAPI) anziché agganciarsi al profilo RICH selezionato graficamente.
2. **Accoppiamento Hardware invertito**:
   L'iPad del fratello aveva inserito il codice mostrato a schermo (`H3ZJ-MELQ`), che nel database era memorizzato sotto `pair_code` del profilo PAPI (`63b7d384-047a-4419-87c2-7266f6a51534`), mentre RICH possedeva il codice `8M2Z-D64Z`.
3. **Flussi di scrittura cronologia vincolati all'ID profilo errato**:
   Ogni richiesta di avanzamento video (`heartbeat` / `progress`) inviata dall'iPad usava il `profileId` di PAPI, alimentando per mesi la tabella `watch_history` sotto l'account sbagliato.

## Cosa è stato fatto per risolverlo
1. **Analisi Telemetrica delle Sessioni e Dispositivi**:
   - Identificati gli identificativi hardware dell'iPad di suo fratello (`e401336f-63e4-4def-857a-04336e33c626` e `3c25f6bc-dd82-45d1-93f0-cf5f62f2ce88`).
   - Isolate nel database tutte le 11 voci di cronologia appartenenti al fratello.
2. **Scambio Atomico dei Codici di Pairing**:
   - Per evitare che il fratello dovesse reinserire un nuovo codice sull'iPad, i codici sono stati scambiati:
     - **RICH** ha ricevuto definitivamente il codice **`H3ZJMELQ`** (mostrato come `H3ZJ-MELQ`).
     - **PAPI** ha ricevuto il codice **`8M2ZD64Z`** (mostrato come `8M2Z-D64Z`).
3. **Riassegnazione Dispositivi nella Tabella `watch_devices`**:
   - Aggiornati i record dei dispositivi dell'iPad impostando `profile_id` e `active_profile_id` all'ID di RICH (`319ab109-c999-42df-8b9e-c45f5ab4879f`).
4. **Migrazione della Cronologia in `watch_history`**:
   - Trasferite 11 voci (Modern Family, The O.C., saga completa Harry Potter, Desperate Housewives) con le percentuali e i secondi esatti di avanzamento nel profilo RICH.
   - PAPI è stato ripulito da tutte le sessioni non pertinenti.

### Errori successivi generati
- Il primo tentativo di eseguire lo scambio dei codici nel database ha provocato il fallimento per violazione del vincolo di formato su `pair_code` (vedi documentazione in [06-db-constraint-pair-code-format.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/06-db-constraint-pair-code-format.md)).
