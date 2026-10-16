"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Check, Clapperboard, Copy, Link2, LockKeyhole, MessageCircle, Play, Radio, ShieldCheck, Upload, Users, X } from "lucide-react";
import { useRoomStore } from "@/lib/store";

function generateRoomId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const random = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(random, (value) => chars[value % chars.length]).join("");
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen animate-pulse bg-[#09090b]" />}>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const router = useRouter();
  const { setUsername, setRoomId } = useRoomStore();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [tab, setTab] = useState<"create" | "join">(() => searchParams.get("tab") === "join" ? "join" : "create");
  const [error, setError] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  const enterRoom = (action: "create" | "join") => {
    if (!name.trim()) {
      setError("Add your name before you continue.");
      return;
    }

    const id = action === "create" ? generateRoomId() : joinCode.trim();
    if (action === "join" && !/^[A-Za-z0-9]{16}$/.test(id)) {
      setError("Enter the 16-character room code.");
      return;
    }

    try {
      if (action === "create") sessionStorage.setItem(`hometheater:${id}:owner`, crypto.randomUUID());
      sessionStorage.setItem(`hometheater:${id}:participant`, crypto.randomUUID());
    } catch {
      setError("Your browser could not save this room session. Enable session storage and try again.");
      return;
    }

    setUsername(name.trim());
    setRoomId(id);
    router.push(`/room/${id}`);
  };

  const selectTab = (nextTab: "create" | "join") => {
    setTab(nextTab);
    setError("");
  };

  return (
    <main className="relative flex min-h-[100dvh] overflow-hidden bg-[#09090b] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-48 h-[34rem] w-[34rem] rounded-full bg-red-600/[0.11] blur-[130px]" />
        <div className="absolute -bottom-64 right-[-5rem] h-[36rem] w-[36rem] rounded-full bg-orange-500/[0.08] blur-[140px]" />
        <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: "linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)", backgroundSize: "64px 64px" }} />
      </div>

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1440px] flex-col px-5 sm:px-8 lg:px-14">
        <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-white/[0.07]">
          <Link href="/" aria-label="HomeTheater home" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500 text-white shadow-lg shadow-red-950/40"><Clapperboard size={18} /></span>
            <span className="text-sm font-semibold tracking-tight">home<span className="text-red-400">theater</span></span>
          </Link>
          <div className="hidden items-center gap-2 text-xs text-zinc-500 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]" />
            Made for movie nights
          </div>
          <button
            type="button"
            onClick={() => setShowGuide(true)}
            className="rounded-lg px-2 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            How it works
          </button>
        </header>

        <div className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)] lg:gap-20 lg:py-16">
          <section className="mx-auto w-full max-w-2xl lg:mx-0">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-red-400/15 bg-red-400/[0.06] px-3 py-1.5 text-[11px] font-medium text-red-200">
              <Radio size={13} className="text-red-400" />
              Your own private watch party
            </div>

            <h1 className="max-w-xl text-5xl font-semibold leading-[1.04] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Movie night is
              <span className="block bg-gradient-to-r from-red-300 via-red-500 to-orange-400 bg-clip-text text-transparent">better together.</span>
            </h1>
            <p className="mt-6 max-w-lg text-sm leading-7 text-zinc-400 sm:text-base">
              Press play from anywhere. Share a screen, stay in sync, and keep the conversation going.
            </p>

            <div className="mt-9 grid max-w-lg grid-cols-3 gap-2.5">
              {[
                { icon: Users, label: "Up to 50 friends" },
                { icon: Play, label: "Synced playback" },
                { icon: LockKeyhole, label: "Private rooms" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3 py-3.5">
                  <Icon size={16} className="mb-3 text-red-300" />
                  <p className="text-[10px] font-medium leading-4 text-zinc-400 sm:text-xs">{label}</p>
                </div>
              ))}
            </div>

            <div id="how-it-works" className="mt-10 hidden items-center gap-3 text-[11px] text-zinc-500 sm:flex">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 text-[10px] text-zinc-300">1</span>
              Create a room
              <span className="h-px w-7 bg-white/10" />
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 text-[10px] text-zinc-300">2</span>
              Share the code
              <span className="h-px w-7 bg-white/10" />
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 text-[10px] text-zinc-300">3</span>
              Watch together
            </div>
          </section>

          <section className="mx-auto w-full max-w-md">
            <div className="rounded-[28px] border border-white/[0.09] bg-[#111114]/90 p-5 shadow-[0_24px_100px_rgba(0,0,0,.55)] backdrop-blur-xl sm:p-7">
              <div className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">Let’s get together</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">Start your watch party</h2>
                <p className="mt-1.5 text-xs text-zinc-500">No accounts. Just you and your people.</p>
              </div>

              <div className="mb-5 grid grid-cols-2 rounded-xl border border-white/[0.06] bg-black/30 p-1">
                {(["create", "join"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => selectTab(item)}
                    aria-pressed={tab === item}
                    className={`rounded-lg px-3 py-2.5 text-xs font-medium transition-all duration-200 ${tab === item ? "bg-white text-zinc-950 shadow-md shadow-black/20" : "text-zinc-500 hover:text-zinc-200"}`}
                  >
                    {item === "create" ? "Create a room" : "Join a room"}
                  </button>
                ))}
              </div>

              <label htmlFor="display-name" className="mb-2 block text-[11px] font-medium text-zinc-400">Your name</label>
              <input
                id="display-name"
                autoComplete="nickname"
                className="mb-4 w-full rounded-xl border border-white/[0.09] bg-black/30 px-4 py-3.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-red-400/50 focus:ring-4 focus:ring-red-400/[0.07]"
                placeholder="How should we call you?"
                value={name}
                maxLength={32}
                onChange={(event) => { setName(event.target.value); setError(""); }}
                onKeyDown={(event) => event.key === "Enter" && enterRoom(tab)}
              />

              {tab === "join" && (
                <div className="mb-4 animate-field-in">
                  <label htmlFor="room-code" className="mb-2 block text-[11px] font-medium text-zinc-400">Room code</label>
                  <div className="relative">
                    <Copy size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" />
                    <input
                      id="room-code"
                      autoComplete="off"
                      className="w-full rounded-xl border border-white/[0.09] bg-black/30 py-3.5 pl-11 pr-4 font-mono text-sm tracking-[0.14em] text-white outline-none transition-colors placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600 focus:border-red-400/50 focus:ring-4 focus:ring-red-400/[0.07]"
                      placeholder="Paste the 16-character code"
                      maxLength={16}
                      value={joinCode}
                      onChange={(event) => { setJoinCode(event.target.value); setError(""); }}
                      onKeyDown={(event) => event.key === "Enter" && enterRoom("join")}
                    />
                  </div>
                </div>
              )}

              {error && <p role="alert" className="mb-3 rounded-lg border border-red-500/15 bg-red-500/[0.07] px-3 py-2 text-xs text-red-300">{error}</p>}
              <button
                type="button"
                onClick={() => enterRoom(tab)}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-red-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition-all duration-200 hover:-translate-y-0.5 hover:from-red-400 hover:to-red-500 hover:shadow-red-950/50 active:translate-y-0"
              >
                {tab === "create" ? "Create watch room" : "Join watch party"}
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </button>

              <div className="mt-5 flex items-center justify-center gap-2 text-[10px] text-zinc-600">
                <Check size={12} className="text-emerald-400" />
                Free to use
                <span className="text-zinc-800">·</span>
                <Link2 size={12} />
                Share one simple code
              </div>
            </div>
            <p className="mt-4 text-center text-[10px] leading-5 text-zinc-600">Rooms support up to 50 people. The host controls what plays.</p>
          </section>
        </div>

        <footer className="flex h-12 shrink-0 items-center justify-center border-t border-white/[0.06] text-[10px] text-zinc-600">
          HomeTheater <span className="mx-2 text-zinc-800">/</span> Make the distance feel smaller.
        </footer>
      </div>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-guide-in"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowGuide(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setShowGuide(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            className="relative max-h-[min(88dvh,760px)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/[0.1] bg-[#111114] p-5 shadow-[0_30px_120px_rgba(0,0,0,.7)] sm:p-8"
          >
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              aria-label="Close how it works"
              className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <X size={17} />
            </button>

            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300">Your watch party, step by step</p>
            <h2 id="guide-title" className="mt-2 pr-10 text-2xl font-semibold tracking-tight sm:text-3xl">How HomeTheater works</h2>
            <p className="mt-2 max-w-lg text-xs leading-5 text-zinc-500">Create a private room, invite your people, and let the host control the movie.</p>

            <ol className="mt-7 space-y-3">
              {[
                {
                  icon: Users,
                  title: "Create a room or join one",
                  detail: "Enter your name. Create a room to host, or choose Join a room and enter the 16-character code your host shared.",
                  color: "text-red-300",
                  tint: "bg-red-400/[0.08]",
                },
                {
                  icon: Copy,
                  title: "Invite friends with the room code",
                  detail: "The host copies the code from the room header and sends it to friends. Rooms allow up to 50 people, including the host.",
                  color: "text-violet-300",
                  tint: "bg-violet-400/[0.08]",
                },
                {
                  icon: Upload,
                  title: "Load something to watch",
                  detail: "The host uploads a local video or audio file, pastes a direct media URL, or shares an embeddable YouTube link. Use browser-compatible formats such as H.264/AAC MP4 or WebM.",
                  color: "text-sky-300",
                  tint: "bg-sky-400/[0.08]",
                },
                {
                  icon: Play,
                  title: "Watch in sync",
                  detail: "The host controls shared play, pause, seeking, and speed. Participants can pause only their own playback; resuming syncs them to the host's latest position.",
                  color: "text-emerald-300",
                  tint: "bg-emerald-400/[0.08]",
                },
                {
                  icon: MessageCircle,
                  title: "Chat and manage the room",
                  detail: "Everyone can chat. The host can temporarily block or unblock a participant's chat and playback controls. When the host leaves, the room closes for everyone.",
                  color: "text-amber-300",
                  tint: "bg-amber-400/[0.08]",
                },
              ].map(({ icon: Icon, title, detail, color, tint }, index) => (
                <li key={title} className="flex gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 sm:gap-4 sm:p-4">
                  <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint} ${color}`}>
                    <Icon size={17} />
                    <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-[#111114] bg-zinc-800 text-[9px] font-semibold text-zinc-300">{index + 1}</span>
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <h3 className="text-xs font-semibold text-zinc-100 sm:text-sm">{title}</h3>
                    <p className="mt-1.5 text-[11px] leading-5 text-zinc-500 sm:text-xs">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-black/20 p-3.5">
              <ShieldCheck size={15} className="mt-0.5 shrink-0 text-zinc-500" />
              <p className="text-[10px] leading-5 text-zinc-500">No account is needed. Local uploads are sent to the room backend and are temporary; on Render Free, files may disappear when its service restarts.</p>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
            >
              Got it <Check size={15} />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
