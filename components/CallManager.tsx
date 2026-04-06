"use client";
import { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { Mic, MicOff, Video, VideoOff, Phone, PhoneOff } from "lucide-react";
import SimplePeer from "simple-peer";

interface Props {
  socket: Socket;
  roomId: string;
}

interface PeerEntry {
  peerId: string;
  peer: SimplePeer.Instance;
}

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      className="w-32 h-24 rounded-xl object-cover border border-zinc-700 bg-zinc-900"
    />
  );
}

export default function CallManager({ socket, roomId }: Props) {
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<{ id: string; stream: MediaStream }[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<PeerEntry[]>([]);

  const destroyPeer = (id: string) => {
    const entry = peersRef.current.find((p) => p.peerId === id);
    if (entry) { try { entry.peer.destroy(); } catch {} }
    peersRef.current = peersRef.current.filter((p) => p.peerId !== id);
    setRemoteStreams((prev) => prev.filter((s) => s.id !== id));
  };

  const createPeer = (targetId: string, initiator: boolean, stream: MediaStream) => {
    // destroy existing peer for this target if any
    destroyPeer(targetId);

    const peer = new SimplePeer({ initiator, stream, trickle: true });

    peer.on("signal", (signal) => {
      socket.emit("signal", { to: targetId, signal });
    });

    peer.on("stream", (remoteStream) => {
      setRemoteStreams((prev) => {
        const exists = prev.find((s) => s.id === targetId);
        if (exists) return prev.map((s) => s.id === targetId ? { ...s, stream: remoteStream } : s);
        return [...prev, { id: targetId, stream: remoteStream }];
      });
    });

    peer.on("close", () => destroyPeer(targetId));
    peer.on("error", () => destroyPeer(targetId));

    peersRef.current.push({ peerId: targetId, peer });
    return peer;
  };

  useEffect(() => {
    const onCallUser = ({ from, callerIds }: { from: string; callerIds: string[] }) => {
      // Someone joined the call — if we're in the call, initiate peer to them
      if (!localStreamRef.current) return;
      createPeer(from, true, localStreamRef.current);
    };

    const onSignal = ({ from, signal }: { from: string; signal: SimplePeer.SignalData }) => {
      if (!localStreamRef.current) return;
      let entry = peersRef.current.find((p) => p.peerId === from);
      if (!entry) {
        // We received a signal before creating a peer — create non-initiator peer
        createPeer(from, false, localStreamRef.current);
        entry = peersRef.current.find((p) => p.peerId === from);
      }
      try { entry?.peer.signal(signal); } catch {}
    };

    const onCallLeave = ({ id }: { id: string }) => {
      destroyPeer(id);
    };

    socket.on("call-user", onCallUser);
    socket.on("signal", onSignal);
    socket.on("call-leave", onCallLeave);

    return () => {
      socket.off("call-user", onCallUser);
      socket.off("signal", onSignal);
      socket.off("call-leave", onCallLeave);
    };
  }, [socket]);

  const joinCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      // Tell everyone in the room we joined the call
      socket.emit("call-join", { roomId });
      setInCall(true);
    } catch (err) {
      alert("Could not access camera/microphone.");
    }
  };

  const leaveCall = () => {
    peersRef.current.forEach(({ peer }) => { try { peer.destroy(); } catch {} });
    peersRef.current = [];
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setRemoteStreams([]);
    setInCall(false);
    socket.emit("call-leave", { roomId });
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = muted));
    setMuted((m) => !m);
  };

  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = videoOff));
    setVideoOff((v) => !v);
  };

  return (
    <div className="flex items-center gap-2">
      {inCall && (
        <>
          <button
            onClick={toggleMute}
            className={`p-2 rounded-xl border transition-all ${
              muted ? "bg-red-500/20 border-red-500/50 text-red-400" : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            {muted ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
          <button
            onClick={toggleVideo}
            className={`p-2 rounded-xl border transition-all ${
              videoOff ? "bg-red-500/20 border-red-500/50 text-red-400" : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            {videoOff ? <VideoOff size={15} /> : <Video size={15} />}
          </button>
        </>
      )}

      <button
        onClick={inCall ? leaveCall : joinCall}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
          inCall
            ? "bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500/30"
            : "bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30"
        }`}
      >
        {inCall ? <><PhoneOff size={13} /> Leave</> : <><Phone size={13} /> Join Call</>}
      </button>

      {inCall && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-32 h-24 rounded-xl object-cover border border-zinc-700 bg-zinc-900"
          />
          {remoteStreams.map(({ id, stream }) => (
            <RemoteVideo key={id} stream={stream} />
          ))}
        </div>
      )}
    </div>
  );
}
