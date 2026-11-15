"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Socket } from "socket.io-client";
import { useRoomStore, VideoState } from "@/lib/store";
import { getSocketServerUrl } from "@/lib/socket";
import { useMediaUpload } from "@/lib/useMediaUpload";
import { toWebVtt } from "@/lib/subtitles";
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Maximize, Upload, Link as LinkIcon, Gauge, X, Captions
} from "lucide-react";

interface Props {
  socket: Socket;
  isOwner: boolean;
  isBlocked: boolean;
  connected: boolean;
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
  setPlaybackRate(rate: number): void;
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

export default function VideoPlayer({ socket, isOwner, isBlocked, connected, roomId, onLiveState }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<YouTubePlayer | null>(null);
  const ytReadyRef = useRef(false);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncing = useRef(false);
  const { videoState, subtitle } = useRoomStore();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const { upload, cancel: cancelUpload, progress: uploadProgress } = useMediaUpload(roomId);
  const [finishingUpload, setFinishingUpload] = useState(false);
  const uploading = Boolean(uploadProgress) || finishingUpload;
  const videoStateRef = useRef(useRoomStore.getState().videoState);
  const locallyPausedRef = useRef(false);
  const awaitingPlaybackSync = useRef(false);
  const lastSource = useRef(videoState.src);

  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [subtitleError, setSubtitleError] = useState("");
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [locallyPaused, setLocallyPaused] = useState(false);
  const [isMediaLoading, setIsMediaLoading] = useState(false);

  const ytId = getYouTubeId(videoState.src);
  const isYouTube = !!ytId;
  const hasSrc = !!(ytId || (videoState.src && isSafeUrl(videoState.src)));

  useEffect(() => {
    videoStateRef.current = videoState;
  }, [videoState]);

  useEffect(() => {
    if (lastSource.current === videoState.src) return;
    lastSource.current = videoState.src;
    locallyPausedRef.current = false;
    awaitingPlaybackSync.current = false;
    setLocallyPaused(false);
    setIsMediaLoading(Boolean(videoState.src));
  }, [videoState.src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !subtitle || isYouTube) return;
    const url = URL.createObjectURL(new Blob([subtitle.text], { type: "text/vtt" }));
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subtitle.label;
    track.srclang = "und";
    track.src = url;
    track.default = captionsEnabled;
    const show = () => { track.track.mode = captionsEnabled ? "showing" : "hidden"; };
    track.addEventListener("load", show);
    video.appendChild(track);
    show();
    return () => { track.removeEventListener("load", show); track.remove(); URL.revokeObjectURL(url); };
  }, [subtitle, captionsEnabled, isYouTube, videoState.src]);

  useEffect(() => {
    if (!connected) cancelUpload();
  }, [connected, cancelUpload]);

  useEffect(() => () => { if (controlsTimer.current) clearTimeout(controlsTimer.current); }, []);

  useEffect(() => {
    const receivePlaybackSync = (state: VideoState) => {
      if (isOwner) return;
      awaitingPlaybackSync.current = false;
      locallyPausedRef.current = false;
      setLocallyPaused(false);
      useRoomStore.getState().setVideoState(state);
    };
    socket.on("playback-sync", receivePlaybackSync);
    return () => {
      socket.off("playback-sync", receivePlaybackSync);
    };
  }, [isOwner, socket]);

  const emit = useCallback((state: Partial<VideoState>) => {
    if (socket.connected) socket.emit("video-state", state);
  }, [socket]);

