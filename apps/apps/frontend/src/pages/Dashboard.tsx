import * as React from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  ArrowRight,
  Plus,
  CalendarDays,
  Clock,
  Newspaper,
  Smile,
  ListChecks,
  Flame,
  Compass,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

/* ---------- current_user shapes ---------- */
type CurrentUserPayload = {
  id: number;
  username: string;
  email?: string | null;
  displayName?: string | null;
  theme?: string | null;
  lang?: string | null;
  joinedDate?: string | null;
  avatarUrl?: string | null;
  postsCount?: number;
  groupsCount?: number;
  friendsCount?: number;
  posts?: { id: number | string; content: string; timestamp: string }[];
  groups?: { id: number | string; name: string; role?: string | null }[];
};

type MeResponseEnvelope = { user?: CurrentUserPayload | null };
type MeResponse = CurrentUserPayload | MeResponseEnvelope;

/* ---------- groups route types ---------- */
type GroupMineItem = {
  id: number;
  name: string;
  description?: string | null;
  location?: string | null;
  owner_id: number;
  code?: string | null;
  created_at: string;
  memberCount: number;
  role: "owner" | "admin" | "member";
  isMember: boolean;
};
type GroupsMineResponse = GroupMineItem[];

/* ---------- data shapes for widgets ---------- */
type UpcomingEvent = {
  id: number | string;
  title: string;
  startISO: string;
  endISO?: string | null;
  location?: string | null;
  color?: string | null;
  group?: { id: number | string; name: string; color?: string | null } | null;
};

type GroupMini = {
  id: number | string;
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
  memberCount?: number | null;
  unreadCount?: number | null;
};

/* ---------- streaks (matches controllers) ---------- */
type FlameInfo = { stage: number; label: string; nextCheckpoint: number; progressToNext: number };
type StreakInfo = {
  type: "study" | "post" | "groupMessage";
  group_id: number | null;
  current_count: number;
  longest_count: number;
  start_date: string | null;
  last_date: string | null;
  todayActive?: boolean;
  flame?: FlameInfo;
};
/** Accepts API responses that might still include `dm`, which we’ll ignore. */
type AnyStreakInfo = StreakInfo | { type: "dm"; [k: string]: unknown };

/* ---------- tiny runtime guards ---------- */
function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}
function isEnvelope(x: unknown): x is MeResponseEnvelope {
  return isObject(x) && "user" in x;
}
function pickUserFromMe(resp: MeResponse): CurrentUserPayload | null {
  return isEnvelope(resp) ? resp.user ?? null : (resp ?? null);
}
function pickStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}
function pickNumOrStr(obj: Record<string, unknown>, key: string): number | string | null {
  const v = obj[key];
  if (typeof v === "number" || typeof v === "string") return v;
  return null;
}

/* ---------- helpers ---------- */
function mapUser(u?: CurrentUserPayload | null) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName ?? u.username,
    avatarUrl: u.avatarUrl ?? null,
    postsCount: u.postsCount ?? 0,
    groupsCount: u.groupsCount ?? 0,
    friendsCount: u.friendsCount ?? 0,
  };
}

