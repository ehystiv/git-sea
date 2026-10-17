# Proposte di feature e miglioramenti

Raccolte il 17 ottobre 2026 dall'analisi del codice e delle voci "Non fatto" di `PLAN.md`. Valgono i vincoli del piano: l'app resta di sola lettura sui repository.

## Top 5 ✅

1. **Ahead/behind rispetto all'upstream nella sidebar** ✅. Comando `list_upstreams` (`git/upstream.rs`, dalla configurazione `branch.<nome>.*`); conteggi nel frontend con `divergence` (`features/graph/range.ts`), che colora gli antenati dei due lati e si ferma appena resta solo storia comune. Badge "4↑ 2↓"; il clic accende i commit dei due lati e mette un chip in toolbar. Voci nella palette.
2. **Confronto tra due commit** ✅. ⇧-clic su un altro commit (grafo, topologia, timeline, elenco) o "Confronta con HEAD / con <ref>" dalla palette: `ComparePanel` con i file e i diff tra i due alberi (`commit_details` e `file_diff` hanno il parametro nuovo `base`), i commit presenti in un solo lato e "Inverti". La base è l'antenato, se uno discende dall'altro, altrimenti il più vecchio per data. Per i merge, il pannello dettagli sceglie il parent di confronto.
3. **Storia di un file** ✅. Pulsante sulla riga del file (al passaggio del mouse): apre la ricerca con `path:<file>`. Non segue le rinomine. Da fare più avanti: blame (`gix-blame`).
4. **Ripristino delle tab all'avvio e riordino trascinandole** ✅. Le tab aperte e quella attiva sono salvate con i recenti e riaperte all'avvio (i repo spariti si saltano). Riordino con eventi pointer, non con il drag and drop HTML, che su Windows è disattivato dalla gestione dei file trascinati.
5. **Evidenziazione per parola nel diff** ✅. `wordDiff.ts`: LCS sui token delle righe accoppiate, nessun segno per righe troppo diverse (meno del 35% in comune) o troppo lunghe (oltre 400 token).

## Da valutare dopo

### Navigazione e produttività
- **Indietro/avanti nella selezione** (⌘[ / ⌘]) tra salti da sidebar, parent, ricerca e minimappa.
- **Menu contestuale sui nodi:** "Copia hash", "Copia messaggio", "Apri su GitHub/GitLab" (parsing del remote già in `ci/remote.rs`, apertura con `open_url`).
- **Apertura da terminale** (`git-sea .`) con i plugin `cli` e `single-instance`: se l'app è aperta, il repo arriva in una nuova tab.
- **Segnalibri sui commit:** puntine locali per repo, persistite, con voci nella palette.

### Ricerca (Fase 11, "Non fatto")
- **Pickaxe** (`-S`/`-G`, ricerca nel contenuto dei diff) con prefisso `diff:`, nel backend con annullamento per generazione.
- **Filtri per autore e per data** combinabili, ricerca con **regex**.
- **Più evidenziazioni insieme** (ricerca e antenati intersecati, oggi vince la ricerca).

### Capire la storia
- **Vista del reflog:** dove stava HEAD prima di un rebase o reset, con i commit "fantasma" non più nel grafo.
- **Statistiche** del repo o del branch: commit per autore, heatmap nel tempo.
- **`.mailmap`** per unificare gli autori in ricerca e statistiche.
- **Firme GPG/SSH** come badge nel pannello dettagli.

### Viste
- **Minimappa nella timeline** (Fase 10, "Non fatto"): adattare `MinimapOverlay` tramite `onFrame`/`goTo`.
- **Esportazione del grafo visibile** in PNG/SVG.
- **Numero di nodi** nella barra di stato in Topologia (Fase 9, "Non fatto").

### Distribuzione e qualità
- **Aggiornamento automatico** con `tauri-plugin-updater` (le release su GitHub ci sono già).
- **Pulizia della cache** alla chiusura o per i repo spariti dal disco (Fase 7).
- **Messaggio chiaro per `path:` su un clone treeless**, invece di "Errore" con il dettaglio nel tooltip.
- **Ricarica incrementale** quando cambiano solo i ref remoti dopo un fetch (bassa priorità: con la cache bastano ~0,3 s, e le corsie rendono il cambiamento delicato).
