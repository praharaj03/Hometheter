"use client";
import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { useRoomStore } from "@/lib/store";
import { LockKeyhole, LockKeyholeOpen } from "lucide-react";

interface Props {
  isOwner: boolean;
  socket: Socket;
}

const ROOM_CAPACITY = 50;

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
  const presentCount = users.filter((user) => user.isConnected !== false).length;
  const openSeats = Math.max(ROOM_CAPACITY - presentCount, 0);
  const [mySocketId, setMySocketId] = useState(socket.id ?? "");
  const [pings, setPings] = useState<Record<string, number>>({});

  useEffect(() => {
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
    <div className="p-4">
      <div className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-sm font-semibold text-white">{presentCount} of {ROOM_CAPACITY} here</p>
            <p className="mt-1 text-xs text-zinc-500">{isOwner ? `${openSeats} ${openSeats === 1 ? "spot" : "spots"} left to invite` : "Room capacity"}</p>
          </div>
          <span className="text-xs font-medium tabular-nums text-zinc-400">{presentCount}/{ROOM_CAPACITY}</span>
        </div>
        <div className="flex gap-1.5" aria-label={`${openSeats} open spots`}>
          {Array.from({ length: ROOM_CAPACITY }, (_, index) => (
            <span key={index} className={`h-1.5 flex-1 rounded-full transition-colors ${index < presentCount ? "bg-red-500" : "bg-white/10"}`} />
          ))}
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">In this room</p>
        <span className="text-[10px] text-zinc-600">{users.length} total</span>
      </div>
      {users.map((u) => {
        const isMe = u.isConnected && u.id === mySocketId;
        const ping = pings[u.id] ?? null;
        const pingColor = ping !== null ? getPingColor(ping) : "text-zinc-600";

        return (
          <div key={u.uid ?? u.id} className={`group flex items-center gap-3 rounded-xl px-2.5 py-3 transition-colors hover:bg-white/[0.035] ${u.isConnected === false ? "opacity-50" : ""}`}>
            {/* Avatar */}
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${u.isOwner ? "border border-red-400/20 bg-red-500/10 text-red-300" : "border border-white/[0.06] bg-white/[0.06] text-zinc-300"}`}>
              {u.username[0]?.toUpperCase()}
            </div>

            {/* Name + uid */}
            <div className="flex flex-col min-w-0 flex-1">
              <span className={`truncate text-xs font-medium ${u.isOwner ? "text-white" : "text-zinc-300"}`}>
                {u.username}
                {u.isOwner && <span className="ml-1.5 text-[10px] font-normal text-red-400">owner</span>}
                {isMe && <span className="ml-1.5 text-[10px] text-zinc-500">you</span>}
                {u.isConnected === false && <span className="ml-1.5 text-[10px] text-zinc-500">offline</span>}
              </span>
              {u.uid && <span className="mt-0.5 text-[10px] font-mono text-zinc-600">{u.uid}</span>}
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

            {/* Owner-only temporary interaction restriction */}
            {isOwner && !isMe && (
              <button
                onClick={() => u.uid && socket.emit("set-blocked", { participantId: u.uid, blocked: !u.isBlocked })}
                className={`rounded-lg p-2 transition-colors ${u.isBlocked ? "text-amber-400 hover:bg-amber-400/10 hover:text-amber-300" : "text-zinc-600 hover:bg-white/[0.06] hover:text-amber-400"}`}
                title={u.isBlocked ? "Unblock participant" : "Temporarily block chat and controls"}
              >
                {u.isBlocked ? <LockKeyholeOpen size={14} /> : <LockKeyhole size={14} />}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
