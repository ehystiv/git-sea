import { useState, type FormEvent } from "react";
import type { CiAccess, CiProvider, CiProviderState, CiWorkflow } from "../../lib/bindings";
import { describeError } from "../../lib/errors";
import { PROVIDER_LABEL, STATUS_LABEL, statusColor, TOKEN_HINT } from "./labels";
import { latestRun } from "./markers";
import { openUrl, type CiState } from "./useCi";
import sidebar from "../sidebar/Sidebar.module.css";
import styles from "./CiSection.module.css";

interface CiSectionProps {
  ci: CiState;
  /** Text typed in the sidebar's filter. */
  filter: string;
  open: boolean;
  onToggle: () => void;
  /** The workflow whose markers alone are shown, or null for all. */
  focus: number | null;
  onFocus: (id: number | null) => void;
  /** The provider whose token field is open. */
  tokenFor: CiProvider | null;
  onTokenFor: (provider: CiProvider | null) => void;
}

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** "Workflow" group of the sidebar: the CI workflows in HEAD, their last run, and the services' access. */
export function CiSection({ ci, filter, open, onToggle, focus, onFocus, tokenFor, onTokenFor }: CiSectionProps) {
  const overview = ci.overview;
  if (!overview || (overview.workflows.length === 0 && overview.problems.length === 0)) return null;

  const needle = filter.trim().toLowerCase();
  const workflows = overview.workflows.filter(
    (w) => needle === "" || w.name.toLowerCase().includes(needle) || w.path.toLowerCase().includes(needle),
  );
  if (needle !== "" && workflows.length === 0) return null;
  const runs = ci.report?.runs ?? [];
  const providers = ci.report?.providers ?? [];

  return (
    <section className={sidebar.group}>
      <h3>
        <button type="button" className={sidebar.heading} aria-expanded={open} onClick={onToggle}>
          <svg viewBox="0 0 24 24" width="11" height="11" {...icon} className={open ? undefined : sidebar.closed}>
            <path d="m6 9 6 6 6-6" />
          </svg>
          Workflow
          {ci.runsLoading && <span className={styles.spinner} aria-label="Aggiorno le run" />}
          <span className={sidebar.count}>{overview.workflows.length}</span>
        </button>
      </h3>
      {open && (
        <ul>
          {workflows.map((workflow) => {
            const last = latestRun(runs, workflow, overview.workflows);
            const focused = focus === workflow.id;
            return (
              <li key={workflow.id} className={sidebar.row}>
                <button
                  type="button"
                  className={`${sidebar.item} ${focused ? sidebar.active : ""}`}
                  aria-pressed={focused}
                  title={workflowTitle(workflow, last ? STATUS_LABEL[last.status] : null)}
                  onClick={() => onFocus(focused ? null : workflow.id)}
                >
                  <span
                    className={`${sidebar.dot} ${last ? "" : styles.hollow}`}
                    style={last ? { background: statusColor(last.status) } : undefined}
                  />
                  <span className={sidebar.label}>{workflow.name}</span>
                  <span className={styles.provider}>{shortProvider(workflow.provider)}</span>
                </button>
                {workflow.webUrl && (
                  <button
                    type="button"
                    className={sidebar.filter}
                    aria-label={`Apri ${workflow.name} nel browser`}
                    title="Apri nel browser"
                    onClick={() => workflow.webUrl && openUrl(workflow.webUrl)}
                  >
                    <svg viewBox="0 0 24 24" width="11" height="11" {...icon}>
                      <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
          {needle === "" &&
            overview.problems.map((problem) => (
              <li key={problem.path} className={styles.note} title={problem.message}>
                <span className={styles.warn}>!</span> {problem.path} non si legge
              </li>
            ))}
          {needle === "" &&
            providers.map((state) => (
              <ProviderRow key={state.provider} state={state} ci={ci} editing={tokenFor === state.provider} onEdit={onTokenFor} />
            ))}
          {needle === "" && ci.report === null && overview.workflows.length > 0 && <li className={styles.note}>Leggo le run…</li>}
        </ul>
      )}
    </section>
  );
}

function workflowTitle(workflow: CiWorkflow, last: string | null): string {
  const lines = [`${workflow.path} · ${PROVIDER_LABEL[workflow.provider]}`, `Eventi: ${workflow.events.join(", ") || "nessuno"}`];
  lines.push(last ? `Ultima run: ${last}` : "Nessuna run nota");
  if (workflow.approximate) lines.push("Alcune condizioni (file cambiati, variabili) non sono valutate");
  lines.push("Clic: mostra solo questo workflow sul grafo");
  return lines.join("\n");
}

function shortProvider(provider: CiProvider): string {
  return { GitHub: "GH", GitLab: "GL", CircleCi: "Circle", Azure: "Azure", Bitbucket: "BB", Travis: "Travis", Jenkins: "Jenkins" }[provider];
}

/** One line per CI service: how its runs are read, or why they are not. */
function ProviderRow({ state, ci, editing, onEdit }: { state: CiProviderState; ci: CiState; editing: boolean; onEdit: (p: CiProvider | null) => void }) {
  const label = PROVIDER_LABEL[state.provider];
  const access = state.access;
  const canSave = state.provider !== "Jenkins" && access.kind !== "unavailable";
  return (
    <li className={styles.providerRow}>
      <div className={styles.note} title={accessTitle(access)}>
        <span className={styles.access} style={{ background: accessColor(access) }} />
        <span className={styles.text}>
          {label}: {accessText(access)}
        </span>
        {canSave && !editing && (access.kind !== "ok" || state.hasSavedToken) && (
          <button type="button" className={styles.link} onClick={() => onEdit(state.provider)}>
            {state.hasSavedToken ? "Token" : "Imposta token"}
          </button>
        )}
      </div>
      {editing && <TokenForm provider={state.provider} saved={state.hasSavedToken} ci={ci} onDone={() => onEdit(null)} />}
    </li>
  );
}

function accessText(access: CiAccess): string {
  switch (access.kind) {
    case "ok":
      return access.via === "Cli" ? "via CLI" : access.via === "Keychain" ? "via Portachiavi" : "pubblico";
    case "needsToken":
      return "serve un token";
    case "unavailable":
      return "run non disponibili";
    case "failed":
      return "errore";
  }
}

function accessTitle(access: CiAccess): string {
  switch (access.kind) {
    case "ok":
      return `${access.runs} run lette`;
    case "needsToken":
    case "unavailable":
    case "failed":
      return access.message;
  }
}

function accessColor(access: CiAccess): string {
  switch (access.kind) {
    case "ok":
      return "var(--add)";
    case "needsToken":
      return "var(--b2)";
    case "unavailable":
      return "var(--text-3)";
    case "failed":
      return "var(--danger)";
  }
}

/** A password field that saves the token in the Keychain (never shown again once saved). */
function TokenForm({ provider, saved, ci, onDone }: { provider: CiProvider; saved: boolean; ci: CiState; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(token: string | null) {
    setBusy(true);
    setError(null);
    try {
      await ci.setToken(provider, token);
      onDone();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim() !== "") void save(value.trim());
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <input
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={TOKEN_HINT[provider]}
        aria-label={`Token di ${PROVIDER_LABEL[provider]}`}
        spellCheck={false}
        autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy || value.trim() === ""}>
          Salva nel Portachiavi
        </button>
        {saved && (
          <button type="button" className={styles.link} disabled={busy} onClick={() => void save(null)}>
            Rimuovi
          </button>
        )}
        <button type="button" className={styles.link} onClick={onDone}>
          Annulla
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
