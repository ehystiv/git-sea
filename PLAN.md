# Branchscope — Piano di progetto

> Nome provvisorio. Visualizzatore Git desktop per uso personale, ispirato a GitKraken ma con UI moderna e focus totale sulla **comprensione del grafo**: dove vanno i branch, come si mergiano, com'è fatto l'albero di commit.

**Stato:** Fase 0 ✅ · Fase 1 ✅ · Fase 2 ✅ · Fase 3 ✅ · Fase 4 ✅ · Fase 5 ✅ · Fase 6 ✅ · Fase 7 ✅ (in attesa di conferma, vedi §5). Mockup approvato: `mockup/index.html` (canvas a nodi) e `mockup/index-lista.html` (variante a lista, scartata).

---

## 1. Requisiti

| Area | Decisione |
|---|---|
| Scope | **Solo visualizzazione (read-only).** Nessuna operazione di scrittura su Git. |
| Piattaforma | **Solo macOS.** |
| Scala | Repo da **5.000 a 50.000 commit**. |
| Repo | **Più repo aperti in tab.** |
| Remoti | **Solo Git locale.** Nessuna integrazione GitHub/GitLab. |
| Viste | **Grafo a nodi stile n8n** (canvas con pan e zoom, flusso da sinistra a destra) + **vista topologica compressa** + **timeline orizzontale** + **minimappa** (overlay). |
| Estetica | Stile **Linear / Raycast** per l'interfaccia (denso, pulito, bordi sottili, accenti viola); il grafo segue il look di **n8n**: sfondo puntinato, nodi quadrati con icona ed etichetta sotto, porte di ingresso/uscita, connessioni curve. |
| Tema | **Scuro + chiaro**, segue l'impostazione di macOS. |
| Interazione | **Keyboard-first** (command palette ⌘K, j/k), mouse comunque supportato. |

### Obiettivi di performance
- Primo caricamento di un repo da 50k commit: prime righe visibili in **< 500 ms**, layout completo in **< 3 s**.
- Riapertura con cache valida: **< 300 ms**.
- Scroll del grafo a **60 fps** su tutta la storia.

---

## 2. Stack

### Backend (Rust)
- **Tauri 2** come shell desktop.
- **`gix` (gitoxide)** come unico motore Git. Read-only, quindi niente libgit2. Verificare le API sulla versione corrente del crate prima di usarle.
- **`notify`** per osservare `.git` e aggiornare il grafo in tempo reale.
- **`serde`** + **`tauri-specta`** (con `specta` e `specta-typescript`, versioni `=2.0.0-rc.25` / `0.0.12` fissate) per generare automaticamente i tipi TypeScript dei comandi.
- **`tauri-plugin-dialog`** per il selettore di cartelle (⌘O).
- **`postcard`** (o `bincode`) per la cache del layout su disco.
- **`thiserror`** per gli errori, **`tracing`** per i log.

### Frontend
- **React + TypeScript + Vite.**
- **Motion** per le transizioni.
- **TanStack Query** per i dati dal backend, **TanStack Virtual** per le liste.
- **Zustand** per lo stato UI (tab, selezione, vista attiva).
- **`cmdk`** per la command palette.
- **Shiki** per l'evidenziazione della sintassi nei diff.
- **CSS moderno**, senza framework utility: token su `:root`, `@layer`, container queries, view transitions. CSS Modules per lo scoping.
- Font: **Inter** (UI) e **JetBrains Mono** (hash, diff), inclusi nell'app con `@fontsource-variable/*` (niente rete a runtime).

---

## 3. Architettura

