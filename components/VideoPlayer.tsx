"use client";
import { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { useRoomStore, VideoState } from "@/lib/store";
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Maximize, Upload, Link as LinkIcon, Gauge, X
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
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0];
  } catch {}
  return null;
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function fmt(s: number): string {
  if (!isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

declare global {
  interface Window { YT: any; onYouTubeIframeAPIReady: () => void; }
}

export default function VideoPlayer({ socket, isOwner, getLiveState }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncing = useRef(false);

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
  const [videoError, setVideoError] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const ytId = getYouTubeId(videoState.src);
  const isYouTube = !!ytId;
  const hasSrc = !!(isYouTube || localSrc || (videoState.src && isSafeUrl(videoState.src)));

  // Expose live state for new joiners
  useEffect(() => {
    if (!getLiveState) return;
    getLiveState.current = () => ({
      ...videoState,
      currentTime: isYouTube
        ? (ytPlayerRef.current?.getCurrentTime?.() ?? videoState.currentTime)
        : (videoRef.current?.currentTime ?? videoState.currentTime),
    });
  });

  const emit = (state: Partial<VideoState>) => socket.emit("video-state", state);

  // ── YouTube IFrame API ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isYouTube || window.YT) return;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }, [isYouTube]);

  useEffect(() => {
    if (!isYouTube || !ytId) return;
    const init = () => {
      if (!ytContainerRef.current) return;
      if (ytPlayerRef.current) {
        ytPlayerRef.current.loadVideoById(ytId);
        if (!videoState.playing) setTimeout(() => ytPlayerRef.current?.pauseVideo(), 500);
        return;
      }
      ytPlayerRef.current = new window.YT.Player(ytContainerRef.current, {
        videoId: ytId,
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e: any) => {
            setDuration(e.target.getDuration());
            if (videoState.currentTime > 0) e.target.seekTo(videoState.currentTime, true);
          },
          onStateChange: (e: any) => {
            if (!isOwner) return;
            const S = window.YT.PlayerState;
            if (e.data === S.PLAYING) emit({ playing: true, currentTime: ytPlayerRef.current.getCurrentTime() });
            if (e.data === S.PAUSED) emit({ playing: false, currentTime: ytPlayerRef.current.getCurrentTime() });
          },
        },
      });
    };
    if (window.YT?.Player) init();
    else window.onYouTubeIframeAPIReady = init;
  }, [ytId, isOwner]);

  // Sync YouTube state
  useEffect(() => {
    if (!isYouTube || !ytPlayerRef.current) return;
    const p = ytPlayerRef.current;
    if (typeof p.seekTo !== "function") return;
    if (Math.abs(p.getCurrentTime() - videoState.currentTime) > 1.5) p.seekTo(videoState.currentTime, true);
    if (videoState.playing && p.getPlayerState() !== window.YT?.PlayerState?.PLAYING) p.playVideo();
    if (!videoState.playing && p.getPlayerState() === window.YT?.PlayerState?.PLAYING) p.pauseVideo();
  }, [videoState, isYouTube]);

  // Sync non-YouTube state
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoState.src || isYouTube) return;

    if (!isOwner && isSafeUrl(videoState.src)) {
      const synced = v.getAttribute("data-synced-src");
      if (synced !== videoState.src) {
        setVideoError("");
        v.src = videoState.src;
        v.setAttribute("data-synced-src", videoState.src);
        v.load();
        return;
      }
    }

    isSyncing.current = true;
    if (Math.abs(v.currentTime - videoState.currentTime) > 1.5) v.currentTime = videoState.currentTime;
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

  // Fullscreen change listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLocalSrc(url);
    setVideoError("");
    if (videoRef.current) { videoRef.current.src = url; videoRef.current.load(); }
    emit({ src: file.name, playing: false, currentTime: 0 });
  };

  const handleUrlLoad = () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!isSafeUrl(url)) { setVideoError("Please enter a valid http/https URL."); return; }
    setVideoError("");
    setDuration(0);
    setCurrentTime(0);
    setLocalSrc("");
    emit({ src: url, playing: false, currentTime: 0 });
    setShowUrlInput(false);
    setUrlInput("");
  };

  const togglePlay = () => {
    if (!isOwner) return;
    const playing = !videoState.playing;
    const currentTime = isYouTube
      ? (ytPlayerRef.current?.getCurrentTime?.() ?? videoState.currentTime)
      : (videoRef.current?.currentTime ?? videoState.currentTime);
    setVideoState({ playing, currentTime });
    emit({ playing, currentTime });
  };

  const seek = (delta: number) => {
    if (!isOwner) return;
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
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

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  const showControlsTemporarily = () => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-black relative overflow-hidden group">

      {/* ── Source controls (owner only) ── */}
      {isOwner && (
        <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap gap-2">
          <label className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md border border-white/10 hover:border-white/30 px-3 py-2 rounded-xl text-xs cursor-pointer transition-all text-zinc-300 hover:text-white">
            <Upload size={13} />
            <span>Local File</span>
            <input type="file" accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} />
          </label>
          <button
            onClick={() => { setShowUrlInput((v) => !v); setVideoError(""); }}
            className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md border border-white/10 hover:border-white/30 px-3 py-2 rounded-xl text-xs transition-all text-zinc-300 hover:text-white"
          >
            <LinkIcon size={13} /> URL
          </button>
          {showUrlInput && (
            <div className="flex gap-2 w-full mt-1">
              <input
                autoFocus
                className="flex-1 bg-zinc-900/90 backdrop-blur border border-white/10 focus:border-white/30 rounded-xl px-4 py-2 text-xs outline-none text-white placeholder-zinc-500 transition-all"
                placeholder="Paste YouTube or direct video URL..."
                value={urlInput}
                maxLength={2048}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlLoad()}
              />
              <button onClick={handleUrlLoad} className="bg-white text-black px-4 py-2 rounded-xl text-xs font-semibold hover:bg-zinc-200 transition-all shrink-0">
                Load
              </button>
              <button onClick={() => { setShowUrlInput(false); setVideoError(""); }} className="text-zinc-500 hover:text-white p-2">
                <X size={14} />
              </button>
            </div>
          )}
          {videoError && (
            <div className="w-full flex items-center gap-2 bg-red-950/80 border border-red-800/50 rounded-xl px-3 py-2 text-xs text-red-400">
              <span>⚠️ {videoError}</span>
              <button onClick={() => setVideoError("")} className="ml-auto text-red-600 hover:text-red-400"><X size={12} /></button>
            </div>
          )}
        </div>
      )}

      {/* ── Video area ── */}
      <div
        className="flex-1 flex items-center justify-center relative"
        onMouseMove={showControlsTemporarily}
        onTouchStart={showControlsTemporarily}
        onClick={isYouTube ? undefined : (isOwner ? togglePlay : undefined)}
      >
        {/* Empty state */}
        {!hasSrc && (
          <div className="text-center px-8 select-none">
            <div className="text-7xl mb-4 opacity-30">🎬</div>
            <p className="text-zinc-400 text-sm font-medium">
              {isOwner ? "Load a video to start watching" : "Waiting for owner to load a video..."}
            </p>
            {isOwner && (
              <p className="text-zinc-600 text-xs mt-2">YouTube · Direct MP4/WebM URL · Local file</p>
            )}
          </div>
        )}

        {/* YouTube iframe */}
        {isYouTube && (
          <div ref={ytContainerRef} className="w-full h-full" />
        )}

        {/* HTML5 video */}
        {!isYouTube && (
          <video
            ref={videoRef}
            className="max-h-full max-w-full w-full h-full object-contain"
            src={isOwner ? (localSrc || (isSafeUrl(videoState.src) ? videoState.src : undefined)) : undefined}
            onTimeUpdate={() => { const v = videoRef.current; if (v) setCurrentTime(v.currentTime); }}
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (!v) return;
              setVideoError("");
              setDuration(v.duration);
              isSyncing.current = true;
              if (videoState.currentTime > 0) v.currentTime = videoState.currentTime;
              if (videoState.playing) v.play().catch(() => {}).finally(() => { isSyncing.current = false; });
              else { v.pause(); isSyncing.current = false; }
              v.playbackRate = videoState.speed;
            }}
            onError={() => {
              if (videoState.src || localSrc)
                setVideoError("Cannot play this video. Try a direct .mp4 URL or YouTube link.");
            }}
            onPlay={() => { if (!isSyncing.current) emit({ playing: true, currentTime: videoRef.current?.currentTime ?? 0 }); }}
            onPause={() => { if (!isSyncing.current) emit({ playing: false, currentTime: videoRef.current?.currentTime ?? 0 }); }}
          />
        )}
      </div>

      {/* ── Controls overlay (non-YouTube) ── */}
      {hasSrc && !isYouTube && (
        <div
          className={`absolute bottom-0 left-0 right-0 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onMouseEnter={() => { setShowControls(true); if (controlsTimer.current) clearTimeout(controlsTimer.current); }}
        >
          {/* Gradient bg */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" />

          <div className="relative px-4 pb-4 pt-10">
            {/* Progress bar */}
            <div className="relative mb-3 group/seek">
              <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeekBar}
                disabled={!isOwner}
                className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-default h-full"
              />
            </div>

            {/* Buttons row */}
            <div className="flex items-center justify-between">
              {/* Left controls */}
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  onClick={() => seek(-10)}
                  disabled={!isOwner}
                  className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-default"
                >
                  <SkipBack size={18} />
                </button>

                <button
                  onClick={togglePlay}
                  className="p-2 rounded-lg text-white hover:bg-white/10 transition-all"
                >
                  {videoState.playing
                    ? <Pause size={22} fill="white" />
                    : <Play size={22} fill="white" />}
                </button>

                <button
                  onClick={() => seek(10)}
                  disabled={!isOwner}
                  className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-default"
                >
                  <SkipForward size={18} />
                </button>

                {/* Volume */}
                <div className="flex items-center gap-1 group/vol">
                  <button
                    onClick={() => {
                      const next = !muted;
                      setMuted(next);
                      if (videoRef.current) videoRef.current.muted = next;
                    }}
                    className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all"
                  >
                    {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input
                    type="range"
                    min={0} max={1} step={0.05}
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setVolume(v);
                      setMuted(v === 0);
                      if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; }
                    }}
                    className="w-16 sm:w-20 h-1 accent-white cursor-pointer"
                  />
                </div>

                {/* Time */}
                <span className="text-xs text-zinc-400 font-mono ml-1 hidden sm:block">
                  {fmt(currentTime)} / {fmt(duration)}
                </span>
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-1 relative">
                {/* Speed */}
                {isOwner && (
                  <div className="relative">
                    <button
                      onClick={() => setShowSpeedMenu((v) => !v)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-all font-mono"
                    >
                      <Gauge size={14} /> {videoState.speed}x
                    </button>
                    {showSpeedMenu && (
                      <div className="absolute bottom-10 right-0 bg-zinc-900/95 backdrop-blur border border-white/10 rounded-xl overflow-hidden shadow-2xl z-20 min-w-[80px]">
                        {SPEEDS.map((s) => (
                          <button
                            key={s}
                            onClick={() => setSpeed(s)}
                            className={`block w-full px-4 py-2 text-xs text-left transition-colors hover:bg-white/10 ${videoState.speed === s ? "text-white font-bold" : "text-zinc-400"}`}
                          >
                            {s}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Fullscreen */}
                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all"
                >
                  <Maximize size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
