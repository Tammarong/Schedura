// controllers/streaks.controller.js
// -------------------------------------------------------------
// Notes (deploy-time):
// - If you're behind PgBouncer, set prisma datasource with directUrl:
//     datasource db { provider = "postgresql"; url = env("DATABASE_URL"); directUrl = env("DIRECT_DATABASE_URL") }
//   Then run `prisma migrate deploy` using DIRECT_DATABASE_URL (non-pooled).
// - Run migrations once per deploy (Render "Postdeploy/Release Command").
// -------------------------------------------------------------

import pkg from "@prisma/client";
const { PrismaClient } = pkg;

/* -------- Lazy Prisma singleton (avoid constructing at import/build) -------- */
let _prisma = null;
function prisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

/* ------------------------------------------------------------------ */
/*                   Delegate detection / compatibility                */
/* ------------------------------------------------------------------ */
function getDelegates(client = prisma()) {
  // Support either model names (with/without @@map)
  const Streak = client.streak ?? client.streaks ?? null;
  const StreakActivity = client.streakActivity ?? client.streak_activity ?? null;

  // Titles schema (pluralized names in your schema)
  const Titles = client.titles ?? client.title ?? null;
  const UserTitles = client.user_titles ?? client.userTitle ?? null;
  const Users = client.users ?? null;

  return { Streak, StreakActivity, Titles, UserTitles, Users };
}

function assertDelegatesOrThrow() {
  const { Streak, StreakActivity } = getDelegates();
  if (!Streak || !StreakActivity) {
    const hint =
      "Prisma client is missing delegates for Streak/StreakActivity (or streaks/streak_activity). " +
      "Make sure `prisma generate` ran against the schema that defines these models.";
    const err = new Error(hint);
    err.code = "PRISMA_DELEGATE_MISSING";
    throw err;
  }
}

/* --------------------- UTC date-only helpers --------------------- */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function daysDiffUtc(a, b) {
  const A = startOfUtcDay(a).getTime();
  const B = startOfUtcDay(b).getTime();
  return Math.round((B - A) / MS_PER_DAY);
}
function toUtcDateOnly(input) {
  const d = input ? new Date(input) : new Date();
  return startOfUtcDay(d);
}
const toIntOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/* --------------------- types & cosmetics --------------------- */
/** DM REMOVED: only these 3 are valid now */
export const STREAK_TYPES = Object.freeze({
  post: "post",
  study: "study",
  groupMessage: "groupMessage",
});
const VALID_TYPES = new Set(Object.values(STREAK_TYPES));

function normalizeType(s) {
  const x = String(s || "").trim().toLowerCase();
  if (x === "post" || x === "posts") return STREAK_TYPES.post;
  if (x === "study" || x === "studies") return STREAK_TYPES.study;
  if (x === "group" || x === "groupmessage" || x === "group-message" || x === "group_msg")
    return STREAK_TYPES.groupMessage;
  return null; // "dm" or anything else => invalid
}

/* ---------- Stages / titles per type ---------- */
const CHECKPOINT = 50;

// Per-type ladders (used for both cosmetic labels & title awards)
const TITLE_LADDERS = Object.freeze({
  [STREAK_TYPES.post]: ["Spark", "Ember", "Flame", "Blaze", "Inferno", "Mythic"],
  [STREAK_TYPES.study]: [
    "Initiate",
    "Learner",
    "Apprentice",
    "Scholar",
    "Expert",
    "Master",
    "Grandmaster",
  ],
  [STREAK_TYPES.groupMessage]: [
    "Scout",
    "Participant",
    "Contributor",
    "Connector",
    "Collaborator",
    "Facilitator",
    "Community Leader",
  ],
});

/** Returns { stage, label, nextCheckpoint, progressToNext } based on type & count */
function computeTier(type, count) {
  const ladder = TITLE_LADDERS[type] ?? TITLE_LADDERS[STREAK_TYPES.post]; // fallback
  const stage = Math.floor((Number(count) || 0) / CHECKPOINT);
  const label = ladder[Math.min(stage, ladder.length - 1)];
  const nextCheckpoint = (stage + 1) * CHECKPOINT;
  const progressToNext = CHECKPOINT
    ? Math.min(1, ((Number(count) || 0) - stage * CHECKPOINT) / CHECKPOINT)
    : 1;
  return { stage, label, nextCheckpoint, progressToNext };
}

function emptyStreak(type, group_id = null) {
  return {
    type,
    group_id,
    current_count: 0,
    longest_count: 0,
    start_date: null,
    last_date: null,
    todayActive: false,
    flame: computeTier(type, 0),
  };
}

/* --------------------- Title helpers --------------------- */
const slugSnake = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const rarityFromStage = (stage) => {
  if (stage >= 6) return "legendary";
  if (stage >= 4) return "epic";
  if (stage >= 2) return "rare";
  return "common";
};