```
branchscope/
├── src-tauri/
│   └── src/
│       ├── main.rs
│       ├── commands/        # comandi Tauri esposti al frontend
│       ├── session.rs       # RepoSession per tab (handle gix, id, generazione di caricamento)
│       ├── error.rs         # AppError (thiserror + specta)
│       ├── git/             # accesso al repo via gix (walk, refs, diff)
│       ├── graph/
│       │   ├── lanes.rs     # algoritmo di assegnazione corsie
│       │   ├── topo.rs      # vista topologica compressa
│       │   └── timeline.rs  # proiezione su asse temporale
│       ├── cache/           # cache del layout su disco
│       └── watcher/         # notify su .git
└── src/
    ├── app/                 # shell, tab, routing tra viste
    ├── features/
    │   ├── graph/           # renderer canvas + righe virtualizzate
    │   ├── minimap/
    │   ├── topology/
    │   ├── timeline/
    │   ├── details/         # pannello commit + diff
    │   ├── sidebar/         # branch, tag, remote, stash
    │   └── palette/         # command palette
    ├── components/          # primitive UI condivise
    ├── lib/                 # binding generati, utility
    └── styles/              # token, tema, reset
```

### Principi
1. **Tutta la logica del grafo vive in Rust.** Il frontend riceve righe già posizionate (corsia, colore, segmenti da disegnare) e si limita a renderizzarle.
2. **Caricamento a blocchi.** Il backend percorre i commit in ordine topologico a blocchi di circa 2.000 e li invia in streaming tramite `tauri::ipc::Channel`. Il frontend mostra subito le prime righe.
3. **Un unico modello di grafo**, più proiezioni: verticale, topologica compressa, timeline. Le proiezioni sono funzioni pure in Rust sul modello base.
4. **Il grafo è un canvas a nodi in stile n8n** (vedi Fase 4): layout x = posizione topologica, y = corsia. **Rendering deciso in Fase 4: tutto su Canvas 2D** (nodi, testo, badge ed edge), con livelli di dettaglio e campionamento delle colonne quando si è molto lontani; WebGL non serve (misure in Fase 4). Si disegnano solo le colonne nel viewport. La lista virtualizzata (TanStack Virtual) resta per la vista a elenco e per la ricerca.
5. **Stato per tab.** Ogni tab ha un proprio `RepoSession` lato Rust (handle `gix`, layout, watcher), identificato da un id. `open_repo` crea la sessione e restituisce il suo `sessionId`; i comandi successivi lavorano su quell'id. Un nuovo caricamento sulla stessa sessione annulla quello in corso (contatore di generazione).

### Modello dati (bozza)

```rust
struct GraphRow {
    commit: CommitSummary, // id, short_id, summary, author, time, parents
    lane: u16,             // colonna del nodo
    color: u8,             // indice palette
    edges: Vec<Edge>,      // segmenti da disegnare in questa riga
    refs: Vec<RefLabel>,   // branch/tag/HEAD che puntano qui
}

struct Edge {
    from_lane: u16,
    to_lane: u16,
    kind: EdgeKind,        // Straight | MergeIn | ForkOut
    color: u8,
}
```

### Algoritmo delle corsie (lanes)
Percorrere i commit in ordine topologico mantenendo un array di corsie attive, dove ogni corsia contiene l'id del commit atteso:
1. Il commit occupa la prima corsia che lo attende. Se nessuna lo attende (punta di branch), prende la prima corsia libera.
2. Le altre corsie che attendevano lo stesso commit vi confluiscono (edge `MergeIn`) e si liberano.
3. Il primo parent continua nella stessa corsia, mantenendone il colore.
4. Gli altri parent (commit di merge) aprono nuove corsie o riusano quelle libere (edge `ForkOut`).
5. Le corsie libere vengono compattate per tenere il grafo stretto.

Requisiti: deterministico, incrementale (si riprende dallo stato delle corsie a fine blocco), coperto da test su repo di fixture.

### Cache
- Chiave: hash di HEAD più l'insieme ordinato di tutti i ref.
- Posizione: cartella di cache dell'app (`app_cache_dir`), un file per repo.
- Se i ref cambiano, si invalida e si ricalcola.

---

## 4. UI

