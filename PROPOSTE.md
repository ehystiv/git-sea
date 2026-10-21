# Proposte di feature e miglioramenti

Raccolte il 17 ottobre 2026 dall'analisi del codice e delle voci "Non fatto" del vecchio piano di progetto. L'app resta di sola lettura sui repository.

## Top 5 ✅

1. **Ahead/behind rispetto all'upstream nella sidebar** ✅. Comando `list_upstreams` (`git/upstream.rs`, dalla configurazione `branch.<nome>.*`); conteggi nel frontend con `divergence` (`features/graph/range.ts`), che colora gli antenati dei due lati e si ferma appena resta solo storia comune. Badge "4↑ 2↓"; il clic accende i commit dei due lati e mette un chip in toolbar. Voci nella palette.
2. **Confronto tra due commit** ✅. ⇧-clic su un altro commit (grafo, topologia, timeline, elenco) o "Confronta con HEAD / con <ref>" dalla palette: `ComparePanel` con i file e i diff tra i due alberi (`commit_details` e `file_diff` hanno il parametro nuovo `base`), i commit presenti in un solo lato e "Inverti". La base è l'antenato, se uno discende dall'altro, altrimenti il più vecchio per data. Per i merge, il pannello dettagli sceglie il parent di confronto.
3. **Storia di un file** ✅. Pulsante sulla riga del file (al passaggio del mouse): apre la ricerca con `path:<file>`, che segue le rinomine (cammino topologico: quando un commit aggiunge il file, una diff con le rinomine trova il nome precedente, che si aggiunge ai percorsi seguiti). **Blame** ✅: terza scheda accanto a Unificato/Affiancato (`git/blame.rs`, feature `blame` di `gix`, rinomine seguite); per ogni gruppo di righe hash, autore e data, con una striscia più accesa per i commit più recenti; le righe del commit mostrato sono segnate; il clic seleziona il commit.
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
- **Ricarica incrementale**: scartata. Dopo un fetch la ricarica completa costa ~0,3 s su 50k commit; aggiornare solo una parte vuol dire ricalcolare la disposizione dei branch di tutto ciò che sta sotto i commit nuovi, con un rischio alto di layout incoerenti.

## Viste ✅

- **Minimappa nella timeline** ✅. La minimappa è diventata generica (`MinimapModel`): la timeline ha il tempo in orizzontale e una fascia per branch, con il viewport fatto dell'intervallo di tempo e dei branch visibili.
- **Esportazione della vista in PNG** ✅. Grafo, topologia e timeline: "Salva come PNG…" (finestra di salvataggio aperta dal backend) e "Copia come immagine", dal pulsante accanto allo zoom o dalla palette. Disegnata almeno a 2×, senza hover né pallini animati.
- **SVG**: scartato per ora. Il grafo è disegnato con `Path2D`, che le librerie di emulazione Canvas→SVG non sanno leggere; servirebbe un secondo renderer.
- ~~Numero di nodi in Topologia~~: c'era già, nella toolbar.

## Seconda tornata (19 ottobre 2026)

