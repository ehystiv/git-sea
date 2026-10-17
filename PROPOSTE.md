# Proposte di feature e miglioramenti

Raccolte il 17 ottobre 2026 dall'analisi del codice e delle voci "Non fatto" del vecchio piano di progetto. L'app resta di sola lettura sui repository.

## Top 5 ✅

1. **Ahead/behind rispetto all'upstream nella sidebar** ✅. Comando `list_upstreams` (`git/upstream.rs`, dalla configurazione `branch.<nome>.*`); conteggi nel frontend con `divergence` (`features/graph/range.ts`), che colora gli antenati dei due lati e si ferma appena resta solo storia comune. Badge "4↑ 2↓"; il clic accende i commit dei due lati e mette un chip in toolbar. Voci nella palette.
2. **Confronto tra due commit** ✅. ⇧-clic su un altro commit (grafo, topologia, timeline, elenco) o "Confronta con HEAD / con <ref>" dalla palette: `ComparePanel` con i file e i diff tra i due alberi (`commit_details` e `file_diff` hanno il parametro nuovo `base`), i commit presenti in un solo lato e "Inverti". La base è l'antenato, se uno discende dall'altro, altrimenti il più vecchio per data. Per i merge, il pannello dettagli sceglie il parent di confronto.
3. **Storia di un file** ✅. Pulsante sulla riga del file (al passaggio del mouse): apre la ricerca con `path:<file>`. Non segue le rinomine. Da fare più avanti: blame (`gix-blame`).
4. **Ripristino delle tab all'avvio e riordino trascinandole** ✅. Le tab aperte e quella attiva sono salvate con i recenti e riaperte all'avvio (i repo spariti si saltano). Riordino con eventi pointer, non con il drag and drop HTML, che su Windows è disattivato dalla gestione dei file trascinati.
5. **Evidenziazione per parola nel diff** ✅. `wordDiff.ts`: LCS sui token delle righe accoppiate, nessun segno per righe troppo diverse (meno del 35% in comune) o troppo lunghe (oltre 400 token).

## Navigazione e ricerca ✅

- **Indietro/avanti nella selezione** ✅. ⌘[ / ⌘] (Ctrl su Linux e Windows, riconosciuti anche dal codice del tasto, perché sulla tastiera italiana le parentesi quadre richiedono ⌥), tasti indietro/avanti del mouse, voci nella palette. `features/repo/history.ts`: j/k/h/l sono passi e sostituiscono l'ultima voce, i clic e i salti la aggiungono.
- **Menu contestuale sui commit** ✅. Clic destro in grafo, topologia, timeline ed elenco: copia hash (intero o breve) e messaggio completo, confronta con il selezionato, segnalibro, apri su GitHub/GitLab/Bitbucket/Azure DevOps (comando `repo_web`). Componente condiviso `components/ContextMenu`, usabile da tastiera.
- **Segnalibri** ✅. `b`, menu o palette; salvati per repository, in cima alla sidebar e nella palette, con un nastro sul nodo in grafo e topologia (non nella timeline).
- **Pickaxe `diff:`** ✅. Come `git log -S` (con le rinomine secondo la configurazione di git); blob oltre 2 MiB esclusi.
- **Termini combinati, date e regex** ✅. `login author:Anna Rossi after:2024-05 path:src`; `after:`/`before:` con date assolute o relative (`2w`, `oggi`); `re:` su oggetto e autore; un solo termine tra `msg:`, `path:` e `diff:`.
- **Ricerca tra gli antenati** ✅. Con gli antenati accesi la ricerca guarda solo la storia del commit selezionato all'inizio, che resta fermo mentre si scorrono i risultati.

## Distribuzione e qualità ✅

- **Aggiornamento automatico** ✅. `tauri-plugin-updater` + `tauri-plugin-process`: controllo all'avvio e ogni 6 ore (disattivabile), avviso nella barra del titolo, download, installazione e riavvio. Le release firmano gli archivi con il secret `TAURI_SIGNING_PRIVATE_KEY` (chiave pubblica in `tauri.conf.json`). Su Linux si aggiorna l'AppImage; per `.deb` e `.rpm` l'app rimanda alla pagina delle release.
- **Pulizia della cache** ✅. Formato 2 con il percorso di `.git` in testa al file; all'avvio si tolgono i file dei repository spariti, quelli vecchi o illeggibili e i temporanei di un crash. Nelle impostazioni: spazio occupato e "Svuota". Non alla chiusura del repo: la cache serve proprio a riaprirlo in fretta.
- **Cloni parziali** ✅. Errore `MissingObjects` quando un clone parziale non ha gli oggetti richiesti: la ricerca dice che `path:` e `diff:` non possono cercare (`msg:` sì), il pannello spiega cosa manca.
- **Ricarica incrementale**: scartata. Dopo un fetch la ricarica completa costa ~0,3 s su 50k commit; aggiornare solo una parte vuol dire ricalcolare le corsie di tutto ciò che sta sotto i commit nuovi, con un rischio alto di layout incoerenti.

## Da valutare dopo

### Navigazione
- **Apertura da terminale** (`git-sea .`) con i plugin `cli` e `single-instance`: se l'app è aperta, il repo arriva in una nuova tab.

### Capire la storia
- **Vista del reflog:** dove stava HEAD prima di un rebase o reset, con i commit "fantasma" non più nel grafo.
- **Statistiche** del repo o del branch: commit per autore, heatmap nel tempo.
- **`.mailmap`** per unificare gli autori in ricerca e statistiche.
- **Firme GPG/SSH** come badge nel pannello dettagli.

### Viste
- **Minimappa nella timeline** (Fase 10, "Non fatto"): adattare `MinimapOverlay` tramite `onFrame`/`goTo`.
- **Esportazione del grafo visibile** in PNG/SVG.
- ~~Numero di nodi in Topologia~~: c'è già, nella toolbar.
