# Branchscope — Piano di progetto

> Nome provvisorio. Visualizzatore Git desktop per uso personale, ispirato a GitKraken ma con UI moderna e focus totale sulla **comprensione del grafo**: dove vanno i branch, come si mergiano, com'è fatto l'albero di commit.

**Stato:** Fase 0 ✅ · Fase 1 ✅ · Fase 2 ✅ · Fase 3 ✅ · Fase 4 ✅ · Fase 5 ✅ · Fase 6 ✅ · Fase 7 ✅ · Fase 8 ✅ · Fase 9 ✅ · Fase 10 ✅ · Fase 11 ✅ (in attesa di conferma, vedi §5). Mockup approvato: `mockup/index.html` (canvas a nodi) e `mockup/index-lista.html` (variante a lista, scartata).

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

### Fase 8 — Minimappa ✅
- Overlay in basso a destra nel canvas: versione ridotta dell'intero grafo con viewport trascinabile e click per saltare.
- Controlli di zoom in basso a sinistra (già presenti dalla Fase 4).
- Esito:
  - **Minimappa** (`src/features/graph/MinimapOverlay.ts` + `minimapMath.ts`, 220×96 px): un canvas a parte sopra quello principale. Il grafo si disegna una volta sola in un livello fuori schermo, che si ricostruisce solo quando cambiano i dati (nuovi blocchi o ricarica), la densità dello schermo o il tema; a ogni frame si copia il livello e si disegna il rettangolo del viewport (almeno 6 px, così non sparisce sulle storie lunghe).
  - **Scala:** il commit più recente sta a destra come nel grafo. Le storie corte usano la stessa scala sui due assi e mostrano commit e edge; quelle lunghe si comprimono in larghezza e disegnano un segno per colonna-pixel e corsia (109k commit costano poche migliaia di rettangoli). La distanza tra corsie è limitata a 14 px.
  - **Interazione:** clic = il viewport si centra sul punto (animato), trascinamento = segue il puntatore subito; l'ingrandimento resta quello corrente. `GraphController` espone `onFrame` e `goTo`, quindi la minimappa non tocca lo stato interno.
  - **Test:** 59 frontend (7 nuovi sulla geometria: dentro i bordi, scala, andata e ritorno, rettangolo minimo, centratura). `bench.html` mostra anche la minimappa.
- Da verificare a mano nell'app: aspetto nel tema scuro, trascinamento fluido su un repo grande e aggiornamento mentre il repo si ricarica.
- Aggiunta a parte, **selettore del tema** (richiesto a fine fase): pulsante in alto a destra nella barra del titolo che cicla sistema → chiaro → scuro, scelta salvata in `localStorage` (`git-sea:theme`). `initTheme()` (`src/lib/theme.ts`) imposta sempre `data-theme` sulla radice, risolvendo "sistema" con `prefers-color-scheme`, quindi `tokens.css` ha un solo blocco scuro (`:root[data-theme="dark"]`) al posto della media query. Il canvas rilegge i colori all'evento `git-sea:theme-changed`. Aggiorna anche il tema della finestra nativa (`setTheme`, permesso `core:window:allow-set-theme`) così la vibrancy della sidebar non resta chiara con l'app scura. 3 test sulla logica (`themeLogic.ts`), totale 62.