### Layout principale
```
┌──────────────────────────────────────────────────────────┐
│ [tab repo 1] [tab repo 2] [+]                ⌘K           │ ← barra titolo overlay
├────────────┬──────────────────────────────────┬─────────────┤
│ Sidebar    │ Canvas a nodi (pan / zoom)       │ Dettagli    │
│ - Branch   │  ▢──▢──▢──┬─▢──▢──▢   ← HEAD     │ commit      │
│ - Remote   │           └─▢──▢──┘              │ + file      │
│ - Tag      │  [zoom]            [minimappa]   │ + diff      │
│ - Stash    │                                  │             │
└────────────┴──────────────────────────────────┴─────────────┘
```
- Commit vecchi a sinistra, HEAD a destra. Ogni nodo: icona per tipo di commit, etichetta e hash sotto, badge dei ref sopra.
- Controlli di zoom in basso a sinistra, minimappa overlay in basso a destra.
- Selettore della vista (Grafo / Topologia / Timeline) nella toolbar.
- Pannello dettagli richiudibile.

### macOS
- Finestra con `titleBarStyle: "Overlay"`, semafori integrati nella barra delle tab.
- Vibrancy sulla sidebar tramite gli effetti finestra di Tauri (richiede finestra trasparente: rimandata alla Fase 6).

### Tema
- Token CSS su `:root` (colori, superfici, bordi, raggi, spaziature, palette dei branch).
- Override per il tema scuro sotto `@media (prefers-color-scheme: dark)`.
- Palette dei branch: 8–10 colori distinguibili su entrambi i temi.

### Scorciatoie (minimo)
| Tasto | Azione |
|---|---|
| ⌘K | Command palette |
| j / k | Commit successivo / precedente |
| h / l | Primo parent / figlio |
| Enter | Apri / chiudi dettagli |
| ⌘1–9 | Vai alla tab N |
| ⌘O | Apri repo |
| ⌘W | Chiudi tab |
| / | Cerca |
| g h | Vai a HEAD |
| 1 / 2 / 3 | Vista grafo / topologia / timeline |

---

## 5. Fasi

**Regola di lavoro: una fase alla volta.** A fine fase ci si ferma per la revisione e si aspetta conferma prima di proseguire. Niente codice di fasi successive in anticipo.

### Fase 0 — Mockup ✅
- Mockup statico HTML/CSS della vista principale, in tema scuro e chiaro, con dati finti.
- **Nessun codice dell'app finché il mockup non è approvato.**
- Esito: approvato il canvas a nodi stile n8n (`mockup/index.html`).

### Fase 1 — Scheletro ✅
- Progetto Tauri 2 + React + Vite + TypeScript.
- Finestra macOS con titlebar overlay.
- Token di tema e primitive UI di base.
- Comando `open_repo(path)` con apertura via `gix` e restituzione di nome, HEAD e numero di ref.
- Integrazione `tauri-specta`.
- Esito: `open_repo` con apertura via drag & drop o percorso incollato; 4 test Rust; bindings in `src/lib/bindings.ts`.

### Fase 2 — Lettura commit ✅
- `RepoSession` lato Rust: `open_repo` restituisce un `sessionId`; aggiunta di `close_repo`.
- Walk topologico con `gix` (`gix::traverse::commit::topo`, equivalente a `git log --topo-order --all`) e streaming a blocchi via `Channel`, con annullamento se parte un nuovo caricamento.
- ⌘O e pulsante "Sfoglia…" con `tauri-plugin-dialog`.
- Lista commit virtualizzata (senza grafo) per validare la velocità.
- Benchmark su un repo pubblico da circa 50k commit.
- Esito (release, macOS, `cargo run --release --example bench_walk -- <repo> [rev]`, repo `nodejs/node` clone treeless):

  | Repo | Primo blocco | Totale | Obiettivo |
  |---|---|---|---|
  | `main`, 49k commit | ~250-330 ms | ~320-400 ms | < 500 ms / < 3 s ✅ |
  | tutti i ref, 109k commit (stress) | ~1,2 s | ~1,9 s | fuori scala del piano |

  La cache oggetti da 64 MB è decisiva: senza, 49k commit richiedevano ~790 ms per il primo blocco e ~1,7 s in totale. Con un commit-graph presente il primo blocco scende a pochi ms.
