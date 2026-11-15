"use client";

import { useState, type FormEvent } from "react";
import type { Socket } from "socket.io-client";
import { ListVideo, SkipForward, X } from "lucide-react";
import { useRoomStore } from "@/lib/store";

export default function QueuePanel({ socket, isOwner, connected }: { socket: Socket; isOwner: boolean; connected: boolean }) {
  const queue = useRoomStore((state) => state.queue);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!connected || pending) return;
    let mediaUrl: URL;
    try {
      mediaUrl = new URL(url.trim());
      if (!["http:", "https:"].includes(mediaUrl.protocol)) throw new Error();
    } catch { setError("Enter a YouTube or direct media URL."); return; }
    setPending(true);
    setError("");
    socket.timeout(8000).emit("queue-add", { src: mediaUrl.href, title: title.trim() || mediaUrl.hostname + mediaUrl.pathname }, (timeout: Error | null, result?: { error?: string }) => {
      setPending(false);
      if (timeout || result?.error) { setError(result?.error || "Could not add this link. Please retry."); return; }
      setUrl("");
      setTitle("");
    });
  };

  return (
    <div className="h-full space-y-4 overflow-y-auto overscroll-contain p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Up next <span className="text-zinc-400">{queue.length}/20</span></h2>
        {isOwner && <button disabled={!connected || !queue.length} onClick={() => socket.emit("queue-next")} className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-200 disabled:opacity-40"><SkipForward size={14} /> Load next</button>}
      </div>
      <p className="text-xs leading-5 text-zinc-400">The next link loads when the current video ends. The host presses play when everyone is ready.</p>
      {queue.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-zinc-400"><ListVideo className="mx-auto mb-3" size={24} />{isOwner ? "Add links to plan your movie night." : "The host has not queued any videos yet."}</div>}
      <ol className="space-y-2">
        {queue.map((item, index) => <li key={item.id} className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.025] p-3">
          <span className="text-xs text-red-300">{index + 1}</span>
          <div className="min-w-0 flex-1"><p className="break-words text-xs font-medium">{item.title}</p><p className="mt-1 truncate text-[11px] text-zinc-400" title={item.src}>{item.src}</p></div>
          {isOwner && <button disabled={!connected} onClick={() => socket.emit("queue-remove", { id: item.id })} aria-label={`Remove ${item.title} from queue`} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white"><X size={14} /></button>}
        </li>)}
      </ol>
      {isOwner && <form onSubmit={add} className="space-y-3 border-t border-white/10 pt-4">
        <label className="block text-xs text-zinc-300">Media link<input type="url" required maxLength={4096} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="YouTube or direct video URL" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs" /></label>
        <label className="block text-xs text-zinc-300">Title <span className="text-zinc-400">(optional)</span><input maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs" /></label>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <button disabled={!connected || pending || queue.length >= 20} className="w-full rounded-xl bg-red-500 px-4 py-3 text-xs font-semibold disabled:opacity-40">{pending ? "Adding…" : "Add to queue"}</button>
      </form>}
    </div>
  );
}
