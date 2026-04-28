import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import clsx from "clsx";
import { Pause, Play, RotateCcw, TimerReset, AlarmClock, X, Clock4 } from "lucide-react";

type Mode = "clock" | "timer" | "countdown";
type Point = { x: number; y: number };

const LS_KEYS = {
  OPEN: "clock_open",
  WIN: "clock_window_pos",
  HIDE_MOBILE: "clock_hide_mobile_bubble", // NEW
} as const;

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function safeSet<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function formatHMS(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function sanitizePos(p: Point, winW: number, winH: number, panelW = 380, panelH = 260): Point {
  const margin = 8;
  const maxX = Math.max(0, winW - panelW - margin);
  const maxY = Math.max(0, winH - panelH - margin);
  const x = Number.isFinite(p.x) ? clamp(p.x, margin, maxX) : margin;
  const y = Number.isFinite(p.y) ? clamp(p.y, margin + 56, maxY) : margin + 56;
  return { x, y };
}

export default function Clock({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState<boolean>(() => safeGet<boolean>(LS_KEYS.OPEN, false));
  const [mode, setMode] = useState<Mode>("clock");

  const initialPos = (): Point => {
    const saved = safeGet<Point>(LS_KEYS.WIN, { x: 16, y: 88 });
    return sanitizePos(saved, window.innerWidth, window.innerHeight);
  };
  const [winPos, setWinPos] = useState<Point>(initialPos);
  const lastWinPos = useRef<Point>(winPos);

  const [now, setNow] = useState<Date>(new Date());

  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);

  const [cdHours, setCdHours] = useState<string>("");
  const [cdMinutes, setCdMinutes] = useState<string>("");
  const [cdSeconds, setCdSeconds] = useState<string>("");
  const [cdRemaining, setCdRemaining] = useState<number>(0);
  const [cdRunning, setCdRunning] = useState(false);
  const [ringing, setRinging] = useState(false);

  // NEW: mobile detection + persisted hide
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth <= 768);
  const [hideMobileBubble, setHideMobileBubble] = useState<boolean>(() =>
    safeGet<boolean>(LS_KEYS.HIDE_MOBILE, false)
  );
  useEffect(() => {
    safeSet(LS_KEYS.HIDE_MOBILE, hideMobileBubble);
  }, [hideMobileBubble]);

  useEffect(() => {
    const onResize = () => {
      setWinPos((p) => sanitizePos(p, window.innerWidth, window.innerHeight));
      setIsMobile(window.innerWidth <= 768); // NEW
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
      setTimerSeconds((s) => (timerRunning ? s + 1 : s));
      setCdRemaining((r) => {
        if (!cdRunning) return r;
        const next = Math.max(0, r - 1);
        if (next === 0 && r !== 0) {
          setCdRunning(false);
          setRinging(true);
          setOpen(false);
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [timerRunning, cdRunning]);

  useEffect(() => {
    safeSet(LS_KEYS.OPEN, open);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key.toLowerCase() === "t") {
        setMode("timer");
        setOpen(true);
      } else if (e.key.toLowerCase() === "d") {
        setMode("countdown");
        setOpen(true);
      } else if (e.key.toLowerCase() === "c") {
        setOpen((o) => !o);
      }
    };
    const onOpenEvent = (ev: Event) => {
      const ce = ev as CustomEvent<{ mode?: Mode; open?: boolean }>;
      const d = ce.detail ?? {};
      if (d.mode) setMode(d.mode);
      setOpen(d.open ?? true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("clock:open", onOpenEvent as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("clock:open", onOpenEvent as EventListener);
    };
  }, []);

  const bubbleTime = useMemo(
    () => now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    [now]
  );
  const fullTime = useMemo(
    () => now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [now]
  );
  const timerDisplay = useMemo(() => formatHMS(timerSeconds), [timerSeconds]);
  const cdDisplay = useMemo(() => formatHMS(cdRemaining), [cdRemaining]);

  function startTimer() {
    setMode("timer");
    setTimerRunning(true);
    setOpen(true);
  }
  function pauseTimer() {
    setTimerRunning(false);
  }
  function resetTimer() {
    setTimerRunning(false);
    setTimerSeconds(0);
  }
  function startCountdown() {
    const total =
      Math.max(0, Number.parseInt(cdHours || "0", 10) || 0) * 3600 +
      Math.max(0, Number.parseInt(cdMinutes || "0", 10) || 0) * 60 +
      Math.max(0, Number.parseInt(cdSeconds || "0", 10) || 0);
    if (total <= 0) return;
    setMode("countdown");
    setCdRemaining(total);
    setCdRunning(true);
    setRinging(false);
    setOpen(true);
  }
  function cancelCountdown() {
    setCdRunning(false);
    setCdRemaining(0);
  }
  function stopAlarm() {
    setRinging(false);
    setOpen(true);
  }

  function onDrag(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    lastWinPos.current = {
      x: lastWinPos.current.x + info.delta.x,
      y: lastWinPos.current.y + info.delta.y,
    };
  }
  function onDragEnd() {
    const sanitized = sanitizePos(
      lastWinPos.current,
      window.innerWidth,
      window.innerHeight
    );
    setWinPos(sanitized);
    lastWinPos.current = sanitized;
    safeSet(LS_KEYS.WIN, sanitized);
  }
  useEffect(() => {
    lastWinPos.current = winPos;
  }, [winPos]);

  const bubbleAnimate =
    ringing && !open ? { x: [0, -2, 2, -2, 2, 0] } : undefined;

  // NEW: hide only on mobile, unless ringing (always visible when ringing)
  const bubbleHidden = isMobile && hideMobileBubble && !ringing;

  return (
    <>
      {/* Top-left trigger bubble — becomes visually hidden on mobile if toggled, but stays clickable */}
      <motion.button
        type="button"
        className={clsx(
          "fixed left-4 top-4 z-[999]",
          "inline-flex items-center gap-2 rounded-full border pointer-events-auto shadow-md",
          "bg-popover text-popover-foreground border-border",
          "px-3 py-2 text-sm hover:ring-2 hover:ring-primary/30",
          ringing ? "ring-2 ring-amber-500" : "ring-0",
          bubbleHidden && "opacity-0" , // NEW
          className
        )}
        onClick={() => setOpen(true)}
        title="Handy Clock"
        aria-label="Open clock"
        animate={bubbleAnimate}
        transition={bubbleAnimate ? { duration: 0.5, repeat: Infinity } : undefined}
      >
        <Clock4 className="h-4 w-4" />
        <span className="tabular-nums">{bubbleTime}</span>
        {ringing && <span className="ml-1 inline-block rounded-full bg-amber-500 h-2 w-2 animate-pulse" />}
      </motion.button>

      {/* Window — opaque, theme tokens */}
      <AnimatePresence>
        {open && (
          <motion.div
            className={clsx(
              "fixed z-[1000] w-[380px] rounded-xl pointer-events-auto",
              "bg-card text-card-foreground border border-border shadow-2xl"
            )}
            style={{ top: winPos.y, left: winPos.x }}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            {/* Header (drag handle) */}
            <motion.div
              className={clsx(
                "cursor-grab active:cursor-grabbing",
                "flex items-center justify-between px-3 py-2 rounded-t-xl",
                ringing
                  ? "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
                  : "bg-secondary text-secondary-foreground"
              )}
              drag
              dragMomentum={false}
              onDrag={onDrag}
              onDragEnd={onDragEnd}
            >
              <div className="flex items-center gap-2">
                <Clock4 className="h-4 w-4" />
                <span className="text-sm font-semibold">Handy Clock</span>
              </div>
              <button
                className="p-1 rounded-md hover:bg-muted"
                onClick={() => setOpen(false)}
                aria-label="Close"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>

            {/* Tabs */}
            <div className="px-3 pt-3">
              <div className="flex gap-2">
                <TabButton current={mode === "clock"} onClick={() => setMode("clock")}>
                  Global Time
                </TabButton>
                <TabButton current={mode === "timer"} onClick={() => setMode("timer")}>
                  Timer
                </TabButton>
                <TabButton current={mode === "countdown"} onClick={() => setMode("countdown")}>
                  Countdown
                </TabButton>
              </div>
            </div>

            {/* Body */}
            <div className="px-4 py-4">
              {mode === "clock" && (
                <div className="text-center space-y-2">
                  <div className="text-4xl font-bold tabular-nums">{fullTime}</div>
                  <div className="text-sm text-muted-foreground">
                    {now.toLocaleDateString(undefined, {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </div>
                </div>
              )}

              {mode === "timer" && (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="text-5xl font-bold tabular-nums">{timerDisplay}</div>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    {!timerRunning ? (
                      <Button onClick={startTimer}>
                        <Play className="h-4 w-4 mr-1" /> Start
                      </Button>
                    ) : (
                      <Button onClick={pauseTimer}>
                        <Pause className="h-4 w-4 mr-1" /> Pause
                      </Button>
                    )}
                    <Button variant="secondary" onClick={resetTimer}>
                      <RotateCcw className="h-4 w-4 mr-1" /> Reset
                    </Button>
                  </div>
                </div>
              )}

              {mode === "countdown" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Hours" value={cdHours} onChange={setCdHours} disabled={cdRunning} />
                    <Field label="Minutes" value={cdMinutes} onChange={setCdMinutes} disabled={cdRunning} />
                    <Field label="Seconds" value={cdSeconds} onChange={setCdSeconds} disabled={cdRunning} />
                  </div>

                  <div className="text-center">
                    <div className="text-5xl font-bold tabular-nums">{cdDisplay}</div>
                  </div>

                  <div className="flex items-center justify-center gap-2">
                    {!cdRunning ? (
                      <Button onClick={startCountdown}>
                        <TimerReset className="h-4 w-4 mr-1" /> Start
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={cancelCountdown}>
                        <RotateCcw className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                    )}
                    {ringing && (
                      <Button variant="warning" onClick={stopAlarm}>
                        <AlarmClock className="h-4 w-4 mr-1" /> Stop Alarm
                      </Button>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    When finished, the top-left bubble will <strong>shake</strong> until you stop the alarm.
                  </p>
                </div>
              )}
            </div>

            {/* NEW: Mobile bubble visibility toggle */}
            <div className="px-4 py-3 border-t border-border">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={hideMobileBubble}
                  onChange={(e) => setHideMobileBubble(e.target.checked)}
                />
                <span>
                  Hide corner bubble on mobile (tap the top-left hot-spot to reopen)
                </span>
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ---------- UI bits ---------- */
function TabButton({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "px-3 py-1.5 rounded-md text-sm border transition",
        current
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-muted text-muted-foreground border-transparent hover:bg-muted/80"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Button({
  children,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "secondary" | "warning";
}) {
  const styles =
    variant === "default"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : variant === "secondary"
      ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
      : "bg-amber-200 text-amber-900 hover:bg-amber-300 dark:bg-amber-300/20 dark:text-amber-200 dark:hover:bg-amber-300/30";
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx("inline-flex items-center px-3 py-1.5 rounded-md border shadow-sm transition", styles)}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="block text-[11px] text-muted-foreground mb-1">{label}</span>
      <input
        className={clsx(
          "w-full px-2 py-2 rounded-md border",
          "bg-background text-foreground border-input"
        )}
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}
