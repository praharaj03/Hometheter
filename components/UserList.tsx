"use client";
import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { useRoomStore } from "@/lib/store";
import { UserMinus } from "lucide-react";

interface Props {
  isOwner: boolean;
  socket: Socket;
}

function getPingColor(ping: number) {
  if (ping < 80) return "text-green-400";
  if (ping < 200) return "text-yellow-400";
  return "text-red-400";
}

function getSignalBars(ping: number) {
  // 3 bars = excellent, 2 = ok, 1 = poor
  if (ping < 80) return 3;
  if (ping < 200) return 2;
  return 1;
}

function SignalIcon({ bars, color }: { bars: number; color: string }) {
  return (
    <span className={`flex items-end gap-[2px] ${color}`}>
      {[1, 2, 3].map((b) => (
        <span
          key={b}
          className="rounded-sm inline-block"
          style={{
            width: 3,
            height: b * 4,
            background: b <= bars ? "currentColor" : "rgba(255,255,255,0.15)",
          }}
        />
      ))}
    </span>
  );
}

export default function UserList({ isOwner, socket }: Props) {
  const { users } = useRoomStore();
  const [mySocketId, setMySocketId] = useState(socket.id ?? "");
  const [pings, setPings] = useState<Record<string, number>>({});

  useEffect(() => {
    if (socket.id) setMySocketId(socket.id);
    const onConnect = () => setMySocketId(socket.id ?? "");
    socket.on("connect", onConnect);
    return () => { socket.off("connect", onConnect); };
  }, [socket]);

  // Measure own ping every 3 seconds and broadcast it
  useEffect(() => {
    const measure = () => {
      const start = Date.now();
      socket.emit("ping", () => {
        const p = Date.now() - start;
        setPings((prev) => ({ ...prev, [socket.id!]: p }));
        socket.emit("broadcast-ping", { ping: p });
      });
    };
    measure();
    const interval = setInterval(measure, 3000);
    return () => clearInterval(interval);
  }, [socket]);

  // Listen for other users' pings
  useEffect(() => {
    const onUserPing = ({ id, ping }: { id: string; ping: number }) => {
      setPings((prev) => ({ ...prev, [id]: ping }));
    };
    socket.on("user-ping", onUserPing);
    return () => { socket.off("user-ping", onUserPing); };
  }, [socket]);

  return (
    <div className="p-4 space-y-1">
      <p className="text-xs text-zinc-500 mb-3">
        {users.length} participant{users.length !== 1 ? "s" : ""}
      </p>
      {users.map((u) => {
        const isMe = u.id === mySocketId;
        const ping = pings[u.id] ?? null;
        const pingColor = ping !== null ? getPingColor(ping) : "text-zinc-600";

        return (
          <div key={u.id} className="flex items-center gap-3 py-2">
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 ${u.isOwner ? "bg-red-900/60 border border-red-700/60" : "bg-zinc-800"}`}>
              {u.username[0]?.toUpperCase()}
            </div>

            {/* Name + uid */}
            <div className="flex flex-col min-w-0 flex-1">
              <span className={`text-sm truncate ${u.isOwner ? "font-bold text-white" : "text-zinc-300"}`}>
                {u.username}
                {u.isOwner && <span className="ml-1.5 text-[10px] font-normal text-red-400">owner</span>}
                {isMe && <span className="ml-1.5 text-[10px] text-zinc-500">you</span>}
              </span>
              {u.uid && <span className="text-[10px] font-mono text-zinc-600">{u.uid}</span>}
            </div>

            {/* Ping + signal for all users */}
            <div className={`flex items-center gap-1.5 shrink-0 ${pingColor}`}>
              {ping !== null ? (
                <>
                  <SignalIcon bars={getSignalBars(ping)} color={pingColor} />
                  <span className="text-[10px] font-mono">{ping}ms</span>
                </>
              ) : (
                <span className="w-2 h-2 rounded-full bg-zinc-700" />
              )}
            </div>

            {/* Kick button (owner only, not self) */}
            {isOwner && !isMe && (
              <button
                onClick={() => socket.emit("kick-user", { participantId: u.id })}
                className="text-zinc-600 hover:text-red-500 transition-colors shrink-0"
                title="Remove participant"
              >
                <UserMinus size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