  const provideLiveState = useCallback(() => ({
    ...videoStateRef.current,
    currentTime: (ytReadyRef.current ? ytPlayerRef.current?.getCurrentTime() : undefined) ?? videoRef.current?.currentTime ?? videoStateRef.current.currentTime,
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
    tag.onerror = () => {
      setIsMediaLoading(false);
      setVideoError("The YouTube player could not load. Check your connection and try again.");
    };
    document.head.appendChild(tag);
  }, [isYouTube]);

  useEffect(() => {
    let disposed = false;
    if (!ytId) {
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
      ytReadyRef.current = false;
      return;
    }
    const init = () => {
      const container = ytContainerRef.current;
      const YT = window.YT;
      if (disposed || !container || !YT) return;
      if (ytPlayerRef.current) {
        ytPlayerRef.current.loadVideoById(ytId);
        return;
      }
      const mount = document.createElement("div");
      container.replaceChildren(mount);
      ytPlayerRef.current = new YT.Player(mount, {
        videoId: ytId,
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 0, controls: isOwner ? 1 : 0, rel: 0, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: (event: YouTubeEvent) => {
            if (disposed) return;
            ytReadyRef.current = true;
            setPlaybackBlocked(false);
            setIsMediaLoading(false);
            setDuration(event.target.getDuration());
            const state = videoStateRef.current;
            if (state.currentTime > 0) event.target.seekTo(state.currentTime, true);
            event.target.setPlaybackRate(state.speed);
            if (state.playing) event.target.playVideo();
          },
          onAutoplayBlocked: () => {
            if (disposed) return;
            setPlaybackBlocked(true);
            setVideoError("Your browser needs a user gesture before it can play media.");
          },
          onPlaybackRateChange: (event: YouTubeEvent) => {
            if (!disposed && isOwner && SPEEDS.includes(event.data)) emit({ speed: event.data });
          },
          onStateChange: (event: YouTubeEvent) => {
            if (disposed) return;
            if (event.data === 3) setIsMediaLoading(true);
            else if (event.data === 1 || event.data === 2 || event.data === 5) setIsMediaLoading(false);
            if (!isOwner || !window.YT) return;
            const state = window.YT.PlayerState;
            if (event.data === state.PLAYING) emit({ playing: true, currentTime: event.target.getCurrentTime() });
            if (event.data === state.PAUSED) emit({ playing: false, currentTime: event.target.getCurrentTime() });
            if (event.data === 0) { emit({ playing: false, currentTime: event.target.getCurrentTime() }); socket.emit("queue-next"); }
          },
          onError: () => {
            if (disposed) return;
            setIsMediaLoading(false);
            setVideoError("This YouTube video cannot be embedded or played.");
          },
        },
      });
    };
    if (window.YT?.Player) init();
    else window.onYouTubeIframeAPIReady = init;
    return () => {
      disposed = true;
      ytReadyRef.current = false;
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
      if (window.onYouTubeIframeAPIReady === init) window.onYouTubeIframeAPIReady = undefined;
    };
  }, [emit, isOwner, ytId, socket]);