/** spark_1d_post, ember_50d_post, flame_100d_post, ... */
function buildTitleKey(type, label, stageIdx) {
  const slug = slugSnake(label);
  const thresholdDays = stageIdx === 0 ? 1 : stageIdx * CHECKPOINT; // 1d, 50d, 100d...
  return `${slug}_${thresholdDays}d_${type}`;
}

/** Award titles on first activation and all newly crossed stage boundaries. */
async function awardStreakTitleIfNeeded(tx, { userId, type, prevCount, newCount }) {
  const { Titles, UserTitles, Users } = getDelegates(tx);
  if (!Titles || !UserTitles || !Users) return; // titles feature not installed -> skip

  const ladder = TITLE_LADDERS[type];
  if (!ladder) return;

  const pc = Number(prevCount || 0);
  const nc = Number(newCount || 0);
  const prevStage = Math.floor(pc / CHECKPOINT);
  const newStage = Math.floor(nc / CHECKPOINT);

  const stagesToAward = [];
  // First activation (0 -> 1+): always ensure stage 0
  if (pc === 0 && nc >= 1) stagesToAward.push(0);
  // Any newly crossed stage(s)
  for (let s = Math.max(prevStage + 1, 1); s <= newStage; s++) stagesToAward.push(s);
  if (stagesToAward.length === 0) return;

  // We might award multiple in unusual cases (backfill/import). Process in order.
  for (const stageIdx of stagesToAward) {
    const label = ladder[Math.min(stageIdx, ladder.length - 1)];
    const key = buildTitleKey(type, label, stageIdx);
    const rarity = rarityFromStage(stageIdx);

    // Upsert into `titles` with your schema (key/label/description/rarity/unlock_json/is_active)
    const title = await Titles.upsert({
      where: { key },
      update: {},
      create: {
        key,
        label,
        description: `Earned via ${type} streak (stage ${stageIdx}, ${stageIdx * CHECKPOINT}+ days).`,
        rarity,
        unlock_json: { type, stage: stageIdx, checkpoint: CHECKPOINT },
        is_active: true,
      },
    });

    // Give it to the user if they don't already have it
    const owned = await UserTitles.findFirst({
      where: { user_id: userId, title_id: title.id },
      select: { title_id: true },
    });
    if (!owned) {
      await UserTitles.create({
        data: {
          user_id: userId,
          title_id: title.id,
          // obtained_at: default(now())
          source: "streak", // TitleSource.streak
          meta: { type, stage: stageIdx, checkpoint: CHECKPOINT },
        },
      });

      // Auto-equip if user has no current title yet
      const user = await Users.findUnique({
        where: { id: userId },
        select: { current_title_id: true },
      });
      if (!user?.current_title_id) {
        await Users.update({
          where: { id: userId },
          data: { current_title_id: title.id },
        });
      }
    }
  }
}

/* =======================================================================
   GET /streaks/me?groupId=?
======================================================================= */
export async function getMyStreaks(req, res) {
  try {
    assertDelegatesOrThrow();
    const { Streak } = getDelegates();

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const groupId = toIntOrNull(req.query.groupId);

    const rows = await Streak.findMany({
      where: groupId != null ? { user_id: userId, group_id: groupId } : { user_id: userId },
      orderBy: [{ type: "asc" }, { current_count: "desc" }, { id: "desc" }],
    });

    const today = startOfUtcDay();

    const pickPersonal = (type) => {
      const personal = rows.find((r) => r.type === type && r.group_id == null);
      return personal ?? rows.find((r) => r.type === type) ?? null;
    };

    // UPDATED: prefer highest-ever longest_count, then higher current_count, then newest id
    const pickHighestByType = (type) => {
      const list = rows.filter((r) => r.type === type);
      if (!list.length) return null;
      return list.reduce((best, r) => {
        if (!best) return r;

        const rLongest = Number(r.longest_count || 0);
        const bLongest = Number(best.longest_count || 0);
        if (rLongest > bLongest) return r;
        if (rLongest < bLongest) return best;

        const rCurrent = Number(r.current_count || 0);
        const bCurrent = Number(best.current_count || 0);
        if (rCurrent > bCurrent) return r;
        if (rCurrent < bCurrent) return best;

        return r.id > best.id ? r : best;
      }, null);
    };

    const out = [];

    // post & study (personal)
    for (const t of [STREAK_TYPES.post, STREAK_TYPES.study]) {
      const r = pickPersonal(t);
      if (!r) out.push(emptyStreak(t, groupId ?? null));
      else {
        const todayActive = r.last_date ? daysDiffUtc(r.last_date, today) === 0 : false;
        out.push({
          type: r.type,
          group_id: r.group_id,
          current_count: r.current_count,
          longest_count: r.longest_count,
          start_date: r.start_date,
          last_date: r.last_date,
          todayActive,
          flame: computeTier(t, r.current_count),
        });
      }
    }

    // groupMessage
    {
      const r =
        groupId != null
          ? rows.find((x) => x.type === STREAK_TYPES.groupMessage) ?? null
          : pickHighestByType(STREAK_TYPES.groupMessage);
      out.push(
        r
          ? {
              type: r.type,
              group_id: r.group_id,
              current_count: r.current_count,
              longest_count: r.longest_count,
              start_date: r.start_date,
              last_date: r.last_date,
              todayActive: r.last_date ? daysDiffUtc(r.last_date, today) === 0 : false,
              flame: computeTier(STREAK_TYPES.groupMessage, r.current_count),
            }
          : emptyStreak(STREAK_TYPES.groupMessage, groupId ?? null)
      );
    }

    const totalActiveToday = out.some((p) => p.todayActive);
    return res.json({ streaks: out, totalActiveToday });
  } catch (err) {
    if (err.code === "PRISMA_DELEGATE_MISSING") {
      console.error(err.message);
      return res.status(500).json({ error: err.message });
    }
    console.error("getMyStreaks error:", err);
    return res.status(500).json({ error: "Failed to fetch streaks" });
  }
}

