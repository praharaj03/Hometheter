"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getSocket, joinRoom, resetJoin, onKickedOrEnded, sanitizeInput } from "@/lib/socket";
import { useRoomStore } from "@/lib/store";
import VideoPlayer from "@/components/VideoPlayer";
import ChatPanel from "@/components/ChatPanel";
import UserList from "@/components/UserList";
import CallManager from "@/components/CallManager";
import { useRouter } from "next/navigation";
import { Copy, Check, DoorOpen, MessageSquare, Users } from "lucide-react";

export default function RoomContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = params.id as string;
  const isOwner = searchParams.get("owner") === "true";

  const router = useRouter();
  const { username, setUsername, setRoomId, setUsers, addMessage, setVideoState, videoState } = useRoomStore();
  const [copied, setCopied] = useState(false);
  const [panel, setPanel] = useState<"chat" | "users">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [joinStatus, setJoinStatus] = useState<"kicked" | "ended" | "joined">("joined");
  const [myUid, setMyUid] = useState("");
  const socketRef = useRef(getSocket());
  const getLiveVideoState = useRef<() => object>(() => videoState);

  useEffect(() => {
    onKickedOrEnded(
      () => { resetJoin(roomId); setJoinStatus("kicked"); },
      () => { resetJoin(roomId); if (isOwner) { router.push("/?tab=create"); } else { setJoinStatus("ended"); } }
    );
  }, [roomId, isOwner]);

  useEffect(() => {
    const socket = socketRef.current;
    setRoomId(roomId);

    const onRoomState = ({ videoState: vs, users, uid }: { videoState: Partial<import("@/lib/store").VideoState>; users: import("@/lib/store").User[]; uid: string }) => {
      if (vs) setVideoState(vs);
      if (users) setUsers(users);
      if (uid) setMyUid(sanitizeInput(uid, 8));
    };
    const onUsersUpdate = (users: import("@/lib/store").User[]) => { if (users) setUsers(users); };
    const onVideoState = (s: Partial<import("@/lib/store").VideoState>) => { if (s) setVideoState(s); };
    const onChatMessage = (m: import("@/lib/store").ChatMessage) => { if (m) addMessage(m); };
    const onRequestState = ({ forSocketId }: { forSocketId: string }) => {
      socket.emit("sync-state", { forSocketId, videoState: getLiveVideoState.current() });
    };

    socket.on("room-state", onRoomState);
    socket.on("users-update", onUsersUpdate);
    socket.on("video-state", onVideoState);
    socket.on("chat-message", onChatMessage);
    socket.on("request-state", onRequestState);

    const name = username || "Guest_" + Math.random().toString(36).slice(2, 6);
    if (!username) setUsername(name);
    joinRoom(roomId, { roomId, username: name, isOwner });

    return () => {
      socket.off("room-state", onRoomState);
      socket.off("users-update", onUsersUpdate);
      socket.off("video-state", onVideoState);
      socket.off("chat-message", onChatMessage);
      socket.off("request-state", onRequestState);
    };
  }, [roomId]);

  const copyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (joinStatus === "kicked") {
    return (
      <div className="h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-5xl">👢</div>
        <p className="text-lg font-semibold">You were removed from the room</p>
      </div>
    );
  }

  if (joinStatus === "ended") {
    return (
      <div className="h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-5xl">🎬</div>
        <p className="text-lg font-semibold">The room has ended</p>
        <p className="text-zinc-500 text-sm">The owner closed the room.</p>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-[#0a0a0a] text-white flex flex-col overflow-hidden">
      {/* Ambient blur orbs */}
      <div className="blur-orb blur-orb-1" />
      <div className="blur-orb blur-orb-2" />
      <div className="blur-orb blur-orb-3" />

      {/* Header */}
      <header className="flex items-center gap-2 px-3 sm:px-5 py-2.5 border-b border-zinc-800 shrink-0 z-10">
        <span className="text-xl sm:text-2xl shrink-0" style={{ fontFamily: "var(--font-bebas)", color: "#E50914", letterSpacing: "0.12em", textShadow: "0 0 30px rgba(229,9,20,0.4)" }}>
          HT
        </span>

        {/* Room code */}
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
          <CallManager socket={socketRef.current} roomId={roomId} />
          {isOwner ? (
            <button
              onClick={() => socketRef.current.emit("end-room")}
              className="flex items-center gap-1 bg-red-900/60 hover:bg-red-800 border border-red-700 px-2 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs text-red-300 transition-all"
            >
              <DoorOpen size={12} />
              <span className="hidden sm:inline">End Room</span>
            </button>
          ) : (
            <button
              onClick={() => { socketRef.current.emit("leave-room"); resetJoin(roomId); router.push("/"); }}
              className="flex items-center gap-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 px-2 sm:px-3 py-1.5 rounded-lg text-[10px] sm:text-xs text-zinc-300 transition-all"
            >
              <DoorOpen size={12} />
              <span className="hidden sm:inline">Leave</span>
            </button>
          )}
          {/* Mobile sidebar toggle */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="lg:hidden flex items-center gap-1 bg-zinc-900 border border-zinc-700 px-2 py-1.5 rounded-lg text-zinc-300 hover:border-zinc-500 transition-all"
          >
            {panel === "chat" ? <MessageSquare size={14} /> : <Users size={14} />}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Video — full width on mobile, flex-1 on desktop */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <VideoPlayer socket={socketRef.current} isOwner={isOwner} getLiveState={getLiveVideoState} />
        </div>

        {/* Sidebar — hidden on mobile unless toggled, fixed on desktop */}
        <aside className={`
          absolute inset-0 z-20 lg:static lg:z-auto
          lg:w-80 lg:flex lg:flex-col lg:border-l lg:border-zinc-800 lg:shrink-0
          ${sidebarOpen ? "flex flex-col" : "hidden lg:flex"}
          bg-[#0a0a0a]/95 backdrop-blur-sm lg:bg-transparent lg:backdrop-blur-none
        `}>
          {/* Mobile close bar */}
          <div className="flex lg:hidden items-center justify-between px-4 py-2 border-b border-zinc-800">
            <span className="text-xs text-zinc-400">Room Panel</span>
            <button onClick={() => setSidebarOpen(false)} className="text-zinc-500 hover:text-white text-lg leading-none">✕</button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-zinc-800 shrink-0">
            {(["chat", "users"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPanel(p)}
                className={`flex-1 py-2.5 text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  panel === p ? "text-white border-b-2 border-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p === "chat" ? <><MessageSquare size={12} /> Chat</> : <><Users size={12} /> Participants</>}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {panel === "chat" ? (
              <ChatPanel socket={socketRef.current} />
            ) : (
              <UserList isOwner={isOwner} socket={socketRef.current} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
