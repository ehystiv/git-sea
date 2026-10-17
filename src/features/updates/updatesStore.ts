import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { onDownloadEvent, startDownload, type Download } from "./progress";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; version: string; notes: string }
  | { kind: "downloading"; version: string; download: Download }
  | { kind: "installed"; version: string }
  | { kind: "error"; during: "check" | "install"; message: string };

interface UpdatesStore {
  status: UpdateStatus;
  /** Look for updates at launch and every few hours. */
  autoCheck: boolean;
  /** The dialog about an available update is shown. */
  open: boolean;
  setAutoCheck: (on: boolean) => void;
  setOpen: (open: boolean) => void;
  /** `quiet`: a failure leaves no error behind (a background check without network). */
  check: (quiet?: boolean) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
}

/** The update found by the last check; it holds a handle in the backend, so it is not state. */
let pending: Update | null = null;

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useUpdates = create<UpdatesStore>()(
  persist(
    (set, get) => ({
      status: { kind: "idle" },
      autoCheck: true,
      open: false,
      setAutoCheck: (autoCheck) => set({ autoCheck }),
      setOpen: (open) => set({ open }),
      check: async (quiet = false) => {
        const { status } = get();
        if (status.kind === "checking" || status.kind === "downloading" || status.kind === "installed") return;
        set({ status: { kind: "checking" } });
        try {
          if (!isTauri()) throw new Error("not running in the app");
          const update = await check();
          await pending?.close().catch(() => undefined);
          pending = update;
          set({ status: update ? { kind: "available", version: update.version, notes: update.body?.trim() ?? "" } : { kind: "upToDate" } });
        } catch (error) {
          set({ status: quiet ? { kind: "idle" } : { kind: "error", during: "check", message: describe(error) } });
        }
      },
      install: async () => {
        const update = pending;
        if (!update) return;
        let download = startDownload;
        set({ status: { kind: "downloading", version: update.version, download } });
        try {
          await update.downloadAndInstall((event) => {
            download = onDownloadEvent(download, event);
            set({ status: { kind: "downloading", version: update.version, download } });
          });
          set({ status: { kind: "installed", version: update.version } });
        } catch (error) {
          set({ status: { kind: "error", during: "install", message: describe(error) } });
        }
      },
      restart: async () => {
        await relaunch();
      },
    }),
    { name: "git-sea:updates", partialize: (s) => ({ autoCheck: s.autoCheck }) },
  ),
);

/** Where to get a release by hand when the update cannot be installed. */
export const RELEASES_URL = "https://github.com/ehystiv/git-sea/releases/latest";