- Frontend: `useCommitStream` (Channel), `CommitList` virtualizzata con TanStack Virtual, barra di stato con i tempi, ⌘O e "Sfoglia…".
- Da verificare a mano nell'app: scroll fluido su 50k righe (obiettivo 60 fps).

### Fase 3 — Algoritmo delle corsie ✅
- `graph/lanes.rs` con test unitari su repo di fixture: lineare, branch semplice, merge, octopus merge, branch incrociati, root multiple.
- Layout incrementale tra un blocco e l'altro.
- Esito: `graph/lanes.rs` (`LaneLayout<K>`, generico sulla chiave del commit, quindi testabile senza repo) è collegato allo streaming: ogni evento `chunk` porta `commits` e `rows` (la riga `i` appartiene al commit `i`); `done` porta `maxLanes`. 13 test unitari + 4 test su fixture (`merges.sh` con octopus, `crossing.sh`, `roots.sh`, `linear.sh`) controllati con `validate_rows`, che verifica la continuità tra righe consecutive.
- Scostamenti dal modello della bozza: `GraphRow` non contiene il commit (viaggia già in `CommitSummary`, in parallelo) e `EdgeKind` ha cinque varianti esplicite (`Through`, `In`, `Out`, `MergeIn`, `ForkOut`) al posto di `Straight | MergeIn | ForkOut`, così il renderer non deve dedurre il lato. Colori: il più basso della palette non usato da una corsia attiva; se sono tutti usati, a rotazione.
- Compattazione: le corsie libere in coda vengono eliminate, quelle libere nel mezzo sono riutilizzate dalla prossima punta o fork (le corsie non si spostano mai, quindi non servono edge di riassegnazione).
- Misure su `nodejs/node` (release): 49k commit → 5 corsie, 109k commit (tutti i ref) → 38 corsie; layout coerente (`validate_rows` = `Ok(0)`) e costo trascurabile (totale invariato, ~320 ms a 49k).
- Le `rows` sono consumate dal renderer della Fase 4; la barra di stato mostra anche il numero di corsie.

