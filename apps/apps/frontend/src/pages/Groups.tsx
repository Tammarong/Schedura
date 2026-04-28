// src/pages/Groups.tsx
import { motion } from "framer-motion";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Users,
  Plus,
  Hash,
  Copy,
  CheckCircle,
  MapPin,
  CalendarDays,
  Crown,
  Search,
  Filter,
  LogIn,
  Flame, // ← NEW: streak icon
} from "lucide-react";
import { api, getToken } from "@/lib/api";
import { AuthContext } from "@/context/AuthContext";

/* ---------- types ---------- */
type Role = "owner" | "member" | undefined;

interface Group {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  owner_id: number;
  created_at: string;
  memberCount: number;
  role?: Role;
  inviteCode?: string | null;
}

// minimal message shape we need (created_at only)
type MessageLite = { created_at: string };

type Me = { id: number; username?: string };

type JwtMaybe = {
  id?: number;
  user_id?: number;
  userId?: number;
  username?: string;
};

/* ---------- helpers ---------- */
function clsx(...arr: Array<string | false | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function decodeJwtId(token: string | null): number | null {
  if (!token) return null;
  try {
    const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
    const [, payload] = raw.split(".");
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as JwtMaybe;
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

function isGroup(x: unknown): x is Group {
  return !!x && typeof x === "object" && typeof (x as { id: unknown }).id === "number" && typeof (x as { name: unknown }).name === "string";
}

/* ---------- streak helpers (UTC, 1 per day per group) ---------- */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function utcDayString(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}
function computeStreakFromMessages(msgs: MessageLite[]) {
  const days = new Set<string>();
  for (const m of msgs) {
    const dt = new Date(m.created_at);
    if (!Number.isNaN(dt.getTime())) days.add(utcDayString(dt));
  }
  let count = 0;
  const today = new Date();
  for (let i = 0; ; i++) {
    const dayStr = utcDayString(new Date(today.getTime() - i * MS_PER_DAY));
    if (days.has(dayStr)) count += 1;
    else break;
  }
  const activeToday = days.has(utcDayString(today));
  return { count, activeToday };
}

/* =========================================================
   Groups Page (auth-aware)
========================================================= */
const Groups = () => {
  const { user, loading: authLoading } = useContext(AuthContext);

  // optimistic id from token (instant)
  const [optimisticId] = useState<number | null>(() => decodeJwtId(getToken() ?? null));

  // canonical `/users/current_user`
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState<boolean>(true);

  // effective auth
  const effectiveUserId = useMemo<number | null>(() => {
    if (user && typeof user.id === "number") return user.id;
    if (me && typeof me.id === "number") return me.id;
    if (optimisticId !== null) return optimisticId;
    return null;
  }, [user, me, optimisticId]);

  // data
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // per-group streaks
  const [groupStreaks, setGroupStreaks] = useState<Record<number, { count: number; activeToday: boolean }>>({});
  const fetchedStreakFor = useRef<Set<number>>(new Set()); // avoid refetching

  // create/join
  const [newGroup, setNewGroup] = useState<{ name: string; description: string; location: string }>({
    name: "",
    description: "",
    location: "",
  });
  const [inviteCode, setInviteCode] = useState<string>("");

  // UX state
  const [createdGroup, setCreatedGroup] = useState<Group | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // filters
  const [query, setQuery] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<Role>(undefined);

  // probe current_user once (like Profile page)
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

  /* ---------- Load groups for authed user ---------- */
  const lastFetchUid = useRef<number | null>(null);
  useEffect(() => {
    const fetchGroups = async () => {
      if (effectiveUserId == null) {
        setGroups([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      lastFetchUid.current = effectiveUserId;
      try {
        const raw = await api<unknown>("/groups/mine", { method: "GET" });
        const safe: Group[] = Array.isArray(raw) ? raw.filter(isGroup) : [];
        if (lastFetchUid.current === effectiveUserId) setGroups(safe);
      } catch (err) {
        console.error("Failed to load groups", err);
        if (lastFetchUid.current === effectiveUserId) setGroups([]);
      } finally {
        if (lastFetchUid.current === effectiveUserId) setLoading(false);
      }
    };
    void fetchGroups();
  }, [effectiveUserId]);

  /* ---------- Fetch streak per group (lazy, idempotent) ---------- */
  useEffect(() => {
    if (!groups.length) return;

    // fetch only for groups not fetched yet; cap to first 24 to be gentle
    const toFetch = groups
      .map((g) => g.id)
      .filter((id) => !fetchedStreakFor.current.has(id))
      .slice(0, 24);

    if (!toFetch.length) return;

    let cancelled = false;
    (async () => {
      for (const gid of toFetch) {
        try {
          // try to be nice to the API: request only what we need
          const res = await api<unknown>(`/messages/group/${gid}?limit=500&fields=created_at`, { method: "GET" });
          const msgs: MessageLite[] = Array.isArray(res)
            ? (res as MessageLite[])
            : Array.isArray((res as any)?.messages)
            ? ((res as any).messages as MessageLite[])
            : [];

          const { count, activeToday } = computeStreakFromMessages(msgs);
          if (!cancelled) {
            setGroupStreaks((prev) => ({ ...prev, [gid]: { count, activeToday } }));
            fetchedStreakFor.current.add(gid);
          }
        } catch {
          // fallback to zero if it fails
          if (!cancelled) {
            setGroupStreaks((prev) => ({ ...prev, [gid]: { count: 0, activeToday: false } }));
            fetchedStreakFor.current.add(gid);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [groups]);

  /* ---------- Create ---------- */
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (effectiveUserId == null) return; // guard
    try {
      const data = await api<Group & { error?: string }>("/groups", {
        method: "POST",
        body: newGroup,
      });
      if (data && isGroup(data)) {
        setCreatedGroup(data);
        setGroups((prev) => [data, ...prev]);
        setNewGroup({ name: "", description: "", location: "" });
      } else {
        const msg = (data as { error?: string } | null)?.error || "Create group failed";
        alert(msg);
      }
    } catch (err) {
      console.error("Error creating group", err);
    }
  };

  /* ---------- Join ---------- */
  const handleJoinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (effectiveUserId == null) return; // guard
    try {
      const res = await api<{ error?: string }>("/groups/join", {
        method: "POST",
        body: { code: inviteCode.trim().toUpperCase() },
      });
      if (!res?.error) {
        setInviteCode("");
        // reload
        const raw = await api<unknown>("/groups/mine", { method: "GET" });
        const safe: Group[] = Array.isArray(raw) ? raw.filter(isGroup) : [];
        setGroups(safe);
      } else {
        alert(res.error || "Join failed");
      }
    } catch (err) {
      console.error("Error joining group", err);
    }
  };

  /* ---------- Copy helpers ---------- */
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // no-op
    }
  };

  /* ---------- Derived list (filter only) ---------- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      const matchesQuery =
        !q ||
        g.name.toLowerCase().includes(q) ||
        (g.description ?? "").toLowerCase().includes(q) ||
        (g.location ?? "").toLowerCase().includes(q);
      const matchesRole = !roleFilter || g.role === roleFilter;
      return matchesQuery && matchesRole;
    });
  }, [groups, query, roleFilter]);

  /* ---------- auth gates ---------- */
  if (authLoading || meLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <p className="text-lg text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const authed = effectiveUserId != null;

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 md:px-6 pt-8 pb-16">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative overflow-hidden rounded-3xl border bg-card shadow-lg"
        >
          <div className="relative p-6 md:p-10">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Schedura Hubs</h1>
                <p className="text-muted-foreground mt-2 max-w-2xl">
                  Find your people. Organize sessions, share resources, and meet up on campus or online.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                {/* Create Group */}
                <Dialog>
                  <DialogTrigger asChild>
                    <Button className="gap-2" disabled={!authed} title={!authed ? "Please log in" : undefined}>
                      <Plus className="h-4 w-4" />
                      Create Group
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[560px]">
                    <DialogHeader>
                      <DialogTitle>Create a Study Group</DialogTitle>
                    </DialogHeader>

                    <form onSubmit={handleCreateGroup} className="space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="g-name">Group Name</Label>
                          <Input
                            id="g-name"
                            value={newGroup.name}
                            onChange={(e) => setNewGroup((p) => ({ ...p, name: e.target.value }))}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="g-location">Location (campus, room, or “Online”)</Label>
                          <Input
                            id="g-location"
                            value={newGroup.location}
                            onChange={(e) => setNewGroup((p) => ({ ...p, location: e.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="g-desc">Description</Label>
                        <Textarea
                          id="g-desc"
                          rows={4}
                          placeholder="What’s the purpose? How often do you meet?"
                          value={newGroup.description}
                          onChange={(e) => setNewGroup((p) => ({ ...p, description: e.target.value }))}
                        />
                      </div>

                      <Button type="submit" className="w-full" disabled={!authed}>
                        Create Group
                      </Button>
                    </form>

                    {createdGroup && (
                      <div className="mt-5 rounded-xl border bg-primary/5 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle className="h-5 w-5 text-primary" />
                          <p className="font-semibold">Group created</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium">{createdGroup.name}</span> is ready.
                          {createdGroup.inviteCode ? " Share the invite code:" : ""}
                        </p>

                        {createdGroup.inviteCode && (
                          <div className="mt-3 flex items-center gap-2">
                            <code className="rounded-md border px-2 py-1 text-sm">
                              {createdGroup.inviteCode}
                            </code>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="gap-2"
                              onClick={() => copyText(createdGroup.inviteCode || "")}
                            >
                              <Copy className="h-4 w-4" />
                              {copied ? "Copied" : "Copy"}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </DialogContent>
                </Dialog>

                {/* Join Group */}
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="secondary" className="gap-2" disabled={!authed} title={!authed ? "Please log in" : undefined}>
                      <Hash className="h-4 w-4" />
                      Join with Code
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[480px]">
                    <DialogHeader>
                      <DialogTitle>Join a Group</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleJoinGroup} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="inviteCode">Invite Code</Label>
                        <Input
                          id="inviteCode"
                          placeholder="ABC123"
                          value={inviteCode}
                          onChange={(e) => setInviteCode(e.target.value)}
                          required
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={!authed}>
                        Join Group
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {!authed && (
              <div className="mt-4 inline-flex items-center gap-2 text-sm text-amber-600">
                <LogIn className="h-4 w-4" />
                You’re not signed in. Log in to create or join groups.
              </div>
            )}
          </div>
        </motion.div>

        {/* Toolbar (search + role filter only) */}
        <div className="sticky top-2 z-10 mt-6">
          <div className="rounded-2xl border bg-card p-3 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex-1 flex items-center gap-2">
                <div className="relative w-full md:w-96">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search by name, description, or location…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Filter className="h-4 w-4" />
                  Role:
                </span>

                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={roleFilter === undefined ? "default" : "secondary"}
                    onClick={() => setRoleFilter(undefined)}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={roleFilter === "owner" ? "default" : "secondary"}
                    onClick={() => setRoleFilter("owner")}
                  >
                    Owners
                  </Button>
                  <Button
                    size="sm"
                    variant={roleFilter === "member" ? "default" : "secondary"}
                    onClick={() => setRoleFilter("member")}
                  >
                    Members
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="mt-6 grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {loading &&
            Array.from({ length: 8 }).map((_, i) => (
              <motion.div
                key={`skeleton-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-2xl border bg-card p-4"
              >
                <div className="h-24 w-full rounded-xl bg-muted/70 animate-pulse" />
                <div className="mt-3 h-4 w-2/3 rounded bg-muted/70 animate-pulse" />
                <div className="mt-2 h-4 w-1/2 rounded bg-muted/70 animate-pulse" />
                <div className="mt-4 h-9 w-full rounded-lg bg-muted/70 animate-pulse" />
              </motion.div>
            ))}

          {!loading &&
            filtered.map((group, idx) => {
              const accents = [
                "from-primary/15 via-primary/10 to-transparent",
                "from-emerald-500/15 via-emerald-500/10 to-transparent",
                "from-rose-500/15 via-rose-500/10 to-transparent",
                "from-amber-500/15 via-amber-500/10 to-transparent",
                "from-sky-500/15 via-sky-500/10 to-transparent",
                "from-violet-500/15 via-violet-500/10 to-transparent",
              ];
              const accent = accents[idx % accents.length];
              const streak = groupStreaks[group.id];

              return (
                <motion.div
                  key={group.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(idx, 12) * 0.02 }}
                  whileHover={{ y: -3 }}
                >
                  <Card className="relative overflow-hidden rounded-2xl border bg-card hover:shadow-lg transition">
                    <div className={clsx("pointer-events-none absolute inset-x-0 -top-20 h-40 bg-gradient-to-b", accent)} />
                    <CardContent className="relative p-5 flex flex-col h-full">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-lg truncate">{group.name}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5" />
                              {group.memberCount} members
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDays className="h-3.5 w-3.5" />
                              since {fmtDate(group.created_at)}
                            </span>
                            {group.role === "owner" && (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                                <Crown className="h-3.5 w-3.5" />
                                Owner
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Streak badge (group-wide) */}
                        <div className="ml-2 inline-flex items-center gap-1.5 text-xs rounded-full border px-2 py-1 bg-background/70">
                          <Flame className={clsx("h-3.5 w-3.5", streak?.activeToday ? "text-orange-500" : "text-muted-foreground")} />
                          <span className="font-medium tabular-nums">
                            {streak ? `${streak.count}d` : "…"}
                          </span>
                          <span className={clsx("hidden sm:inline", streak?.activeToday ? "text-green-600" : "text-muted-foreground")}>
                            {streak?.activeToday ? "active" : "send today"}
                          </span>
                        </div>
                      </div>

                      {group.description && (
                        <p className="mt-3 text-sm text-muted-foreground line-clamp-3">
                          {group.description}
                        </p>
                      )}

                      <div className="mt-3 inline-flex items-center gap-2 text-xs rounded-full border px-2.5 py-1.5 w-fit bg-muted">
                        <MapPin className="h-3.5 w-3.5" />
                        <span className="truncate max-w-[180px] sm:max-w-[220px]">
                          {group.location && group.location.trim().length > 0 ? group.location : "Online / TBA"}
                        </span>
                      </div>

                      <Link to={`/groups/${group.id}`} className="mt-4">
                        <Button className="w-full">View Group</Button>
                      </Link>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
        </div>

        {!loading && authed && filtered.length === 0 && (
          <div className="text-center py-16">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No groups found. Try a different role or search term.</p>
          </div>
        )}

        {!loading && !authed && (
          <div className="text-center py-16">
            <LogIn className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Please log in to view and manage your groups.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Groups;
