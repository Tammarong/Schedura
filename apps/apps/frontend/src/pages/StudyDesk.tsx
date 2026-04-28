// src/pages/StudyDesk.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Clock3,
  CheckCircle2,
  Circle,
  PlusCircle,
  Trash2,
  Link2,
  Pencil,
  FlameKindling,
  Hourglass,
  BookOpenCheck,
  Archive,
  Loader2,
  Sparkles,
  Hand,
  Move,
  Eraser,
  MonitorSmartphone,
  LayoutGrid,
} from "lucide-react";
import { API_BASE, getToken } from "@/lib/api";

/* ---------- JSON type (no any) ---------- */
type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

/* ---------- types ---------- */
type Desk = {
  id: number;
  user_id: number;
  title: string | null;
  theme: string | null;
  layout: Json | null;
  prefs: Json | null;
  created_at: string;
  updated_at: string;
};

type Task = {
  id: number;
  user_id: number;
  desk_id: number | null;
  title: string;
  done: boolean;
  priority: "low" | "medium" | "high";
  due_at: string | null;
  created_at: string;
  updated_at: string;
};

type Resource = {
  id: number;
  user_id: number;
  desk_id: number | null;
  title: string;
  url: string | null;
  note: string | null;
  created_at: string;
};

type Session = {
  id: number;
  user_id: number;
  desk_id: number | null;
  mode: "focus" | "break" | "longBreak";
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  created_at: string;
};

type IconCmp = React.ComponentType<{ className?: string }>;
type ModeDef = { key: "focus" | "break" | "longBreak"; label: string; minutes: number; icon: IconCmp };

/* ---------- streak types ---------- */
type FlameInfo = { stage: number; label: string; nextCheckpoint: number; progressToNext: number };
type StreakInfo = {
  type: "study" | string;
  current_count: number;
  longest_count: number;
  start_date: string | null;
  last_date: string | null;
  todayActive?: boolean;
  flame?: FlameInfo;
};

/* ---------- helpers ---------- */
function clsx(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}
const fmt = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

// local-day helpers (don’t rely on UTC day; users expect local)
const getLocalYMD = (d: Date) => {
  const y = d.getFullYear();
  const m = fmt(d.getMonth() + 1);
  const dd = fmt(d.getDate());
  return `${y}-${m}-${dd}`;
};
const sameLocalDay = (a: Date, b: Date) => getLocalYMD(a) === getLocalYMD(b);
const msUntilLocalMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // next local midnight
  return Math.max(0, midnight.getTime() - now.getTime());
};

// ----- precise local-midnight countdown (HH:MM:SS) -----
const msUntilLocalMidnightExact = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(0, midnight.getTime() - now.getTime());
};
const fmtHMS = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${fmt(hh)}:${fmt(mm)}:${fmt(ss)}`;
};
function useMidnightTicker() {
  const [msLeft, setMsLeft] = useState<number>(msUntilLocalMidnightExact());
  useEffect(() => {
    const id = window.setInterval(() => setMsLeft(msUntilLocalMidnightExact()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return msLeft;
}

/* ---------- auth fetch (Bearer token; per-user) ---------- */
async function authFetch(input: string, init?: RequestInit) {
  const token = getToken?.();
  const headers = new Headers(init?.headers || {});
  if (token) headers.set("Authorization", token.startsWith("Bearer ") ? token : `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const url = input.startsWith("http") ? input : `${API_BASE}${input}`;
  return fetch(url, { ...init, headers });
}

/* ---------- constants ---------- */
const MODES: ModeDef[] = [
  { key: "focus", label: "Focus", minutes: 25, icon: FlameKindling },
  { key: "break", label: "Break", minutes: 5, icon: Hourglass },
  { key: "longBreak", label: "Long Break", minutes: 15, icon: BookOpenCheck },
];