### Fase 9 — Vista topologica compressa ✅
- Le catene lineari si comprimono in un singolo nodo "N commit" (o in un'etichetta sull'edge, come i "5 items" di n8n); restano visibili solo fork, merge e punte dei branch.
- Espansione al click.
- Esito:
  - **Regola:** un commit fa parte di una catena se ha esattamente un parent e un figlio, nessun ref (branch, tag, HEAD) e sta sulla stessa corsia del figlio. Le catene di almeno 3 commit (`MIN_GROUP`) diventano un nodo; quelle più corte restano com'erano, perché un nodo al posto di uno o due commit nasconderebbe più di quanto risparmia. Restano visibili punte, radici, fork, merge e commit con ref.
  - **Layout:** non si ricalcola. Il nodo prende la colonna, la corsia e gli edge del commit più recente della catena; le colonne dei commit nascosti spariscono e le linee delle altre corsie si richiudono da sole, perché ogni colonna disegna la propria linea da bordo a bordo. Il nodo ha come parent quello del commit più vecchio della catena, quindi `h`/`l` e la selezione funzionano come sempre.
  - **Dove vive:** `src/features/graph/compress.ts` (`compressIndex`, funzione pura da `GraphIndex` a `GraphIndex`) e `useCompressedIndex.ts` (un indice unico e stabile che si ricostruisce a ogni blocco o espansione, quindi la vista non si azzera: lo stesso meccanismo di `replaceWith` della Fase 7). **Deviazione dal principio 3** ("proiezioni in Rust"): la proiezione è in TypeScript perché lavora su dati già nel frontend e deve rispondere subito al clic; serve solo il conteggio dei figli. Costo misurato: 28 ms su 109k commit, che diventano 3.447 nodi. Se in futuro serve in Rust (per esempio per la timeline), la funzione è piccola e si porta.
  - **Rendering:** nodo con una pila di due contorni dietro, il numero di commit dentro, "N commit" e l'intervallo di hash (`abc1234 … def5678`) sotto. A zoom < 0,6 resta la tessera con la pila, senza testo.
  - **Interazione:** il clic su un nodo-catena lo seleziona (il pannello mostra il commit più recente) e lo espande; i commit si aprono dove sono, la vista resta ancorata. "Comprimi tutto" in toolbar richiude tutto. Selettore **Grafo / Topologia / Elenco** e scorciatoie `1` e `2` (`3` è per la timeline). Gli id dei commit nascosti puntano al nodo che li contiene (`GraphIndex.aliases`), quindi selezionare dalla sidebar un commit dentro una catena porta al nodo giusto. Le catene aperte si ricordano per tutta la sessione.
  - **Richiudere una catena:** un secondo clic su un commit già selezionato di una catena aperta la richiude (il commit resta selezionato, ora dentro il nodo). Il primo clic su un commit di una catena aperta lo seleziona soltanto, così si possono ancora guardare i singoli commit senza richiudere. Subito dopo l'espansione è selezionato il commit più recente: cliccarlo di nuovo funziona quindi come un interruttore sul nodo. `GraphIndex.openRuns` dice a quale catena aperta appartiene ogni commit.
  - **Test:** 71 frontend (12 nuovi su `compress`: catena interna, parent del nodo, soglia, ref che spezzano la catena, fork e merge, corsie, espansione, caricamento a metà). `bench.html?compress=1` mostra la proiezione.
