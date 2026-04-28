// src/chathead/Vinyl.tsx
import * as React from "react";
import { motion } from "framer-motion";
import {
  ExternalLink,
  Pause,
  Play,
  ChevronUp,
  ChevronDown,
  RefreshCcw,
  X, // NEW
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import clsx from "clsx";

/* ------------------ Minimal YouTube IFrame API types ------------------ */
export type YTPlayerState = -1 | 0 | 1 | 2 | 3 | 5;

export interface YTPlayerVars {
  rel?: 0 | 1;
  modestbranding?: 0 | 1;
  origin?: string;
  start?: number;
  list?: string;
  listType?: "playlist" | "search";
  playsinline?: 0 | 1;
}

export interface YTOnReadyEvent { target: YTPlayer }
export interface YTOnStateChangeEvent { data: YTPlayerState; target: YTPlayer }

export interface YTPlayerOptions {
  height?: string | number;
  width?: string | number;
  videoId?: string;
  playerVars?: YTPlayerVars;
  events?: {
    onReady?: (e: YTOnReadyEvent) => void;
    onStateChange?: (e: YTOnStateChangeEvent) => void;
  };
}

export interface YTCueVideoByIdOptions {
  videoId: string;
  startSeconds?: number;
  endSeconds?: number;
  suggestedQuality?:
    | "default" | "small" | "medium" | "large"
    | "hd720" | "hd1080" | "highres";
}

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
  getPlayerState(): YTPlayerState;
  cueVideoById(opts: YTCueVideoByIdOptions): void;
  setVolume(volume: number): void; // 0..100
  getVolume?(): number;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
}

export interface YTGlobal {
  Player: new (elementId: string, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTGlobal;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/* ------------------------------- Props -------------------------------- */
type VinylProps = {
  videoId?: string;
  playlistId?: string;
  title?: string;
  startSeconds?: number;
  className?: string;
};

const LS_OPEN   = "vinyl_open_v1";
const LS_VIDEO  = "vinyl_video_v1";
const LS_VOLUME = "vinyl_volume_v1";
const LS_LOOP   = "vinyl_loop_v1";
const LS_HIDE_MOBILE = "vinyl_hide_mobile_fab_v1"; // NEW

/* ----------------------- Helpers & small utilities -------------------- */
function safeParseBoolean(v: string | null): boolean {
  try { return JSON.parse(v ?? "false") as boolean; } catch { return false; }
}

function loadYouTubeScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.YT && window.YT.Player) { resolve(); return; }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    (document.head || document.body).appendChild(tag);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
  });
}

/** Extract a YouTube video ID from a URL or string-ish */
function extractVideoId(input: string): string {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) {
      const seg = url.pathname.split("/").filter(Boolean)[0];
      if (seg && /^[a-zA-Z0-9_-]{11}$/.test(seg)) return seg;
    }
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p === "embed");
    if (idx >= 0 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) {
      return parts[idx + 1];
    }
  } catch (err) {
    void err;
  }
  const maybe = trimmed.slice(-11);
  return /^[a-zA-Z0-9_-]{11}$/.test(maybe) ? maybe : trimmed;
}

