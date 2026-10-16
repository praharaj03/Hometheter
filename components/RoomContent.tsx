"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Clapperboard, Copy, DoorOpen, MessageSquare, ShieldCheck, Users, X } from "lucide-react";
import type { VideoState, User } from "@/lib/store";
import { useRoomStore } from "@/lib/store";
import { getServerSocketSnapshot, getSocketSnapshot, sanitizeInput, subscribeToSocket } from "@/lib/socket";
import VideoPlayer from "@/components/VideoPlayer";
import ChatPanel from "@/components/ChatPanel";
import UserList from "@/components/UserList";

interface RoomState {
  videoState: Partial<VideoState>;
  users: User[];
  you: { uid: string; isOwner: boolean; isBlocked: boolean };
}

const ROOM_CAPACITY = 10;

export default function RoomContent() {
  const { id: roomId } = useParams<{ id: string }>();
  const router = useRouter();
  const socket = useSyncExternalStore(subscribeToSocket, getSocketSnapshot, getServerSocketSnapshot);
  const {
    username,
    users,
    setRoomId,
    setUsers,
    addMessage,
    setVideoState,
    setIsBlocked,
    isBlocked,
  } = useRoomStore();
  const [copied, setCopied] = useState(false);
  const [panel, setPanel] = useState<"chat" | "users">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [joinStatus, setJoinStatus] = useState<"connecting" | "joined" | "ended" | "error">("connecting");
  const [joinError, setJoinError] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [myUid, setMyUid] = useState("");
  const liveVideoState = useRef<() => object>(() => useRoomStore.getState().videoState);
  const presentCount = users.filter((user) => user.isConnected !== false).length;
  const availableSpots = Math.max(ROOM_CAPACITY - presentCount, 0);

  const publishLiveVideoState = useCallback((provider: (() => object) | null) => {
    liveVideoState.current = provider ?? (() => useRoomStore.getState().videoState);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const participantKey = `hometheater:${roomId}:participant`;
    let participantToken = sessionStorage.getItem(participantKey);
    if (!participantToken) {
      participantToken = crypto.randomUUID();
      sessionStorage.setItem(participantKey, participantToken);
    }

    const ownerToken = sessionStorage.getItem(`hometheater:${roomId}:owner`);
    const name = sanitizeInput(username || "Guest", 32) || "Guest";
    const join = () => {
      socket.emit("join-room", {
        roomId,
        username: name,
        ownerToken,
        createRoom: Boolean(ownerToken),
        participantToken,
      });
    };

    const onRoomState = ({ videoState, users, you }: RoomState) => {
      setRoomId(roomId);
      if (videoState) setVideoState(videoState);
      if (users) setUsers(users);
      if (you) {
        setMyUid(sanitizeInput(you.uid, 8));
        setIsOwner(you.isOwner);
        setIsBlocked(you.isBlocked);
      }
      setJoinError("");
      setJoinStatus("joined");
    };
    const onUsersUpdate = (updatedUsers: User[]) => setUsers(updatedUsers);
    const onVideoState = (state: Partial<VideoState>) => setVideoState(state);
    const onChatMessage = (message: { username: string; message: string; time: number }) => addMessage(message);
    const onRequestState = ({ forSocketId }: { forSocketId: string }) => {
      socket.emit("sync-state", { forSocketId, videoState: liveVideoState.current() });
    };
    const onBlockedState = (blocked: boolean) => setIsBlocked(blocked);
    const onRoomError = ({ message }: { message: string }) => {
      setJoinError(message);
      setJoinStatus("error");
    };
    const onRoomEnded = () => {
      sessionStorage.removeItem(`hometheater:${roomId}:owner`);
      setJoinStatus("ended");
      router.replace("/");
    };

    socket.on("room-state", onRoomState);
    socket.on("users-update", onUsersUpdate);
    socket.on("video-state", onVideoState);
    socket.on("chat-message", onChatMessage);
    socket.on("request-state", onRequestState);
    socket.on("blocked-state", onBlockedState);
    socket.on("room-error", onRoomError);
    socket.on("room-ended", onRoomEnded);
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      socket.off("room-state", onRoomState);
      socket.off("users-update", onUsersUpdate);
      socket.off("video-state", onVideoState);
      socket.off("chat-message", onChatMessage);
      socket.off("request-state", onRequestState);
      socket.off("blocked-state", onBlockedState);
      socket.off("room-error", onRoomError);
      socket.off("room-ended", onRoomEnded);
      socket.off("connect", join);
      socket.emit("leave-room");
    };
  }, [addMessage, roomId, router, setIsBlocked, setRoomId, setUsers, setVideoState, socket, username]);

  const handleLeave = () => {
    if (!socket) return;
    socket.emit("leave-room");
    router.push("/");
  };

  const handleEndRoom = () => {
    socket?.emit("end-room");
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setJoinError("Could not copy the room code. Please copy it manually.");
    }
  };

  if (!socket || joinStatus === "connecting") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] text-white">
        <div className="flex flex-col items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] text-red-300"><Clapperboard size={24} /></span>
          <span className="media-spinner" />
          <p className="text-xs text-zinc-500">Joining your watch room…</p>
        </div>
      </main>
    );
  }

  if (joinStatus === "error" || joinStatus === "ended") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] px-5 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-[#111114] p-8 text-center shadow-2xl">
          <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${joinStatus === "ended" ? "bg-zinc-800 text-zinc-300" : "bg-red-500/10 text-red-300"}`}>
            {joinStatus === "ended" ? <DoorOpen size={23} /> : <Users size={23} />}
          </span>
          <h1 className="mt-5 text-xl font-semibold">{joinStatus === "ended" ? "This watch room has ended" : "Could not join the room"}</h1>
          <p role="alert" className="mt-2 text-sm leading-6 text-zinc-500">{joinStatus === "ended" ? "The host left, so everyone has been returned to the lobby." : joinError}</p>
          <button onClick={() => router.push("/")} className="mt-6 rounded-xl bg-white px-5 py-3 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200">Back to home</button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#09090b] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute -top-64 left-1/3 h-[34rem] w-[34rem] rounded-full bg-red-600/[0.055] blur-[150px]" />

      <header className="relative z-10 flex h-[68px] shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#0b0b0d]/90 px-4 backdrop-blur-xl sm:px-6">
        <Link href="/" aria-label="HomeTheater home" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500 text-white shadow-lg shadow-red-950/30"><Clapperboard size={17} /></span>
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">home<span className="text-red-400">theater</span></span>
        </Link>

        <span className="h-7 w-px bg-white/[0.08]" />
        <button
          type="button"
          onClick={copyCode}
          aria-label="Copy room code"
          className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
        >
          <span className="truncate font-mono text-[11px] tracking-[0.14em] text-zinc-300 sm:text-xs">{roomId}</span>
          {copied ? <Check size={13} className="shrink-0 text-emerald-400" /> : <Copy size={13} className="shrink-0 text-zinc-500" />}
          <span className="hidden text-[10px] text-zinc-500 sm:inline">{copied ? "Copied" : "Copy invite"}</span>
        </button>

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 sm:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[11px] text-zinc-400">{presentCount} here</span>
            {isOwner && <span className="h-3 w-px bg-white/10" />}
            {isOwner && <span className="text-[11px] text-zinc-500">{availableSpots} spots open</span>}
          </div>
          {myUid && <span className="hidden font-mono text-[10px] text-zinc-600 md:inline">ID {myUid}</span>}

          <button
            type="button"
            onClick={isOwner ? handleEndRoom : handleLeave}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors ${isOwner ? "border-red-400/15 bg-red-500/[0.07] text-red-300 hover:border-red-400/30 hover:bg-red-500/15" : "border-white/[0.08] bg-white/[0.035] text-zinc-300 hover:bg-white/[0.08]"}`}
          >
            <DoorOpen size={14} />
            <span className="hidden sm:inline">{isOwner ? "End room" : "Leave"}</span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? "Close room panel" : "Open room panel"}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-zinc-300 transition-colors hover:bg-white/[0.08] lg:hidden"
          >
            {sidebarOpen ? <X size={16} /> : panel === "chat" ? <MessageSquare size={16} /> : <Users size={16} />}
          </button>
        </div>
      </header>

      {isOwner && (
        <div className="relative z-10 flex items-center gap-2 border-b border-white/[0.05] bg-white/[0.015] px-4 py-2 sm:hidden">
          <Users size={13} className="text-zinc-500" />
          <span className="text-[11px] text-zinc-400">{presentCount} of {ROOM_CAPACITY} here</span>
          <span className="ml-auto text-[11px] text-zinc-500">{availableSpots} spots left</span>
        </div>
      )}

      {isBlocked && (
        <p role="status" className="relative z-10 border-b border-amber-400/10 bg-amber-400/[0.06] px-4 py-2.5 text-center text-[11px] text-amber-200">
          The host has temporarily restricted your chat and playback controls.
        </p>
      )}

      <div className="relative flex min-h-0 flex-1 gap-4 p-3 sm:p-4 lg:gap-5 lg:p-5">
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e0e11] shadow-[0_16px_60px_rgba(0,0,0,.25)]">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">
            <span className={`h-1.5 w-1.5 rounded-full ${isBlocked ? "bg-amber-400" : "bg-emerald-400"}`} />
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">{isBlocked ? "Watching" : "Room live"}</span>
            {isOwner && <span className="ml-1 flex items-center gap-1 text-[10px] text-red-300"><ShieldCheck size={12} /> Host controls</span>}
            <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-600"><Users size={12} /> {presentCount}/{ROOM_CAPACITY}</span>
          </div>
          <VideoPlayer socket={socket} isOwner={isOwner} isBlocked={isBlocked} roomId={roomId} onLiveState={publishLiveVideoState} />
        </section>

        <aside className={`fixed inset-0 z-30 flex flex-col bg-[#09090b]/80 p-3 pt-[76px] backdrop-blur-sm transition-all duration-200 lg:static lg:z-auto lg:w-[340px] lg:shrink-0 lg:bg-transparent lg:p-0 lg:pt-0 lg:opacity-100 lg:backdrop-blur-none ${sidebarOpen ? "visible opacity-100" : "invisible opacity-0 lg:visible"}`}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e0e11] shadow-2xl lg:shadow-none">
            <div className="flex h-[54px] shrink-0 items-center gap-1 border-b border-white/[0.07] p-2">
              {(["chat", "users"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPanel(item)}
                  className={`flex h-full flex-1 items-center justify-center gap-2 rounded-xl text-xs font-medium transition-all ${panel === item ? "bg-white/[0.07] text-white" : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300"}`}
                >
                  {item === "chat" ? <MessageSquare size={14} /> : <Users size={14} />}
                  {item === "chat" ? "Chat" : "People"}
                  {item === "users" && <span className="text-[10px] text-zinc-600">{presentCount}</span>}
                </button>
              ))}
              <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Close room panel" className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden"><X size={15} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {panel === "chat" ? <ChatPanel socket={socket} /> : <UserList isOwner={isOwner} socket={socket} />}
            </div>
          </div>
        </aside>
      </div>

      <footer className="relative z-10 hidden h-8 shrink-0 items-center justify-center gap-1.5 border-t border-white/[0.05] text-[9px] text-zinc-700 sm:flex">
        <ShieldCheck size={11} /> Private room <span className="mx-1">·</span> Share the room code to invite friends
      </footer>
    </main>
  );
}
