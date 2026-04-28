// src/pages/GroupSchedule.tsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Calendar as CalendarIcon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Trash2,
  Clock,
  MapPin,
  Info,
  Users,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Filter,
  List as ListIcon,
  LayoutGrid,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { API_BASE, getToken } from "@/lib/api";

/* ---------- types ---------- */
type EventType = "personal" | "group";

type Group = {
  id: number;
  name: string;
  highlight_color?: string | null;
};

type GroupEvent = {
  id: number;
  group_id: number | null;
  date: string; // ISO "YYYY-MM-DD"
  title: string;
  description?: string | null;
  location?: string | null;
  start_time?: string | null; // "HH:mm"
  end_time?: string | null;   // "HH:mm"
  type: EventType;
  groups?: Group | null;
};

type LoadState = "idle" | "loading" | "error";
type ViewMode = "month" | "agenda";

/* ---------- utils ---------- */
function fmtDate(d: string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function timeRange(ev: GroupEvent): string | null {
  const s = ev.start_time ?? "";
  const e = ev.end_time ?? "";
  if (s && e) return `${s}–${e}`;
  if (s) return s;
  if (e) return e;
  return null;
}
function colorOrHash(group: Group | null | undefined): string {
  if (group?.highlight_color) return group.highlight_color;
  if (!group?.id) return "#6366F1"; // fallback indigo
  const hues = [262, 199, 150, 18, 340, 120, 200];
  const h = hues[group.id % hues.length];
  return `hsl(${h} 80% 60%)`;
}
function apiPath(p: string) {
  return p.startsWith("/") ? p : `/${p}`;
}
async function apiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: token ?? "",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = "Request failed";
    try {
      const t = await res.text();
      msg = t || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/* ---- UTC date helpers (align with backend date-only keys) ---- */
function utcDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}
function toKeyUTC(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
function todayKeyUTC(): string {
  const now = new Date();
  return toKeyUTC(utcDate(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function startOfMonthUTC(year: number, month: number) {
  return utcDate(year, month, 1);
}
function endOfMonthUTC(year: number, month: number) {
  return utcDate(year, month + 1, 0);
}
function monthMatrixUTC(year: number, month: number) {
  const first = startOfMonthUTC(year, month);
  const startDow = first.getUTCDay(); // 0=Sun
  const gridStart = utcDate(year, month, 1 - startDow);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = utcDate(
      gridStart.getUTCFullYear(),
      gridStart.getUTCMonth(),
      gridStart.getUTCDate() + i
    );
    days.push(d);
  }
  return days;
}

/* ---- Local-day helpers (UI: show the user's real "today") ---- */
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
function toKeyLocal(dt: Date): string {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function todayKeyLocal(): string {
  return toKeyLocal(new Date());
}

/* ---------- lightweight toast ---------- */
function Toast({ kind, message }: { kind: "error" | "success"; message: string }) {
  const Icon = kind === "error" ? AlertCircle : CheckCircle2;
  const bg =
    kind === "error"
      ? "bg-red-50 text-red-800 border-red-200"
      : "bg-emerald-50 text-emerald-800 border-emerald-200";
  return (
    <div className={`fixed z-50 bottom-5 left-1/2 -translate-x-1/2 rounded-xl border px-4 py-2 shadow ${bg}`}>
      <div className="flex items-center gap-2 text-sm">
        <Icon className="w-4 h-4" />
        <span className="max-w-[70vw] line-clamp-2">{message}</span>
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */
function EmptyHint({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="p-8 text-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <CalendarIcon className="w-5 h-5" />
          <p>{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------- Mini Month (sidebar) ---------- */
function MiniMonth({
  ym,
  onChangeMonth,
  selectedKey,
  onSelectDate,
  accent,
}: {
  ym: { y: number; m: number };
  onChangeMonth: (delta: -1 | 1) => void;
  selectedKey: string;
  onSelectDate: (k: string) => void;
  accent: string;
}) {
  const days = monthMatrixUTC(ym.y, ym.m); // keep UTC grid for backend-aligned range
  const currentMonth = ym.m;
  const todayKey = todayKeyLocal(); // <- local "today"
  const monthLabel = new Date(Date.UTC(ym.y, ym.m, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="rounded-2xl border p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <Button variant="ghost" size="icon" onClick={() => onChangeMonth(-1)} aria-label="Previous month">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="text-sm font-medium">{monthLabel}</div>
        <Button variant="ghost" size="icon" onClick={() => onChangeMonth(1)} aria-label="Next month">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-7 text-[10px] text-muted-foreground mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
          <div key={d} className="text-center py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const k = toKeyUTC(d);       // still used to talk to server / keying grid
          const kLocal = toKeyLocal(d); // local key for UI
          const isToday = kLocal === todayKey;
          const inMonth = d.getUTCMonth() === currentMonth;
          const isSelected = kLocal === selectedKey;
          return (
            <button
              key={k}
              className={[
                "h-7 rounded-md text-[11px] flex items-center justify-center border transition",
                inMonth ? "text-foreground" : "text-muted-foreground/60",
                isSelected ? "bg-primary text-primary-foreground border-primary" : "border-transparent",
                !isSelected && isToday ? "border-[1px]" : "",
              ].join(" ")}
              style={!isSelected && isToday ? { borderColor: accent } : undefined}
              onClick={() => onSelectDate(k)}
              title={fmtDayLabel(d)}
              aria-current={isToday ? "date" : undefined}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => onSelectDate(todayKeyLocal())}>
          Today
        </Button>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
          <CalendarDays className="w-3.5 h-3.5" />
          Today uses your local time
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */

export default function GroupSchedule() {
  /* --------- constants --------- */
  const PERSONAL_ACCENT = "hsl(220 80% 60%)";

  /* --------- view & month state --------- */
  const [view, setView] = useState<ViewMode>("month");
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({
    y: now.getFullYear(),
    m: now.getMonth(),
  });
  const currentMonthLabel = new Date(Date.UTC(ym.y, ym.m, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const monthFromKey = toKeyUTC(startOfMonthUTC(ym.y, ym.m));
  const monthToKey = toKeyUTC(endOfMonthUTC(ym.y, ym.m));
  const todayKey = todayKeyLocal();

  /* --------- data: groups --------- */
  const [groups, setGroups] = useState<Group[]>([]);
  const [gState, setGState] = useState<LoadState>("idle");
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);

  /* --------- data: events (group + personal overlay) --------- */
  const [groupEvents, setGroupEvents] = useState<GroupEvent[]>([]);
  const [personalEvents, setPersonalEvents] = useState<GroupEvent[]>([]);
  const [geState, setGeState] = useState<LoadState>("idle");
  const [peState, setPeState] = useState<LoadState>("idle");
  const includePersonal = useRef<boolean>(true);
  const [includePersonalUI, setIncludePersonalUI] = useState<boolean>(true);

  /* --------- dialog / editing --------- */
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<GroupEvent | null>(null);
  const [form, setForm] = useState<{
    date: string;
    title: string;
    location: string;
    start_time: string;
    end_time: string;
    description: string;
    type: EventType;
  }>({
    date: new Date().toISOString().slice(0, 10),
    title: "",
    location: "",
    start_time: "",
    end_time: "",
    description: "",
    type: "group",
  });

  /* --------- day sheet dialog --------- */
  const [dayOpenKey, setDayOpenKey] = useState<string | null>(null);

  /* --------- quick filters / search --------- */
  const [q, setQ] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<"all" | "group" | "personal">("all");

  /* --------- density (max items / day cell) --------- */
  const [cellCap, setCellCap] = useState<number>(4);

  /* --------- quick add row --------- */
  const [qa, setQa] = useState({
    title: "",
    date: todayKey,
    start: "",
    end: "",
    location: "",
    type: "group" as EventType,
  });
  const canQuickAdd = qa.title.trim().length > 0 && (qa.type === "personal" || selectedGroupId != null);

  /* --------- toast --------- */
  const [toast, setToast] = useState<{ kind: "error" | "success"; msg: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  function showToast(kind: "error" | "success", msg: string) {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ kind, msg });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600);
  }

  /* --------- derived --------- */
  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );

  // Accent always based on the selected group (no personal-only mode)
  const accent = colorOrHash(selectedGroup);

  const mergedEvents: GroupEvent[] = useMemo(() => {
    return includePersonal.current ? [...groupEvents, ...personalEvents] : groupEvents;
  }, [groupEvents, personalEvents]);

  const filteredEvents = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return mergedEvents.filter((ev) => {
      const matchesType = typeFilter === "all" ? true : ev.type === typeFilter;
      const hay = `${ev.title} ${ev.location ?? ""} ${ev.description ?? ""}`.toLowerCase();
      const matchesQ = qLower ? hay.includes(qLower) : true;
      return matchesType && matchesQ;
    });
  }, [mergedEvents, q, typeFilter]);

  const eventsByKey = useMemo(() => {
    const map = new Map<string, GroupEvent[]>();
    for (const ev of filteredEvents) {
      const k = ev.date.slice(0, 10);
      const arr = map.get(k) ?? [];
      arr.push(ev);
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = a.start_time ?? "";
        const tb = b.start_time ?? "";
        if (ta === tb) return a.title.localeCompare(b.title);
        return ta.localeCompare(tb);
      });
    }
    return map;
  }, [filteredEvents]);

  const agendaSections = useMemo(() => {
    const entries = Array.from(eventsByKey.entries()).sort(([d1], [d2]) => d1.localeCompare(d2));
    return entries;
  }, [eventsByKey]);

  const loadState: LoadState = (() => {
    if (geState === "loading" || (includePersonalUI && peState === "loading")) return "loading";
    if (geState === "error" || (includePersonalUI && peState === "error")) return "error";
    return "idle";
  })();

  /* --------- api: groups --------- */
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setGState("loading");
        const data = await apiJSON<Group[]>(apiPath("groups/mine"));
        if (!ignore) {
          setGroups(data);
          setGState("idle");
          if (!selectedGroupId && data.length > 0) {
            setSelectedGroupId(data[0].id);
          }
        }
      } catch {
        if (!ignore) {
          setGState("error");
          showToast("error", "Failed to load groups.");
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, [selectedGroupId]);

  /* --------- api: group events --------- */
  const loadGroupEvents = useCallback(
    async (groupId: number | null, fromKey: string, toKey: string) => {
      if (!groupId) {
        setGroupEvents([]);
        return;
      }
      setGeState("loading");
      try {
        const qs = `?${new URLSearchParams({ from: fromKey, to: toKey }).toString()}`;
        const data = await apiJSON<{ group: Group; events: GroupEvent[] }>(
          apiPath(`groups/${groupId}/schedule${qs}`)
        );
        const withType = data.events.map((e) => ({ ...e, type: "group" as const }));
        setGroupEvents(withType);
        setGeState("idle");
      } catch {
        setGeState("error");
        showToast("error", "Failed to load group events.");
      }
    },
    []
  );

  useEffect(() => {
    if (selectedGroupId) {
      void loadGroupEvents(selectedGroupId, monthFromKey, monthToKey);
    } else {
      setGroupEvents([]);
    }
  }, [selectedGroupId, monthFromKey, monthToKey, loadGroupEvents]);

  /* --------- api: personal events (GET /schedules) --------- */
  const loadPersonalEvents = useCallback(
    async (fromKey: string, toKey: string) => {
      setPeState("loading");
      try {
        const all = await apiJSON<GroupEvent[]>(apiPath(`schedules`)); // personal only by default
        const withinRange = all
          .filter((e) => e.type === "personal")
          .filter((e) => {
            const k = e.date.slice(0, 10);
            return k >= fromKey && k <= toKey;
          });
        const withType = withinRange.map((e) => ({ ...e, type: "personal" as const }));
        setPersonalEvents(withType);
        setPeState("idle");
      } catch {
        setPeState("error");
        showToast("error", "Failed to load personal events.");
      }
    },
    []
  );

  useEffect(() => {
    includePersonal.current = includePersonalUI;
    if (includePersonalUI) {
      void loadPersonalEvents(monthFromKey, monthToKey);
    } else {
      setPersonalEvents([]);
    }
  }, [includePersonalUI, monthFromKey, monthToKey, loadPersonalEvents]);

  /* --------- create/edit helpers --------- */
  const openCreate = useCallback((dateKey?: string) => {
    setEditing(null);
    setForm({
      date: dateKey ?? new Date().toISOString().slice(0, 10),
      title: "",
      location: "",
      start_time: "",
      end_time: "",
      description: "",
      type: selectedGroupId ? "group" : "personal",
    });
    setDialogOpen(true);
  }, [selectedGroupId]);

  const openEdit = useCallback((ev: GroupEvent) => {
    setEditing(ev);
    setForm({
      date: ev.date.slice(0, 10),
      title: ev.title,
      location: ev.location ?? "",
      start_time: ev.start_time ?? "",
      end_time: ev.end_time ?? "",
      description: ev.description ?? "",
      type: ev.type,
    });
    setDialogOpen(true);
  }, []);

  const validateForm = useCallback((): string | null => {
    if (!form.title.trim()) return "Title is required.";
    if (form.start_time && form.end_time && form.start_time > form.end_time) {
      return "End time must be after start time.";
    }
    if (form.type === "group" && !selectedGroupId) {
      return "Choose a group for a group event.";
    }
    return null;
  }, [form.end_time, form.start_time, form.title, form.type, selectedGroupId]);

  const refetchAll = useCallback(async () => {
    if (selectedGroupId) {
      await loadGroupEvents(selectedGroupId, monthFromKey, monthToKey);
    }
    if (includePersonalUI) {
      await loadPersonalEvents(monthFromKey, monthToKey);
    }
  }, [includePersonalUI, loadGroupEvents, loadPersonalEvents, monthFromKey, monthToKey, selectedGroupId]);

  const saveForm = useCallback(async () => {
    const problem = validateForm();
    if (problem) {
      showToast("error", problem);
      return;
    }

    try {
      const groupPayload = {
        date: form.date,
        title: form.title.trim(),
        location: form.location.trim() || undefined,
        start_time: form.start_time || undefined,
        end_time: form.end_time || undefined,
        description: form.description.trim() || undefined,
      };
      const personalPayload = {
        date: form.date,
        title: form.title.trim(),
        location: form.location.trim() || undefined,     // <-- now sent
        start_time: form.start_time || undefined,
        end_time: form.end_time || undefined,
        description: form.description.trim() || undefined, // <-- now sent
      };

      if (editing) {
        // UPDATE
        if (editing.type === "group") {
          await apiJSON<GroupEvent>(
            apiPath(`groups/${editing.group_id ?? selectedGroupId}/schedule/${editing.id}`),
            { method: "PUT", body: JSON.stringify(groupPayload) }
          );
        } else {
          // Personal upsert (by date); include location & description
          await apiJSON<GroupEvent>(apiPath(`schedules`), {
            method: "POST",
            body: JSON.stringify(personalPayload),
          });
          // If date changed, delete old to avoid duplicates across days
          const oldKey = editing.date.slice(0, 10);
          if (oldKey !== form.date) {
            await apiJSON<{ success: boolean }>(apiPath(`schedules/${editing.id}`), { method: "DELETE" });
          }
        }
        showToast("success", "Event updated.");
      } else {
        // CREATE
        if (form.type === "group") {
          await apiJSON<GroupEvent>(apiPath(`groups/${selectedGroupId}/schedule`), {
            method: "POST",
            body: JSON.stringify(groupPayload),
          });
        } else {
          await apiJSON<GroupEvent>(apiPath(`schedules`), {
            method: "POST",
            body: JSON.stringify(personalPayload),
          });
        }
        showToast("success", "Event created.");
      }

      setDialogOpen(false);
      await refetchAll();
      const d = new Date(form.date);
      setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not save event.";
      showToast("error", msg);
    }
  }, [editing, form.date, form.description, form.end_time, form.location, form.start_time, form.title, form.type, refetchAll, selectedGroupId, validateForm]);

  const deleteEvent = useCallback(
    async (ev: GroupEvent) => {
      try {
        if (ev.type === "group") {
          await apiJSON<{ success: boolean }>(
            apiPath(`groups/${ev.group_id ?? selectedGroupId}/schedule/${ev.id}`),
            { method: "DELETE" }
          );
        } else {
          await apiJSON<{ success: boolean }>(apiPath(`schedules/${ev.id}`), { method: "DELETE" });
        }
        showToast("success", "Event deleted.");
        await refetchAll();
      } catch {
        showToast("error", "Failed to delete event.");
      }
    },
    [refetchAll, selectedGroupId]
  );

  /* --------- agenda auto-scroll --------- */
  const todayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (view !== "agenda") return;
    const t = window.setTimeout(() => {
      todayRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
    return () => window.clearTimeout(t);
  }, [view, agendaSections.length]);

  /* --------- keyboard: save in dialog --------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!dialogOpen) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void saveForm();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, saveForm]);

  /* --------- header actions --------- */
  const goPrevMonth = () => {
    setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }));
  };
  const goNextMonth = () => {
    setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
  };
  const goToday = () => {
    const d = new Date();
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };

  /* --------- quick add --------- */
  const doQuickAdd = useCallback(async () => {
    if (!canQuickAdd) return;
    if (qa.start && qa.end && qa.start > qa.end) {
      showToast("error", "End time must be after start time.");
      return;
    }
    try {
      if (qa.type === "group") {
        const payload = {
          date: qa.date,
          title: qa.title.trim(),
          location: qa.location.trim() || undefined,
          start_time: qa.start || undefined,
          end_time: qa.end || undefined,
        };
        await apiJSON<GroupEvent>(apiPath(`groups/${selectedGroupId}/schedule`), {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else {
        const payload = {
          date: qa.date,
          title: qa.title.trim(),
          location: qa.location.trim() || undefined, // <-- now included for personal quick add
          start_time: qa.start || undefined,
          end_time: qa.end || undefined,
        };
        await apiJSON<GroupEvent>(apiPath(`schedules`), {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setQa((p) => ({ ...p, title: "", start: "", end: "", location: "" }));
      showToast("success", "Event created.");
      await refetchAll();
      const d = new Date(qa.date);
      setYm({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Quick add failed.";
      showToast("error", msg);
    }
  }, [canQuickAdd, qa.date, qa.end, qa.location, qa.start, qa.title, qa.type, refetchAll, selectedGroupId]);

  /* --------- helpers --------- */
  const days = monthMatrixUTC(ym.y, ym.m);
  const eventAccent = (ev: GroupEvent) =>
    ev.type === "personal" ? PERSONAL_ACCENT : colorOrHash(ev.groups ?? selectedGroup);

  const dayEvents = (dateKey: string) => eventsByKey.get(dateKey) ?? [];

  // Header scope just mirrors the current filter
  const headerScope = typeFilter;

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      {/* Sticky Header */}
      <div
        className="rounded-2xl p-4 border sticky top-0 z-20 backdrop-blur supports-[backdrop-filter]:bg-background/70 bg-background/90"
        style={{ borderColor: accent }}
      >
        <div className="flex flex-col gap-3">
          {/* Row 1: identity + primary toolbar */}
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
            {/* identity */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl" style={{ background: accent, opacity: 0.25 }} />
              <div>
                <h1 className="text-xl font-semibold flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  {selectedGroup
                    ? selectedGroup.name
                    : gState === "loading"
                    ? "Loading groups…"
                    : "Select a group"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Group + Personal schedule — simple, clear, fast.
                </p>
              </div>
            </div>

            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              {/* group select */}
              <select
                className="border rounded-lg px-3 py-2 bg-background shrink-0 min-w-[180px]"
                value={selectedGroupId ?? ""}
                onChange={(e) => setSelectedGroupId(Number(e.target.value))}
                title="Choose group"
              >
                <option value="" disabled>
                  Choose group…
                </option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>

              {/* quick add */}
              <Button variant="outline" onClick={() => openCreate()}>
                <Plus className="w-4 h-4 mr-2" />
                Add
              </Button>

              {/* view toggle */}
              <div className="flex rounded-lg border overflow-hidden">
                <Button
                  variant={view === "agenda" ? "default" : "ghost"}
                  className="rounded-none"
                  onClick={() => setView("agenda")}
                  aria-label="Agenda view"
                >
                  <ListIcon className="w-4 h-4 mr-2" />
                  Agenda
                </Button>
                <Button
                  variant={view === "month" ? "default" : "ghost"}
                  className="rounded-none"
                  onClick={() => setView("month")}
                  aria-label="Month view"
                >
                  <LayoutGrid className="w-4 h-4 mr-2" />
                  Month
                </Button>
              </div>

              {/* scope segmented: All | Group | Personal */}
              <div className="flex rounded-lg border overflow-hidden">
                <Button
                  variant={headerScope === "all" ? "default" : "ghost"}
                  className="rounded-none"
                  onClick={() => {
                    setTypeFilter("all");
                    setIncludePersonalUI(true); // ensure personal overlay is included
                  }}
                  title="Show group + personal"
                >
                  All
                </Button>
                <Button
                  variant={headerScope === "group" ? "default" : "ghost"}
                  className="rounded-none"
                  onClick={() => {
                    setTypeFilter("group");
                    setIncludePersonalUI(false); // hide personal overlay
                  }}
                  title="Group only"
                >
                  Group
                </Button>
                <Button
                  variant={headerScope === "personal" ? "default" : "ghost"}
                  className="rounded-none"
                  onClick={() => {
                    setTypeFilter("personal"); // filter to personal only
                    setIncludePersonalUI(true); // make sure personal data is present
                  }}
                  title="Personal only"
                >
                  Personal
                </Button>
              </div>

              {/* month nav */}
              <div className="hidden md:flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={goPrevMonth} aria-label="Previous month">
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <div className="text-sm font-semibold min-w-[9ch] text-center">{currentMonthLabel}</div>
                <Button variant="ghost" size="icon" onClick={goNextMonth} aria-label="Next month">
                  <ChevronRight className="w-5 h-5" />
                </Button>
                <Button variant="outline" onClick={goToday}>
                  Today
                </Button>
              </div>

              {/* refresh */}
              <Button
                variant="outline"
                onClick={() => { void refetchAll(); }}
                disabled={loadState === "loading"}
              >
                {loadState === "loading" ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main layout: sidebar + content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Sidebar */}
        <aside className="lg:col-span-3 space-y-4">
          <MiniMonth
            ym={ym}
            onChangeMonth={(delta) =>
              setYm(({ y, m }) =>
                m === (delta < 0 ? 0 : 11) ? { y: y + delta, m: delta < 0 ? 11 : 0 } : { y, m: m + delta }
              )
            }
            selectedKey={todayKey}
            onSelectDate={(k) => {
              const d = new Date(k);
              setYm({ y: d.getFullYear(), m: d.getMonth() });
              if (view === "agenda") setQ("");
            }}
            accent={accent}
          />

          {/* Filters */}
          <div className="rounded-2xl border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Filter className="w-4 h-4" />
                Filters
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Cell cap</span>
                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={cellCap}
                  onChange={(e) => setCellCap(Number(e.target.value))}
                  aria-label="Events per day cell"
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button
                  variant={typeFilter === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setTypeFilter("all");
                    setIncludePersonalUI(true);
                  }}
                >
                  All
                </Button>
                <Button
                  variant={typeFilter === "group" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setTypeFilter("group");
                    setIncludePersonalUI(false);
                  }}
                >
                  Group
                </Button>
                <Button
                  variant={typeFilter === "personal" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setTypeFilter("personal");
                    setIncludePersonalUI(true);
                  }}
                >
                  Personal
                </Button>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search title/place/notes"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Server range: {monthFromKey} → {monthToKey}</span>
                <button
                  className="underline underline-offset-2"
                  onClick={() => { setTypeFilter("all"); setIncludePersonalUI(true); }}
                  title="Reset scope & filters"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="rounded-2xl border p-3">
            <div className="text-sm font-medium mb-2">Legend</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-block w-3 h-3 rounded" style={{ background: accent }} />
              Current group
            </div>
            <div className="flex items-center gap-2 text-sm mt-2">
              <span className="inline-block w-3 h-3 rounded" style={{ background: PERSONAL_ACCENT }} />
              Personal
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              Tip: Click a day number to add; click “+N more” to open the day sheet.
            </div>
          </div>
        </aside>

        {/* Content */}
        <section className="lg:col-span-9 space-y-4">
          {/* MONTH VIEW */}
          {view === "month" && (
            <>
              {/* Month toolbar (mobile visible) */}
              <div className="flex items-center justify-between lg:hidden">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={goPrevMonth} aria-label="Previous month">
                    <ChevronLeft className="w-5 h-5" />
                  </Button>
                  <div className="text-lg font-semibold">{currentMonthLabel}</div>
                  <Button variant="ghost" size="icon" onClick={goNextMonth} aria-label="Next month">
                    <ChevronRight className="w-5 h-5" />
                  </Button>
                  <Button variant="outline" onClick={goToday} className="ml-2">
                    Today
                  </Button>
                </div>
                <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarDays className="w-4 h-4" />
                  <span>
                    Showing {monthFromKey} → {monthToKey}
                  </span>
                </div>
              </div>

              {/* Weekday header */}
              <div className="grid grid-cols-7 mt-1 text-xs font-medium text-muted-foreground">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="px-2 py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Upgraded calendar grid */}
              <MonthGrid
                days={days}
                ym={ym}
                todayKey={todayKey}
                cellCap={cellCap}
                dayEvents={dayEvents}
                openCreate={openCreate}
                openEdit={openEdit}
                setDayOpenKey={setDayOpenKey}
                eventAccent={eventAccent}
              />

              {loadState === "loading" && (
                <p className="text-sm mt-2 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading events…
                </p>
              )}
              {loadState === "error" && (
                <Card className="mt-3">
                  <CardContent className="p-6 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                      <p className="text-sm text-red-500">Failed to load events.</p>
                      <Button variant="outline" onClick={() => void refetchAll()} className="mt-2">
                        Try again
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* AGENDA VIEW */}
          {view === "agenda" && (
            <>
              {loadState === "loading" && (
                <div className="space-y-6">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4" />
                    <h2 className="font-semibold">Loading…</h2>
                  </div>
                  <AgendaSkeleton />
                  <AgendaSkeleton />
                </div>
              )}

              {loadState === "error" && (
                <Card>
                  <CardContent className="p-6 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-red-500" />
                      <p className="text-sm text-red-500">Failed to load events.</p>
                      <Button variant="outline" onClick={() => void refetchAll()} className="mt-2">
                        Try again
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {agendaSections.length === 0 && loadState === "idle" && selectedGroupId && (
                <EmptyHint label="No events yet. Use Quick Add above or click Add to create one." />
              )}

              <div className="space-y-6">
                {agendaSections.map(([dateKey, items]) => {
                  const isToday = dateKey === todayKey;
                  return (
                    <section key={dateKey} ref={isToday ? todayRef : undefined} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4" />
                        <h2 className="font-semibold">
                          {fmtDate(dateKey)} {isToday && <span className="text-primary ml-2">• Today</span>}
                        </h2>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {items.map((ev) => (
                          <motion.div
                            key={ev.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.18 }}
                          >
                            <Card className="border hover:shadow-md transition-shadow h-full">
                              <CardContent className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <h3 className="font-medium">{ev.title}</h3>
                                    <div className="text-sm text-muted-foreground space-y-1">
                                      {timeRange(ev) && (
                                        <div className="flex items-center gap-2">
                                          <Clock className="w-4 h-4" />
                                          <span>{timeRange(ev)}</span>
                                        </div>
                                      )}
                                      {ev.location && (
                                        <div className="flex items-center gap-2">
                                          <MapPin className="w-4 h-4" />
                                          <span>{ev.location}</span>
                                        </div>
                                      )}
                                      {ev.description && (
                                        <div className="flex items-center gap-2">
                                          <Info className="w-4 h-4" />
                                          <span className="whitespace-pre-wrap">{ev.description}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <Button variant="outline" size="icon" onClick={() => openEdit(ev)} aria-label="Edit" title="Edit">
                                      <Pencil className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="icon"
                                      onClick={() => void deleteEvent(ev)}
                                      aria-label="Delete"
                                      title="Delete"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div
                                    className="h-1 rounded-full w-24"
                                    style={{ background: eventAccent(ev) }}
                                  />
                                  <span className="text-[11px] px-2 py-0.5 rounded-full border">
                                    {ev.type === "group" ? "Group" : "Personal"}
                                  </span>
                                </div>
                              </CardContent>
                            </Card>
                          </motion.div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit event" : "Create event"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="etype">Type</Label>
              <select
                id="etype"
                className="border rounded-lg px-3 py-2 bg-background w-full"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as EventType }))}
              >
                <option value="group">Group</option>
                <option value="personal">Personal</option>
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="title">What are we doing?</Label>
                <span className={`text-xs ${form.title.trim() ? "text-muted-foreground" : "text-red-500"}`}>
                  {form.title.trim() ? "Looks good" : "Required"}
                </span>
              </div>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g., Weekly Study Session: Calculus"
              />
            </div>

            {/* Times — allowed for both personal and group */}
            <div className="space-y-2">
              <Label htmlFor="start">Start time</Label>
              <Input
                id="start"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">End time</Label>
              <Input
                id="end"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
              />
              {form.start_time && form.end_time && form.start_time > form.end_time && (
                <p className="text-xs text-red-500">End must be after start.</p>
              )}
            </div>

            {/* Details (now allowed for personal too) */}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="location">Where</Label>
              <Input
                id="location"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="e.g., Library Room 301"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="desc">Notes</Label>
              <Textarea
                id="desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Details, resources to bring, agenda…"
                rows={4}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveForm()} disabled={!form.title.trim()}>
              {editing ? "Save changes" : "Create event"}
            </Button>
          </DialogFooter>

          <p className="text-[11px] text-muted-foreground mt-2">
            Tip: Press <kbd className="px-1 py-0.5 border rounded">⌘/Ctrl</kbd>{" "}
            + <kbd className="px-1 py-0.5 border rounded">Enter</kbd> to save.
          </p>
        </DialogContent>
      </Dialog>

      {/* Day Sheet Dialog */}
      <Dialog open={!!dayOpenKey} onOpenChange={(o) => setDayOpenKey(o ? dayOpenKey : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dayOpenKey ? fmtDate(dayOpenKey) : "Day"}
            </DialogTitle>
          </DialogHeader>

          {dayOpenKey && (
            <div className="space-y-3">
              {dayEvents(dayOpenKey).length === 0 ? (
                <EmptyHint label="No events here yet." />
              ) : (
                dayEvents(dayOpenKey).map((ev) => (
                  <Card key={ev.id} className="border">
                    <CardContent className="p-3 flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ background: eventAccent(ev) }}
                            aria-hidden
                          />
                          <h3 className="font-medium text-sm">{ev.title}</h3>
                          <span className="text-[11px] px-2 py-0.5 rounded-full border">
                            {ev.type === "group" ? "Group" : "Personal"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          {timeRange(ev) && (
                            <div className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{timeRange(ev)}</span>
                            </div>
                          )}
                          {ev.location && (
                            <div className="flex items-center gap-2">
                              <MapPin className="w-3.5 h-3.5" />
                              <span>{ev.location}</span>
                            </div>
                          )}
                          {ev.description && (
                            <div className="flex items-center gap-2">
                              <Info className="w-3.5 h-3.5" />
                              <span className="whitespace-pre-wrap">{ev.description}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button variant="outline" size="icon" onClick={() => openEdit(ev)} aria-label="Edit" title="Edit">
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => void deleteEvent(ev)}
                          aria-label="Delete"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
              <div className="pt-2">
                <Button onClick={() => dayOpenKey && openCreate(dayOpenKey)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add on this day
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {toast && <Toast kind={toast.kind} message={toast.msg} />}

      {/* hidden spacer so sticky header never overlaps bottom toasts on mobile */}
      <div className="h-2" />
    </div>
  );
}

/* ---------------------- MonthGrid (upgraded month calendar) ---------------------- */
function MonthGrid({
  days,
  ym,
  todayKey,
  cellCap,
  dayEvents,
  openCreate,
  openEdit,
  setDayOpenKey,
  eventAccent,
}: {
  days: Date[];
  ym: { y: number; m: number };
  todayKey: string;
  cellCap: number;
  dayEvents: (k: string) => GroupEvent[];
  openCreate: (dateKey?: string) => void;
  openEdit: (ev: GroupEvent) => void;
  setDayOpenKey: (k: string | null) => void;
  eventAccent: (ev: GroupEvent) => string;
}) {
  return (
    <div className="grid grid-cols-7 grid-rows-6 rounded-xl overflow-hidden bg-border gap-px h-[540px] sm:h-[640px] lg:h-[720px]">
      {days.map((d, idx) => {
        const k = toKeyUTC(d); // keep for event lookup & server-aligned grid
        const inMonth = d.getUTCMonth() === ym.m;
        const isToday = toKeyLocal(d) === todayKey; // local “today” highlight
        const dow = d.getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        const items = dayEvents(k);
        const show = items.slice(0, cellCap);
        const more = Math.max(0, items.length - show.length);

        return (
          <div
            key={k + idx}
            className={[
              "group relative bg-card p-1.5 sm:p-2 overflow-hidden",
              inMonth && isWeekend ? "bg-muted/40" : "",
              !inMonth ? "bg-muted/20" : "",
            ].join(" ")}
          >
            {/* date badge + hover add */}
            <div className="flex items-center justify-between">
              <button
                onClick={() => openCreate(k)}
                className={[
                  "inline-flex items-center justify-center rounded-full text-[11px] sm:text-xs w-6 h-6 sm:w-7 sm:h-7",
                  isToday
                    ? "bg-primary text-primary-foreground font-semibold shadow"
                    : inMonth
                    ? "hover:bg-secondary"
                    : "text-muted-foreground/70 hover:bg-secondary/70",
                ].join(" ")}
                title={`Add on ${fmtDayLabel(d)}`}
                aria-current={isToday ? "date" : undefined}
              >
                {d.getUTCDate()}
              </button>

              <button
                className="rounded-md p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                onClick={() => openCreate(k)}
                aria-label={`Add event on ${k}`}
                title="Add event"
              >
                <Plus className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>

            {/* events list (scrolls inside cell) */}
            <div className="absolute inset-x-1.5 sm:inset-x-2 top-8 bottom-1.5 sm:bottom-2 overflow-auto space-y-1.5">
              {show.length === 0 ? (
                <div className="text-[10px] sm:text-[11px] text-muted-foreground/60 italic">—</div>
              ) : (
                show.map((ev) => {
                  const dot = eventAccent(ev);
                  const tr = timeRange(ev);
                  return (
                    <button
                      key={ev.id}
                      onClick={() => openEdit(ev)}
                      title={ev.title}
                      className="w-full text-left group rounded-md border px-1.5 py-1 sm:px-2 sm:py-1.5 hover:bg-muted/60 hover:shadow-sm transition flex items-center gap-1.5"
                      style={{ borderColor: dot }}
                    >
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-[1px]"
                        style={{ background: dot }}
                        aria-hidden
                      />
                      <span className="flex-1 min-w-0 text-[10px] sm:text-[11px]">
                        {tr && <b className="mr-1">{tr}</b>}
                        <span className="truncate align-middle">{ev.title}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {/* +N more pinned bottom-left */}
            {more > 0 && (
              <button
                className="absolute left-1.5 sm:left-2 bottom-1.5 sm:bottom-2 text-[10px] sm:text-[11px] text-muted-foreground underline underline-offset-2"
                onClick={() => setDayOpenKey(k)}
                aria-label={`Show all events for ${k}`}
              >
                +{more} more
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- small skeleton for agenda ---------- */
function AgendaSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-40 bg-muted rounded" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border p-4 space-y-3">
            <div className="h-4 w-2/3 bg-muted rounded" />
            <div className="h-3 w-1/3 bg-muted rounded" />
            <div className="h-3 w-1/2 bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