- **Contenuto in e rilasciato in** ✅. Nel pannello dettagli: il tag più vecchio che contiene il commit ("Rilascio") e i branch locali e remoti che lo contengono ("In"), come `git tag/branch --contains`. Calcolato nel frontend (`features/graph/contains.ts`) scendendo dai figli del commit, quindi un commit recente costa pochi passi. Con il filtro dei branch conta solo la storia caricata.
- **Pull request e merge request nel grafo** ✅. Comando `pull_requests` (`ci/pulls.rs`): le 100 richieste aggiornate più di recente da GitHub o GitLab, con gli stessi token della CI (`gh`/`glab` o portachiavi). Nel grafo un badge sopra i ref (`#12` o `!12`): sulla punta per quelle aperte (tratteggiato per le bozze), sul commit di merge (o squash) per quelle unite; le chiuse senza merge si saltano. Sezione in sidebar con le aperte, riga "Richiesta" nel pannello dettagli con il link. Richieste di nuovo ogni 3 minuti e dopo ogni fetch. Non nella timeline.
- **Replay della storia in GIF o video** ✅. Dal menu di esportazione o dalla palette, in grafo e topologia: la storia cresce commit dopo commit da sinistra (in ordine topologico, così ogni commit arriva dopo i suoi parent), con lo zoom e l'altezza che il grafo aveva, ogni commit che entra con l'animazione d'arrivo del grafo (arco tracciato, nodo che spunta, anello; solo da riquadri in su, non con i puntini), la telecamera che segue il fronte e una didascalia con mese e numero di commit. Il disegno è quello del grafo (`draw()`) ritagliato al fronte (`features/replay/`). Inizio e fine a scelta ("Da"/"A": tag, branch, commit selezionato; "Replay da qui"/"Replay fino a qui" nel menu del commit): la storia fino all'inizio c'è già al primo fotogramma, e con una fine si vede solo la storia di quel commit, disposta a parte dal comando `replay_commits`. All'apertura finisce sul branch del commit selezionato (quello di cui è la punta, altrimenti il branch locale che lo contiene, HEAD prima). Velocità in commit al secondo (1–1000; all'inizio quella che dura circa 30 s), con la durata accanto; GIF fino a 2 minuti. "Salva GIF…" disegna i fotogrammi fuori schermo a 15 fps, larga al massimo 960 px, con la palette dell'ultimo fotogramma (dipendenza `gifenc`); "Salva video…" registra in tempo reale il canvas a 60 fps con `MediaRecorder` (MP4 dove c'è, altrimenti WebM; il pulsante manca dove la webview non sa registrare). Il comando `save_png` è diventato `save_export` con il formato.

## Terza tornata (21 ottobre 2026)

- **Statistiche** ✅. Quinta vista "Statistiche" (tasto 4, palette), calcolata nel frontend sulla storia caricata (`features/stats/stats.ts`), quindi segue il filtro dei branch: commit, autori, giorni attivi e periodo; calendario dell'attività per giorno (ultimi 12 mesi o un anno a scelta); giorno × ora nel fuso orario locale; classifica dei commit per autore. Il clic su un autore mostra solo la sua attività (e porta il calendario al suo ultimo anno, se da 12 mesi non committa); il clic su un giorno, o il pulsante accanto all'autore, apre l'Elenco con la ricerca (`author:`, `after:`/`before:`).
- **`.mailmap`** ✅. Feature `mailmap` di `gix` (`git/mailmap.rs`): nome ed email canonici nel cammino dei commit (quindi grafo, ricerca e statistiche), nei dettagli e nel blame. La mailmap fa parte dell'impronta della cache (formato 3); una modifica a `.mailmap` nella copia di lavoro ricarica il grafo.

- **Apertura da terminale** ✅. `git-sea` apre il repo della cartella corrente, `git-sea <percorso>…` quelli indicati (risalendo alla radice del repo), ciascuno in una tab. Con `tauri-plugin-single-instance` un secondo avvio passa gli argomenti all'app aperta ed esce; su macOS anche l'evento "apri" del sistema (`open -a git-sea .`, una cartella trascinata sull'icona nel Dock; `Info.plist` dichiara le cartelle senza diventarne l'app predefinita). I percorsi aspettano nel backend (`launch.rs`) finché il frontend, dopo aver ripristinato le tab, li prende. Il comando: su macOS "Installa il comando git-sea…" (menu dell'app, palette, impostazioni) scrive in `/usr/local/bin` uno script che usa `open -a`, chiedendo la password se serve (`shell_command.rs`); con i pacchetti `.deb` e `.rpm` c'è già `/usr/bin/git-sea`. Niente plugin `cli`: basta leggere i percorsi.

## Da valutare dopo

### Capire la storia
- **Vista del reflog:** dove stava HEAD prima di un rebase o reset, con i commit "fantasma" non più nel grafo.
- **Firme GPG/SSH** come badge nel pannello dettagli.