/* ------------------------------- Component ---------------------------- */
export default function Vinyl({
  videoId = "dQw4w9WgXcQ",
  playlistId,
  title = "Now Playing",
  startSeconds = 0,
  className,
}: VinylProps) {
  const [open, setOpen] = React.useState<boolean>(() => safeParseBoolean(localStorage.getItem(LS_OPEN)));
  const [isReady, setReady] = React.useState(false);
  const [isPlaying, setPlaying] = React.useState(false);

  const initialDefault = React.useRef<string>(videoId);
  const [currentVideo, setCurrentVideo] = React.useState<string>(() => localStorage.getItem(LS_VIDEO) || videoId);
  const [inputText, setInputText] = React.useState<string>(() => localStorage.getItem(LS_VIDEO) || videoId);

  const [volume, setVolume] = React.useState<number>(() => {
    const v = Number(localStorage.getItem(LS_VOLUME));
    return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 60;
  });
  const [loopOn, setLoopOn] = React.useState<boolean>(() => safeParseBoolean(localStorage.getItem(LS_LOOP)));

  // NEW: mobile detection + persisted hide
  const [isMobile, setIsMobile] = React.useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );
  const [hideMobileFab, setHideMobileFab] = React.useState<boolean>(() =>
    safeParseBoolean(localStorage.getItem(LS_HIDE_MOBILE))
  );

  // keep loop flag fresh inside YT callbacks
  const loopRef = React.useRef<boolean>(loopOn);
  React.useEffect(() => { loopRef.current = loopOn; }, [loopOn]);

  const playerRef = React.useRef<YTPlayer | null>(null);
  const iframeHostId = React.useId();

  React.useEffect(() => { localStorage.setItem(LS_OPEN, JSON.stringify(open)); }, [open]);
  React.useEffect(() => { localStorage.setItem(LS_VIDEO, currentVideo); }, [currentVideo]);
  React.useEffect(() => { localStorage.setItem(LS_VOLUME, String(volume)); }, [volume]);
  React.useEffect(() => { localStorage.setItem(LS_LOOP, JSON.stringify(loopOn)); }, [loopOn]);
  React.useEffect(() => { localStorage.setItem(LS_HIDE_MOBILE, JSON.stringify(hideMobileFab)); }, [hideMobileFab]); // NEW

  /** Mount the player ONCE */
  React.useEffect(() => {
    let destroyed = false;

    loadYouTubeScript().then(() => {
      if (destroyed) return;
      const el = document.getElementById(iframeHostId);
      if (!el || !window.YT) return;

      const baseVars: YTPlayerVars = {
        rel: 0, modestbranding: 1, origin: window.location.origin,
        start: startSeconds || 0, playsinline: 1
      };

      const options: YTPlayerOptions = {
        // Make iframe fluid; wrapper below sets aspect ratio
        height: "100%",
        width: "100%",
        playerVars: baseVars,
        events: {
          onReady: () => {
            setReady(true);
            try { playerRef.current?.setVolume(volume); } catch (err) { void err; }
          },
          onStateChange: (e) => {
            if (e.data === 1) setPlaying(true);
            else if (e.data === 2) setPlaying(false);
            else if (e.data === 0) { // ENDED
              setPlaying(false);
              if (loopRef.current) {
                const p = playerRef.current;
                try {
                  p?.seekTo(0, true);
                  setTimeout(() => p?.playVideo(), 0);
                } catch (err) { void err; }
              }
            }
          },
        },
      };

      if (playlistId) {
        options.playerVars = { ...baseVars, listType: "playlist", list: playlistId };
      } else {
        options.videoId = extractVideoId(currentVideo);
      }

      playerRef.current = new window.YT.Player(iframeHostId, options);
    });

    return () => {
      destroyed = true;
      try { playerRef.current?.destroy(); } catch (err) { void err; }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeHostId]);

  /** Follow prop videoId only when it actually changes */
  const lastPropVideoId = React.useRef<string>(initialDefault.current);
  React.useEffect(() => {
    if (playlistId || !isReady || !playerRef.current) return;

    const cleaned = extractVideoId(videoId);
    if (cleaned !== lastPropVideoId.current) {
      lastPropVideoId.current = cleaned;
      setCurrentVideo(cleaned);
      setInputText(cleaned);
      try {
        playerRef.current.cueVideoById({ videoId: cleaned, startSeconds: startSeconds || 0 });
      } catch (err) {
        void err;
      }
      setPlaying(false);
    }
  }, [videoId, playlistId, isReady, startSeconds]);

  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const togglePlay = () => {
    const player = playerRef.current;
    if (!player || !isReady) { setOpen(true); return; }
    const state = player.getPlayerState();
    if (state === 1) player.pauseVideo();
    else player.playVideo();
  };

  const handleFabClick = () => {
    // When hidden on mobile, use the vinyl as an invisible "open" hotspot instead of play/pause
    if (isMobile && hideMobileFab) { setOpen(true); return; }
    togglePlay();
  };

  const openOnYouTube = () => {
    const url = playlistId
      ? `https://www.youtube.com/playlist?list=${playlistId}`
      : `https://www.youtube.com/watch?v=${currentVideo}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  /** Load from the input field */
  const cueFromInput = (autoPlay = false) => {
    const player = playerRef.current;
    if (!player || !isReady) return;
    const id = extractVideoId(inputText);
    setCurrentVideo(id);
    try {
      player.cueVideoById({ videoId: id, startSeconds: 0 });
      if (autoPlay) player.playVideo();
      else setPlaying(false);
    } catch (err) {
      void err;
    }
  };

  /** Volume change — set on the existing player (no resets) */
  const onChangeVolume: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const v = Math.min(100, Math.max(0, Number(e.target.value)));
    setVolume(v);
    try { playerRef.current?.setVolume(v); } catch (err) { void err; }
  };

  // NEW: compute hidden state for the FAB row
  const fabHidden = isMobile && hideMobileFab;

  return (
    <>
      {/* Floating controls (bottom-left) */}
      <div
        className={clsx(
          "fixed z-50 md:bottom-5 md:left-5 bottom-24 left-4",
          "pointer-events-none",
          "flex items-start gap-2",
          className
        )}
        aria-hidden={false}
      >
        {/* Row: vinyl then toggle on the right */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Vinyl disc (acts as open hotspot when hidden on mobile) */}
          <motion.button
            onClick={handleFabClick}
            aria-label={isPlaying ? "Pause" : "Play"}
            className={clsx(
              "relative h-16 w-16 rounded-full shadow-md border",
              "bg-gradient-to-br from-zinc-200 to-zinc-100 dark:from-zinc-800 dark:to-zinc-700",
              "grid place-items-center overflow-hidden",
              fabHidden && "opacity-0" // still clickable
            )}
            whileTap={{ scale: 0.96 }}
            style={{
              boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.15), inset 0 0 0 10px rgba(0,0,0,0.05)",
            }}
            title={isPlaying ? "Pause" : "Play"}
          >
            {/* Grooves */}
            <div className="absolute inset-0">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  backgroundImage:
                    "repeating-radial-gradient(circle at 50% 50%, rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px)",
                }}
              />
            </div>

            {/* Center cap */}
            <div className="absolute h-5 w-5 rounded-full bg-primary" />
            <div className="absolute h-2 w-2 rounded-full bg-background" />

            {/* Icon overlay */}
            <motion.div
              animate={{ opacity: isPlaying ? 0 : 1, scale: isPlaying ? 0.9 : 1 }}
              transition={{ duration: 0.2 }}
              className="relative z-10 text-background"
            >
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </motion.div>

            {/* Rotation when playing */}
            <motion.div
              className="absolute inset-0"
              animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
              transition={isPlaying ? { repeat: Infinity, ease: "linear", duration: 4 } : { duration: 0.3 }}
              style={{ borderRadius: "9999px" }}
            />
          </motion.button>

          {/* Expand / collapse (also hidden visually on mobile, still clickable) */}
          <Button
            size="icon"
            variant="secondary"
            onClick={() => setOpen((o) => !o)}
            title={open ? "Hide player" : "Show player"}
            className={clsx("shadow-md", fabHidden && "opacity-0")}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Player panel */}
      <div
        className={clsx(
          "fixed z-50 md:bottom-60 md:left-5 bottom-40 left-4",
          "transition-all duration-200",
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-3 pointer-events-none",
          "w-[min(560px,95vw)]" // responsive width
        )}
      >
        <Card className="p-3 shadow-lg border-card-border bg-card/95 backdrop-blur">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold truncate mr-2">{title}</div>
            <div className="flex items-center gap-1 text-[11px] text-foreground/60">
              <Button size="icon" variant="ghost" onClick={openOnYouTube} title="Open on YouTube" aria-label="Open on YouTube">
                <ExternalLink className="h-4 w-4" />
              </Button>
              {/* NEW: Close (X) button */}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setOpen(false)}
                title="Close player"
                aria-label="Close player"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Player host — responsive 16:9 box */}
          <div
            className="relative w-full rounded-lg overflow-hidden border"
            style={{ aspectRatio: "16 / 9" }}
          >
            <div id={iframeHostId} className="absolute inset-0" />
          </div>

          {/* Controls row */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={togglePlay} className="gap-2">
              {isPlaying ? (<><Pause className="h-4 w-4" /> Pause</>) : (<><Play className="h-4 w-4" /> Play</>)}
            </Button>

            {/* Loop toggle */}
            <Button
              size="sm"
              variant={loopOn ? "default" : "outline"}
              onClick={() => setLoopOn((v) => !v)}
              className="gap-2"
              title={loopOn ? "Loop is ON" : "Loop is OFF"}
            >
              <RefreshCcw className="h-4 w-4" />
              Loop {loopOn ? "On" : "Off"}
            </Button>

            {/* Volume slider */}
            <label className="flex items-center gap-2 text-xs">
              <span>Vol</span>
              <input
                type="range"
                min={0}
                max={100}
                value={volume}
                onChange={onChangeVolume}
                className="w-40"
              />
              <span className="tabular-nums w-8 text-right">{volume}</span>
            </label>
          </div>

          {/* Paste link / ID */}
          {!playlistId && (
            <div className="mt-3 flex items-center gap-2">
              <input
                className="flex-1 text-xs bg-transparent border rounded px-2 py-1"
                placeholder="Paste a YouTube link or 11-char video ID"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onPaste={(e) => {
                  requestAnimationFrame(() =>
                    setInputText((e.target as HTMLInputElement).value)
                  );
                }}
                onBlur={() => cueFromInput(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); cueFromInput(true); }
                }}
              />
              <Button size="sm" variant="outline" onClick={() => cueFromInput(true)}>Load</Button>
            </div>
          )}

          <div className="mt-2 text-[11px] text-foreground/60">
            Paste a full YouTube URL (or the 11-character video ID) and press <b>Load</b> (or Enter).
            Click the vinyl to play/pause. Loop replays the current track automatically.
          </div>

          {/* Mobile FAB visibility toggle */}
          <div className="mt-3 pt-3 border-t text-[12px] text-foreground/80">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-primary"
                checked={hideMobileFab}
                onChange={(e) => setHideMobileFab(e.target.checked)}
              />
              <span>Hide bottom-left vinyl button on mobile (tap the bottom-left hot-spot to open)</span>
            </label>
          </div>
        </Card>
      </div>
    </>
  );
}
