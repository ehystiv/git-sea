import type { AppError } from "./bindings";
import { t, type Messages } from "./i18n";

/** Wraps the typed error returned by a Tauri command so it can be thrown. */
export class CommandError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.appError = appError;
  }
}

/** User-facing text for each backend error kind, in the UI language. */
export function describeError(error: unknown, m: Messages = t()): string {
  if (error instanceof CommandError) {
    switch (error.appError.kind) {
      case "PathNotFound":
        return m.errors.pathNotFound;
      case "NotARepository":
        return m.errors.notARepository;
      case "SessionNotFound":
        return m.errors.sessionNotFound;
      case "Git":
        return m.errors.git(error.appError.message);
      case "Internal":
        return m.errors.internal(error.appError.message);
    }
  }
  return m.errors.backend;
}