### Fase 4 — Rendering del grafo (canvas a nodi stile n8n) ✅
- Canvas con sfondo puntinato, pan (trascinamento e trackpad), zoom (⌘+ / ⌘− / pinch) e "adatta".
- Layout: x = posizione topologica (vecchi a sinistra, HEAD a destra), y = corsia. Nodi quadrati con icona per tipo di commit (Conventional Commits), etichetta e hash sotto, badge dei ref sopra, porte di ingresso e uscita; punte dei branch con il lato sinistro tondo.
- Edge bezier con tangenti orizzontali, colorati per corsia; merge e fork si aprono dalla stessa porta.
- Virtualizzazione: solo le colonne nel viewport. Prototipo e profiling su 50k commit per scegliere la tecnologia di rendering (vedi §3, principio 4).
- Selezione e navigazione da tastiera (j/k/h/l); la selezione centra il nodo.
- Riferimento visivo: `mockup/index.html`.
- Esito:
  - **Backend:** nuovo evento `refs` (inviato prima dei blocchi) con le etichette `RefLabel { commit, name, kind: Head | Branch | Remote | Tag }`; i tag annotati sono "peeled" al commit; `refs/stash`, le note e `origin/HEAD` sono esclusi. 27 test Rust.
  - **Frontend** (`src/features/graph/`): `GraphIndex` (store mutabile: niente copie degli array a ogni blocco, indici id→posizione e figli), `GraphController` (stato della vista, input, ciclo di disegno, selezione), `draw.ts` (rendering), `view.ts` (matematica di pan/zoom/adatta), `icons.ts`, `describe.ts`, `palette.ts` (colori letti dai token CSS, quindi segue il tema). Il canvas è fuori dallo stato React: nessun re-render a 60 fps.
  - **Livelli di dettaglio:** zoom ≥ 0,6 schede complete (icona, etichetta, badge, porte); tra 0,2 e 0,6 solo tessere; sotto 0,2 puntini e campionamento delle colonne (le corsie principali restano continue).
  - **Input:** trascinamento, rotella/trackpad per il pan, ⌘+rotella e pinch (anche gli eventi `gesture*` di Safari/WKWebView) per lo zoom, ⌘+ / ⌘− / ⌘0, click per selezionare, `j k h l`, `g h` per tornare a HEAD, `Esc`. "Adatta" mostra tutta la storia se breve, altrimenti le ultime 120 colonne.
  - **Vista a elenco** (Fase 2) mantenuta e raggiungibile dal selettore "Grafo / Elenco" nella toolbar.
  - **Profiling** (`bench.html` + `src/dev/bench.ts`, solo sviluppo; dati da `bench_walk <repo> <rev|-> <file.json>` in `public/dev-data/`, ignorata da git). Chrome headless con rasterizzazione software, costo del frame con lettura forzata dei pixel:

    | Dati | Zoom 1 | Zoom 0,6 | Zoom 0,01 |
    |---|---|---|---|
    | 49k commit, 5 corsie, 1× | 1,1 ms (p95 2,1) | 1,9 ms (p95 4,7) | 1,2 ms |
    | 109k commit, 38 corsie, 2× DPI | 1,4 ms (p95 2,8) | 2,0 ms (p95 3,0) | 4,7 ms (p95 5,5) |

    Il budget per 60 fps è 16,6 ms: Canvas 2D basta con ampio margine.
  - **Test frontend:** `vitest` (`pnpm test`), 19 test su descrizione dei commit, `GraphIndex`, matematica della vista e hit-test.
- Non fatto (è di altre fasi): minimappa overlay (Fase 8). Il pannello dettagli è arrivato in Fase 5.
- Da verificare a mano nell'app: pinch del trackpad in WKWebView, tema scuro del canvas e fluidità percepita.

### Fase 5 — Dettagli e diff ✅
- Pannello con metadati del commit, parent cliccabili, lista dei file cambiati.
- Diff per file (unified, e split come opzione) con Shiki.
- Esito:
  - **Backend** (`git/diff.rs`, comandi `commit_details` e `file_diff`): i file cambiati vengono da `Repository::diff_tree_to_tree` (con rilevamento delle rinomine secondo la configurazione di git); le righe da `gix::diff::blob` (Histogram, con euristica degli slider); gli hunk hanno 3 righe di contesto e si fondono se più vicini di 6 righe. **Il confronto è sempre con il primo parent** (come `git show --first-parent`; la UI lo segnala per i merge), con l'albero vuoto per le radici.
  - **Limiti:** statistiche per riga (`+`/`−`) calcolate sui primi 400 file; blob oltre 2 MiB non vengono confrontati; un diff si ferma a 20.000 righe; file binari e submodule non hanno anteprima.
  - **Test Rust:** 7 test su `tests/fixtures/diffs.sh` (radice, modifica, rinomina + cancellazione, merge con corpo del messaggio, binari, id non validi) più 4 unitari sul calcolo degli hunk. In totale 38.
  - **Frontend** (`src/features/details/`): `DetailsPanel`, `FileList`, `DiffView`, `useCommitDetails` (TanStack Query, `staleTime` infinito perché i commit non cambiano), `highlight.ts` (Shiki `core` + motore JavaScript, niente WASM; grammatiche caricate al primo uso; tema `css-variables`, quindi i colori della sintassi seguono i token CSS e il tema di sistema senza ri-evidenziare), `diffModel.ts` (accoppiamento delle righe per la vista affiancata, limite di righe). Ogni hunk viene evidenziato come due blocchi (lato vecchio e lato nuovo) per tokenizzare i costrutti multi-riga nel loro contesto.
  - **Interazione:** il pannello si apre e chiude con `Invio` o dal pulsante in toolbar, si ridimensiona trascinando il bordo sinistro (320-900 px); i parent cliccabili selezionano il commit nel grafo; la richiesta al backend parte 80 ms dopo l'ultima selezione (tenendo premuto `j`/`k` non si accodano richieste). La selezione funziona anche dalla vista a elenco.
  - **Test frontend:** 27 in totale (8 nuovi su accoppiamento righe, limite di righe e riconoscimento/evidenziazione delle lingue).
  - **Strumenti di sviluppo** (non fanno parte della build): `panel.html` + `src/dev/panel.tsx` mostrano il pannello con dati reali prodotti dal backend (`cargo run --example dump_commit -- <repo> "<summary>" public/dev-data/commit.json`) e un finto `invoke`; servono per controllare l'aspetto senza l'app.
