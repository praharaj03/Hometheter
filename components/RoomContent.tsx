"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Check, Clapperboard, Copy, DoorOpen, ListVideo, MessageSquare, ShieldCheck, Users, X } from "lucide-react";
import type { VideoState, User, ChatMessage, QueueItem, Subtitle } from "@/lib/store";
import { useRoomStore } from "@/lib/store";
import { getServerSocketSnapshot, getSocketSnapshot, sanitizeInput, subscribeToSocket } from "@/lib/socket";
import VideoPlayer from "@/components/VideoPlayer";
import ChatPanel from "@/components/ChatPanel";
import UserList from "@/components/UserList";
import QueuePanel from "@/components/QueuePanel";
import { useSavedName } from "@/lib/session";
import { useDialogFocus } from "@/lib/useDialogFocus";

interface RoomState {
  videoState: Partial<VideoState>;
  users: User[];
  you: { uid: string; isOwner: boolean; isBlocked: boolean };
  hostReconnectUntil: number | null;
  queue: QueueItem[];
  subtitle: Subtitle | null;
}

const ROOM_CAPACITY = 50;

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
    myUid,
    setMyUid,
    setQueue,
    setSubtitle,
  } = useRoomStore();
  const savedName = useSavedName();
  const displayName = username || savedName;
  const [copied, setCopied] = useState(false);
  const [panel, setPanel] = useState<"chat" | "users" | "queue">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [joinStatus, setJoinStatus] = useState<"connecting" | "joined" | "ended" | "error">("connecting");
  const [joinError, setJoinError] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [connection, setConnection] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [hostReconnectUntil, setHostReconnectUntil] = useState<number | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [copyError, setCopyError] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  useDialogFocus(sidebarRef, sidebarOpen, closeSidebar, true);
  const joinedRef = useRef(false);
  const liveVideoState = useRef<() => object>(() => useRoomStore.getState().videoState);
  const presentCount = users.filter((user) => user.isConnected !== false).length;
  const availableSpots = Math.max(ROOM_CAPACITY - presentCount, 0);
  const readyCount = users.filter((user) => user.isConnected !== false && user.isReady).length;
  const me = users.find((user) => user.uid === myUid);

  const publishLiveVideoState = useCallback((provider: (() => object) | null) => {
    liveVideoState.current = provider ?? (() => useRoomStore.getState().videoState);
  }, []);

  useEffect(() => {
    if (!socket) return;
    if (!/^[A-Za-z0-9]{16}$/.test(roomId) || !displayName.trim()) {
      router.replace(`/?tab=join&room=${encodeURIComponent(roomId)}`);
      return;
    }
    const participantKey = `hometheater:${roomId}:participant`;
    let participantToken: string;
    let ownerToken: string | null;
    try {
      participantToken = sessionStorage.getItem(participantKey) || crypto.randomUUID();
      sessionStorage.setItem(participantKey, participantToken);
      ownerToken = sessionStorage.getItem(`hometheater:${roomId}:owner`);
    } catch {
      queueMicrotask(() => { setJoinError("Enable session storage in your browser, then retry."); setJoinStatus("error"); });
      return;
    }
    const name = sanitizeInput(displayName, 32) || "Guest";
    let joinTimer: ReturnType<typeof setTimeout>;
    let ended = false;
    const startTimeout = () => {
      clearTimeout(joinTimer);
      joinTimer = setTimeout(() => {
        setJoinError("The room server is taking too long to respond. Check your connection and retry.");
        if (!joinedRef.current) setJoinStatus("error");
      }, 20_000);
    };
    const join = () => {
      if (ended) return;
      startTimeout();
      socket.emit("join-room", {
        roomId,
        username: name,
        ownerToken,
        createRoom: Boolean(ownerToken),
        participantToken,
      });
    };

    const onRoomState = ({ videoState, users, you, hostReconnectUntil, queue, subtitle }: RoomState) => {
      if (ended) return;
      clearTimeout(joinTimer);
      joinedRef.current = true;
      setRoomId(roomId);
      if (videoState) setVideoState(videoState);
      if (users) setUsers(users);
      if (you) {
        setMyUid(sanitizeInput(you.uid, 8));
        setIsOwner(you.isOwner);
        setIsBlocked(you.isBlocked);
      }
      setHostReconnectUntil(hostReconnectUntil);
      setQueue(queue);
      setSubtitle(subtitle);
      setConnection("connected");
      setJoinError("");
      setJoinStatus("joined");
    };
    const onUsersUpdate = (updatedUsers: User[]) => setUsers(updatedUsers);
    const onVideoState = (state: Partial<VideoState>) => setVideoState(state);
    const onChatMessage = (message: ChatMessage) => addMessage(message);
    const onRequestState = ({ forSocketId }: { forSocketId: string }) => {
      socket.emit("sync-state", { forSocketId, videoState: liveVideoState.current() });
    };
    const onBlockedState = (blocked: boolean) => setIsBlocked(blocked);
    const onRoomError = ({ message }: { message: string }) => {
      if (ended) return;
      clearTimeout(joinTimer);
      setJoinError(message);
      setJoinStatus("error");
    };
    const onRoomEnded = () => {
      ended = true;
      joinedRef.current = false;
      clearTimeout(joinTimer);
      try { sessionStorage.removeItem(`hometheater:${roomId}:owner`); } catch { /* Already ended. */ }
      setJoinStatus("ended");
    };
    const onDisconnect = () => {
      if (ended) return;
      setConnection("reconnecting");
      startTimeout();
    };
    const onConnectError = () => {
      if (ended) return;
      setConnection("reconnecting");
      setJoinError("Could not connect to the room server. Check your connection and retry.");
      if (!joinedRef.current) setJoinStatus("error");
    };
    const onPresence = ({ hostReconnectUntil }: { hostReconnectUntil: number | null }) => setHostReconnectUntil(hostReconnectUntil);

    socket.on("room-state", onRoomState);
    socket.on("users-update", onUsersUpdate);
    socket.on("video-state", onVideoState);
    socket.on("chat-message", onChatMessage);
    socket.on("request-state", onRequestState);
    socket.on("blocked-state", onBlockedState);
    socket.on("room-error", onRoomError);
    socket.on("room-ended", onRoomEnded);
    socket.on("connect", join);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room-presence", onPresence);
    socket.on("queue-update", setQueue);
    socket.on("subtitle-update", setSubtitle);
    startTimeout();
    if (socket.connected) join();
    else socket.connect();

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
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room-presence", onPresence);
      socket.off("queue-update", setQueue);
      socket.off("subtitle-update", setSubtitle);
      clearTimeout(joinTimer);
      if (socket.connected) socket.emit("leave-room", { temporary: true });
    };
  }, [addMessage, roomId, router, setIsBlocked, setMyUid, setRoomId, setUsers, setVideoState, setQueue, setSubtitle, socket, displayName, retryAttempt]);

  const retry = () => {
    setJoinError("");
    if (!joinedRef.current) setJoinStatus("connecting");
    setRetryAttempt((attempt) => attempt + 1);
  };

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
      await navigator.clipboard.writeText(`${window.location.origin}/?tab=join&room=${encodeURIComponent(roomId)}`);
      setCopyError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Could not copy the invite. Share the room code shown above instead.");
    }
  };

  if (joinStatus === "connecting") {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[#09090b] text-white">
        <div className="flex flex-col items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] text-red-300"><Clapperboard size={24} /></span>
          <span className="media-spinner" />
          <p className="text-xs text-zinc-500">Joining your watch room…</p>
          <button onClick={() => router.push("/")} className="rounded-lg px-4 py-2 text-xs text-zinc-300">Back to home</button>
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
          <p role="alert" className="mt-2 text-sm leading-6 text-zinc-400">{joinStatus === "ended" ? "The host ended the room or did not reconnect in time." : joinError}</p>
          {joinStatus === "error" && <button onClick={retry} className="mt-6 mr-3 rounded-xl bg-red-500 px-5 py-3 text-xs font-semibold text-white">Retry connection</button>}
          <button onClick={() => router.push("/")} className="mt-6 rounded-xl bg-white px-5 py-3 text-xs font-semibold text-zinc-950 transition-colors hover:bg-zinc-200">Back to home</button>
        </div>
      </main>
    );
  }

  if (!socket) return null;

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
          aria-label="Copy invite link"
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
            disabled={connection !== "connected"}
            aria-label={isOwner ? "End room" : "Leave room"}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors ${isOwner ? "border-red-400/15 bg-red-500/[0.07] text-red-300 hover:border-red-400/30 hover:bg-red-500/15" : "border-white/[0.08] bg-white/[0.035] text-zinc-300 hover:bg-white/[0.08]"}`}
          >
            <DoorOpen size={14} />
            <span className="hidden sm:inline">{isOwner ? "End room" : "Leave"}</span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? "Close room panel" : "Open room panel"}
            aria-expanded={sidebarOpen}
            aria-controls="room-panel"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-zinc-300 transition-colors hover:bg-white/[0.08] lg:hidden"
          >
            {sidebarOpen ? <X size={16} /> : panel === "chat" ? <MessageSquare size={16} /> : <Users size={16} />}
          </button>
        </div>
      </header>

      {copyError && <p role="alert" className="px-4 py-2 text-xs text-amber-200">{copyError}</p>}
      {connection !== "connected" && (
        <div role="status" className="flex flex-wrap items-center justify-center gap-3 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
          {joinError || "Connection lost. Reconnecting to your room…"}
          <button onClick={retry} className="rounded-lg border border-amber-200/30 px-3 py-2">Retry connection</button>
          <button onClick={() => router.push("/")} className="rounded-lg px-3 py-2">Leave</button>
        </div>
      )}
      {hostReconnectUntil && connection === "connected" && <p role="status" className="bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-200">Host reconnecting. Playback is paused; their place is reserved for up to 60 seconds.</p>}

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
            <span className={`h-1.5 w-1.5 rounded-full ${connection !== "connected" || hostReconnectUntil || isBlocked ? "bg-amber-400" : "bg-emerald-400"}`} />
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-400">{connection !== "connected" ? "Reconnecting" : hostReconnectUntil ? "Host reconnecting" : isBlocked ? "Watching" : "Room live"}</span>
            {isOwner && <span className="ml-1 flex items-center gap-1 text-[10px] text-red-300"><ShieldCheck size={12} /> Host controls</span>}
            <button onClick={() => socket.emit("set-ready", { ready: !me?.isReady })} disabled={isBlocked || connection !== "connected"} aria-pressed={Boolean(me?.isReady)} className="ml-auto rounded-lg border border-white/10 px-2 py-1 text-[11px] text-zinc-200 disabled:opacity-40">{me?.isReady ? "✓ Ready" : "I'm ready"} · {readyCount}/{presentCount}</button>
          </div>
          <VideoPlayer socket={socket} isOwner={isOwner} isBlocked={isBlocked} connected={connection === "connected"} roomId={roomId} onLiveState={publishLiveVideoState} />
        </section>

        <aside ref={sidebarRef} id="room-panel" aria-label="Room chat, people, and queue" tabIndex={-1} className={`fixed inset-0 z-30 flex flex-col bg-[#09090b]/80 p-3 pt-[76px] backdrop-blur-sm transition-all duration-200 lg:static lg:z-auto lg:w-[340px] lg:shrink-0 lg:bg-transparent lg:p-0 lg:pt-0 lg:opacity-100 lg:backdrop-blur-none ${sidebarOpen ? "visible opacity-100" : "invisible opacity-0 lg:visible"}`}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e0e11] shadow-2xl lg:shadow-none">
            <div className="flex h-[54px] shrink-0 items-center gap-1 border-b border-white/[0.07] p-2">
              {(["chat", "users", "queue"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPanel(item)}
                  aria-pressed={panel === item}
                  className={`flex h-full flex-1 items-center justify-center gap-2 rounded-xl text-xs font-medium transition-all ${panel === item ? "bg-white/[0.07] text-white" : "text-zinc-500 hover:bg-white/[0.035] hover:text-zinc-300"}`}
                >
                  {item === "chat" ? <MessageSquare size={14} /> : item === "users" ? <Users size={14} /> : <ListVideo size={14} />}
                  {item === "chat" ? "Chat" : item === "users" ? "People" : "Queue"}
                  {item === "users" && <span className="text-[10px] text-zinc-600">{presentCount}</span>}
                </button>
              ))}
              <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Close room panel" className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden"><X size={15} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {panel === "chat" ? <ChatPanel socket={socket} connected={connection === "connected"} /> : panel === "users" ? <UserList isOwner={isOwner} socket={socket} connected={connection === "connected"} /> : <QueuePanel socket={socket} isOwner={isOwner} connected={connection === "connected"} />}
            </div>
          </div>
        </aside>
      </div>

      <footer className="relative z-10 hidden h-8 shrink-0 items-center justify-center gap-1.5 border-t border-white/[0.05] text-[9px] text-zinc-700 sm:flex">
        <ShieldCheck size={11} /> Private room <span className="mx-1">·</span> Copy an invite link to bring your friends
      </footer>
    </main>
  );
}
