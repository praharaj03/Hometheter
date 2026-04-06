"use client";
import { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { useRoomStore, VideoState } from "@/lib/store";
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Maximize, Upload, Link as LinkIcon, Gauge
} from "lucide-react";

interface Props {
  socket: Socket;
  isOwner: boolean;
  getLiveState?: React.MutableRefObject<() => object>;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
  } catch {}
  return null;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export default function VideoPlayer({ socket, isOwner, getLiveState }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const { videoState, setVideoState } = useRoomStore();
  const [localSrc, setLocalSrc] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ytSyncInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSyncing = useRef(false);

  const ytId = getYouTubeId(videoState.src);
  const isYouTube = !!ytId;

  // Always expose live currentTime for new joiners
  useEffect(() => {
    if (!getLiveState) return;
    getLiveState.current = () => ({
      ...videoState,
      currentTime: isYouTube
        ? (ytPlayerRef.current?.getCurrentTime?.() ?? videoState.currentTime)
        : (videoRef.current?.currentTime ?? videoState.currentTime),
    });
  });

  const emit = (state: Partial<VideoState>) => {
    socket.emit("video-state", state);
  };

  // Load YouTube IFrame API
  useEffect(() => {
    if (!isYouTube) return;
    if (window.YT) return;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }, [isYouTube]);

  // Create/update YouTube player
  useEffect(() => {
    if (!isYouTube || !ytId) return;

    const initPlayer = () => {
      if (!ytContainerRef.current) return;
      if (ytPlayerRef.current) {
        ytPlayerRef.current.loadVideoById(ytId);
        if (!videoState.playing) ytPlayerRef.current.pauseVideo();
        return;
      }
      ytPlayerRef.current = new window.YT.Player(ytContainerRef.current, {
        videoId: ytId,
        playerVars: { autoplay: 0, controls: isOwner ? 1 : 0, rel: 0 },
        events: {
          onReady: (e: any) => {
            setDuration(e.target.getDuration());
            if (videoState.currentTime > 0) e.target.seekTo(videoState.currentTime, true);
          },
          onStateChange: (e: any) => {
            if (!isOwner) return;
            const YT = window.YT.PlayerState;
            if (e.data === YT.PLAYING) emit({ playing: true, currentTime: ytPlayerRef.current.getCurrentTime() });
            if (e.data === YT.PAUSED) emit({ playing: false, currentTime: ytPlayerRef.current.getCurrentTime() });
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (ytSyncInterval.current) clearInterval(ytSyncInterval.current);
    };
  }, [ytId, isOwner]);

  // Sync YouTube player state for participants
  useEffect(() => {
    if (!isYouTube || !ytPlayerRef.current) return;
    const p = ytPlayerRef.current;
    if (typeof p.seekTo !== "function") return;

    if (Math.abs(p.getCurrentTime() - videoState.currentTime) > 1) {
      p.seekTo(videoState.currentTime, true);
    }
    if (videoState.playing && p.getPlayerState() !== window.YT?.PlayerState?.PLAYING) {
      p.playVideo();
    }
    if (!videoState.playing && p.getPlayerState() === window.YT?.PlayerState?.PLAYING) {
      p.pauseVideo();
    }
  }, [videoState, isYouTube]);

  // Sync incoming state (non-YouTube) — runs for ALL clients including owner
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoState.src || isYouTube) return;

    // For participants: set src imperatively
    if (!isOwner && videoState.src.startsWith("http") && isSafeUrl(videoState.src)) {
      const currentSrc = v.getAttribute("data-synced-src");
      if (currentSrc !== videoState.src) {
        v.src = videoState.src;
        v.setAttribute("data-synced-src", videoState.src);
        v.load();
        return;
      }
    }

    isSyncing.current = true;
    if (Math.abs(v.currentTime - videoState.currentTime) > 1) {
      v.currentTime = videoState.currentTime;
    }
    if (videoState.playing && v.paused) {
      v.play().catch(() => {}).finally(() => { isSyncing.current = false; });
    } else if (!videoState.playing && !v.paused) {
      v.pause();
      isSyncing.current = false;
    } else {
      isSyncing.current = false;
    }
    v.playbackRate = videoState.speed;
  }, [videoState, isOwner, isYouTube]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLocalSrc(url);
    if (videoRef.current) videoRef.current.src = url;
    emit({ src: file.name, playing: false, currentTime: 0 });
  };

  const handleUrlLoad = () => {
    if (!urlInput.trim()) return;
    emit({ src: urlInput.trim(), playing: false, currentTime: 0 });
    setShowUrlInput(false);
    setUrlInput("");
  };

  const togglePlay = () => {
    const playing = !videoState.playing;
    const currentTime = videoRef.current?.currentTime ?? videoState.currentTime;
    emit({ playing, currentTime });
  };

  const seek = (delta: number) => {
    if (!isOwner) return;
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    v.currentTime = t;
    emit({ currentTime: t });
  };

  const handleSeekBar = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isOwner) return;
    const t = parseFloat(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = t;
    emit({ currentTime: t });
  };

  const setSpeed = (s: number) => {
    if (!isOwner) return;
    if (videoRef.current) videoRef.current.playbackRate = s;
    emit({ speed: s });
    setShowSpeedMenu(false);
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const showControlsTemporarily = () => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  };

  const hasSrc = !!(isYouTube || (isOwner ? (localSrc || videoState.src) : videoState.src?.startsWith("http")));

  return (
    <div className="flex-1 flex flex-col bg-black relative overflow-hidden">
      {/* Source controls (owner only) */}
      {isOwner && (
        <div className="absolute top-3 left-3 z-20 flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 bg-zinc-900/80 backdrop-blur border border-zinc-700 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer hover:border-zinc-500 transition-all">
            <Upload size={13} />
            <span className="hidden sm:inline">Local File</span>
            <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
          </label>
          <button
            onClick={() => setShowUrlInput((v) => !v)}
            className="flex items-center gap-1.5 bg-zinc-900/80 backdrop-blur border border-zinc-700 px-2.5 py-1.5 rounded-lg text-xs hover:border-zinc-500 transition-all"
          >
            <LinkIcon size={13} /> <span className="hidden sm:inline">URL</span>
          </button>
          {showUrlInput && (
            <div className="flex gap-1 w-full sm:w-auto">
              <input
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs outline-none w-full sm:w-56 focus:border-zinc-500"
                placeholder="Paste video URL..."
                value={urlInput}
                maxLength={2048}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlLoad()}
              />
              <button onClick={handleUrlLoad} className="bg-white text-black px-3 py-1.5 rounded-lg text-xs font-medium shrink-0">
                Load
              </button>
            </div>
          )}
        </div>
      )}

      {/* Video */}
      <div
        className="flex-1 flex items-center justify-center cursor-pointer relative"
        onMouseMove={showControlsTemporarily}
        onClick={isYouTube ? undefined : togglePlay}
      >
        {!hasSrc && (
          <div className="text-zinc-600 text-center">
            <div className="text-6xl mb-3">🎬</div>
            <p className="text-sm">{isOwner ? "Load a video to start" : "Waiting for owner to load a video..."}</p>
          </div>
        )}
        {isYouTube ? (
          <div ref={ytContainerRef} className="w-full h-full" />
        ) : (
          <video
            ref={videoRef}
            className="max-h-full max-w-full"
            src={isOwner ? (localSrc || (videoState.src && isSafeUrl(videoState.src) ? videoState.src : undefined)) : undefined}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (!v) return;
              setDuration(v.duration);
              isSyncing.current = true;
              if (videoState.currentTime > 0) v.currentTime = videoState.currentTime;
              if (videoState.playing) v.play().catch(() => {}).finally(() => { isSyncing.current = false; });
              else { v.pause(); isSyncing.current = false; }
              v.playbackRate = videoState.speed;
            }}
            onPlay={() => { if (!isSyncing.current) emit({ playing: true, currentTime: videoRef.current?.currentTime ?? 0 }); }}
            onPause={() => { if (!isSyncing.current) emit({ playing: false, currentTime: videoRef.current?.currentTime ?? 0 }); }}
          />
        )}
      </div>

      {/* Controls (non-YouTube only) */}
      {hasSrc && !isYouTube && (
        <div
          className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-3 sm:px-4 pb-3 sm:pb-4 pt-8 transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
          onMouseEnter={() => setShowControls(true)}
        >
          {/* Seek bar */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            onChange={handleSeekBar}
            disabled={!isOwner}
            className="w-full h-1.5 accent-white mb-3 cursor-pointer disabled:cursor-default disabled:opacity-40"
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <button onClick={() => seek(-10)} disabled={!isOwner} className="p-1.5 text-zinc-300 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-default">
                <SkipBack size={20} />
              </button>
              <button onClick={togglePlay} className="p-1.5 text-white hover:scale-110 transition-transform">
                {videoState.playing ? <Pause size={26} /> : <Play size={26} />}
              </button>
              <button onClick={() => seek(10)} disabled={!isOwner} className="p-1.5 text-zinc-300 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-default">
                <SkipForward size={20} />
              </button>

              <div className="flex items-center gap-1.5">
                <button onClick={() => setMuted((m) => !m)} className="p-1.5 text-zinc-300 hover:text-white">
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setVolume(v);
                    if (videoRef.current) videoRef.current.volume = v;
                    setMuted(v === 0);
                  }}
                  className="w-14 sm:w-20 h-1.5 accent-white cursor-pointer"
                />
              </div>

              <span className="text-[10px] sm:text-xs text-zinc-400 font-mono">
                {fmt(currentTime)} / {fmt(duration)}
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 relative">
              <button
                onClick={() => isOwner && setShowSpeedMenu((v) => !v)}
                disabled={!isOwner}
                className="hidden sm:flex items-center gap-1 text-xs text-zinc-300 hover:text-white disabled:opacity-30 disabled:cursor-default"
              >
                <Gauge size={15} /> {videoState.speed}x
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-8 right-8 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl z-10">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpeed(s)}
                      className={`block w-full px-4 py-2 text-xs text-left hover:bg-zinc-800 transition-colors ${
                        videoState.speed === s ? "text-white font-bold" : "text-zinc-400"
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => videoRef.current?.requestFullscreen()}
                className="p-1.5 text-zinc-300 hover:text-white"
              >
                <Maximize size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