- Non fatto: diff delle righe modificate "dentro la riga" (evidenziazione per parola), confronto con il secondo parent per i merge, ricerca nel diff.
- Da verificare a mano nell'app: aspetto e velocità su commit grandi, tema scuro.

### Fase 6 — Sidebar e tab ✅
- Sidebar con branch locali, remoti, tag e stash; click per saltare al commit. Vibrancy sulla sidebar.
- Tab multi-repo e lista dei repo recenti.
- Esito:
  - **Sidebar** (`src/features/sidebar/`): sezioni costruite dalle etichette dei ref già in streaming (`buildSections`, pura e testata) più gli stash; branch corrente per primo con marcatore HEAD, tag dal più recente (`v10` prima di `v9`), filtro per nome senza distinzione tra maiuscole e minuscole, sezioni richiudibili con contatore. Il pallino di ogni branch ha il colore della sua corsia nel grafo. Un click seleziona il commit (nel grafo lo centra); le voci il cui commit non è ancora arrivato dallo streaming sono disabilitate. Gli stash puntano al commit su cui sono stati creati, perché il commit dello stash non fa parte del grafo.
  - **Backend:** comando `list_stashes` (`git/stash.rs`), che legge il reflog di `refs/stash` (nuovo-per-primo, con il commit di base). Menu nativo macOS (`build_menu` in `lib.rs`) con File → "Apri repository…" (⌘O) e "Chiudi tab" (⌘W), più i menu standard (senza il menu Modifica ⌘C/⌘V non funzionano nei campi di testo): quello di default lega ⌘W a "Chiudi finestra". Le scelte arrivano al frontend con l'evento `menu`.
  - **Tab** (`src/app/`): store `zustand` (`tabsStore.ts`) sopra funzioni pure (`tabsLogic.ts`, testate: apertura, chiusura con scelta della tab attiva, ⌘1–⌘9, recenti). Ogni tab è una sessione del backend ed è chiusa con la tab. Le tab restano tutte montate (le inattive nascoste e senza tastiera): grafo, selezione, pannello e scorrimento sopravvivono al cambio. Aprire un repo già aperto passa alla sua tab. Gli errori di apertura con tab aperte compaiono in un avviso sotto la barra.
  - **Recenti:** gli ultimi 8 repo (persistiti in `localStorage`), nella schermata iniziale, con rimozione.
  - **Vibrancy:** finestra trasparente (`transparent`, `macOSPrivateApi`, feature `macos-private-api`) con effetto `sidebar`. Il `body` è trasparente e ogni zona dipinge il proprio sfondo; la sidebar usa un colore semitrasparente (`--sidebar`). Esclude la distribuzione sull'App Store (irrilevante per l'uso personale). Per disattivarla basta togliere `transparent` e `windowEffects` da `tauri.conf.json`.
  - **Bug trovato usando l'app:** `refs/remotes/origin/HEAD` è un ref simbolico e, risolto dal peeling, usciva con il nome del suo bersaglio: `origin/master` compariva due volte (chiavi React duplicate). Ora i ref sono deduplicati per tipo e nome; test con un clone vero (packed-refs + ref loose che sovrascrive).
  - **Test:** 41 Rust (2 nuovi sugli stash, 1 sul clone), 45 frontend (13 nuovi su tab, recenti e sezioni della sidebar). `shell.html` + `src/dev/shell.tsx` mostrano tab e sidebar con dati reali (solo sviluppo).
