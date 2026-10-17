/** Bytes downloaded so far, and the total when the server said it. */
export interface Download {
  downloaded: number;
  total: number | null;
}

export type DownloadEvent = { event: "Started"; data: { contentLength?: number } } | { event: "Progress"; data: { chunkLength: number } } | { event: "Finished" };

export const startDownload: Download = { downloaded: 0, total: null };

/** The download after one event of the updater. */
export function onDownloadEvent(download: Download, event: DownloadEvent): Download {
  switch (event.event) {
    case "Started":
      return { downloaded: 0, total: event.data.contentLength ?? null };
    case "Progress":
      return { ...download, downloaded: download.downloaded + event.data.chunkLength };
    case "Finished":
      return { ...download, downloaded: download.total ?? download.downloaded };
  }
}

/** 0–1, or null while the size is unknown. */
export function downloadFraction(download: Download): number | null {
  if (!download.total) return null;
  return Math.min(1, download.downloaded / download.total);
}
