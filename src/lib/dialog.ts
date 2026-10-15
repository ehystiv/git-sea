import { open } from "@tauri-apps/plugin-dialog";

/** Native folder picker. Returns null when cancelled or when not running inside Tauri. */
export async function pickRepoFolder(): Promise<string | null> {
  try {
    const picked = await open({ directory: true, multiple: false, title: "Apri un repository" });
    return typeof picked === "string" ? picked : null;
  } catch (error) {
    console.warn("folder picker unavailable", error);
    return null;
  }
}
