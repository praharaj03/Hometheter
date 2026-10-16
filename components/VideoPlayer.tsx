"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { useRoomStore, VideoState } from "@/lib/store";
import { getSocketServerUrl } from "@/lib/socket";
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Maximize, Upload, Link as LinkIcon, Gauge, X
} from "lucide-react";

interface Props {
  socket: Socket;
  isOwner: boolean;
  roomId: string;
  onLiveState: (provider: (() => object) | null) => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const isYouTube = u.hostname === "youtube.com" || u.hostname.endsWith(".youtube.com");
    const id = isYouTube
      ? (u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1])
      : u.hostname === "youtu.be" ? u.pathname.slice(1).split("/")[0] : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

interface YouTubePlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(videoId: string): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}

interface YouTubeEvent {
  target: YouTubePlayer;
  data: number;
}

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayer;
      PlayerState: { PLAYING: number; PAUSED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function formatTime(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export default function VideoPlayer({ socket, isOwner, roomId, onLiveState }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<YouTubePlayer | null>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncing = useRef(false);
  const videoStateRef = useRef(useRoomStore.getState().videoState);

  const { videoState } = useRoomStore();
  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);

  const ytId = getYouTubeId(videoState.src);
  const isYouTube = !!ytId;
  const hasSrc = !!(ytId || (videoState.src && isSafeUrl(videoState.src)));

  useEffect(() => {
    videoStateRef.current = videoState;
  }, [videoState]);

  const emit = useCallback((state: Partial<VideoState>) => {
    socket.emit("video-state", state);
  }, [socket]);

  const provideLiveState = useCallback(() => ({
    ...videoStateRef.current,
    currentTime: ytPlayerRef.current?.getCurrentTime?.() ?? videoRef.current?.currentTime ?? videoStateRef.current.currentTime,
  }), []);

  useEffect(() => {
    onLiveState(provideLiveState);
    return () => onLiveState(null);
  }, [onLiveState, provideLiveState]);

  useEffect(() => {
    if (!isYouTube || window.YT) return;
    if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) return;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }, [isYouTube]);

  useEffect(() => {
    if (!ytId) {
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
      return;
    }
    const init = () => {
      const container = ytContainerRef.current;
      const YT = window.YT;
      if (!container || !YT) return;
      if (ytPlayerRef.current) {
        ytPlayerRef.current.loadVideoById(ytId);
        return;
      }
      ytPlayerRef.current = new YT.Player(container, {
        videoId: ytId,
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 0, controls: isOwner ? 1 : 0, rel: 0, modestbranding: 1 },
        events: {
          onReady: (event: YouTubeEvent) => {
            setPlaybackBlocked(false);
            setDuration(event.target.getDuration());
            const state = videoStateRef.current;
            if (state.currentTime > 0) event.target.seekTo(state.currentTime, true);
            if (state.playing) event.target.playVideo();
          },
          onAutoplayBlocked: () => {
            setPlaybackBlocked(true);
            setVideoError("Your browser needs a user gesture before it can play media.");
          },
          onStateChange: (event: YouTubeEvent) => {
            if (!isOwner || !window.YT) return;
            const state = window.YT.PlayerState;
            if (event.data === state.PLAYING) emit({ playing: true, currentTime: event.target.getCurrentTime() });
            if (event.data === state.PAUSED) emit({ playing: false, currentTime: event.target.getCurrentTime() });
          },
          onError: () => setVideoError("This YouTube video cannot be embedded or played."),
        },
      });
    };
    if (window.YT?.Player) init();
    else window.onYouTubeIframeAPIReady = init;
  }, [emit, isOwner, ytId]);

  useEffect(() => {
    const player = ytPlayerRef.current;
    if (!player || !isYouTube || !window.YT) return;
    const state = videoStateRef.current;
    if (Math.abs(player.getCurrentTime() - state.currentTime) > 1.5) player.seekTo(state.currentTime, true);
    if (state.playing && player.getPlayerState() !== window.YT.PlayerState.PLAYING) player.playVideo();
    if (!state.playing && player.getPlayerState() === window.YT.PlayerState.PLAYING) player.pauseVideo();
  }, [isYouTube, videoState]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoState.src || isYouTube) return;
    isSyncing.current = true;
    if (Math.abs(video.currentTime - videoState.currentTime) > 1.5) video.currentTime = videoState.currentTime;
    if (videoState.playing && video.paused) {
      video.play().catch(() => {
        setPlaybackBlocked(true);
        setVideoError("Your browser needs a user gesture before it can play media.");
      }).finally(() => { isSyncing.current = false; });
    } else if (!videoState.playing && !video.paused) {
      video.pause();
      isSyncing.current = false;
    } else {
      isSyncing.current = false;
    }
    video.playbackRate = videoState.speed;
  }, [isOwner, isYouTube, videoState]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = ytPlayerRef.current;
      if (player) {
        setCurrentTime(player.getCurrentTime());
        setDuration(player.getDuration());
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isOwner || !videoState.playing) return;
    const timer = window.setInterval(() => {
      const player = ytPlayerRef.current;
      const time = player?.getCurrentTime() ?? videoRef.current?.currentTime;
      if (typeof time === "number" && Number.isFinite(time)) emit({ currentTime: time });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [emit, isOwner, videoState.playing]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const fallbackTypes: Record<string, string> = {
      mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg",
      mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
      aac: "audio/aac", ogg: "audio/ogg",
    };
    const contentType = file.type || fallbackTypes[extension] || "";
    if (!contentType.startsWith("video/") && !contentType.startsWith("audio/")) {
      setVideoError("Choose a video or audio file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setVideoError("The maximum upload size is 2 GB.");
      return;
    }
    const ownerToken = sessionStorage.getItem(`hometheater:${roomId}:owner`);
    if (!ownerToken) {
      setVideoError("Room owner credentials are missing. Recreate the room to upload media.");
      return;
    }

    setUploading(true);
    setVideoError("");
    try {
      const baseUrl = getSocketServerUrl().replace(/\/$/, "");
      const response = await fetch(`${baseUrl}/media/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": contentType, "X-Room-Token": ownerToken },
        body: file,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || `Upload failed (${response.status}).`);
      }
      emit({ src: `${baseUrl}/media/${encodeURIComponent(roomId)}`, playing: false, currentTime: 0, speed: 1 });
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : "The video upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const allowPlayback = () => {
    if (ytPlayerRef.current) {
      ytPlayerRef.current.playVideo();
      setPlaybackBlocked(false);
      setVideoError("");
      return;
    }
    const promise = videoRef.current?.play();
    promise?.then(() => {
      setPlaybackBlocked(false);
      setVideoError("");
    }).catch(() => {
      setPlaybackBlocked(true);
      setVideoError("Playback could not start. Check your connection and try again.");
    });
  };

  const handleUrlLoad = () => {
    const url = urlInput.trim();
    if (!url) return;
    if (!isSafeUrl(url)) {
      setVideoError("Please enter a valid http/https URL.");
      return;
    }
    setVideoError("");
    setDuration(0);
    setCurrentTime(0);
    emit({ src: url, playing: false, currentTime: 0, speed: 1 });
    setShowUrlInput(false);
    setUrlInput("");
  };

  const togglePlay = () => {
    if (!isOwner) return;
    const playing = !videoState.playing;
    const time = ytPlayerRef.current?.getCurrentTime?.() ?? videoRef.current?.currentTime ?? videoState.currentTime;
    emit({ playing, currentTime: time });
  };

  const seek = (delta: number) => {
    if (!isOwner) return;
    const player = ytPlayerRef.current;
    const video = videoRef.current;
    const time = player?.getCurrentTime() ?? video?.currentTime;
    const length = player?.getDuration() ?? video?.duration;
    if (typeof time !== "number" || !Number.isFinite(time)) return;
    const maxTime = typeof length === "number" && Number.isFinite(length) && length > 0
      ? length
      : Number.POSITIVE_INFINITY;
    const target = Math.max(0, Math.min(maxTime, time + delta));
    if (player) player.seekTo(target, true);
    if (video) video.currentTime = target;
    setCurrentTime(target);
    emit({ currentTime: target });
  };

  const handleSeekBar = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!isOwner) return;
    const time = Number.parseFloat(event.target.value);
    const player = ytPlayerRef.current;
    if (player) player.seekTo(time, true);
    if (videoRef.current) videoRef.current.currentTime = time;
    emit({ currentTime: time });
  };

  const setSpeed = (speed: number) => {
    if (!isOwner) return;
    if (videoRef.current) videoRef.current.playbackRate = speed;
    emit({ speed });
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
      {isOwner && (
        <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap gap-2">
          <label className={`flex items-center gap-1.5 bg-black/70 backdrop-blur-md border border-white/10 px-3 py-2 rounded-xl text-xs transition-all text-zinc-300 ${uploading ? "opacity-50 cursor-wait" : "cursor-pointer hover:border-white/30 hover:text-white"}`}>
            <Upload size={13} />
            <span>{uploading ? "Uploading original..." : "Local File"}</span>
            <input type="file" accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} disabled={uploading} />
          </label>
          <button
            onClick={() => { setShowUrlInput((open) => !open); setVideoError(""); }}
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
                onChange={(event) => setUrlInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleUrlLoad()}
              />
              <button onClick={handleUrlLoad} className="bg-white text-black px-4 py-2 rounded-xl text-xs font-semibold hover:bg-zinc-200 transition-all shrink-0">Load</button>
              <button onClick={() => { setShowUrlInput(false); setVideoError(""); }} className="text-zinc-500 hover:text-white p-2"><X size={14} /></button>
            </div>
          )}
          {videoError && (
            <div role="alert" className="w-full flex items-center gap-2 bg-red-950/80 border border-red-800/50 rounded-xl px-3 py-2 text-xs text-red-400">
              <span>⚠️ {videoError}</span>
              <button onClick={() => setVideoError("")} className="ml-auto text-red-600 hover:text-red-400"><X size={12} /></button>
            </div>
          )}
        </div>
      )}

      <div
        className="flex-1 flex items-center justify-center relative"
        onMouseMove={showControlsTemporarily}
        onTouchStart={showControlsTemporarily}
        onClick={isYouTube ? undefined : (isOwner ? togglePlay : playbackBlocked ? allowPlayback : undefined)}
      >
        {!hasSrc && (
          <div className="text-center px-8 select-none">
            <div className="text-7xl mb-4 opacity-30">🎬</div>
            <p className="text-zinc-400 text-sm font-medium">{isOwner ? "Load a video to start watching" : "Waiting for owner to load a video..."}</p>
            {isOwner && <p className="text-zinc-600 text-xs mt-2">YouTube · Direct MP4/WebM URL · Original-quality upload</p>}
          </div>
        )}

        {isYouTube && <div ref={ytContainerRef} className="w-full h-full" />}
        {!isYouTube && (
          <video
            ref={videoRef}
            className="max-h-full max-w-full w-full h-full object-contain"
            src={isSafeUrl(videoState.src) ? videoState.src : undefined}
            onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); }}
            onLoadedMetadata={() => {
              const video = videoRef.current;
              if (!video) return;
              setVideoError("");
              setPlaybackBlocked(false);
              setDuration(video.duration);
              isSyncing.current = true;
              if (videoStateRef.current.currentTime > 0) video.currentTime = videoStateRef.current.currentTime;
              if (videoStateRef.current.playing) {
                video.play().catch(() => {
                  setPlaybackBlocked(true);
                  setVideoError("Your browser needs a user gesture before it can play media.");
                }).finally(() => { isSyncing.current = false; });
              } else {
                video.pause();
                isSyncing.current = false;
              }
              video.playbackRate = videoStateRef.current.speed;
            }}
            onError={() => {
              if (videoState.src) setVideoError("Cannot play this video. Try a direct .mp4/.webm URL or upload the original file.");
            }}
            onPlay={() => { if (!isSyncing.current) emit({ playing: true, currentTime: videoRef.current?.currentTime ?? 0 }); }}
            onPause={() => { if (!isSyncing.current) emit({ playing: false, currentTime: videoRef.current?.currentTime ?? 0 }); }}
          />
        )}
        {!isOwner && playbackBlocked && (
          <button
            onClick={(event) => { event.stopPropagation(); allowPlayback(); }}
            className="absolute z-10 rounded-xl bg-black/80 border border-white/20 px-5 py-3 text-sm text-white hover:bg-black"
          >
            Click to start synchronized playback
          </button>
        )}
        {videoError && !isOwner && !playbackBlocked && (
          <p role="alert" className="absolute top-16 z-10 rounded-lg bg-red-950/90 px-4 py-2 text-xs text-red-200">{videoError}</p>
        )}
      </div>

      {hasSrc && !isYouTube && (
        <div
          className={`absolute bottom-0 left-0 right-0 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onMouseEnter={() => { setShowControls(true); if (controlsTimer.current) clearTimeout(controlsTimer.current); }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" />
          <div className="relative px-4 pb-4 pt-10">
            <div className="relative mb-3 group/seek">
              <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <input type="range" min={0} max={duration || 100} step={0.1} value={currentTime} onChange={handleSeekBar} disabled={!isOwner} className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-default h-full" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 sm:gap-2">
                <button onClick={() => seek(-10)} disabled={!isOwner} className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-default"><SkipBack size={18} /></button>
                <button onClick={togglePlay} disabled={!isOwner} className="p-2 rounded-lg text-white hover:bg-white/10 transition-all disabled:opacity-50">
                  {videoState.playing ? <Pause size={22} fill="white" /> : <Play size={22} fill="white" />}
                </button>
                <button onClick={() => seek(10)} disabled={!isOwner} className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-default"><SkipForward size={18} /></button>
                <div className="flex items-center gap-1 group/vol">
                  <button onClick={() => {
                    const next = !muted;
                    setMuted(next);
                    if (videoRef.current) videoRef.current.muted = next;
                  }} className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all">
                    {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    setVolume(value);
                    setMuted(value === 0);
                    if (videoRef.current) { videoRef.current.volume = value; videoRef.current.muted = value === 0; }
                  }} className="w-16 sm:w-20 h-1 accent-white cursor-pointer" />
                </div>
                <span className="text-xs text-zinc-400 font-mono ml-1 hidden sm:block">{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>
              <div className="flex items-center gap-1 relative">
                {isOwner && (
                  <div className="relative">
                    <button onClick={() => setShowSpeedMenu((open) => !open)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-all font-mono">
                      <Gauge size={14} /> {videoState.speed}x
                    </button>
                    {showSpeedMenu && (
                      <div className="absolute bottom-10 right-0 bg-zinc-900/95 backdrop-blur border border-white/10 rounded-xl overflow-hidden shadow-2xl z-20 min-w-[80px]">
                        {SPEEDS.map((speed) => (
                          <button key={speed} onClick={() => setSpeed(speed)} className={`block w-full px-4 py-2 text-xs text-left transition-colors hover:bg-white/10 ${videoState.speed === speed ? "text-white font-bold" : "text-zinc-400"}`}>{speed}x</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={toggleFullscreen} className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all"><Maximize size={18} /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