/* ---------- mobile detection ---------- */
function useIsMobile(breakpointPx = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => window.matchMedia(`(max-width:${breakpointPx - 1}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpointPx - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpointPx]);
  return isMobile;
}

/* =========================================================
   Whiteboard Types
========================================================= */
type WBPoint = { x: number; y: number };
type WBPen = { type: "pen"; id: string; color: string; size: number; points: WBPoint[] };
type WBRect = {
  type: "rect";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  fill: string | null;
  strokeWidth: number;
};
type WBText = {
  type: "text";
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
};
type WBImage = { type: "image"; id: string; x: number; y: number; w: number; h: number; src: string };

type WBObject = WBPen | WBRect | WBText | WBImage;

type WBState = {
  objects: WBObject[];
  tx: number;
  ty: number;
  scale: number;
};

const DEFAULT_WB: WBState = { objects: [], tx: 0, ty: 0, scale: 1 };
const uid = (prefix = "obj") => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

/* =========================================================
   StudyDesk Page
========================================================= */
export default function StudyDesk() {
  const [loading, setLoading] = useState(true);
  const [desk, setDesk] = useState<Desk | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);

  // Desk edit
  const [titleDraft, setTitleDraft] = useState("");
  const [savingDesk, setSavingDesk] = useState(false);

  // Timer
  const [mode, setMode] = useState<ModeDef>(MODES[0]);
  const [secondsLeft, setSecondsLeft] = useState(mode.minutes * 60);
  const [running, setRunning] = useState(false);
  const [bootCheckingOpen, setBootCheckingOpen] = useState(true);

  // New items
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newResource, setNewResource] = useState<{ title: string; url: string; note: string }>({
    title: "",
    url: "",
    note: "",
  });

  // Study streak
  const [studyStreak, setStudyStreak] = useState<StreakInfo | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  const isMobile = useIsMobile();
  const msToMidnight = useMidnightTicker(); // live HH:MM:SS for header + card
  const resetHMS = fmtHMS(msToMidnight);

  /* ---------- load all ---------- */
  useEffect(() => {
    (async () => {
      try {
        // desk
        const dRes = await authFetch(`/study/desk`);
        if (!dRes.ok) throw new Error(`desk: ${dRes.status}`);
        const d = (await dRes.json()) as Desk;
        setDesk(d);
        setTitleDraft(d.title || "My Workbench");

        // tasks
        const tRes = await authFetch(`/study/tasks`);
        if (!tRes.ok) throw new Error(`tasks: ${tRes.status}`);
        const t = (await tRes.json()) as Task[];
        setTasks(t);

        // resources
        const rRes = await authFetch(`/study/resources`);
        if (!rRes.ok) throw new Error(`resources: ${rRes.status}`);
        const r = (await rRes.json()) as Resource[];
        setResources(r);

        // sessions (7d)
        const sRes = await authFetch(`/study/sessions?range=7d`);
        if (!sRes.ok) throw new Error(`sessions: ${sRes.status}`);
        const s = (await sRes.json()) as Session[];
        setSessions(s);

        // open session -> restore timer
        const open = s.find((x) => x.ended_at === null);
        if (open) {
          const md = MODES.find((m) => m.key === open.mode) || MODES[0];
          setMode(md);
          const elapsed = Math.floor((Date.now() - new Date(open.started_at).getTime()) / 1000);
          const left = Math.max(0, md.minutes * 60 - elapsed);
          setSecondsLeft(left);
          setRunning(true);
        } else {
          setSecondsLeft(MODES[0].minutes * 60);
          setRunning(false);
        }

// study streak
try {
  const stRes = await authFetch(`/streaks/study`);
  if (stRes.ok) {
    const si = (await stRes.json()) as StreakInfo;
    const todayActive = si.last_date
      ? sameLocalDay(new Date(si.last_date), new Date())
      : false;
    setStudyStreak({ ...si, todayActive });
  }
} catch {
  // ignore; button will still be available and will create/refresh streak
}
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
        setBootCheckingOpen(false);
      }
    })();
  }, []);

  /* ---------- timer ticking ---------- */
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // If mode changes while idle, reset seconds
  useEffect(() => {
    if (!running) {
      setSecondsLeft(mode.minutes * 60);
    }
  }, [mode, running]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  /* ---------- desk update ---------- */
  const saveDesk = async () => {
    if (!desk) return;
    try {
      setSavingDesk(true);
      const res = await authFetch(`/study/desk`, {
        method: "PATCH",
        body: JSON.stringify({ title: titleDraft.trim() }),
      });
      if (!res.ok) throw new Error("Save failed");
      const updated: Desk = await res.json();
      setDesk(updated);
    } catch (e) {
      console.error(e);
      alert("Failed to save desk");
    } finally {
      setSavingDesk(false);
    }
  };

  /* ---------- streak: check-in (once/day; per user) ---------- */
const checkedToday =
  !!studyStreak?.last_date && sameLocalDay(new Date(studyStreak.last_date), new Date());

const doStudyCheckIn = async () => {
  if (checkingIn || checkedToday) return; // UI guard
  try {
    setCheckingIn(true);
    // Send local calendar day for correct server-side bucketing
    const res = await authFetch(`/streaks/study/ping`, {
      method: "POST",
      body: JSON.stringify({ at: getLocalYMD(new Date()) }),
    });

    if (!res.ok) {
      if (res.status === 409 || res.status === 429) {
        setStudyStreak((prev) =>
          prev
            ? { ...prev, todayActive: true, last_date: new Date().toISOString() }
            : {
                type: "study",
                current_count: 0,
                longest_count: 0,
                start_date: null,
                last_date: new Date().toISOString(),
                todayActive: true,
              }
        );
        return;
      }
      throw new Error(`Check-in failed (${res.status})`);
    }

const data = (await res.json()) as { ok: boolean; streak: StreakInfo };
// Trust server values, but also set last_date = now so checkedToday becomes true immediately
setStudyStreak({ ...data.streak, todayActive: true, last_date: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    alert("Could not register study check-in.");
  } finally {
    setCheckingIn(false);
  }
};

  /* ---------- timer actions ---------- */
  const startSession = async () => {
    try {
      const res = await authFetch(`/study/sessions/start`, {
        method: "POST",
        body: JSON.stringify({ mode: mode.key }),
      });
      if (!res.ok) throw new Error("Start failed");
      const created: Session = await res.json();
      setSessions((prev) => [created, ...prev]);
      setSecondsLeft(mode.minutes * 60);
      setRunning(true);
    } catch (e) {
      console.error(e);
      alert("Could not start session");
    }
  };

  const stopSession = async () => {
    try {
      const res = await authFetch(`/study/sessions/stop`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Stop failed");
      const updated: Session = await res.json();
      setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setRunning(false);
    } catch (e) {
      console.error(e);
      alert("Could not stop session");
    }
  };

  // Auto-stop when hits zero
  useEffect(() => {
    if (running && secondsLeft === 0) {
      void stopSession();
    }
  }, [secondsLeft, running]);

  /* ---------- tasks ---------- */
  const createTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    try {
      const res = await authFetch(`/study/tasks`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Create failed");
      const created: Task = await res.json();
      setTasks((prev) => [created, ...prev]);
      setNewTaskTitle("");
    } catch (e) {
      console.error(e);
      alert("Failed to add task");
    }
  };

  const toggleTask = async (t: Task) => {
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    try {
      const res = await authFetch(`/study/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !t.done }),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch (e) {
      console.error(e);
      setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: t.done } : x)));
    }
  };

  const renameTask = async (t: Task, title: string) => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === t.title) return;
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, title: trimmed } : x)));
    try {
      const res = await authFetch(`/study/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error("Rename failed");
    } catch (e) {
      console.error(e);
      alert("Failed to rename task");
      const r = await authFetch(`/study/tasks`);
      setTasks((await r.json()) as Task[]);
    }
  };

  const deleteTask = async (id: number) => {
    const prev = tasks;
    setTasks((p) => p.filter((x) => x.id !== id));
    try {
      const res = await authFetch(`/study/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch (e) {
      console.error(e);
      alert("Failed to delete task");
      setTasks(prev);
    }
  };

  /* ---------- resources ---------- */
  const addResource = async () => {
    const t = newResource.title.trim();
    if (!t) return;
    try {
      const res = await authFetch(`/study/resources`, {
        method: "POST",
        body: JSON.stringify({ title: t, url: newResource.url || null, note: newResource.note || null }),
      });
      if (!res.ok) throw new Error("Create failed");
      const created: Resource = await res.json();
      setResources((prev) => [created, ...prev]);
      setNewResource({ title: "", url: "", note: "" });
    } catch (e) {
      console.error(e);
      alert("Failed to add resource");
    }
  };

  const updateResource = async (r: Resource, patch: Partial<Resource>) => {
    setResources((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
    try {
      const res = await authFetch(`/study/resources/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch (e) {
      console.error(e);
      alert("Failed to update resource");
      const rr = await authFetch(`/study/resources`);
      setResources((await rr.json()) as Resource[]);
    }
  };

  const deleteResource = async (id: number) => {
    const prev = resources;
    setResources((p) => p.filter((x) => x.id !== id));
    try {
      const res = await authFetch(`/study/resources/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch (e) {
      console.error(e);
      alert("Failed to delete resource");
      setResources(prev);
    }
  };

  /* ---------- derived ---------- */
  const openSession = sessions.find((s) => s.ended_at === null) || null;
  const totalFocusSecs = useMemo(
    () =>
      sessions
        .filter((s) => s.mode === "focus")
        .reduce((sum, s) => sum + (s.ended_at ? s.duration_seconds : 0), 0),
    [sessions]
  );

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-2xl border bg-card shadow-sm p-6 md:p-8 mb-6"
        >
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight flex items-center gap-2">
                <Sparkles className="h-7 w-7 text-primary" />
                {desk?.title || "My Workbench"}
              </h1>
              <p className="text-muted-foreground mt-1">
                Your focused corner of Schedura — plan, study, and track your momentum.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Desk Title</Label>
                <Input
                  className="w-56"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  placeholder="My Workbench"
                />
              </div>
              <Button onClick={saveDesk} disabled={savingDesk} className="whitespace-nowrap">
                {savingDesk ? "Saving..." : "Save Desk"}
              </Button>

              {/* Study check-in (mobile only; desktop uses floating FAB on the right) */}
              <Button
                onClick={doStudyCheckIn}
                disabled={checkingIn || checkedToday}
                variant={checkedToday ? "secondary" : "default"}
                className={clsx(
                  "whitespace-nowrap gap-2 md:hidden",
                  checkedToday
                    ? "bg-emerald-600 text-white hover:bg-emerald-600/90"
                    : "bg-gradient-to-r from-amber-500 to-rose-500 text-white hover:opacity-95"
                )}
                title={checkedToday ? "Already checked in today" : "Register today's study check-in"}
                aria-label={checkedToday ? `Checked in today. Resets in ${resetHMS}.` : "Study check-in"}
              >
                <FlameKindling className="h-4 w-4" />
                {checkedToday ? `Checked in ✓` : checkingIn ? "Checking…" : "Study check-in"}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              Focused {Math.round(totalFocusSecs / 60)} min (last 7d)
            </Badge>
            {openSession && <Badge variant="default">Session in progress</Badge>}

            {/* Study streak badge */}
            {studyStreak && (
              <Badge variant="secondary" className="gap-1">
                <FlameKindling className="h-3.5 w-3.5" />
                {checkedToday ? "Checked in today • " : ""}
                Streak {studyStreak.current_count}d
                {studyStreak.flame?.label ? ` • ${studyStreak.flame.label}` : ""}
                {checkedToday ? ` • resets in ${resetHMS}` : ""}
              </Badge>
            )}
          </div>
        </motion.div>

        {/* Streak Summary Card (compact, accessible) */}
        {studyStreak && (
          <StreakSummaryCard
            streak={studyStreak}
            checkedToday={checkedToday}
            msToMidnight={msToMidnight}
          />
        )}

        {/* RIGHT-SIDE floating streak FAB (desktop only) */}
        <StreakCheckinFab
          streak={studyStreak}
          checkingIn={checkingIn}
          onCheckIn={doStudyCheckIn}
        />

        {/* Grid: Whiteboard / Timer / Tasks / Resources */}
        {loading ? (
          <div className="grid place-items-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading Study Desk…
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {isMobile ? <WhiteboardPlaceholderCard /> : <WhiteboardCard />}

            {/* Timer */}
            <Card className="border bg-card shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FlameKindling className="h-5 w-5 text-primary" />
                    Timer
                  </h2>
                  <div className="flex gap-2">
                    {MODES.map((m) => {
                      const Icon = m.icon;
                      const active = mode.key === m.key;
                      return (
                        <Button
                          key={m.key}
                          variant={active ? "default" : "secondary"}
                          size="sm"
                          onClick={() => {
                            if (running) return;
                            setMode(m);
                          }}
                          className="gap-1"
                        >
                          <Icon className="h-4 w-4" />
                          {m.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div className="py-6 text-center">
                  <div className="text-6xl font-bold tracking-tight tabular-nums">
                    {fmt(Math.floor(secondsLeft / 60))}:{fmt(secondsLeft % 60)}
                  </div>
                  <p className="text-muted-foreground mt-2">{mode.label} mode</p>
                </div>

                <div className="flex items-center justify-center gap-3">
                  {!running ? (
                    <Button size="lg" onClick={startSession} className="px-8">
                      Start
                    </Button>
                  ) : (
                    <Button size="lg" variant="destructive" onClick={stopSession} className="px-8">
                      Stop
                    </Button>
                  )}
                </div>

                <div className="mt-6">
                  <h3 className="text-sm font-semibold mb-2">Recent Sessions</h3>
                  <div className="space-y-2 max-h-48 overflow-auto pr-1">
                    {sessions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No sessions yet.</p>
                    ) : (
                      sessions.slice(0, 8).map((s) => (
                        <div key={s.id} className="flex items-center justify-between text-sm">
                          <span className="truncate">
                            {s.mode} • {fmtDateTime(s.started_at)}
                          </span>
                          <span className="text-muted-foreground">
                            {s.ended_at ? `${Math.round(s.duration_seconds / 60)}m` : "—"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tasks */}
            <Card className="border bg-card shadow-sm lg:col-span-2">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    Tasks
                  </h2>
                </div>

                <div className="flex gap-2 mb-4">
                  <Input
                    placeholder="Add a task…"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createTask();
                      }
                    }}
                  />
                  <Button onClick={createTask} className="gap-2">
                    <PlusCircle className="h-4 w-4" />
                    Add
                  </Button>
                </div>

                <div className="space-y-2">
                  {tasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tasks yet. Add your first task!</p>
                  ) : (
                    tasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        onToggle={() => toggleTask(t)}
                        onRename={(v) => renameTask(t, v)}
                        onDelete={() => deleteTask(t.id)}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Resources */}
            <Card className="border bg-card shadow-sm lg:col-span-2">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Link2 className="h-5 w-5 text-primary" />
                    Resources
                  </h2>
                </div>

                <div className="grid md:grid-cols-3 gap-3 mb-4">
                  <Input
                    placeholder="Title (e.g., Linear Algebra Notes)"
                    value={newResource.title}
                    onChange={(e) => setNewResource((p) => ({ ...p, title: e.target.value }))}
                  />
                  <Input
                    placeholder="URL (optional)"
                    value={newResource.url}
                    onChange={(e) => setNewResource((p) => ({ ...p, url: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="Note (optional)"
                      value={newResource.note}
                      onChange={(e) => setNewResource((p) => ({ ...p, note: e.target.value }))}
                    />
                    <Button onClick={addResource} className="whitespace-nowrap">
                      Add
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {resources.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No resources yet. Save helpful links or notes here.</p>
                  ) : (
                    resources.map((r) => (
                      <ResourceRow
                        key={r.id}
                        res={r}
                        onChange={(patch) => updateResource(r, patch)}
                        onDelete={() => deleteResource(r.id)}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Archive / Tips */}
            <Card className="border bg-card shadow-sm">
              <CardContent className="p-6">
                <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
                  <Archive className="h-5 w-5 text-primary" />
                  Tips
                </h2>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li>Use Focus/Break cycles to keep momentum.</li>
                  <li>Break large tasks into small, finishable ones.</li>
                  <li>Pin key links (syllabus, docs, videos) in Resources.</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Boot check dialog */}
        <Dialog open={bootCheckingOpen} onOpenChange={() => { /* locked during boot */ }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Preparing your desk…</DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking for active sessions…
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

/* =========================================================
   Streak Summary Card  — improved title & layout
========================================================= */
function StreakSummaryCard({
  streak,
  checkedToday,
  msToMidnight,
}: {
  streak: StreakInfo;
  checkedToday: boolean;
  msToMidnight: number;
}) {
  // Tiered titles that get "more superior" as stage increases.
  // Uses backend-provided flame.stage if present; clamps safely.
  const TITLES = ["Initiate", "Learner", "Apprentice", "Scholar", "Expert", "Master", "Grandmaster"] as const;
  const stage = Math.max(0, Math.floor(streak.flame?.stage ?? 0));
  const currentTitle = TITLES[Math.min(stage, TITLES.length - 1)];
  const nextTitle = stage + 1 < TITLES.length ? TITLES[stage + 1] : null;

  const pct = Math.round((streak.flame?.progressToNext ?? 0) * 100);
  const nextAt = streak.flame?.nextCheckpoint ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border bg-card p-4 shadow-sm mb-6"
      aria-live="polite"
    >
      {/* Header row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <FlameKindling className="h-6 w-6 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            {/* Prominent superior title */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-sm">
                {currentTitle}
              </span>
              <span className="text-sm text-muted-foreground">
                Study Streak • {streak.current_count} day{streak.current_count === 1 ? "" : "s"}
              </span>
              <Badge variant="secondary" className="text-xs">Stage {stage}</Badge>
            </div>

            {/* Subline meta */}
            <div className="text-sm text-muted-foreground mt-1 truncate">
              Longest: {streak.longest_count}d
              {streak.start_date ? ` • Started ${new Date(streak.start_date).toLocaleDateString()}` : ""}
              {nextTitle && nextAt > 0 ? (
                <> • Next title: <span className="font-medium text-foreground">{nextTitle}</span> at <span className="tabular-nums">{nextAt}d</span></>
              ) : null}
            </div>
          </div>
        </div>

        {/* Check-in status */}
        <div className="text-sm text-muted-foreground shrink-0">
          {checkedToday ? (
            <span>
              Next check-in in{" "}
              <span className="font-medium text-foreground">{fmtHMS(msToMidnight)}</span>
            </span>
          ) : (
            <span className="text-emerald-600 font-medium">Check-in available now</span>
          )}
        </div>
      </div>

      {/* Progress to next title */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-muted-foreground">
            Progress to {nextTitle ? nextTitle : "next checkpoint"}
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 rounded-full bg-muted overflow-hidden"
        >
          <div
            className="h-full bg-primary transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {nextTitle && nextAt > 0 && (
          <div className="mt-1 text-[12px] text-muted-foreground">
            Next title at <span className="tabular-nums font-medium">{nextAt}d</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* =========================================================
   Floating Streak Check-in (desktop, right side)
========================================================= */
function StreakCheckinFab({
  streak,
  checkingIn,
  onCheckIn,
}: {
  streak: StreakInfo | null;
  checkingIn: boolean;
  onCheckIn: () => void;
}) {
  // derive today status even if backend doesn't send todayActive
// derive today status from last_date using local day
const checkedToday =
  !!streak?.last_date && sameLocalDay(new Date(streak.last_date), new Date());

  // exact countdown to midnight (per second)
  const msLeft = useMidnightTicker();
  const hms = fmtHMS(msLeft);

  return (
    // Use a fixed wrapper so we can offset from the right navbar and center vertically.
    <div
      className="hidden md:block fixed z-50"
      style={{
        right: "calc(var(--right-nav-w, 88px) + 1.25rem)",
        top: "calc(50% + 0.5rem)",
        transform: "translateY(-50%)",
      }}
    >
      <motion.button
        onClick={onCheckIn}
        disabled={checkingIn || checkedToday}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        whileHover={!checkedToday ? { scale: 1.03 } : {}}
        whileTap={!checkedToday ? { scale: 0.98 } : {}}
        className={clsx(
          "rounded-full shadow-2xl ring-2 px-5 py-3",
          "flex items-center gap-3 select-none pointer-events-auto",
          checkedToday
            ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white ring-emerald-300/40"
            : "bg-gradient-to-br from-amber-500 to-rose-500 text-white ring-amber-300/50",
          !checkedToday && "animate-[pulse_2.4s_ease-in-out_infinite]"
        )}
        title={checkedToday ? "Already checked in today" : "Register today's study check-in"}
        aria-label={
          checkedToday
            ? `Checked in today. Streak ${streak?.current_count ?? 0} days. Resets in ${hms}.`
            : "Study check-in"
        }
      >
        <div className="relative">
          <FlameKindling className="h-6 w-6 drop-shadow" />
        </div>
        <div className="text-left">
          <div className="text-sm font-semibold leading-tight">
            {checkedToday ? "Checked in ✓" : checkingIn ? "Checking…" : "Study check-in"}
          </div>
          <div className="text-[12px] opacity-90">
            Streak {streak?.current_count ?? 0}d
            {checkedToday ? ` • resets in ${hms}` : ""}
          </div>
        </div>
      </motion.button>
    </div>
  );
}

/* =========================================================
   Whiteboard Placeholder (mobile)
========================================================= */
function WhiteboardPlaceholderCard() {
  return (
    <Card className="border bg-card shadow-sm lg:col-span-3">
      <CardContent className="p-8">
        <div className="flex items-center gap-3 mb-2">
          <MonitorSmartphone className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Whiteboard</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          The whiteboard is available on the <span className="font-medium">desktop</span> version only.
          Please open Schedura on a larger screen to draw, add text, and move items.
        </p>
      </CardContent>
    </Card>
  );
}

/* =========================================================
   Whiteboard Card (desktop only)
========================================================= */
function WhiteboardCard() {
  const [wb, setWb] = useState<WBState>(DEFAULT_WB);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  // ---- Grid settings ----
  const [showGrid, setShowGrid] = useState<boolean>(true);

  const GRID_MINOR = 20;
  const GRID_MAJOR_EVERY = 5;
  const GRID_EXTENT = 10000000;
  const GRID_MINOR_COLOR = "#9ca3af";
  const GRID_MAJOR_COLOR = "#6b7280";
  const GRID_MINOR_OPACITY = 0.25;
  const GRID_MAJOR_OPACITY = 0.45;
  const [gridRect, setGridRect] = useState<{ x: number; y: number; w: number; h: number }>({
    x: -1000, y: -1000, w: 2000, h: 2000,
  });

  // tools
  const [tool, setTool] = useState<"pan" | "move" | "pen" | "rect" | "text" | "image" | "eraser">("pan");
  const [color, setColor] = useState<string>("#111111");
  const [penSize, setPenSize] = useState<number>(3);
  const [strokeWidth, setStrokeWidth] = useState<number>(2);

  // interaction state
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [spaceHeld, setSpaceHeld] = useState<boolean>(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  // drawing
  const penDrawingRef = useRef<boolean>(false);
  const rectStartRef = useRef<WBPoint | null>(null);

  type DragRef =
    | { kind: "pen"; objIndex: number; startWorld: WBPoint; origPoints: WBPoint[] }
    | { kind: "rect" | "text" | "image"; objIndex: number; startWorld: WBPoint; origX: number; origY: number }
    | null;
  const dragRef = useRef<DragRef>(null);

  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  if (!measureCanvasRef.current) {
    measureCanvasRef.current = document.createElement("canvas");
  }
  const measureText = (text: string, px: number): { width: number; height: number } => {
    const canvas = measureCanvasRef.current!;
       const ctx = canvas.getContext("2d");
    if (!ctx) return { width: text.length * px * 0.6, height: px * 1.2 };
    ctx.font = `${px}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const metrics = ctx.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent || px * 0.8;
    const descent = metrics.actualBoundingBoxDescent || px * 0.2;
    return { width: metrics.width, height: ascent + descent };
  };

  // load from backend
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`/study/whiteboard`);
        if (res.ok) {
          const data = (await res.json()) as { state: WBState | null };
          setWb(data.state ?? DEFAULT_WB);
        } else {
          setWb(DEFAULT_WB);
        }
      } catch {
        setWb(DEFAULT_WB);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isEditableTarget = (el: EventTarget | null) => {
    const node = el as HTMLElement | null;
    if (!node) return false;
    const tag = node.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || (node as HTMLElement).isContentEditable;
  };

  // keyboard (space to pan) — but DON'T steal space from inputs
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (isEditableTarget(e.target)) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        setSpaceHeld(false);
        setIsPanning(false);
        panStartRef.current = null;
      }
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up, { passive: false });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const toWorld = (clientX: number, clientY: number, host: HTMLDivElement): WBPoint => {
    const r = host.getBoundingClientRect();
    const x = (clientX - r.left - wb.tx) / wb.scale;
    const y = (clientY - r.top - wb.ty) / wb.scale;
    return { x, y };
  };

  const hitTest = (pt: WBPoint): { index: number } | null => {
    for (let i = wb.objects.length - 1; i >= 0; i--) {
      const o = wb.objects[i];
      if (o.type === "rect") {
        const rx = Math.min(o.x, o.x + o.w);
        const ry = Math.min(o.y, o.y + o.h);
        const rw = Math.abs(o.w);
        const rh = Math.abs(o.h);
        if (pt.x >= rx && pt.x <= rx + rw && pt.y >= ry && pt.y <= ry + rh) return { index: i };
      } else if (o.type === "image") {
        if (pt.x >= o.x && pt.x <= o.x + o.w && pt.y >= o.y && pt.y <= o.y + o.h) return { index: i };
      } else if (o.type === "text") {
        const { width, height } = measureText(o.text, o.size);
        const rx = o.x;
        const ry = o.y;
        const rw = width;
        const rh = height;
        if (pt.x >= rx && pt.x <= rx + rw && pt.y >= ry && pt.y <= ry + rh) return { index: i };
      } else if (o.type === "pen") {
        if (o.points.length > 0) {
          const xs = o.points.map((p) => p.x);
          const ys = o.points.map((p) => p.y);
          const minX = Math.min(...xs) - o.size * 1.5;
          const maxX = Math.max(...xs) + o.size * 1.5;
          const minY = Math.min(...ys) - o.size * 1.5;
          const maxY = Math.max(...ys) + o.size * 1.5;
          if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) return { index: i };
        }
      }
    }
    return null;
  };

  const onWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (!hostRef.current) return;
    const { x, y } = toWorld(e.clientX, e.clientY, hostRef.current);
    const scaleDelta = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(5, Math.max(0.2, wb.scale * scaleDelta));

    const nx = x * newScale + wb.tx;
    const ny = y * newScale + wb.ty;
    const rect = hostRef.current.getBoundingClientRect();
    const dx = e.clientX - rect.left - nx;
    const dy = e.clientY - rect.top - ny;

    setWb((prev) => ({ ...prev, scale: newScale, tx: prev.tx + dx, ty: prev.ty + dy }));
    requestSave();
  };

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!hostRef.current) return;
    const world = toWorld(e.clientX, e.clientY, hostRef.current);

    if (tool === "pan" || spaceHeld) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - wb.tx, y: e.clientY - wb.ty };
      return;
    }

    if (tool === "pen") {
      penDrawingRef.current = true;
      const pen: WBPen = { type: "pen", id: uid("pen"), color, size: penSize, points: [world] };
      setWb((prev) => ({ ...prev, objects: [...prev.objects, pen] }));
      return;
    }

    if (tool === "rect") {
      rectStartRef.current = world;
      const rect: WBRect = { type: "rect", id: uid("rect"), x: world.x, y: world.y, w: 0, h: 0, color, fill: null, strokeWidth };
      setWb((prev) => ({ ...prev, objects: [...prev.objects, rect] }));
      return;
    }

    if (tool === "text") {
      const text = window.prompt("Enter text:");
      if (text && text.trim()) {
        const obj: WBText = { type: "text", id: uid("txt"), x: world.x, y: world.y, text: text.trim(), color, size: 18 };
        setWb((prev) => ({ ...prev, objects: [...prev.objects, obj] }));
        requestSave();
      }
      return;
    }

    if (tool === "image") {
      return;
    }

    if (tool === "eraser") {
      const hit = hitTest(world);
      if (hit) {
        setWb((prev) => {
          const arr = prev.objects.slice();
          arr.splice(hit.index, 1);
          return { ...prev, objects: arr };
        });
        requestSave();
      }
      return;
    }

    if (tool === "move") {
      const hit = hitTest(world);
      if (hit) {
        const obj = wb.objects[hit.index];
        if (obj.type === "pen") {
          dragRef.current = {
            kind: "pen",
            objIndex: hit.index,
            startWorld: world,
            origPoints: obj.points.map((p) => ({ x: p.x, y: p.y })),
          };
        } else {
          dragRef.current = {
            kind: obj.type,
            objIndex: hit.index,
            startWorld: world,
            origX: obj.x,
            origY: obj.y,
          };
        }
      } else {
        dragRef.current = null;
      }
      return;
    }
  };

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!hostRef.current) return;

    if (isPanning && panStartRef.current) {
      const ntx = e.clientX - panStartRef.current.x;
      const nty = e.clientY - panStartRef.current.y;
      setWb((prev) => ({ ...prev, tx: ntx, ty: nty }));
      return;
    }

    if (penDrawingRef.current) {
      setWb((prev) => {
        const last = prev.objects[prev.objects.length - 1];
        if (!last || last.type !== "pen") return prev;
        const pt = toWorld(e.clientX, e.clientY, hostRef.current!);
        const updated: WBPen = { ...last, points: [...last.points, pt] };
        const arr = prev.objects.slice(0, -1).concat(updated);
        return { ...prev, objects: arr };
      });
      return;
    }

    if (tool === "rect" && rectStartRef.current) {
      const cur = toWorld(e.clientX, e.clientY, hostRef.current);
      setWb((prev) => {
        const last = prev.objects[prev.objects.length - 1];
        if (!last || last.type !== "rect") return prev;
        const sx = rectStartRef.current!.x;
        const sy = rectStartRef.current!.y;
        const updated: WBRect = { ...last, x: sx, y: sy, w: cur.x - sx, h: cur.y - sy };
        const arr = prev.objects.slice(0, -1).concat(updated);
        return { ...prev, objects: arr };
      });
      return;
    }

    if (tool === "move" && dragRef.current) {
      const cur = toWorld(e.clientX, e.clientY, hostRef.current);
      const dx = cur.x - dragRef.current.startWorld.x;
      const dy = cur.y - dragRef.current.startWorld.y;

      setWb((prev) => {
        const arr = prev.objects.slice();
        const d = dragRef.current!;
        const obj = arr[d.objIndex];
        if (!obj) return prev;

        if (d.kind === "pen" && obj.type === "pen") {
          const updated: WBPen = {
            ...obj,
            points: d.origPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          };
          arr[d.objIndex] = updated;
        } else if (obj.type === "rect" && d.kind === "rect") {
          arr[d.objIndex] = { ...obj, x: d.origX + dx, y: d.origY + dy };
        } else if (obj.type === "text" && d.kind === "text") {
          arr[d.objIndex] = { ...obj, x: d.origX + dx, y: d.origY + dy };
        } else if (obj.type === "image" && d.kind === "image") {
          arr[d.objIndex] = { ...obj, x: d.origX + dx, y: d.origY + dy };
        }
        return { ...prev, objects: arr };
      });
      return;
    }
  };

  const onMouseUp: React.MouseEventHandler<HTMLDivElement> = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
      requestSave();
      return;
    }
    if (penDrawingRef.current) {
      penDrawingRef.current = false;
      requestSave();
      return;
    }
    if (rectStartRef.current) {
      rectStartRef.current = null;
      requestSave();
      return;
    }
    if (dragRef.current) {
      dragRef.current = null;
      requestSave();
    }
  };

  const onImagePick = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      const obj: WBImage = { type: "image", id: uid("img"), x: 0, y: 0, w: 300, h: 200, src };
      setWb((prev) => ({ ...prev, objects: [...prev.objects, obj] }));
      requestSave();
    };
    reader.readAsDataURL(f);
  };

  const saveTimer = useRef<number | null>(null);
  const requestSave = (immediate = false) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const doSave = async () => {
      try {
        setSaving(true);
        await authFetch(`/study/whiteboard`, {
          method: "PATCH",
          body: JSON.stringify({ state: wb }),
        });
      } catch {
        // ignore
      } finally {
        setSaving(false);
      }
    };
    if (immediate) void doSave();
    else saveTimer.current = window.setTimeout(doSave, 600);
  };

  const cursor =
    spaceHeld || tool === "pan"
      ? "grab"
      : tool === "pen"
      ? "crosshair"
      : tool === "rect"
      ? "crosshair"
      : tool === "move"
      ? "move"
      : tool === "eraser"
      ? "not-allowed"
      : "default";

  return (
    <Card className="border bg-card shadow-sm lg:col-span-3">
      <CardContent className="p-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center gap-2">
            <Button variant={tool === "pan" ? "default" : "secondary"} size="sm" onClick={() => setTool("pan")}>
              <Hand className="h-4 w-4 mr-1" /> Pan
            </Button>
            <Button variant={tool === "move" ? "default" : "secondary"} size="sm" onClick={() => setTool("move")}>
              <Move className="h-4 w-4 mr-1" /> Move
            </Button>
            <Button variant={tool === "pen" ? "default" : "secondary"} size="sm" onClick={() => setTool("pen")}>
              Pen
            </Button>
            <Button variant={tool === "rect" ? "default" : "secondary"} size="sm" onClick={() => setTool("rect")}>
              Rect
            </Button>
            <Button variant={tool === "text" ? "default" : "secondary"} size="sm" onClick={() => setTool("text")}>
              Text
            </Button>
            <Button variant={tool === "eraser" ? "default" : "secondary"} size="sm" onClick={() => setTool("eraser")}>
              <Eraser className="h-4 w-4 mr-1" /> Erase
            </Button>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 border rounded-md cursor-pointer text-sm">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImagePick(file);
                  e.currentTarget.value = "";
                }}
              />
              Image…
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant={showGrid ? "default" : "secondary"}
              size="sm"
              onClick={() => setShowGrid((v) => !v)}
              title={showGrid ? "Hide grid" : "Show grid"}
              className="gap-1"
            >
              <LayoutGrid className="h-4 w-4" />
              Grid
            </Button>

            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Color" />
            <div className="flex items-center gap-1 text-sm">
              <span>Pen</span>
              <Input
                type="number"
                min={1}
                max={20}
                value={penSize}
                onChange={(e) => setPenSize(Number(e.target.value) || 1)}
                className="w-14"
              />
            </div>
            <div className="flex items-center gap-1 text-sm">
              <span>Stroke</span>
              <Input
                type="number"
                min={1}
                max={10}
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value) || 1)}
                className="w-14"
              />
            </div>
            <Button size="sm" onClick={() => requestSave(true)} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {/* Host + world */}
        <div
          ref={hostRef}
          className="relative overflow-hidden select-none"
          style={{ height: 520, background: "#fff", cursor, outline: "none" }}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          tabIndex={-1}
        >
          <div
            className="absolute inset-0"
            style={{
              transform: `translate(${wb.tx}px, ${wb.ty}px) scale(${wb.scale})`,
              transformOrigin: "0 0",
            }}
          >
            {showGrid && (
              <svg
                style={{
                  position: "absolute",
                  left: -GRID_EXTENT,
                  top: -GRID_EXTENT,
                  width: GRID_EXTENT * 2,
                  height: GRID_EXTENT * 2,
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              >
                <defs>
                  <pattern id="wb-grid-minor" width={GRID_MINOR} height={GRID_MINOR} patternUnits="userSpaceOnUse">
                    <path
                      d={`M ${GRID_MINOR} 0 L 0 0 0 ${GRID_MINOR}`}
                      fill="none"
                      stroke={GRID_MINOR_COLOR}
                      strokeOpacity={GRID_MINOR_OPACITY}
                      strokeWidth={1 / wb.scale}
                    />
                  </pattern>
                  <pattern
                    id="wb-grid-major"
                    width={GRID_MINOR * GRID_MAJOR_EVERY}
                    height={GRID_MINOR * GRID_MAJOR_EVERY}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={`M ${GRID_MINOR * GRID_MAJOR_EVERY} 0 L 0 0 0 ${GRID_MINOR * GRID_MAJOR_EVERY}`}
                      fill="none"
                      stroke={GRID_MAJOR_COLOR}
                      strokeOpacity={GRID_MAJOR_OPACITY}
                      strokeWidth={1.5 / wb.scale}
                    />
                  </pattern>
                </defs>
                <rect
                  x={-GRID_EXTENT}
                  y={-GRID_EXTENT}
                  width={GRID_EXTENT * 2}
                  height={GRID_EXTENT * 2}
                  fill="url(#wb-grid-minor)"
                />
                <rect
                  x={-GRID_EXTENT}
                  y={-GRID_EXTENT}
                  width={GRID_EXTENT * 2}
                  height={GRID_EXTENT * 2}
                  fill="url(#wb-grid-major)"
                />
              </svg>
            )}

            {wb.objects.map((o) => {
              if (o.type === "pen") {
                const d = o.points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
                return (
                  <svg key={o.id} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
                    <path d={d} fill="none" stroke={o.color} strokeWidth={o.size} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                );
              }
              if (o.type === "rect") {
                const rx = Math.min(o.x, o.x + o.w);
                const ry = Math.min(o.y, o.y + o.h);
                const rw = Math.abs(o.w);
                const rh = Math.abs(o.h);
                return (
                  <div
                    key={o.id}
                    style={{
                      position: "absolute",
                      left: rx,
                      top: ry,
                      width: rw,
                      height: rh,
                      border: `${o.strokeWidth}px solid ${o.color}`,
                      background: o.fill ?? "transparent",
                      userSelect: "none",
                      outline: "none",
                    }}
                  />
                );
              }
              if (o.type === "text") {
                return (
                  <div
                    key={o.id}
                    style={{
                      position: "absolute",
                      left: o.x,
                      top: o.y,
                      color: o.color,
                      fontSize: o.size,
                      whiteSpace: "pre",
                      userSelect: "none",
                      outline: "none",
                      lineHeight: 1.1,
                    }}
                  >
                    {o.text}
                  </div>
                );
              }
              const img = o as WBImage;
              return (
                <img
                  key={img.id}
                  src={img.src}
                  alt=""
                  draggable={false}
                  style={{
                    position: "absolute",
                    left: img.x,
                    top: img.y,
                    width: img.w,
                    height: img.h,
                    objectFit: "contain",
                    userSelect: "none",
                    outline: "none",
                  }}
                />
              );
            })}
          </div>

          {loading && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading whiteboard…
              </div>
            </div>
          )}

          <div className="absolute bottom-2 left-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
            Space + drag to pan • Wheel to zoom • Move tool to drag objects • Eraser to delete
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* =========================================================
   Task Row
========================================================= */
function TaskRow({
  task,
  onToggle,
  onRename,
  onDelete,
}: {
  task: { id: number; title: string; done: boolean; created_at: string };
  onToggle: () => void;
  onRename: (v: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(task.title);

  useEffect(() => setVal(task.title), [task.title]);

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg border bg-background/50">
      <button
        onClick={onToggle}
        className={clsx(
          "h-6 w-6 grid place-items-center rounded-full border transition-colors",
          task.done ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary"
        )}
        title={task.done ? "Mark as not done" : "Mark as done"}
      >
        {task.done ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
      </button>

      {!editing ? (
        <div className="flex-1">
          <div
            className={clsx("leading-tight", task.done && "line-through text-muted-foreground")}
            onDoubleClick={() => setEditing(true)}
          >
            {task.title}
          </div>
          <div className="text-xs text-muted-foreground">{fmtDateTime(task.created_at)}</div>
        </div>
      ) : (
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            void onRename(val);
          }}
        >
          <Input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => {
              setEditing(false);
              void onRename(val);
            }}
          />
        </form>
      )}

      <div className="flex items-center gap-1">
        {!editing && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(true)} title="Rename">
            <Pencil className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete} title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* =========================================================
   Resource Row
========================================================= */
function ResourceRow({
  res,
  onChange,
  onDelete,
}: {
  res: Resource;
  onChange: (patch: Partial<Resource>) => void;
  onDelete: () => void;
}) {
  const [editTitle, setEditTitle] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [t, setT] = useState(res.title);
  const [u, setU] = useState(res.url || "");
  const [n, setN] = useState(res.note || "");

  useEffect(() => {
    setT(res.title);
    setU(res.url || "");
    setN(res.note || "");
  }, [res]);

  return (
    <div className="p-3 rounded-lg border bg-background/50">
      {/* Title + URL */}
      <div className="flex items-center gap-2">
        {!editTitle ? (
          <>
            <a
              href={res.url || undefined}
              target="_blank"
              rel="noreferrer"
              className={clsx("font-medium", res.url ? "hover:underline text-primary" : "")}
            >
              {res.title}
            </a>
            {res.url && (
              <Badge variant="secondary" className="ml-1">
                <Link2 className="h-3.5 w-3.5 mr-1" />
                Link
              </Badge>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditTitle(true)} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <form
            className="flex-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setEditTitle(false);
              onChange({ title: t, url: u || null });
            }}
          >
            <Input className="flex-1" value={t} onChange={(e) => setT(e.target.value)} placeholder="Title" />
            <Input className="flex-1" value={u} onChange={(e) => setU(e.target.value)} placeholder="URL" />
            <Button type="submit">Save</Button>
          </form>
        )}
        <div className="ml-auto">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete} title="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Note */}
      <div className="mt-2">
        {!editNote ? (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
            {res.note ? res.note : <span className="opacity-70">No note</span>}
            <Button variant="ghost" size="sm" className="ml-1 h-7" onClick={() => setEditNote(true)}>
              Edit note
            </Button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setEditNote(false);
              onChange({ note: n || null });
            }}
          >
            <Textarea value={n} onChange={(e) => setN(e.target.value)} rows={3} />
            <div className="mt-2">
              <Button type="submit" size="sm">
                Save
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