  useEffect(() => {
    const player = ytPlayerRef.current;
    if (!player || !ytReadyRef.current || !isYouTube || !window.YT) return;
    if (!isOwner && (locallyPausedRef.current || awaitingPlaybackSync.current)) return;
    const state = videoStateRef.current;
    if (Math.abs(player.getCurrentTime() - state.currentTime) > 1.5) player.seekTo(state.currentTime, true);
    if (state.playing && player.getPlayerState() !== window.YT.PlayerState.PLAYING) player.playVideo();
    if (!state.playing && player.getPlayerState() === window.YT.PlayerState.PLAYING) player.pauseVideo();
    player.setPlaybackRate(state.speed);
  }, [isOwner, isYouTube, videoState]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoState.src || isYouTube) return;
    if (!isOwner && (locallyPausedRef.current || awaitingPlaybackSync.current)) return;
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
      if (player && ytReadyRef.current) {
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
      const time = (ytReadyRef.current ? player?.getCurrentTime() : undefined) ?? videoRef.current?.currentTime;
      if (typeof time === "number" && Number.isFinite(time)) emit({ currentTime: time });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [emit, isOwner, videoState.playing]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !connected || !isOwner) return;
    if (file.size === 0) { setVideoError("This file is empty. Choose another media file."); return; }
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const fallbackTypes: Record<string, string> = {
      mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg",
      mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
      aac: "audio/aac", ogg: "audio/ogg",
    };
    const reportedType = file.type.toLowerCase();
    const contentType = reportedType.startsWith("video/") || reportedType.startsWith("audio/")
      ? reportedType
      : fallbackTypes[extension] || "";
    if (!contentType.startsWith("video/") && !contentType.startsWith("audio/")) {
      setVideoError("This file format is not supported. Use MP4 (H.264/AAC), WebM, MP3, WAV, M4A, AAC, or OGG.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setVideoError("The maximum upload size is 2 GB.");
      return;
    }
    let ownerToken: string | null = null;
    try { ownerToken = sessionStorage.getItem(`hometheater:${roomId}:owner`); } catch { /* Show the credentials error below. */ }
    if (!ownerToken) {
      setVideoError("Room owner credentials are missing. Recreate the room to upload media.");
      return;
    }

    setUploadNotice("");
    setVideoError("");
    try {
      const baseUrl = getSocketServerUrl().replace(/\/$/, "");
      const { mediaId } = await upload(file, contentType, ownerToken);
      if (!socket.connected) throw new Error("Connection lost. Reconnect and upload the file again.");
      setFinishingUpload(true);
      await new Promise<void>((resolve, reject) => {
        socket.timeout(8000).emit("activate-media", { mediaId, src: `${baseUrl}/media/${encodeURIComponent(roomId)}?v=${encodeURIComponent(mediaId)}` }, (timeout: Error | null, result?: { error?: string }) => {
          if (timeout || result?.error) reject(new Error(result?.error || "Could not load the upload. Check your connection and try again."));
          else resolve();
        });
      });
      setUploadNotice("Upload complete.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setUploadNotice("Upload cancelled. You can choose another file.");
      else setVideoError(error instanceof Error ? error.message : "The video upload failed.");
    } finally {
      setFinishingUpload(false);
    }
  };

  const handleSubtitleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !isOwner || !connected) return;
    setSubtitleError("");
    try {
      if (!/\.(vtt|srt)$/i.test(file.name) || file.size > 65_536) throw new Error("Choose a VTT or SRT subtitle file up to 64 KB.");
      const text = toWebVtt(await file.text());
      socket.timeout(8000).emit("set-subtitle", { text, label: file.name }, (timeout: Error | null, result?: { error?: string }) => {
        if (timeout || result?.error) setSubtitleError(result?.error || "Subtitles could not be shared. Please retry.");
      });
    } catch (error) { setSubtitleError(error instanceof Error ? error.message : "Could not load subtitles."); }
  };

  const allowPlayback = () => {
    if (isBlocked) return;
    if (ytPlayerRef.current) {
      if (!ytReadyRef.current) return;
      ytPlayerRef.current.playVideo();
      setPlaybackBlocked(false);
      setVideoError("");
      if (!isOwner) {
        locallyPausedRef.current = false;
        awaitingPlaybackSync.current = true;
        setLocallyPaused(false);
        socket.emit("request-playback-sync");
      }
      return;
    }
    const promise = videoRef.current?.play();
    promise?.then(() => {
      setPlaybackBlocked(false);
      setVideoError("");
      setIsMediaLoading(false);
      if (!isOwner) {
        locallyPausedRef.current = false;
        awaitingPlaybackSync.current = true;
        setLocallyPaused(false);
        socket.emit("request-playback-sync");
      }
    }).catch(() => {
      setPlaybackBlocked(true);
      setVideoError("Playback could not start. Check your connection and try again.");
    });
  };

  const handleUrlLoad = () => {
    if (!connected || uploading) return;
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
    if (!connected || (isYouTube && !ytReadyRef.current)) return;
    if (!isOwner) {
      if (isBlocked) return;
      const isPlaying = isYouTube && ytPlayerRef.current && window.YT
        ? ytPlayerRef.current.getPlayerState() === window.YT.PlayerState.PLAYING
        : Boolean(videoRef.current && !videoRef.current.paused);
      if (isPlaying) {
        locallyPausedRef.current = true;
        awaitingPlaybackSync.current = false;
        setLocallyPaused(true);
        ytPlayerRef.current?.pauseVideo();
        videoRef.current?.pause();
        return;
      }

      locallyPausedRef.current = false;
      awaitingPlaybackSync.current = true;
      setLocallyPaused(false);
      if (ytPlayerRef.current) ytPlayerRef.current.playVideo();
      else {
        videoRef.current?.play().catch(() => {
          setPlaybackBlocked(true);
          setVideoError("Playback could not start. Check your connection and try again.");
        });
      }
      socket.emit("request-playback-sync");
      return;
    }
    const playing = !videoState.playing;
    const time = ytPlayerRef.current?.getCurrentTime?.() ?? videoRef.current?.currentTime ?? videoState.currentTime;
    emit({ playing, currentTime: time });
  };

  const seek = (delta: number) => {
    if (!isOwner || !connected || (isYouTube && !ytReadyRef.current)) return;
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
    if (!isOwner || !connected) return;
    const time = Number.parseFloat(event.target.value);
    const player = ytPlayerRef.current;
    if (player) player.seekTo(time, true);
    if (videoRef.current) videoRef.current.currentTime = time;
    emit({ currentTime: time });
  };

  const setSpeed = (speed: number) => {
    if (!isOwner || !connected) return;
    if (videoRef.current) videoRef.current.playbackRate = speed;
    emit({ speed });
    setShowSpeedMenu(false);
  };

  const toggleFullscreen = () => {
    const action = !document.fullscreenElement ? containerRef.current?.requestFullscreen?.() : document.exitFullscreen?.();
    action?.catch(() => setVideoError("Fullscreen is unavailable. Try your browser's fullscreen option."));
  };

  const handlePlayerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, button, a, [contenteditable=true]") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!hasSrc) return;
    switch (event.key.toLowerCase()) {
      case " ": case "k": event.preventDefault(); togglePlay(); break;
      case "arrowleft": event.preventDefault(); seek(-10); break;
      case "arrowright": event.preventDefault(); seek(10); break;
      case "f": event.preventDefault(); toggleFullscreen(); break;
      case "m": event.preventDefault(); if (videoRef.current) { videoRef.current.muted = !muted; setMuted(!muted); } break;
      case "c": if (subtitle && !isYouTube) { event.preventDefault(); setCaptionsEnabled((enabled) => !enabled); } break;
    }
  };

  const showControlsTemporarily = () => {
    setShowControls(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div ref={containerRef} tabIndex={0} role="region" aria-label="Video player. Space or K: play or pause. Arrow keys: seek. M: mute. F: fullscreen. C: subtitles." onKeyDown={handlePlayerKeyDown} onFocusCapture={() => { setShowControls(true); if (controlsTimer.current) clearTimeout(controlsTimer.current); }} className="min-h-0 flex-1 flex flex-col items-center justify-center bg-black relative overflow-hidden group">
      {isOwner && (
      <div className="z-20 flex w-full shrink-0 flex-wrap gap-2 bg-[#0e0e11] p-3">
        <button type="button" disabled={uploading || !connected} onClick={() => mediaInputRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#111114]/90 px-3.5 py-2.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-[#1b1b20] disabled:opacity-50">
            <Upload size={13} />
          <span>{uploading ? "Uploading…" : "Upload media"}</span>
          </button>
          <input ref={mediaInputRef} aria-label="Upload media file" type="file" accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} disabled={uploading || !connected} />
          <button
            onClick={() => { setShowUrlInput((open) => !open); setVideoError(""); }}
            disabled={!connected || uploading}
            aria-expanded={showUrlInput}
          className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#111114]/90 px-3.5 py-2.5 text-[11px] font-medium text-zinc-200 shadow-lg shadow-black/20 backdrop-blur-xl transition-colors hover:border-white/20 hover:bg-[#1b1b20]"
          >
          <LinkIcon size={13} /> Add link
          </button>
          {hasSrc && !isYouTube && <>
            <button disabled={!connected} onClick={() => subtitleInputRef.current?.click()} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[11px] text-zinc-200"><Captions size={14} /> Add subtitles</button>
            <input ref={subtitleInputRef} type="file" accept=".vtt,.srt" aria-label="Upload subtitle file" className="hidden" onChange={handleSubtitleUpload} />
            {subtitle && <button disabled={!connected} onClick={() => socket.emit("set-subtitle", null)} className="rounded-xl px-3 py-2 text-[11px] text-zinc-300">Remove subtitles</button>}
          </>}
          {uploadProgress && <div className="w-full rounded-xl border border-white/10 bg-black/50 p-3">
            <div className="mb-2 flex items-center gap-3 text-xs"><span className="min-w-0 flex-1 truncate">{uploadProgress.name}</span><button onClick={cancelUpload} className="rounded-lg border border-white/20 px-3 py-2">Cancel upload</button></div>
            <progress aria-label="Media upload progress" value={uploadProgress.loaded} max={uploadProgress.total || 1} className="h-2 w-full accent-red-400" />
            <p role="status" className="mt-2 text-[11px] text-zinc-300">{Math.floor(uploadProgress.loaded / (uploadProgress.total || 1) * 100)}% · {(uploadProgress.loaded / 1024 / 1024).toFixed(1)} / {(uploadProgress.total / 1024 / 1024).toFixed(1)} MB{uploadProgress.loaded === uploadProgress.total ? " · Finishing upload…" : ""}</p>
          </div>}
          {uploadNotice && <p role="status" className="w-full text-xs text-zinc-300">{uploadNotice}</p>}
          {subtitleError && <p role="alert" className="w-full text-xs text-red-300">{subtitleError}</p>}
          {showUrlInput && (
            <div className="flex gap-2 w-full mt-1">
              <input
                aria-label="YouTube or direct media URL"
                autoFocus
                className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#111114]/95 px-4 py-2.5 text-xs text-white outline-none backdrop-blur focus:border-red-400/40"
                placeholder="Paste YouTube or direct video URL..."
                value={urlInput}
                maxLength={2048}
                onChange={(event) => setUrlInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleUrlLoad()}
              />
              <button disabled={!connected || uploading} onClick={handleUrlLoad} className="shrink-0 rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-zinc-200">Load</button>
              <button onClick={() => { setShowUrlInput(false); setVideoError(""); }} aria-label="Close URL input" className="rounded-xl border border-white/[0.08] bg-black/40 p-2.5 text-zinc-400 transition-colors hover:text-white"><X size={14} /></button>
            </div>
          )}
          {videoError && (
            <div role="alert" className="flex w-full items-center gap-2 rounded-xl border border-red-400/20 bg-red-950/90 px-3 py-2.5 text-xs text-red-200 shadow-xl backdrop-blur-xl">
              <span>⚠️ {videoError}</span>
              <button aria-label="Dismiss playback error" onClick={() => setVideoError("")} className="ml-auto p-2 text-red-300 hover:text-red-100"><X size={14} /></button>
            </div>
          )}
        </div>
      )}

      <div
        className="flex-1 min-h-0 w-full flex items-center justify-center relative"
        onMouseMove={showControlsTemporarily}
        onTouchStart={showControlsTemporarily}
        onClick={isYouTube ? undefined : (isOwner ? togglePlay : isBlocked ? undefined : playbackBlocked ? allowPlayback : togglePlay)}
      >
        <div className="relative aspect-video w-full max-h-full overflow-hidden rounded-xl bg-[#050506] shadow-[0_18px_70px_rgba(0,0,0,.38)]">
          {!hasSrc && (
            <div className="absolute inset-0 flex select-none flex-col items-center justify-center px-8 text-center">
              {uploading ? (
                <>
                  <span className="media-spinner mb-4" />
                  <p className="text-sm font-medium text-zinc-200">Uploading your media…</p>
                  <p className="mt-2 max-w-xs text-xs leading-5 text-zinc-500">Keep this room open while the original file uploads.</p>
                </>
              ) : (
                <>
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] border border-white/[0.08] bg-white/[0.035] text-zinc-500 shadow-inner"><Play size={25} /></div>
                  <p className="text-sm font-medium text-zinc-300">{isOwner ? "Your screen is ready" : "Waiting for the host to start"}</p>
                  <p className="mt-2 max-w-xs text-xs leading-5 text-zinc-600">{isOwner ? "Upload a video or paste a supported link to begin your watch party." : "The movie will appear here as soon as the host loads it."}</p>
                </>
              )}
            </div>
          )}

          {isYouTube && <div ref={ytContainerRef} className="absolute inset-0" />}
          {!isOwner && !isBlocked && isYouTube && hasSrc && (
            <button
              onClick={togglePlay}
              aria-label={locallyPaused || !videoState.playing ? "Resume synchronized playback" : "Pause for me"}
              className="absolute bottom-4 right-4 z-10 rounded-lg bg-black/80 border border-white/20 p-3 text-white hover:bg-black"
            >
              {locallyPaused || !videoState.playing ? <Play size={18} fill="white" /> : <Pause size={18} fill="white" />}
            </button>
          )}
          {!isYouTube && (
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-contain"
              src={isSafeUrl(videoState.src) ? videoState.src : undefined}
              playsInline
              onEnded={() => { if (isOwner) { emit({ playing: false, currentTime: videoRef.current?.currentTime ?? 0 }); socket.emit("queue-next"); } }}
              onLoadStart={() => setIsMediaLoading(true)}
              onWaiting={() => setIsMediaLoading(true)}
              onStalled={() => setIsMediaLoading(true)}
              onCanPlay={() => setIsMediaLoading(false)}
              onPlaying={() => setIsMediaLoading(false)}
              onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); }}
              onLoadedMetadata={() => {
                const video = videoRef.current;
                if (!video) return;
                setVideoError("");
                setPlaybackBlocked(false);
                setDuration(video.duration);
                setIsMediaLoading(video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA);
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
                setIsMediaLoading(false);
                const mediaError = videoRef.current?.error;
                if (!videoState.src || !mediaError) return;
                if (mediaError.code === MediaError.MEDIA_ERR_DECODE || mediaError.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
                  setVideoError("This video codec or container is not supported by your browser. Try MP4 with H.264/AAC or WebM.");
                } else {
                  setVideoError("The video could not be loaded. Check the link or ask the host to upload it again.");
                }
              }}
              onPlay={() => { if (isOwner && !isSyncing.current) emit({ playing: true, currentTime: videoRef.current?.currentTime ?? 0 }); }}
              onPause={() => { if (isOwner && !isSyncing.current) emit({ playing: false, currentTime: videoRef.current?.currentTime ?? 0 }); }}
            />
          )}
          {hasSrc && isMediaLoading && !videoError && (
            <div role="status" aria-live="polite" className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black/65 text-center backdrop-blur-[2px]">
              <span className="media-spinner" />
              <span className="text-xs font-medium text-zinc-200">{uploading ? "Uploading your media…" : videoState.playing ? "Buffering playback…" : "Loading media…"}</span>
              <span className="text-[10px] text-zinc-500">This can take a moment on a slow connection</span>
            </div>
          )}
          {!isOwner && !isBlocked && playbackBlocked && (
            <button
              onClick={(event) => { event.stopPropagation(); allowPlayback(); }}
              className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-[#111114]/95 px-5 py-3 text-xs font-medium text-white shadow-xl transition-colors hover:bg-[#1b1b20]"
            >
              Click to start synchronized playback
            </button>
          )}
          {videoError && !isOwner && !playbackBlocked && (
            <p role="alert" className="absolute top-2 left-2 right-2 z-10 rounded-lg bg-red-950/90 px-4 py-2 text-xs text-red-200">{videoError}</p>
          )}
        </div>
      </div>

      {hasSrc && !isYouTube && (
        <div
          className={`relative z-10 w-full shrink-0 transition-opacity duration-300 focus-within:opacity-100 focus-within:pointer-events-auto ${showControls ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onMouseEnter={() => { setShowControls(true); if (controlsTimer.current) clearTimeout(controlsTimer.current); }}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent" />
          <div className="relative px-4 pb-4 pt-10">
            <div className="relative mb-3 rounded-full focus-within:ring-2 focus-within:ring-red-300 group/seek">
              <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <input aria-label="Playback position" aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`} type="range" min={0} max={duration || 100} step={0.1} value={currentTime} onChange={handleSeekBar} disabled={!isOwner || !connected} className="absolute -inset-y-2 left-0 w-full opacity-0 cursor-pointer disabled:cursor-default h-5" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 sm:gap-2">
                <button aria-label="Seek backward 10 seconds" onClick={() => seek(-10)} disabled={!isOwner || !connected} className="p-2.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-default"><SkipBack size={18} /></button>
                <button aria-label={(!isOwner && locallyPaused) || !videoState.playing ? "Play" : isOwner ? "Pause" : "Pause for me"} onClick={togglePlay} disabled={!connected || (!isOwner && (isBlocked || playbackBlocked))} className="p-2.5 rounded-lg text-white hover:bg-white/10 transition-all disabled:opacity-50">
                  {(!isOwner && locallyPaused) || !videoState.playing ? <Play size={22} fill="white" /> : <Pause size={22} fill="white" />}
                </button>
                <button aria-label="Seek forward 10 seconds" onClick={() => seek(10)} disabled={!isOwner || !connected} className="p-2.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-default"><SkipForward size={18} /></button>
                <div className="flex items-center gap-1 group/vol">
                  <button aria-label={muted || volume === 0 ? "Unmute" : "Mute"} onClick={() => {
                    const next = !muted;
                    setMuted(next);
                    if (videoRef.current) videoRef.current.muted = next;
                  }} className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all">
                    {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input aria-label="Volume" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    setVolume(value);
                    setMuted(value === 0);
                    if (videoRef.current) { videoRef.current.volume = value; videoRef.current.muted = value === 0; }
                  }} className="w-16 sm:w-20 h-1 accent-white cursor-pointer" />
                </div>
                <span className="text-xs text-zinc-400 font-mono ml-1 hidden sm:block">{formatTime(currentTime)} / {formatTime(duration)}</span>
              </div>
              <div className="flex items-center gap-1 relative">
                {subtitle && <button aria-label={captionsEnabled ? "Hide subtitles" : "Show subtitles"} aria-pressed={captionsEnabled} onClick={() => setCaptionsEnabled((enabled) => !enabled)} className="rounded-lg p-2 text-zinc-200"><Captions size={18} /></button>}
                {isOwner && (
                  <div className="relative">
                    <button disabled={!connected} aria-label={`Playback speed ${videoState.speed} times`} aria-expanded={showSpeedMenu} onClick={() => setShowSpeedMenu((open) => !open)} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-zinc-300 hover:text-white hover:bg-white/10 transition-all font-mono">
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
                <button aria-label="Toggle fullscreen" onClick={toggleFullscreen} className="p-2.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 transition-all"><Maximize size={18} /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