/* =======================================================================
   GET /streaks/:type?groupId=?
   - Valid types: post, study, groupMessage
   - groupMessage requires groupId; post/study must NOT include groupId
======================================================================= */
export async function getStreakByType(req, res) {
  try {
    assertDelegatesOrThrow();
    const { Streak } = getDelegates();

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const type = normalizeType(req.params.type);
    if (!type || !VALID_TYPES.has(type)) return res.status(400).json({ error: "Invalid type" });

    const groupId = toIntOrNull(req.query.groupId);

    if (type === STREAK_TYPES.groupMessage && groupId == null) {
      return res.status(400).json({ error: "groupId is required for groupMessage streaks" });
    }
    if (type !== STREAK_TYPES.groupMessage && groupId != null) {
      return res.status(400).json({ error: "groupId is only valid for groupMessage streaks" });
    }

    const today = startOfUtcDay();
    const effectiveGroupId = type === STREAK_TYPES.groupMessage ? groupId : null;

    const r = await Streak.findFirst({
      where: { user_id: userId, type, group_id: effectiveGroupId },
      orderBy: { id: "asc" },
    });

    if (!r) return res.json(emptyStreak(type, effectiveGroupId));

    const todayActive = r.last_date ? daysDiffUtc(r.last_date, today) === 0 : false;

    return res.json({
      type: r.type,
      group_id: r.group_id,
      current_count: r.current_count,
      longest_count: r.longest_count,
      start_date: r.start_date,
      last_date: r.last_date,
      todayActive,
      flame: computeTier(type, r.current_count),
    });
  } catch (err) {
    if (err.code === "PRISMA_DELEGATE_MISSING") {
      console.error(err.message);
      return res.status(500).json({ error: err.message });
    }
    console.error("getStreakByType error:", err);
    return res.status(500).json({ error: "Failed to fetch streak" });
  }
}

/* =======================================================================
   GET /streaks/:type/history?days=90&groupId=?
======================================================================= */
export async function getStreakHistory(req, res) {
  try {
    assertDelegatesOrThrow();
    const { StreakActivity } = getDelegates();

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const type = normalizeType(req.params.type);
    if (!type || !VALID_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid type" });
    }

    const groupId = toIntOrNull(req.query.groupId);

    if (type === STREAK_TYPES.groupMessage && groupId == null) {
      return res.status(400).json({ error: "groupId is required for groupMessage history" });
    }
    if (type !== STREAK_TYPES.groupMessage && groupId != null) {
      return res.status(400).json({ error: "groupId is only valid for groupMessage history" });
    }

    const days = Math.max(1, Math.min(365, Number(req.query.days ?? 90)));
    const end = startOfUtcDay();
    const start = new Date(end.getTime() - (days - 1) * MS_PER_DAY);

    const effectiveGroupId = type === STREAK_TYPES.groupMessage ? groupId : null;

    const rows = await StreakActivity.findMany({
      where: {
        user_id: userId,
        type,
        group_id: effectiveGroupId,
        activity_date: { gte: start, lte: end },
      },
      orderBy: { activity_date: "asc" },
    });

    const map = new Map(rows.map((r) => [startOfUtcDay(r.activity_date).getTime(), r.count]));
    const series = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * MS_PER_DAY);
      const key = d.getTime();
      series.push({ date: d.toISOString().slice(0, 10), count: map.get(key) ?? 0 });
    }

    return res.json({ type, group_id: effectiveGroupId, days, series });
  } catch (err) {
    if (err.code === "PRISMA_DELEGATE_MISSING") {
      console.error(err.message);
      return res.status(500).json({ error: err.message });
    }
    console.error("getStreakHistory error:", err);
    return res.status(500).json({ error: "Failed to fetch history" });
  }
}

