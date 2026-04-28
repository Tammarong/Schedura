// src/pages/Schedule.tsx
import { motion } from "framer-motion";
import {
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AuthContext } from "@/context/AuthContext";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api, getToken } from "@/lib/api";

/* ---------- constants ---------- */
const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const monthNames = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
] as const;

/* ---------- types ---------- */
type Event = {
  id: number;
  date: string; // e.g. "2025-10-08T00:00:00.000Z"
  type: "group" | "personal";
  title: string;
  user_id: number | null;
  users?: { id: number; username: string; display_name: string | null } | null;
  groups?: { id: number; name: string } | null;
};

type DayCell = {
  date: Date;
  iso: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  events: Event[];
};

type Me = {
  id: number;
  username?: string;
};

type JwtMaybe = {
  id?: number;
  user_id?: number;
  userId?: number;
  username?: string;
};

type CSSVars = React.CSSProperties & {
  ["--cell"]?: string;
  ["--gap"]?: string;
};

/* ---------- local JWT decode (no verification; fallback only) ---------- */
function decodeJwtId(token: string | null): number | null {
  if (!token) return null;
  try {
    const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
    const [, payload] = raw.split(".");
    if (!payload) return null;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    ) as JwtMaybe;
    const id =
      (typeof json.id === "number" && json.id) ||
      (typeof json.user_id === "number" && json.user_id) ||
      (typeof json.userId === "number" && json.userId) ||
      null;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

/* =========================================================
   Schedule (AuthContext OR /users/current_user OR token decode)
========================================================= */
const Schedule = () => {
  const { user, loading: authLoading } = useContext(AuthContext);

  // Optimistic id from JWT (instant)
  const [optimisticId] = useState<number | null>(() => decodeJwtId(getToken() ?? null));

  // Canonical user from server
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState<boolean>(true);

  // page state
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [note, setNote] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // layout helpers
  const vw = useViewportWidth();
  const isMobile = vw < 640;
  const gapPx = isMobile ? 4 : 8;

  const [wrapperWidth, setWrapperWidth] = useState<number>(0);
  const wrapperRef = useResizeObserver<HTMLDivElement>((rect) => {
    setWrapperWidth(rect.width);
  });

  const cellPx = useMemo(() => {
    if (wrapperWidth <= 0) return 56;
    const columns = 7;
    const totalGaps = gapPx * (columns - 1);
    return Math.floor((wrapperWidth - totalGaps) / columns);
  }, [wrapperWidth, gapPx]);

  const calendarVars = useMemo<CSSVars>(
    () => ({
      "--cell": `${cellPx}px`,
      "--gap": `${gapPx}px`,
    }),
    [cellPx, gapPx]
  );

  // Effective user id (prefer context → server → optimistic token)
  const effectiveUserId = useMemo<number | null>(() => {
    if (user && typeof user.id === "number") return user.id;
    if (me && typeof me.id === "number") return me.id;
    if (optimisticId !== null) return optimisticId;
    return null;
  }, [user, me, optimisticId]);

  // Canonical auth probe (same spirit as Profile.tsx)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setMeLoading(true);
        const res = await api<Me>("/users/current_user", { method: "GET" });
        if (!cancelled) setMe(res ?? null);
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setMeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- fetch (aligned with backend) ---------- */
  const fetchEvents = useCallback(async () => {
    if (effectiveUserId == null) return; // guard UI until authed
    setLoading(true);
    setError(null);
    try {
      // includeGroup=1 to include group events for the signed-in user's groups
      const data = await api<Event[]>(`/schedules?includeGroup=1&t=${Date.now()}`, {
        method: "GET",
      });
      setEvents(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load events:", e);
      setError("Failed to load events");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId]);

  useEffect(() => {
    setEvents([]);
    setSelectedDate(null);
    setNote("");
    if (effectiveUserId != null) void fetchEvents();
  }, [effectiveUserId, fetchEvents]);

  /* ---------- computed: existing personal note for selected day ---------- */
  const existingNote = useMemo(() => {
    if (!selectedDate) return null;
    const iso = toISODate(selectedDate);
    // server returns at most one personal note per day per user (unique constraint)
    return events.find((e) => e.type === "personal" && e.date.startsWith(iso)) ?? null;
  }, [selectedDate, events]);

  /* ---------- save (POST upsert) ---------- */
  const handleSaveNote = async () => {
    if (!selectedDate || !note.trim()) return;
    setIsSaving(true);
    try {
      await api(`/schedules`, {
        method: "POST",
        body: {
          date: toISODate(selectedDate), // local yyyy-mm-dd; backend normalizes to UTC date-only
          title: note.trim(),
        },
      });
      setNote("");
      setSelectedDate(null);
      await fetchEvents();
    } catch (e) {
      console.error("Failed to save note:", e);
      setError("Failed to save note");
    } finally {
      setIsSaving(false);
    }
  };

  /* ---------- delete (owner-only; backend enforces) ---------- */
  const handleDeleteNote = async () => {
    if (!existingNote) return;
    setIsDeleting(true);
    try {
      await api(`/schedules/${existingNote.id}`, { method: "DELETE" });
      setNote("");
      setSelectedDate(null);
      await fetchEvents();
    } catch (e) {
      console.error("Failed to delete note:", e);
      setError("Failed to delete note");
    } finally {
      setIsDeleting(false);
    }
  };

  /* ---------- calendar grid ---------- */
  const monthGrid: DayCell[] = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInThisMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const todayISO = toISODate(new Date());

    const cells: DayCell[] = [];

    // leading days
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, daysInPrevMonth - i);
      const iso = toISODate(d);
      cells.push({
        date: d,
        iso,
        inCurrentMonth: false,
        isToday: iso === todayISO,
        events: events.filter((e) => e.date.startsWith(iso)),
      });
    }

    // current month
    for (let day = 1; day <= daysInThisMonth; day++) {
      const d = new Date(year, month, day);
      const iso = toISODate(d);
      cells.push({
        date: d,
        iso,
        inCurrentMonth: true,
        isToday: iso === todayISO,
        events: events.filter((e) => e.date.startsWith(iso)),
      });
    }

    // trailing days
    while (cells.length < 42) {
      const last = cells[cells.length - 1]?.date || new Date(year, month, daysInThisMonth);
      const d = new Date(last);
      d.setDate(d.getDate() + 1);
      const iso = toISODate(d);
      cells.push({
        date: d,
        iso,
        inCurrentMonth: false,
        isToday: iso === todayISO,
        events: events.filter((e) => e.date.startsWith(iso)),
      });
    }

    return cells;
  }, [currentDate, events]);

  /* ---------- keyboard month nav ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
      } else if (e.key === "ArrowRight") {
        setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- auth gates ---------- */
  if (authLoading || meLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground">Loading schedule...</p>
      </div>
    );
  }

  if (effectiveUserId == null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-500">Please log in to see your schedule.</p>
      </div>
    );
  }

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen p-4 sm:p-6">
      {error && (
        <div className="max-w-5xl mx-auto mb-4 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void fetchEvents()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Retry
          </Button>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="max-w-5xl mx-auto"
      >
        <Card className="border shadow-sm bg-card/90 backdrop-blur mt-6 sm:mt-0">
          <CardHeader className="sticky top-0 z-[1] bg-card/90 backdrop-blur rounded-t-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5 text-primary" />
                <CardTitle className="text-2xl">My Schedule</CardTitle>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size={isMobile ? "sm" : "default"}
                  onClick={() =>
                    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
                  }
                  aria-label="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline ml-1">Prev</span>
                </Button>

                <div className="min-w-[180px] text-center font-semibold">
                  {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
                </div>

                <Button
                  variant="secondary"
                  size={isMobile ? "sm" : "default"}
                  onClick={() =>
                    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
                  }
                  aria-label="Next month"
                >
                  <span className="hidden sm:inline mr-1">Next</span>
                  <ChevronRight className="h-4 w-4" />
                </Button>

                <Button
                  size={isMobile ? "sm" : "default"}
                  onClick={() => setCurrentDate(new Date())}
                  aria-label="Jump to today"
                >
                  Today
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-3 sm:p-5">
            <div ref={wrapperRef} className="w-full">
              {/* Weekday header */}
              <div
                className="grid mb-2 text-center font-medium text-muted-foreground"
                style={{
                  gridTemplateColumns: "repeat(7, var(--cell))",
                  gap: "var(--gap)",
                  ...calendarVars,
                } as CSSVars}
              >
                {daysOfWeek.map((d) => (
                  <div key={d} className="py-1 text-[11px] sm:text-sm">
                    {d}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              {loading ? (
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: "repeat(7, var(--cell))",
                    gap: "var(--gap)",
                    ...calendarVars,
                  } as CSSVars}
                >
                  {Array.from({ length: 42 }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-lg border bg-muted/20 animate-pulse"
                      style={{ height: `var(--cell)` }}
                    />
                  ))}
                </div>
              ) : (
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: "repeat(7, var(--cell))",
                    gap: "var(--gap)",
                    ...calendarVars,
                  } as CSSVars}
                >
                  {monthGrid.map((cell) => {
                    const groupEvents = cell.events.filter((e) => e.type === "group");
                    const personal = cell.events.filter((e) => e.type === "personal");

                    return (
                      <motion.button
                        key={cell.iso}
                        type="button"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => {
                          setSelectedDate(cell.date);
                          const mine = personal[0]; // at most 1 per day
                          setNote(mine ? mine.title : "");
                        }}
                        className={[
                          "p-1.5 sm:p-2 rounded-lg border text-left relative",
                          "transition focus:outline-none focus:ring-2 focus:ring-primary/60",
                          cell.inCurrentMonth ? "bg-background" : "bg-muted/30 text-muted-foreground",
                          cell.isToday ? "ring-2 ring-primary font-semibold" : "",
                        ].join(" ")}
                        aria-label={`Day ${cell.date.getDate()} ${cell.inCurrentMonth ? "" : "(other month)"}`}
                        style={{ height: `var(--cell)` }}
                      >
                        <div className="flex items-start justify-between">
                          <span className="text-xs sm:text-sm">{cell.date.getDate()}</span>
                          {groupEvents.length > 0 && (
                            <span
                              className="ml-1 inline-flex items-center rounded-full bg-primary text-primary-foreground px-1.5 py-0.5 text-[10px] sm:text-[11px] leading-none"
                              title={`${groupEvents.length} group event(s)`}
                            >
                              {groupEvents.length}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 space-y-0.5 overflow-hidden" style={{ maxHeight: isMobile ? 18 : 22 }}>
                          {personal.slice(0, 2).map((ev) => (
                            <div
                              key={ev.id}
                              className="truncate rounded-md bg-secondary text-secondary-foreground px-1.5 py-0.5 text-[10px] sm:text-xs"
                              title={ev.title}
                            >
                              {ev.title}
                            </div>
                          ))}
                          {personal.length > 2 && (
                            <div className="text-[10px] text-muted-foreground">+{personal.length - 2} more</div>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-5 text-xs sm:text-sm">
              <div className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-primary" />
                Your Personal Note
              </div>
              <div className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-secondary" />
                ❤️
              </div>
              <div className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full ring-2 ring-primary" />
                Today
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Add/Edit Note dialog */}
      <Dialog
        open={!!selectedDate}
        onOpenChange={(openState) => {
          if (!openState) {
            setSelectedDate(null);
            setNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg">
              {selectedDate ? selectedDate.toDateString() : "Add Note"}
            </DialogTitle>
          </DialogHeader>

          <Input
            placeholder="Enter your note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />

          <DialogFooter className="gap-2">
            {existingNote && (
              <Button
                variant="destructive"
                onClick={handleDeleteNote}
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedDate(null);
                  setNote("");
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveNote} disabled={isSaving || !note.trim()}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Schedule;

/* ---------- tiny utils ---------- */
function useViewportWidth(): number {
  const [w, setW] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

function useResizeObserver<T extends HTMLElement>(
  onResize: (rect: DOMRectReadOnly) => void
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const obs = new ResizeObserver((entries) => {
      if (entries[0]) onResize(entries[0].contentRect);
    });
    obs.observe(el);
    return () => obs.unobserve(el);
  }, [onResize]);
  return ref;
}

// Local yyyy-mm-dd (no UTC conversion). Server will normalize to UTC date-only.
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