- Non fatto: riordinare le tab trascinandole, ripristinare le tab all'avvio, ricerca nella sidebar con `/` (è della Fase 11).
- Da verificare a mano nell'app: effetto vibrancy (non visibile in Chrome headless), ⌘O / ⌘W dal menu, ⌘1–⌘9, scorrimento fluido con più tab aperte.

### Fase 7 — Cache e watcher ✅
- Cache del layout su disco.
- Watcher su `.git` per ricaricare in modo incrementale quando cambiano i ref.
- Esito:
  - **Cache** (`src-tauri/src/cache/`): un file per repo in `app_cache_dir` (`~/Library/Caches/dev.ehystiv.git-sea/`, nome = FNV-1a del percorso di `.git`), formato `postcard`, scrittura atomica (file temporaneo + rename), al massimo 30 file (si eliminano i meno recenti), solo per storie di almeno 1.000 commit. Contiene commit, righe del layout e `maxLanes`. **Validità:** si confronta l'impronta esatta dei ref (tipo, nome e commit di ogni branch, remoto, tag e HEAD, in ordine fisso) invece di un hash, così una cache vecchia non può passare per buona; un commit, un branch o un tag nuovi o cancellati la invalidano, mentre lo stesso stato dei ref in ordine diverso no. File illeggibili vengono cancellati; `FORMAT_VERSION` va incrementato quando cambia il formato o l'algoritmo delle corsie. Il file si scrive dopo l'evento `done`, quindi il salvataggio non ritarda nulla. Gli eventi `done` portano `fromCache`, e la barra di stato mostra "(cache)".
  - **Misure** (release, `nodejs/node`): riapertura da cache di 49k commit in **13 ms** (file da 7,4 MB; lettura 7 ms) e di 109k commit in 31 ms (17,4 MB), contro 320-400 ms e 2 s con il walk. Obiettivo del piano: < 300 ms.
  - **Watcher** (`src-tauri/src/watcher/`, crate `notify` 8, FSEvents su macOS): osserva `.git` (e la common dir per i worktree collegati) e reagisce solo a `HEAD`, `packed-refs` e `refs/**` (stash compreso), ignorando indice, oggetti, log e file `.lock`; accorpa le raffiche di eventi (300 ms di quiete) ed emette `repo-changed` con l'id della sessione. Se non riesce a partire, il repo si apre lo stesso, senza aggiornamento automatico.
  - **Aggiornamento:** alla ricezione di `repo-changed` il frontend ricarica la storia **in silenzio e per intero** (non per differenza: aggiungere commit in cima cambia l'assegnazione delle corsie di tutto ciò che sta sotto, e con la cache degli oggetti un walk completo costa ~0,3 s a 49k commit). Il nuovo grafo si costruisce fuori schermo e si sostituisce a quello vecchio a caricamento finito (`GraphIndex.replaceWith`), quindi lo schermo non si svuota. La vista resta ancorata al commit che l'utente aveva al centro (oppure non si muove se guardava le ultime colonne, così i nuovi commit compaiono dove guardava), la selezione segue l'id del commit e la sidebar (compresi gli stash) si aggiorna. La barra di stato mostra "Aggiornamento…".
  - **Selezione automatica di HEAD:** all'apertura di un repo il pannello dettagli mostra il commit a cui punta HEAD (non il primo del grafo, che potrebbe essere la punta di un altro branch), a meno che l'utente non abbia già scelto altro.
  - **Test:** 54 Rust (5 unitari sulla cache, 3 unitari sul filtro dei percorsi del watcher, 3 di integrazione sulla cache: stream da cache identico a quello del walk, layout valido, invalidazione con commit e branch; 2 sul watcher con eventi veri: nota solo i ref, tace con indice e oggetti, si ferma quando viene rilasciato), 52 frontend (nuovi: sostituzione dell'indice e ancoraggio della vista).
- Non fatto: aggiornamento per differenza (vedi sopra), pulizia della cache alla chiusura del repo, aggiornamento in tempo reale dello stato "worktree sporco" (non è nello scope: l'app è di sola lettura sui ref).
- Da verificare a mano nell'app: riaprire un repo grande e vedere "(cache)" in barra di stato; fare un commit o creare un branch da terminale e vedere il grafo aggiornarsi da solo, senza perdere posizione né selezione.

### Fase 8 — Minimappa
- Overlay in basso a destra nel canvas: versione ridotta dell'intero grafo con viewport trascinabile e click per saltare.
- Controlli di zoom in basso a sinistra.

### Fase 9 — Vista topologica compressa
- Le catene lineari si comprimono in un singolo nodo "N commit" (o in un'etichetta sull'edge, come i "5 items" di n8n); restano visibili solo fork, merge e punte dei branch.
- Espansione al click.

### Fase 10 — Timeline orizzontale
- Asse X = data del commit, una riga per branch.
- Zoom e pan.

### Fase 11 — Palette, ricerca, filtri
- Command palette con tutte le azioni.
- Ricerca per messaggio, autore, hash e percorso.
- Filtro "mostra solo questi branch" ed evidenziazione degli antenati del commit selezionato.

---

## 6. Convenzioni

- **Rust:** `cargo fmt` e `cargo clippy -- -D warnings` puliti. Errori tipizzati con `thiserror`, nessun `unwrap()` fuori dai test.
- **TypeScript:** `strict: true`, niente `any`. Tipi dei comandi solo da `tauri-specta`.
- **Test:** test unitari per tutto `graph/`; fixture di repo create da script in `src-tauri/tests/fixtures/`.
- **Commit:** Conventional Commits.
- **Dipendenze:** si possono aggiungere senza chiedere prima (autorizzato a fine Fase 1), ma ogni nuova dipendenza va elencata nel riepilogo di fine fase con il motivo.
- **Lingua:** codice e commenti in inglese, comunicazione con l'utente in italiano.

---

## 7. Note tecniche emerse

- **`gix` 0.89:** serve la feature `sha1` (insieme a `max-performance-safe`). Gli errori di apertura sono opachi (`gix_error`), quindi "non è un repository" si riconosce prima con un controllo su `.git` (o `HEAD` + `objects/` per i bare).
- **Ordine topologico:** `gix::revision::walk::Sorting` non lo offre; si usa `gix::traverse::commit::topo::Builder` (`Sorting::TopoOrder`). `build()` è costoso perché fa una prima visita per calcolare i gradi d'ingresso; misurato in Fase 2: con la cache oggetti da 64 MB resta sotto i 350 ms su 49k commit, anche senza commit-graph.
- **Tipi specta:** `i64`/`u64` non sono ammessi nei binding TypeScript; i timestamp usano `#[specta(type = f64)]`.
- **Tauri:** `data-tauri-drag-region` vale solo per l'elemento stesso; i figli non interattivi della title bar hanno `pointer-events: none`. Servono i permessi `core:window:allow-start-dragging` e `allow-internal-toggle-maximize`.
- **Test fuori da Tauri:** `getCurrentWebview()` lancia in modo sincrono in un browser normale; è protetto con try/catch.
