import { useCallback, useEffect, useRef, useState } from "react";
import { getSocketServerUrl } from "@/lib/socket";

export function useMediaUpload(roomId: string) {
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number; name: string } | null>(null);
  const upload = useCallback((file: File, contentType: string, ownerToken: string) => new Promise<{ mediaId: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    requestRef.current = request;
    setProgress({ loaded: 0, total: file.size, name: file.name });
    const finish = () => { requestRef.current = null; setProgress(null); };
    request.open("POST", `${getSocketServerUrl().replace(/\/$/, "")}/media/${encodeURIComponent(roomId)}`);
    request.setRequestHeader("Content-Type", contentType);
    request.setRequestHeader("X-Room-Token", ownerToken);
    request.timeout = 30 * 60 * 1000;
    request.upload.onprogress = (event) => setProgress({ loaded: Math.min(event.loaded, file.size), total: file.size, name: file.name });
    request.onload = () => {
      finish();
      let result: { mediaId?: string; error?: string } = {};
      try { result = JSON.parse(request.responseText); } catch { /* Report invalid responses below. */ }
      if (request.status >= 200 && request.status < 300 && result.mediaId) resolve({ mediaId: result.mediaId });
      else reject(new Error(result.error || `Upload failed (${request.status}). Please retry.`));
    };
    request.onerror = () => { finish(); reject(new Error("Upload failed. Check your connection and retry.")); };
    request.ontimeout = () => { finish(); reject(new Error("Upload timed out. Please retry with a smaller file.")); };
    request.onabort = () => { finish(); reject(new DOMException("Upload cancelled.", "AbortError")); };
    request.send(file);
  }), [roomId]);
  const cancel = useCallback(() => requestRef.current?.abort(), []);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  return { upload, cancel, progress };
}
