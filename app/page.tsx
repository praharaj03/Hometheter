"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRoomStore } from "@/lib/store";

function generateRoomId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

const badges = [
  { label: "4K Ultra HD", icon: "▣", color: "#00b4d8" },
  { label: "HDR", icon: "◈", color: "#f4a261" },
  { label: "Dolby Atmos", icon: "◉", color: "#a8dadc" },
  { label: "No Delay", icon: "⚡", color: "#e63946" },
  { label: "HD 1080p", icon: "▤", color: "#57cc99" },
  { label: "Sync'd", icon: "⟳", color: "#c77dff" },
];

export default function Home() {
  const router = useRouter();
  const { setUsername, setRoomId } = useRoomStore();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"create" | "join">("create");

  useEffect(() => {
    if (searchParams.get("tab") === "join") setTab("join");
    else setTab("create");
  }, [searchParams]);

  const handleCreate = () => {
    if (!name.trim()) return;
    const id = generateRoomId();
    setUsername(name.trim());
    setRoomId(id);
    router.push(`/room/${id}?owner=true`);
  };

  const handleJoin = () => {
    if (!name.trim() || joinCode.length !== 16) return;
    setUsername(name.trim());
    setRoomId(joinCode);
    router.push(`/room/${joinCode}`);
  };

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center text-white relative overflow-hidden px-4 py-8"
      style={{ background: "linear-gradient(160deg, #1a0000 0%, #141414 40%, #0d0d0d 100%)" }}
    >
      {/* Subtle red glow top */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] sm:w-[600px] h-[150px] sm:h-[200px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(229,9,20,0.18) 0%, transparent 70%)" }}
      />

      {/* Logo */}
      <div className="mb-6 sm:mb-8 text-center">
        <h1
          className="text-5xl sm:text-7xl"
          style={{ fontFamily: 'var(--font-bebas)', color: "#e50914", letterSpacing: '0.1em', textShadow: "0 0 40px rgba(229,9,20,0.4)" }}
        >
          HomeTheater
        </h1>
        <p className="mt-2 text-sm font-medium" style={{ color: "#808080" }}>
          Watch together, feel together.
        </p>
      </div>

      {/* Quality Badges */}
      <div className="flex flex-wrap justify-center gap-2 mb-6 sm:mb-8 max-w-sm sm:max-w-md px-2">
        {badges.map((b) => (
          <span
            key={b.label}
            className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-md text-[10px] sm:text-xs font-bold tracking-wide"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${b.color}44`,
              color: b.color,
            }}
          >
            <span>{b.icon}</span>
            {b.label}
          </span>
        ))}
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl p-5 sm:p-7 shadow-2xl"
        style={{
          background: "rgba(20,20,20,0.95)",
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Tabs */}
        <div className="flex mb-5 rounded-xl p-1" style={{ background: "#2a2a2a" }}>
          {(["create", "join"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all"
              style={tab === t ? { background: "#e50914", color: "#fff" } : { color: "#808080" }}
            >
              {t === "create" ? "Create Room" : "Join Room"}
            </button>
          ))}
        </div>

        <input
          className="w-full rounded-xl px-4 py-3.5 text-sm mb-3 outline-none transition-all"
          style={{ background: "#2a2a2a", border: "1px solid #3a3a3a", color: "#e5e5e5" }}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (tab === "create" ? handleCreate() : handleJoin())}
          onFocus={(e) => (e.target.style.borderColor = "#e50914")}
          onBlur={(e) => (e.target.style.borderColor = "#3a3a3a")}
        />

        {tab === "join" && (
          <input
            className="w-full rounded-xl px-4 py-3.5 text-sm mb-3 outline-none font-mono tracking-widest transition-all"
            style={{ background: "#2a2a2a", border: "1px solid #3a3a3a", color: "#e5e5e5" }}
            placeholder="16-digit room code"
            maxLength={16}
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            onFocus={(e) => (e.target.style.borderColor = "#e50914")}
            onBlur={(e) => (e.target.style.borderColor = "#3a3a3a")}
          />
        )}

        <button
          onClick={tab === "create" ? handleCreate : handleJoin}
          className="w-full font-bold py-3.5 rounded-xl text-sm mt-1 transition-all active:scale-95"
          style={{ background: "#e50914", color: "#fff" }}
          onMouseEnter={(e) => ((e.target as HTMLElement).style.background = "#f6121d")}
          onMouseLeave={(e) => ((e.target as HTMLElement).style.background = "#e50914")}
        >
          {tab === "create" ? "Create & Enter" : "Join Room"}
        </button>
      </div>

      <p className="mt-6 text-xs" style={{ color: "#404040" }}>
        No account needed · Instant rooms · Free forever
      </p>
    </main>
  );
}
