"use client";
import { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { useRoomStore } from "@/lib/store";
import { Send } from "lucide-react";

import { sanitizeInput } from "@/lib/socket";

interface Props {
  socket: Socket;
}

export default function ChatPanel({ socket }: Props) {
  const { messages, username } = useRoomStore();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = () => {
    const safe = sanitizeInput(input, 500);
    if (!safe) return;
    socket.emit("chat-message", { message: safe, username });
    setInput("");
  };

  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin">
        {messages.length === 0 && (
          <p className="text-zinc-600 text-xs text-center mt-8">No messages yet. Say hi! 👋</p>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.username === username;
          return (
            <div key={i} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
              <span className="text-[10px] text-zinc-500 mb-0.5">
                {isMe ? "You" : msg.username} · {fmt(msg.time)}
              </span>
              <div
                className={`px-3 py-2 rounded-2xl text-sm max-w-[85%] break-words ${
                  isMe
                    ? "bg-white text-black rounded-tr-sm"
                    : "bg-zinc-800 text-zinc-100 rounded-tl-sm"
                }`}
              >
                {msg.message}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 p-3 flex gap-2">
        <input
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm outline-none focus:border-zinc-500 placeholder-zinc-600"
          placeholder="Message..."
          value={input}
          maxLength={500}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button
          onClick={send}
          className="bg-white text-black p-2 rounded-xl hover:bg-zinc-200 transition-all"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