function formatTimeRange(startISO: string, endISO?: string | null) {
  const start = new Date(startISO);
  const end = endISO ? new Date(endISO) : null;
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  const startStr = start.toLocaleTimeString([], opts);
  const endStr = end ? end.toLocaleTimeString([], opts) : null;
  return endStr ? `${startStr}–${endStr}` : startStr;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function next7Days() {
  const days: { date: Date; label: string; isToday: boolean; key: string }[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push({
      date: d,
      key: dayKey(d),
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      isToday: i === 0,
    });
  }
  return days;
}

/** Map events to days (no hooks) */
function mapEventsByDay<T extends { key: string }>(days: T[], events: UpcomingEvent[] | null) {
  const map = new Map<string, UpcomingEvent[]>();
  for (const d of days) map.set(d.key, []);
  if (Array.isArray(events)) {
    for (const ev of events) {
      const dt = new Date(ev.startISO);
      const key = dayKey(dt);
      if (map.has(key)) map.get(key)!.push(ev);
    }
  }
  return map;
}

/* -------- Schedule response → UI events (matches your controller) -------- */
type ScheduleRow = {
  id: number | string;
  title?: string | null;
  date?: string; // ISO string (UTC midnight)
  start_time?: string | null; // "HH:mm"
  end_time?: string | null;   // "HH:mm"
  location?: string | null;
  color?: string | null;
  groups?: { id: number | string; name: string; color?: string | null } | null;
};

function utcDateOnlyToLocalDate(dateISO: string): Date {
  const d = new Date(dateISO);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return new Date(y, m, day, 0, 0, 0, 0);
}

function combineLocalYMDAndHHMM(localYMD: Date, hhmm: string | null): string {
  const [hh, mm] = (hhmm ?? "00:00").split(":").map((s) => Number(s));
  const out = new Date(localYMD);
  out.setHours(Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0, 0, 0);
  return out.toISOString();
}

function normalizeScheduleRows(payload: unknown): UpcomingEvent[] {
  if (!Array.isArray(payload)) return [];
  const out: UpcomingEvent[] = [];
  for (const item of payload) {
    if (!isObject(item)) continue;
    const id = pickNumOrStr(item, "id");
    if (id == null) continue;
    const title = pickStr(item, "title") ?? "(untitled)";
    const dateISO = pickStr(item, "date");
    if (!dateISO) continue;
    const localYMD = utcDateOnlyToLocalDate(dateISO);

    const startHHMM = pickStr(item, "start_time");
    const endHHMM = pickStr(item, "end_time");

    const startISO = combineLocalYMDAndHHMM(localYMD, startHHMM ?? "00:00");
    const endISO = endHHMM ? combineLocalYMDAndHHMM(localYMD, endHHMM) : null;

    let group: UpcomingEvent["group"] = null;
    const g = item["groups"];
    if (isObject(g)) {
      const gid = pickNumOrStr(g, "id") ?? "group";
      const gname = pickStr(g, "name") ?? "Group";
      const gcolor = pickStr(g, "color") ?? undefined;
      group = { id: gid, name: gname, color: gcolor };
    }

    const location = pickStr(item, "location");
    const color = pickStr(item, "color");

    out.push({ id, title, startISO, endISO, location, color, group });
  }
  return out;
}

/* ===================== Groups mini ===================== */
function GroupsMiniList({ groups }: { groups: GroupMini[] }) {
  if (!groups.length) {
    return (
      <div className="text-sm text-foreground/60">
        You’re not in any groups yet. <Link to="/groups" className="text-primary underline">Find one</Link> or{" "}
        <Link to="/groups" className="text-primary underline">create your own</Link>.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {groups.slice(0, 10).map((g) => (
        <Link key={g.id} to={`/groups/${g.id}`}>
          <div
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 bg-card/70 hover:bg-accent/10 transition"
            title={g.name}
          >
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: g.color ?? "hsl(var(--primary))" }}
            />
            <span className="text-sm">{g.name}</span>
            {typeof g.memberCount === "number" && g.memberCount > 0 && (
              <span className="text-xs text-foreground/60">· {g.memberCount}</span>
            )}
            {typeof g.unreadCount === "number" && g.unreadCount > 0 && (
              <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {g.unreadCount} new
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ===================== TODAY PANEL ===================== */
function useNow() {
  const [now, setNow] = React.useState<Date>(new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function findNextEvent(events: UpcomingEvent[] | null): UpcomingEvent | null {
  if (!events || events.length === 0) return null;
  const now = Date.now();
  const sorted = [...events].sort((a, b) => new Date(a.startISO).valueOf() - new Date(b.startISO).valueOf());
  for (const ev of sorted) {
    if (new Date(ev.startISO).valueOf() >= now) return ev;
  }
  return null;
}

function TodayPanel({ events }: { events: UpcomingEvent[] | null }) {
  const now = useNow();
  const next = findNextEvent(events);

  const niceDate = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const niceTime = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Today
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-sm text-foreground/70">{niceDate}</div>
            <div className="text-3xl font-bold tracking-tight">{niceTime}</div>
          </div>
          <div className="rounded-xl border p-3 bg-card/70 min-w-[240px]">
            {next ? (
              <>
                <div className="text-xs text-foreground/60">Next up</div>
                <div className="mt-1 font-medium truncate">{next.title}</div>
                <div className="text-xs text-foreground/60">
                  {new Date(next.startISO).toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}{" · "}
                  {formatTimeRange(next.startISO, next.endISO)}
                  {next.location ? ` · ${next.location}` : ""}
                </div>
              </>
            ) : (
              <>
                <div className="text-xs text-foreground/60">Next up</div>
                <div className="mt-1 font-medium">You’re free 🎉</div>
                <div className="text-xs text-foreground/60">Plan something you enjoy.</div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ===================== DAILY CHECK-IN ===================== */
function ymdKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
type GoalsState = { move: boolean; learn: boolean; connect: boolean };

function DailyCheckIn() {
  const key = React.useMemo(() => `dash_checkin_${ymdKey()}`, []);
  const [mood, setMood] = React.useState<number>(() => {
    try {
      const saved = localStorage.getItem(`${key}_mood`);
      return saved ? Number(saved) : 0;
    } catch { return 0; }
  });
  const [goals, setGoals] = React.useState<GoalsState>(() => {
    try {
      const saved = localStorage.getItem(`${key}_goals`);
      return saved ? (JSON.parse(saved) as GoalsState) : { move: false, learn: false, connect: false };
    } catch { return { move: false, learn: false, connect: false }; }
  });

  function saveMood(v: number) {
    setMood(v);
    try { localStorage.setItem(`${key}_mood`, String(v)); } catch {}
  }
  function toggle(k: keyof GoalsState) {
    setGoals((g) => {
      const next = { ...g, [k]: !g[k] };
      try { localStorage.setItem(`${key}_goals`, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const moods = ["😞", "😐", "🙂", "😄", "🤩"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl flex items-center gap-2">
          <Smile className="h-5 w-5" />
          Daily check-in
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-sm text-foreground/70">How are you feeling?</div>
        <div className="mt-2 flex gap-2">
          {moods.map((m, idx) => {
            const v = idx + 1;
            const active = mood === v;
            return (
              <button
                key={m}
                onClick={() => saveMood(v)}
                className={`h-9 w-9 rounded-full border text-lg leading-none transition ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent/20"}`}
                aria-label={`mood ${m}`}
                title={`mood ${m}`}
              >
                {m}
              </button>
            );
          })}
        </div>

        <div className="mt-4 text-sm text-foreground/70 flex items-center gap-2">
          <ListChecks className="h-4 w-4" />
          Tiny goals for today
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            { k: "move" as const, label: "Move" },
            { k: "learn" as const, label: "Learn" },
            { k: "connect" as const, label: "Connect" },
          ].map(({ k, label }) => {
            const on = goals[k];
            return (
              <button
                key={k}
                onClick={() => toggle(k)}
                className={`rounded-md border px-2 py-1.5 text-sm transition ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent/20"}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 text-xs text-foreground/60">
          Small steps count. Check one and you’re already winning.
        </div>
      </CardContent>
    </Card>
  );
}

/* ===================== Study titles (match Study Desk) ===================== */
const STUDY_TITLES = [
  "Initiate",
  "Learner",
  "Apprentice",
  "Scholar",
  "Expert",
  "Master",
  "Grandmaster",
] as const;
type StudyTitle = typeof STUDY_TITLES[number];

function titleFromStage(stage?: number | null): StudyTitle {
  const idx = Math.max(0, Math.min(STUDY_TITLES.length - 1, Math.floor(stage ?? 0)));
  return STUDY_TITLES[idx];
}

/** stage → gradient badge for a “flame” feel */
const STAGE_BADGE_GRADIENT = [
  "bg-gradient-to-r from-sky-500 to-indigo-500",
  "bg-gradient-to-r from-indigo-500 to-purple-500",
  "bg-gradient-to-r from-purple-500 to-pink-500",
  "bg-gradient-to-r from-pink-500 to-rose-500",
  "bg-gradient-to-r from-amber-500 to-rose-500",
  "bg-gradient-to-r from-emerald-500 to-teal-500",
  "bg-gradient-to-r from-fuchsia-500 to-orange-500",
] as const;
function badgeClassFromStage(stage?: number | null) {
  const idx = Math.max(0, Math.min(STAGE_BADGE_GRADIENT.length - 1, Math.floor(stage ?? 0)));
  return STAGE_BADGE_GRADIENT[idx];
}

/* ===================== SUGGESTIONS ===================== */
function Suggestions({ hasGroups, hasEvents }: { hasGroups: boolean; hasEvents: boolean }) {
  const tips = [
    {
      icon: CalendarDays,
      label: hasEvents ? "Review this week" : "Add your first event",
      to: "/schedule",
      sub: hasEvents ? "Tweak times & stay ahead" : "It takes 10 seconds",
    },
    {
      icon: Users,
      label: hasGroups ? "Say hi to your group" : "Find a group",
      to: "/groups",
      sub: hasGroups ? "Drop a quick message" : "Study, hobbies, local",
    },
    {
      icon: Newspaper,
      label: "Explore posts",
      to: "/posts",
      sub: "Discover what others share",
    },
  ];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl flex items-center gap-2">
          <Compass className="h-5 w-5" />
          Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {tips.map((t) => (
          <Link key={t.label} to={t.to}>
            <div className="rounded-lg border p-3 hover:bg-accent/10 transition flex items-center gap-3">
              <div className="rounded-md p-2 bg-primary/10 text-primary">
                <t.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-foreground/60">{t.sub}</div>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 text-foreground/50" />
            </div>
          </Link>
        ))}
        <div className="mt-3 text-xs text-foreground/60 inline-flex items-center gap-1">
          <Lightbulb className="h-3.5 w-3.5" /> Tip: do one small thing now—future you will smile.
        </div>
      </CardContent>
    </Card>
  );
}

/* ===================== STREAKS (Dashboard Card) ===================== */
function DashboardStreaksCard({
  study,
  post,
  groupChatHighest,
}: {
  study: StreakInfo | null;
  post: StreakInfo | null;
  groupChatHighest: number | null;
}) {
  const studyDays = study?.current_count ?? 0;
  const stage = Math.floor(study?.flame?.stage ?? 0);
  const title = titleFromStage(stage);
  const pct = Math.round((study?.flame?.progressToNext ?? 0) * 100);
  const nextAt = study?.flame?.nextCheckpoint ?? null;
  const badgeGrad = badgeClassFromStage(stage);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg md:text-xl flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" />
          Study Streak
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Study — prominent */}
        <div className="rounded-xl border p-3 bg-card/60">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium text-white shadow-sm ${badgeGrad}`}
            >
              {title}
            </span>
            <div className="text-sm text-foreground/70">
              {studyDays} day{studyDays === 1 ? "" : "s"}
            </div>
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] text-foreground/60 mb-1">
              <span>Progress to next title</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-2 rounded-full bg-muted overflow-hidden"
            >
              <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
            {nextAt != null && (
              <div className="mt-1 text-[12px] text-foreground/60">
                Next at <span className="tabular-nums font-medium">{nextAt}d</span>
              </div>
            )}
          </div>
        </div>

        {/* Other streaks — show HIGHEST (longest_count) */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border p-3 bg-card/50">
            <div className="text-[11px] text-foreground/60 flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              Group chat (highest)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {(groupChatHighest ?? 0)}d
            </div>
          </div>
          <div className="rounded-lg border p-3 bg-card/50">
            <div className="text-[11px] text-foreground/60 flex items-center gap-1">
              <Newspaper className="h-3.5 w-3.5" />
              Posts (highest)
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {(post?.longest_count ?? 0)}d
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Link to="/study">
            <Button variant="outline" className="gap-2">
              Open Study Desk <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/* ===================== Page ===================== */
export default function Dashboard() {
  const nav = useNavigate();
  const { user: ctxUser, loading: authLoading } = useAuth();
  const [me, setMe] = React.useState<ReturnType<typeof mapUser> | null>(null);
  const [hydrating, setHydrating] = React.useState(true);

  // fetched data
  const [events, setEvents] = React.useState<UpcomingEvent[] | null>(null);
  const [groups, setGroups] = React.useState<GroupMini[] | null>(null);
  const [streakDays, setStreakDays] = React.useState<number | null>(null);

  // streak details
  const [streaks, setStreaks] = React.useState<Partial<Record<"study" | "post" | "groupMessage", StreakInfo>>>({});
  const [groupChatHighest, setGroupChatHighest] = React.useState<number | null>(0); // <-- driven by /streaks/me

  // hydrate user
  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (authLoading) return;
      if (ctxUser) {
        if (alive) {
          setMe(mapUser(ctxUser as unknown as CurrentUserPayload));
          setHydrating(false);
        }
        return;
      }
      try {
        const data = await api<MeResponse>("/users/current_user");
        const payload = pickUserFromMe(data);
        if (alive) {
          setMe(mapUser(payload) ?? null);
          setHydrating(false);
        }
      } catch {
        if (alive) {
          setMe(null);
          setHydrating(false);
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxUser, authLoading]);

  // fetch dashboard data
  React.useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await api<unknown>("/schedules?includeGroup=1");
        if (alive) setEvents(normalizeScheduleRows(res));
      } catch {
        if (alive) setEvents([]);
      }
    })();

    (async () => {
      try {
        const res = await api<GroupsMineResponse>("/groups/mine");
        if (alive) {
          const minis: GroupMini[] = res.map((g) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            color: undefined,
            avatarUrl: undefined,
            unreadCount: undefined,
          }));
          setGroups(minis);
        }
      } catch {
        if (alive) setGroups([]);
      }
    })();

    // Fetch ALL personal streaks (study/post) + backend-picked highest groupMessage.
    (async () => {
      try {
        const res = await api<{ streaks: AnyStreakInfo[]; totalActiveToday?: boolean }>("/streaks/me");
        if (alive) {
          const allowed = res.streaks.filter(
            (s): s is StreakInfo =>
              (s as AnyStreakInfo).type === "study" ||
              (s as AnyStreakInfo).type === "post" ||
              (s as AnyStreakInfo).type === "groupMessage"
          );
          const byType = Object.fromEntries(allowed.map((s) => [s.type, s])) as Partial<Record<
            "study" | "post" | "groupMessage",
            StreakInfo
          >>;

          setStreaks(byType);
          setStreakDays(byType.study?.current_count ?? 0);

          // Highest group streak days (longest_count) straight from backend
          setGroupChatHighest(byType.groupMessage?.longest_count ?? 0);
        }
      } catch {
        if (alive) {
          setStreaks({});
          setStreakDays(0);
          setGroupChatHighest(0);
        }
      }
    })();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // NOTE: removed per-group fan-out to /streaks/groupMessage?groupId=...
  // Backend already returns the highest groupMessage via /streaks/me

  if (authLoading || hydrating) return <div style={{ height: 1 }} />;

  const user = me;
  const days = next7Days();
  const eventsByDay = mapEventsByDay(days, events);

  const hasGroups = Array.isArray(groups) && groups.length > 0;
  const hasEvents = Array.isArray(events) && events.length > 0;

  return (
    <div className="relative min-h-screen">
      {/* animated soft background */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <motion.div
          className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full blur-3xl bg-primary/15"
          initial={{ scale: 0.9, opacity: 0.5 }}
          animate={{ scale: 1.05, opacity: 0.8 }}
          transition={{ duration: 6, repeat: Infinity, repeatType: "mirror" }}
        />
        <motion.div
          className="absolute -bottom-24 right-8 h-80 w-80 rounded-full blur-3xl bg-accent/15"
          initial={{ scale: 0.95, opacity: 0.5 }}
          animate={{ scale: 1.08, opacity: 0.75 }}
          transition={{ duration: 7, repeat: Infinity, repeatType: "mirror" }}
        />
      </div>

      <div className="mx-auto max-w-7xl px-4 md:px-8 py-8 md:py-12">
        {/* HERO — warm, universal */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/10 via-accent/10 to-background"
        >
          <div className="p-6 md:p-8 flex flex-col md:flex-row items-center md:items-end justify-between gap-6">
            <div className="flex items-center gap-4">
              {/* Larger, clickable avatar -> profile */}
              <Link
                to={user ? `/profile/${user.username}` : "/profile"}
                aria-label="Open your profile"
                title="Open your profile"
                className="group"
              >
                <div className="h-20 w-20 md:h-24 md:w-24 rounded-full bg-muted overflow-hidden border shadow-sm ring-1 ring-transparent transition group-hover:ring-primary/40">
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.displayName ?? "user"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-2xl md:text-3xl font-semibold">
                      {user?.displayName?.[0]?.toUpperCase() ?? "U"}
                    </div>
                  )}
                </div>
              </Link>

              <div>
                <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight">
                  Hey {user?.displayName ?? "there"} 👋
                </h1>
                <p className="mt-1 text-sm md:text-base text-foreground/70">
                  A gentle place to plan, connect, and make small progress every day.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link to="/schedule">
                <Button className="gap-2">
                  Plan this Week <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/posts">
                <Button variant="outline" className="gap-2">
                  Open Posts <Newspaper className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 border-t">
            <div className="px-6 py-3 text-sm flex items-center justify-between">
              <span className="text-foreground/60">Friends</span>
              <span className="font-semibold">{user?.friendsCount ?? 0}</span>
            </div>
            <div className="px-6 py-3 text-sm flex items-center justify-between">
              <span className="text-foreground/60">Groups</span>
              <span className="font-semibold">{user?.groupsCount ?? 0}</span>
            </div>
            <div className="px-6 py-3 text-sm flex items-center justify-between">
              <span className="text-foreground/60">Streak</span>
              <span className="font-semibold inline-flex items-center gap-1">
                <Flame className="h-4 w-4 text-primary" />
                {typeof streakDays === "number" ? `${streakDays}` : "0"}d
              </span>
            </div>
          </div>
        </motion.div>

        {/* MAIN GRID — 12 cols: main (8) / side (4) */}
        <div className="mt-10 md:mt-14 grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
          {/* MAIN */}
          <div className="lg:col-span-8 space-y-6">
            <TodayPanel events={events} />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                  <CalendarDays className="h-5 w-5" />
                  This Week
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-7 gap-2">
                  {days.map((d) => {
                    const evs = eventsByDay.get(d.key) ?? [];
                    return (
                      <div
                        key={d.key}
                        className={`rounded-xl border px-3 py-3 text-center ${d.isToday ? "bg-primary/10 border-primary/30" : "bg-card/50"}`}
                      >
                        <div className="text-xs md:text-sm font-medium">{d.label}</div>
                        <div className="mt-2 flex flex-col items-center gap-1">
                          {evs.slice(0, 3).map((ev) => (
                            <div
                              key={ev.id}
                              className="w-full rounded-md px-2 py-1 text-xs text-left truncate border"
                              style={{ borderColor: ev.color ?? "hsl(var(--primary))" }}
                              title={`${ev.title} · ${formatTimeRange(ev.startISO, ev.endISO)}`}
                            >
                              <span className="font-medium">{ev.title}</span>
                              <span className="text-foreground/60"> · {formatTimeRange(ev.startISO, ev.endISO)}</span>
                            </div>
                          ))}
                          {evs.length > 3 && <div className="text-[11px] text-foreground/60">+{evs.length - 3} more</div>}
                          {!evs.length && <div className="text-[11px] text-foreground/60">Free</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <Link to="/schedule">
                    <Button variant="outline" className="gap-2">
                      Open Schedule <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Posts CTA — universal, simple */}
            <Card
              className="cursor-pointer border-primary/20 bg-gradient-to-br from-primary/10 via-background to-accent/10 hover:shadow-lg transition"
              onClick={() => nav("/posts")}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                  <Newspaper className="h-5 w-5" />
                  Community Posts
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="text-sm md:text-base text-foreground/70">
                    Read, comment, and share with everyone.
                  </div>
                  <Button className="gap-2">
                    Go to Posts <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* SIDE */}
          <div className="lg:col-span-4 space-y-6">
            <DailyCheckIn />

            {/* Streaks Card (no DM) */}
            <DashboardStreaksCard
              study={streaks.study ?? null}
              post={streaks.post ?? null}
              groupChatHighest={groupChatHighest}
            />

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Your Groups
                  </CardTitle>
                  <Link to="/groups">
                    <Button size="sm" variant="outline" className="gap-2">
                      <Plus className="h-4 w-4" /> New
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {groups === null ? (
                  <div className="text-sm text-foreground/60">Loading groups…</div>
                ) : (
                  <GroupsMiniList groups={groups} />
                )}
              </CardContent>
            </Card>

            <Suggestions hasGroups={hasGroups} hasEvents={hasEvents} />
          </div>
        </div>

        <div className="mt-12 md:mt-16 text-center text-xs md:text-sm text-foreground/60">
          Built with ❤️ — Schedura
        </div>
      </div>
    </div>
  );
}
