"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { Copy, Check, DoorOpen, MessageSquare, Users } from "lucide-react";
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

export default function RoomContent() {
  const { id: roomId } = useParams<{ id: string }>();
  const router = useRouter();
  const socket = useSyncExternalStore(subscribeToSocket, getSocketSnapshot, getServerSocketSnapshot);
  const {
    username,
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
    const onUsersUpdate = (users: User[]) => setUsers(users);
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
  }, [addMessage, roomId, setIsBlocked, setRoomId, setUsers, setVideoState, socket, username]);

  const handleLeave = () => {
    if (!socket) return;
    socket.emit("leave-room");
    router.push("/");
  };

  const handleEndRoom = () => {
    if (!socket) return;
    socket.emit("end-room");
    router.push("/");
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
    return <div className="h-screen bg-[#0a0a0a] flex items-center justify-center text-zinc-500">Connecting to room...</div>;
  }

  if (joinStatus === "error" || joinStatus === "ended") {
    return (
      <div className="h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-lg font-semibold">{joinStatus === "ended" ? "The room has ended" : "Could not join room"}</p>
        <p role="alert" className="text-zinc-500 text-sm">
          {joinStatus === "ended" ? "The owner closed the room." : joinError}
        </p>
        <button onClick={() => router.push("/")} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm">Back to home</button>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-[#0a0a0a] text-white flex flex-col overflow-hidden">
      <div className="blur-orb blur-orb-1" />
      <div className="blur-orb blur-orb-2" />
      <div className="blur-orb blur-orb-3" />

      <header className="flex items-center gap-2 px-3 sm:px-5 py-2.5 border-b border-zinc-800 shrink-0 z-10">
        <span className="text-xl sm:text-2xl shrink-0" style={{ fontFamily: "var(--font-bebas)", color: "#E50914", letterSpacing: "0.12em", textShadow: "0 0 30px rgba(229,9,20,0.4)" }}>
          HT
        </span>
        <button
          onClick={copyCode}
          className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 px-2 py-1 rounded-lg text-[10px] sm:text-xs font-mono hover:border-zinc-500 transition-all min-w-0"
        >
          <span className="truncate max-w-[80px] sm:max-w-none tracking-widest text-zinc-300">{roomId}</span>
          {copied ? <Check size={11} className="text-green-400 shrink-0" /> : <Copy size={11} className="text-zinc-500 shrink-0" />}
        </button>
        {myUid && (
          <span className="hidden sm:inline text-[10px] font-mono bg-zinc-800 border border-zinc-700 text-zinc-400 px-2 py-1 rounded-lg shrink-0">
            ID: {myUid}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isOwner ? (
            <button onClick={handleEndRoom} className="flex items-center gap-1 bg-red-900/60 hover:bg-red-800 border border-red-700 px-2 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs text-red-300 transition-all">
              <DoorOpen size={12} />
              <span className="hidden sm:inline">End Room</span>
            </button>
          ) : (
            <button onClick={handleLeave} className="flex items-center gap-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-2 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs text-zinc-300 transition-all">
              <DoorOpen size={12} />
              <span className="hidden sm:inline">Leave</span>
            </button>
          )}
          <button
            onClick={() => setSidebarOpen((open) => !open)}
            className="lg:hidden flex items-center gap-1 bg-zinc-900 border border-zinc-700 px-2 py-1.5 rounded-lg text-zinc-300 hover:border-zinc-500 transition-all"
          >
            {panel === "chat" ? <MessageSquare size={14} /> : <Users size={14} />}
          </button>
        </div>
      </header>

      {isBlocked && (
        <p role="status" className="bg-amber-950/80 px-4 py-2 text-center text-xs text-amber-200">
          The room owner has temporarily restricted your chat and controls.
        </p>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <VideoPlayer socket={socket} isOwner={isOwner} roomId={roomId} onLiveState={publishLiveVideoState} />
        </div>
        <aside className={`
          absolute inset-0 z-20 lg:static lg:z-auto
          lg:w-80 lg:flex lg:flex-col lg:border-l lg:border-zinc-800 lg:shrink-0
          ${sidebarOpen ? "flex flex-col" : "hidden lg:flex"}
          bg-[#0a0a0a]/95 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none
        `}>
          <div className="flex lg:hidden items-center justify-between px-4 py-2 border-b border-zinc-800">
            <span className="text-xs text-zinc-400">Room Panel</span>
            <button onClick={() => setSidebarOpen(false)} className="text-zinc-500 hover:text-white text-lg leading-none">✕</button>
          </div>
          <div className="flex border-b border-zinc-800 shrink-0">
            {(["chat", "users"] as const).map((item) => (
              <button
                key={item}
                onClick={() => setPanel(item)}
                className={`flex-1 py-2.5 text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  panel === item ? "text-white border-b-2 border-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {item === "chat" ? <><MessageSquare size={12} /> Chat</> : <><Users size={12} /> Participants</>}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            {panel === "chat" ? <ChatPanel socket={socket} /> : <UserList isOwner={isOwner} socket={socket} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
