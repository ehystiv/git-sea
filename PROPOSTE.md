# Proposte di feature e miglioramenti

Le proposte ancora da fare. L'app resta di sola lettura sui repository. Quelle realizzate si tolgono da qui: la storia di git le conserva.

## Capire la storia
- **Vista del reflog:** dove stava HEAD prima di un rebase o reset, con i commit "fantasma" non più nel grafo.
- **Firme GPG/SSH** come badge nel pannello dettagli.
- **Issue e ticket nei messaggi:** `#123`, `!45` e chiavi come `ABC-123` cliccabili, con un modello configurabile per repo e l'URL costruito da `repo_web`.
- **Diff tra due tag come pagina di release:** commit raggruppati per tipo, autori, PR unite, partendo dal pannello del confronto.
- **Storia di un intervallo di righe** come `git log -L`: dal blame si scelgono le righe e si vede come sono cambiate.
- **Vista first-parent:** solo i merge su `main`, che si aprono al clic sui commit che portano.
- **Righe spostate nel diff:** codice spostato da un punto o da un file all'altro segnato come tale, non come tolto e aggiunto.

## Viste
- **Righe nei file più modificati:** oggi contano i commit; aggiunte e tolte per file richiederebbero un diff dei blob per ogni commit, da tenere in cache.

## Repo complessi
- **Sottomoduli:** nei dettagli di un commit che sposta il puntatore, i commit del sottomodulo tra i due hash, e apertura del sottomodulo in una tab (anche dal browser dei file).
- **Worktree multipli:** sezione della sidebar con gli altri worktree (`git worktree list`), il loro percorso e branch, apribili in una tab.
- **Git LFS:** riconoscere i file puntatore e mostrare "file LFS, N MB" invece del testo del puntatore.
- **Git notes** nel pannello dettagli.

## Flusso di lavoro
- **Copia come link permanente** (GitHub/GitLab) a un file o a una riga del blame al commit selezionato.
- **Apri nell'editor** un file o una riga, con `code`/`zed`/`$EDITOR` passando da `process.rs`.
- **Ricerche salvate** e filtri dei branch salvati per repo, come i segnalibri.
- **Notifiche di sistema** quando il fetch in background trova commit nuovi sui branch seguiti, o quando la CI fallisce sul proprio branch.
- **Anteprima delle immagini** nel browser dei file e nel diff, invece di "file binario".

## Qualità
- **Accessibilità del canvas:** un elenco per gli screen reader che segua la selezione, e un tema ad alto contrasto.
- **Benchmark in CI** con `bench_walk` su un repo grande fisso, per accorgersi dei rallentamenti.

## Scartate

- **Ricarica incrementale**: scartata. Dopo un fetch la ricarica completa costa ~0,3 s su 50k commit; aggiornare solo una parte vuol dire ricalcolare la disposizione dei branch di tutto ciò che sta sotto i commit nuovi, con un rischio alto di layout incoerenti.
- **SVG**: scartato per ora. Il grafo è disegnato con `Path2D`, che le librerie di emulazione Canvas→SVG non sanno leggere; servirebbe un secondo renderer.