- Aggiunta a parte, **animazione di apertura e chiusura** (richiesta dopo la Fase 11): aprendo una catena i suoi commit escono dal nodo e scorrono al loro posto comparendo in dissolvenza; chiudendola fanno il percorso inverso e svaniscono dentro il nodo (280 ms, ease-in-out). Le corsie sono le stesse nelle due proiezioni, quindi si muove solo la colonna: `morph.ts` calcola per ogni commit la colonna di partenza e di arrivo (corretta per lo spostamento della vista che tiene fermo l'ancoraggio), e il renderer disegna le colonne in posizioni interpolate, con gli edge che arrivano a metà strada tra colonne vicine per restare continui. Durante la chiusura si disegna la proiezione vecchia (quella che ha tutti i commit), poi si passa alla nuova. Solo per apertura e chiusura (`replaceWith(…, animate)`), non per nuovi blocchi o ricariche; niente animazione sotto i 6 px per colonna o con "riduci movimento". Su una catena di 37k commit (`node50k`) i nodi impilati sullo stesso punto e i segmenti di lunghezza zero si saltano: senza, il primo frame arrivava dopo 1,2 s; ora 65-78 ms, frame sotto i 50 ms. 5 test nuovi (`morph.test.ts`).
- Non fatto: conteggio dei nodi nella barra di stato.
- Da verificare a mano nell'app: Topologia su un repo vero, clic su una catena, "Comprimi tutto", e il cambio Grafo ↔ Topologia con un commit selezionato.

### Fase 10 — Timeline orizzontale ✅
- Asse X = data del commit, una riga per branch.
- Zoom e pan.
- Esito:
  - **Righe = corsie del layout, non branch con nome:** ogni riga è una corsia del layout del grafo (colore e posizione come in "Grafo"); i nomi dei branch, dei remoti, dei tag e HEAD compaiono come badge sopra il commit a cui puntano. Le corsie si riusano quando un ramo finisce, quindi una riga con un nome fisso (una riga per branch vero) darebbe migliaia di righe nei repo grandi e un'etichetta sbagliata fuori dal punto dove il ramo esiste. È una scelta da confermare.
  - **Codice** (`src/features/timeline/`): `layout.ts` (tempo di ogni commit, colonne ordinate per data, tutti i link ai parent ordinati per inizio con massimo cumulativo: si trovano in tempo logaritmico anche i link che attraversano la finestra con entrambi gli estremi fuori), `view.ts` (la vista è una finestra di tempo `t0`, uno scorrimento verticale `ty` e un fattore `zx` in pixel al secondo; per questo resta sugli stessi commit quando i dati si sostituiscono, senza ancoraggi), `ticks.ts` (asse calendario in ora locale: ore, giorni, settimane, mesi, anni), `draw.ts`, `TimelineController.ts`, `TimelineCanvas.tsx`.
  - **Asse e griglia:** barra delle date in alto, con unità che si adatta allo zoom, righe di guida per corsia e linee verticali per i tick.
  - **Livelli di dettaglio** (pixel per ora): ≥ 30 nodi pieni con didascalia sotto (testo troncato con "…", senza sovrapposizioni, per corsia) e badge dei ref; ≥ 4 quadratini; sotto, puntini. I merge sono cerchi. Gli edge sono curve tra corsie e linee sulla stessa corsia; a zoom lontano le catene sulla stessa corsia si fondono in una sola linea e i raccordi tra corsie si deduplicano per pixel.
  - **Interazione:** trascinamento e rotella/trackpad per lo scorrimento, ⌘+rotella e pinch per lo zoom (solo sul tempo), ⌘+ / ⌘− / ⌘0 ("adatta" mostra tutta la storia), clic per selezionare, `j k h l`, `g h`, `Esc`, come nel grafo. Vista iniziale: l'ultimo mese (o tutta la storia se più corta). Selettore **Grafo / Topologia / Timeline / Elenco** e tasto `3`. I commit senza data prendono quella del vicino nel walk, per non stirare l'asse fino al 1970. 100% nei controlli = 100 px al giorno.
  - **Misure** (`bench.html?timeline=1&mode=bench`, Chrome con rasterizzazione software, 1920×913, 109k commit, 38 corsie, p50 / p95): 100 px/giorno e oltre 1,4-3 / 2-10 ms; 3 px/giorno 4 / 7 ms; 0,3 px/giorno (tutta la storia) 10 / 12 ms; costruzione dei dati 40 ms. Prima di fondere le catene sulla stessa corsia a zoom lontano erano 26-29 ms: il costo era quasi tutto nel disegno dei ~24k segmenti per frame.
  - **Test:** 91 frontend (20 nuovi: dati e ricerca per finestra di tempo, link che attraversano la finestra, date mancanti, zoom e limiti, scorrimento verticale, hit test, tick del calendario).
- Non fatto: minimappa nella timeline (c'è solo nel grafo), righe con il nome del branch (vedi sopra), zoom verticale, un indicatore del periodo visibile fuori dall'asse.
- Da verificare a mano nell'app: Timeline su un repo vero (trascinamento e zoom con il trackpad, tema scuro), selezione dalla sidebar e passaggio Grafo ↔ Timeline con un commit selezionato.
- Aggiunta a parte, **flusso animato** (richiesto prima della Fase 11): pallini che scorrono lungo i collegamenti, sempre da sinistra a destra, cioè da un commit verso i commit costruiti sopra (il senso in cui si legge la storia). Vale per Grafo, Topologia e Timeline.
  - **Codice:** `src/features/graph/flow.ts` (`FlowLinks`: i collegamenti visibili in un frame, tutti memorizzati da sinistra a destra, al massimo 4.000; `drawFlow`: dischi con un alone tenue, raggruppati per colore; `straightDots` e `curvePoint` sono funzioni pure). I renderer raccolgono i collegamenti mentre li disegnano e il flusso viene disegnato dopo gli edge e prima dei nodi, quindi i pallini entrano ed escono dai nodi.
  - **Movimento:** sulle linee dritte i pallini stanno a distanza fissa e sono agganciati al contenuto (muovendo la vista non scivolano); sulle curve tra corsie percorrono la curva allo stesso passo. Nel grafo velocità e distanza seguono lo zoom (64 e 96 px a zoom 1), nella timeline sono fisse (48 px/s, 96 px).
  - **Costo:** il ciclo di animazione gira solo se il frame contiene pallini in movimento, la scheda è attiva e la pagina visibile; con la vista ferma o troppo lontana non disegna nulla di più. Nel grafo i pallini compaiono da zoom 0,2, nella timeline da 1 px/ora (24 px/giorno), che include la vista iniziale. Misure (software, 1920×913): grafo a zoom 1 circa 2,5 ms di mediana; timeline su 109k commit a 30 px/giorno 2,6 ms.
  - **Controllo:** pulsante in toolbar (accanto al pannello dettagli, nelle viste Grafo, Topologia e Timeline), scelta salvata in `localStorage` (`git-sea:flow`). Acceso di default, spento di default per chi ha attivo "riduci movimento" nel sistema.
  - **Test:** 102 frontend (8 nuovi su `flow`: distanza e fase dei pallini, aggancio al contenuto, curva da sinistra a destra, limite dei collegamenti). `bench.html?flow=1` li mostra.


### Fase 11 — Palette, ricerca, filtri ✅
- Command palette con tutte le azioni.
- Ricerca per messaggio, autore, hash e percorso.
- Filtro "mostra solo questi branch" ed evidenziazione degli antenati del commit selezionato.
- Esito:
  - **Command palette** (`src/features/palette/`, dipendenza nuova **`cmdk`** per tastiera e accessibilità della lista; il filtro e l'ordinamento sono nostri, `rank.ts`). ⌘K da ovunque, o il pulsante "Comandi" nella barra del titolo. Le azioni arrivano da "sorgenti" registrate in uno store (`paletteStore.ts`): la finestra (apri repository, chiudi tab, passa a un'altra tab, recenti, tema) e il repository attivo (viste, pannello, flusso, zoom, cerca, vai a HEAD, antenati, richiudi catene, togli filtro). Scrivendo compaiono anche i ref ("Vai a …", "Mostra solo …", "Aggiungi/Togli … dal filtro") e fino a 8 commit per oggetto, autore o hash.
  - **Ricerca** (`src/features/search/`): `/` o la lente in toolbar apre una barra sopra il canvas. Senza prefisso cerca in oggetto, autore e inizio dell'hash (da 4 cifre), nel frontend (8 ms su 109k commit). `author:`/`autore:`, `hash:`, `msg:` (tutto il messaggio, corpo compreso) e `path:`/`file:`; gli ultimi due vanno nel backend con il comando nuovo `search_commits` (`src-tauri/src/git/search.rs`), che percorre tutti i ref e si annulla da solo quando parte una ricerca nuova (contatore di generazione come per i caricamenti). **Percorso** = commit il cui albero differisce dal primo parent in quel file o cartella (lo stesso confronto del pannello dettagli; i merge che portano dentro il file contano). Verificato contro `git cat-file` su un repo da 19k commit: stesso risultato (238 commit) in 302 ms; `msg:fix` 5.789 commit come `git log -i --grep` in 114 ms. Massimo 20.000 risultati. I risultati: attenuazione del resto del grafo, contatore "3 di 120", Invio / ⇧Invio / frecce per scorrerli, elenco virtualizzato sotto il campo; nella vista Elenco restano solo i commit trovati. In Topologia una catena che contiene risultati conta una volta sola.
  - **Filtro dei branch**: imbuto accanto a ogni branch, remote e tag nella sidebar (compare al passaggio del mouse; acceso se nel filtro), voci della palette e chip "Solo main ×" in toolbar. Il filtro va al backend (`load_commits` ha il parametro nuovo `only`): il walk parte solo da quei ref, quindi **le corsie sono ricalcolate in Rust** (principio 1) e il grafo è compatto. Il ricaricamento avviene come un aggiornamento (si sostituisce l'indice a fine caricamento, la vista resta dov'è). Un grafo filtrato non usa né scrive la cache. Un branch locale nel filtro resta valido anche dopo un checkout (HEAD ↔ Branch); un ref cancellato esce dal filtro da solo.
  - **Antenati**: `a`, pulsante in toolbar o palette. Il commit selezionato e tutti i suoi antenati restano accesi, il resto è attenuato. Nel grafo anche i collegamenti: `laneEdgeEmphasis` ripercorre le corsie da destra a sinistra e accende i segmenti dei collegamenti che partono da un commit acceso (per un insieme chiuso sui parent sono esattamente i collegamenti tra antenati). 10 ms su 109k commit. Funziona in Grafo, Topologia (attraverso i nodi-catena) e Timeline.
  - **Attenuazione condivisa** (`src/features/graph/emphasis.ts`): una maschera per colonna, applicata da entrambi i renderer con un secondo gruppo di path disegnati con trasparenza; i pallini del flusso restano solo sui collegamenti accesi. Una maschera costruita per un indice vecchio viene ignorata finché non si aggiorna.
  - **Test:** 125 frontend (23 nuovi: query di ricerca, ordinamento della palette, filtro dei ref, maschere e corsie accese; `laidOutIndex` in `testData.ts` riproduce le regole delle corsie per avere edge veri nei test). 60 backend (6 nuovi: ricerca per percorso, cartelle, messaggio, annullamento, filtro dei branch). `bench.html` accetta `ancestors=<col>` e `match=<testo>`; `app.html?data=<nome>` è l'app intera nel browser con un backend finto, utile per provare la UI senza Tauri. `examples/bench_search.rs` misura le ricerche su un repo vero.
- Aggiunta a parte, **emoji nel nodo** (richiesta a fine fase): se il messaggio comincia con un'emoji, prima o dopo il prefisso Conventional Commits (`✨ feat: …`, `feat: ✨ …`) o con uno shortcode gitmoji (`:sparkles: …`, mappa in `src/features/graph/emoji.ts`), il nodo mostra quell'emoji al posto dell'icona del tipo e l'etichetta la perde. Le sequenze intere (pelle, ZWJ, bandiere) restano unite; i merge tengono la loro icona. Nella timeline il segno è troppo piccolo, quindi l'emoji apre la didascalia. 3 test nuovi, totale 128.
- Non fatto: ricerca con espressioni regolari, ricerca nel contenuto dei diff (`git log -S`), filtro per autore o per data, più sorgenti di evidenziazione insieme (ricerca e antenati: vince la ricerca).
- Da verificare a mano nell'app: ⌘K dentro la finestra Tauri (il menu nativo non deve intercettarlo), `path:` su un repo grande, filtro su un repo con molti branch e cambio Grafo ↔ Topologia ↔ Timeline con ricerca aperta. Su un clone parziale (treeless) `path:` fallisce, perché gli alberi mancano in locale: mostra "Errore" con il messaggio nel tooltip.

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
