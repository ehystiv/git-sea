import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useUpdates } from "./updatesStore";

/** The first check waits for the app to settle; later ones come every few hours. */
const FIRST_CHECK_MS = 10_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

/** Looks for updates in the background while `autoCheck` is on; failures stay quiet. */
export function useAutoUpdateCheck(): void {
  const autoCheck = useUpdates((s) => s.autoCheck);
  useEffect(() => {
    if (!autoCheck || !isTauri()) return;
    const run = () => void useUpdates.getState().check(true);
    const first = setTimeout(run, FIRST_CHECK_MS);
    const every = setInterval(run, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [autoCheck]);
}