/* =======================================================================
   POST /streaks/:type/ping
   Body: { groupId? , at? }
   Rules:
   - Valid types: post, study, groupMessage
   - groupMessage requires groupId; others must NOT include groupId
   - Once per day: If already active today, counters do NOT change.
   - When crossing to a new day:
       gap==1  => current_count += 1
       gap>1   => current_count = 1, start_date = today
======================================================================= */
const SHOULD_RETRY = (e) =>
  e?.code === "P2028" || /Transaction already closed|Transaction timeout/i.test(e?.message || "");

export async function pingStreak(req, res) {
  try {
    assertDelegatesOrThrow();

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const type = normalizeType(req.params.type);
    if (!type || !VALID_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid type" });
    }

    const bodyGroup = toIntOrNull(req.body?.groupId);
    const queryGroup = toIntOrNull(req.query?.groupId);
    const groupId = bodyGroup ?? queryGroup;

    if (type === STREAK_TYPES.groupMessage && groupId == null) {
      return res.status(400).json({ error: "groupId is required for groupMessage streaks" });
    }
    if (type !== STREAK_TYPES.groupMessage && groupId != null) {
      return res.status(400).json({ error: "groupId is only valid for groupMessage streaks" });
    }

    const effectiveGroupId = type === STREAK_TYPES.groupMessage ? groupId : null;
    const today = startOfUtcDay(toUtcDateOnly(req.body?.at));

    let attempts = 0;
    async function runOnce() {
      attempts += 1;
      return await prisma().$transaction(async (tx) => {
        const { Streak: TxStreak, StreakActivity: TxActivity } = getDelegates(tx);
        if (!TxStreak || !TxActivity) {
          const err = new Error("Prisma transaction is missing Streak/StreakActivity delegates.");
          err.code = "PRISMA_DELEGATE_MISSING";
          throw err;
        }

        // --- record activity (binary per-day)
        const updated = await TxActivity.updateMany({
          where: { user_id: userId, type, group_id: effectiveGroupId, activity_date: today },
          data: { count: { set: 1 } },
        });
        if (updated.count === 0) {
          await TxActivity.create({
            data: {
              user_id: userId,
              type,
              group_id: effectiveGroupId,
              activity_date: today,
              count: 1,
            },
          });
        }

        // --- load current streak (pre-change) for stage award comparison
        let streak = await TxStreak.findFirst({
          where: { user_id: userId, type, group_id: effectiveGroupId },
          orderBy: { id: "desc" },
        });

        const prevCount = streak?.current_count || 0;

        if (!streak) {
          streak = await TxStreak.create({
            data: {
              user_id: userId,
              type,
              group_id: effectiveGroupId,
              current_count: 1,
              longest_count: 1,
              start_date: today,
              last_date: today,
            },
          });
        } else {
          let current = streak.current_count || 0;
          let longest = streak.longest_count || 0;
          const last = streak.last_date ?? new Date(0);
          const gap = daysDiffUtc(last, today); // 0 same day, 1 consecutive, >1 broken, <0 backdated

          if (gap === 0) {
            // already active today; counters unchanged
          } else if (gap === 1) {
            current += 1;
            longest = Math.max(longest, current);
            streak = await TxStreak.update({
              where: { id: streak.id },
              data: { current_count: current, longest_count: longest, last_date: today },
            });
          } else if (gap > 1) {
            // streak broken; restart
            streak = await TxStreak.update({
              where: { id: streak.id },
              data: {
                current_count: 1,
                longest_count: Math.max(longest, 1),
                start_date: today,
                last_date: today,
              },
            });
          } else {
            // backdated -> leave counters as-is
          }
        }

        // --- award title if this action created/advanced a stage
        await awardStreakTitleIfNeeded(tx, {
          userId,
          type,
          prevCount,
          newCount: streak.current_count || 0,
        });

        return streak;
      });
    }

    let result;
    try {
      result = await runOnce();
    } catch (e) {
      if (SHOULD_RETRY(e) && attempts < 2) {
        result = await runOnce();
      } else {
        throw e;
      }
    }

    return res.json({
      ok: true,
      streak: {
        type: result.type,
        group_id: result.group_id,
        current_count: result.current_count,
        longest_count: result.longest_count,
        start_date: result.start_date,
        last_date: result.last_date,
        flame: computeTier(result.type, result.current_count),
      },
    });
  } catch (err) {
    if (err.code === "PRISMA_DELEGATE_MISSING") {
      console.error(err.message);
      return res.status(500).json({ error: err.message });
    }
    console.error("pingStreak error:", err);
    return res.status(500).json({ error: "Failed to record streak" });
  }
}
