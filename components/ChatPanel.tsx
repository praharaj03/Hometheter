"use client";
import { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { useRoomStore } from "@/lib/store";
import { MessageCircle, Send } from "lucide-react";

import { sanitizeInput } from "@/lib/socket";

interface Props {
  socket: Socket;
}

export default function ChatPanel({ socket }: Props) {
  const { messages, username, isBlocked } = useRoomStore();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    const safe = sanitizeInput(input, 500);
    if (!safe || isBlocked) return;
    socket.emit("chat-message", { message: safe });
    setInput("");
  };

  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex h-full min-h-40 flex-col items-center justify-center text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-zinc-500"><MessageCircle size={18} /></span>
            <p className="text-xs font-medium text-zinc-300">Your room, your conversation</p>
            <p className="mt-1 text-[11px] text-zinc-600">Send a message to get things started.</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.username === username;
          return (
            <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
              <span className="mb-1 text-[10px] text-zinc-500">
                {isMe ? "You" : msg.username} · {fmt(msg.time)}
              </span>
              <div
                className={`max-w-[88%] break-words rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  isMe
                    ? "rounded-tr-md bg-red-500 text-white shadow-lg shadow-red-950/20"
                    : "rounded-tl-md border border-white/[0.06] bg-white/[0.05] text-zinc-200"
                }`}
              >
                {msg.message}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 border-t border-white/[0.07] p-3">
        <input
          className="min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3.5 py-2.5 text-xs text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-red-400/40 disabled:opacity-50"
          placeholder={isBlocked ? "Chat is unavailable" : "Write a message..."}
          value={input}
          maxLength={500}
          disabled={isBlocked}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button
          onClick={send}
          disabled={isBlocked}
          aria-label="Send message"
          className="rounded-xl bg-red-500 p-2.5 text-white transition-all hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
