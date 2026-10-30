# Errore 06: Violazione Check Constraint Database su `pair_code` (`PostgresError 23514`)

## Descrizione del problema
Durante l'esecuzione dello script di swap dei codici di accoppiamento tra i profili PAPI e RICH, la query di aggiornamento `UPDATE "watch_profiles"` è fallita bruscamente sollevando l'eccezione:
```
PostgresError: new row for relation "watch_profiles" violates check constraint "watch_profiles_pair_code_format"
code: '23514'
detail: 'Failing row contains (63b7d384-..., TMP_1793306989276, ..., PAPI, 0).'
```

## Cosa lo causava
1. **Vincolo di Unicità su `pair_code`**:
   La tabella `watch_profiles` possiede un vincolo di unicità `UNIQUE` sulla colonna `pair_code`. Non è possibile assegnare direttamente il codice di PAPI a RICH senza prima liberarlo da PAPI, altrimenti si genera un errore di chiave duplicata.
2. **Uso di un Codice Temporaneo non Conforme**:
   Lo script iniziale aveva introdotto un valore temporaneo `TMP_${Date.now()}` (`TMP_1793306989276`) per parcheggiare il codice di PAPI durante la transazione.
3. **Presenza di un Check Constraint Reperito nel Catalogo di Postgres**:
   La tabella ha un vincolo di controllo esplicito:
   ```sql
   CHECK ((pair_code ~ '^[A-HJ-NP-Z2-9]{8}$'::text))
   ```
   Tale vincolo impone che qualsiasi codice debba essere composto da esattamente 8 caratteri appartenenti all'alfabeto Base32 (escludendo le lettere ambigue I, O, e i numeri 0, 1). Il prefisso `TMP_` e i timestamp numerici non rispettavano questa espressione regolare, violando il vincolo `23514`.

## Cosa è stato fatto per risolverlo
1. **Ispezione del Vincolo nel Database**:
   - Eseguita una query SQL su `pg_constraint` per estrarre la definizione esatta della regex con `pg_get_constraintdef(c.oid)`.
2. **Adozione di un Placeholder Base32 Valido**:
   - È stato scelto il valore temporaneo `'ZZZZZZZZ'`, conforme alla regex `^[A-HJ-NP-Z2-9]{8}$`.
   - È stato verificato preventivamente che il valore non fosse già presente nel database.
3. **Esecuzione dello Swap in 3 Passaggi**:
   - Passaggio 1: PAPI `pair_code` impostato temporaneamente a `'ZZZZZZZZ'`.
   - Passaggio 2: RICH `pair_code` impostato a `'H3ZJMELQ'`.
   - Passaggio 3: PAPI `pair_code` impostato a `'8M2ZD64Z'`.
   - L'operazione è andata a buon fine senza violazioni di unicità né di formato.

### Errori successivi generati
- Nessun errore successivo: lo swap è stato completato e ha sbloccato la migrazione definitiva di tutti i dispositivi e della cronologia (vedi [05-binding-profilo-papi-rich-codici.md](file:///c:/Users/matti/Documents/TheHustlePlace/doc/errore/05-binding-profilo-papi-rich-codici.md)).
