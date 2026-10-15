import type { AppError } from "./bindings";

/** Wraps the typed error returned by a Tauri command so it can be thrown. */
export class CommandError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.appError = appError;
  }
}

/** User-facing (Italian) text for each backend error kind. */
export function describeError(error: unknown): string {
  if (error instanceof CommandError) {
    switch (error.appError.kind) {
      case "PathNotFound":
        return "Il percorso non esiste.";
      case "NotARepository":
        return "Questa cartella non è un repository Git.";
      case "SessionNotFound":
        return "Il repository non è più aperto.";
      case "Git":
        return `Impossibile leggere il repository: ${error.appError.message}`;
      case "Internal":
        return `Errore interno: ${error.appError.message}`;
    }
  }
  return "Impossibile contattare il backend dell'app.";
}
