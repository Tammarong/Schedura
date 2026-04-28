// src/pages/Landing.tsx
import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Users,
  MessageSquare,
  BookOpen,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Sparkles,
  Sun,
  Moon,
  Monitor,
  Coffee,
  Handshake,
  Target,
  Timer,
  Brain,
  Layers,
  BarChart3,
  Flame,
  FileText,
  StickyNote,
  Rocket,
  ShieldCheck,
  Star,
} from "lucide-react";

import { ThemeProvider, useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AuthContext } from "@/context/AuthContext";

/* ---------- animation helper ---------- */
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay },
});

/* ---------- theme toggle using next-themes ---------- */
function ThemeSwitcher() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted ? theme === "dark" || resolvedTheme === "dark" : false;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      aria-label="Toggle theme"
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light" : "Switch to dark"}
    >
      {mounted ? (isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />) : <span className="inline-block h-4 w-4" />}
    </Button>
  );
}

/* ---------- glowing badge ---------- */
function GlowBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide
      bg-primary/10 text-primary border-primary/20 shadow-[0_0_20px_-8px] shadow-primary/60">
      {children}
    </span>
  );
}

/* ---------- view content (inside ThemeProvider) ---------- */
function LandingInner() {
  const { user, loading } = useContext(AuthContext);
  const navigate = useNavigate();

  // If already logged in, go to dashboard (LandingGate also handles this — double-safe)
  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [user, loading, navigate]);

  const FeatureCards = useMemo(
    () => [
      {
        icon: Users,
        title: "Meet people",
        desc: "Match with classmates and like-minded learners on campus or online.",
        to: "/friends",
        cta: "Find friends",
      },
      {
        icon: BookOpen,
        title: "Study groups",
        desc: "Join or host groups with shared goals and recurring sessions.",
        to: "/groups",
        cta: "Browse groups",
      },
      {
        icon: MessageSquare,
        title: "Chat & share",
        desc: "DMs and group chat with media, reactions, and quick threads.",
        to: "/posts",
        cta: "Open chat",
      },
      {
        icon: CalendarDays,
        title: "Simple scheduling",
        desc: "Plan sessions in seconds. Auto-reminders keep everyone on track.",
        to: "/schedule",
        cta: "Plan a session",
      },
      {
        icon: Monitor,
        title: "Study Desk",
        desc: "Timers, presence, and a calm space to focus — solo or together.",
        to: "/desk", // fixed route
        cta: "Focus now",
      },
      {
        icon: FileText,
        title: "Docs & notes",
        desc: "Write together: study docs, checklists, and outlines.",
        to: "/document",
        cta: "Open docs",
      },
    ],
    []
  );

  const Stats = useMemo(
    () => [
      { label: "Study sessions planned", value: "2k+" },
      { label: "Active groups", value: "450+" },
      { label: "Messages sent", value: "120k+" },
      { label: "Daily streak highs", value: "30+" },
    ],
    []
  );

  const Techniques = useMemo(
    () => [
      {
        icon: Target,
        title: "HVA (High-Value Activities)",
        desc: "Prioritize the 1–3 tasks that move the needle. Park the rest.",
        action: { to: "/notes", label: "Prioritize with notes" },
      },
      {
        icon: Timer,
        title: "Pomodoro",
        desc: "25/5 intervals to keep momentum and avoid burnout.",
        action: { to: "/desk", label: "Start a timer" },
      },
      {
        icon: Brain,
        title: "Spaced repetition",
        desc: "Schedule quick reviews to lock in concepts long-term.",
        action: { to: "/schedule", label: "Schedule reviews" },
      },
      {
        icon: Layers,
        title: "Time-boxing",
        desc: "Block time for deep work; protect it like a class.",
        action: { to: "/schedule", label: "Time-box session" },
      },
      {
        icon: BarChart3,
        title: "Eisenhower",
        desc: "Urgent vs. important — decide fast and act on what matters.",
        action: { to: "/notes", label: "Make a quick matrix" },
      },
      {
        icon: StickyNote,
        title: "Sticky notes",
        desc: "Capture ideas and TODOs without breaking flow.",
        action: { to: "/notes", label: "Open sticky notes" },
      },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_600px_at_80%_-20%,rgba(168,85,247,0.15),transparent),radial-gradient(900px_500px_at_10%_-10%,rgba(14,165,233,0.12),transparent)]">
      {/* Top nav */}
      <header className="sticky top-0 z-30 w-full border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/50">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-primary/20 grid place-items-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold tracking-tight">Schedura</span>
          </Link>

          <div className="flex items-center gap-1.5">
            <ThemeSwitcher />
            {!user && !loading ? (
              <>
                <Link to="/login">
                  <Button variant="ghost">Sign in</Button>
                </Link>
                <Link to="/register">
                  <Button>Get started</Button>
                </Link>
              </>
            ) : (
              <Link to="/dashboard">
                <Button variant="secondary">Open app</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pt-12 md:pt-18">
        <motion.div {...fadeUp(0)} className="text-center max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-2">
            <GlowBadge>
              <ShieldCheck className="h-3.5 w-3.5" />
              Focus first • People first
            </GlowBadge>
            <GlowBadge>
              <Flame className="h-3.5 w-3.5" />
              Streaks keep momentum
            </GlowBadge>
          </div>

          <h1 className="mt-4 text-4xl md:text-6xl font-extrabold leading-tight tracking-tight">
            Meet, study, hang out —{" "}
            <span className="bg-gradient-to-r from-primary via-fuchsia-500 to-sky-500 bg-clip-text text-transparent">
              schedule together
            </span>
            .
          </h1>

          <p className="mt-4 text-base md:text-lg text-muted-foreground">
            <span className="font-medium">Schedura</span> is your social planning home for learners.
            Find partners, organize sessions, chat, and keep going with proven techniques like{" "}
            <span className="font-medium">HVA</span>, Pomodoro, and time-boxing.
          </p>

          {!user && !loading && (
            <div className="mt-6 flex items-center justify-center gap-2">
              <Link to="/register">
                <Button size="lg" className="px-6">
                  Get started free
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="secondary" className="px-6">
                  Sign in
                </Button>
              </Link>
            </div>
          )}

          <div className="mt-3 text-xs text-muted-foreground flex items-center justify-center gap-2">
            <Star className="h-3.5 w-3.5" />
            Built for students & lifelong learners
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          {...fadeUp(0.12)}
          className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-5"
        >
          {Stats.map((s) => (
            <Card key={s.label} className="border-border/60 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)]">
              <CardContent className="p-4 text-center">
                <div className="text-2xl md:text-3xl font-extrabold tracking-tight">{s.value}</div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground mt-1">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </motion.div>

        {/* Feature grid */}
        <motion.div
          {...fadeUp(0.18)}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mt-10 md:mt-14"
        >
          {FeatureCards.map((f) => (
            <Card
              key={f.title}
              className="bg-card/70 border-border/60 hover:shadow-[0_24px_60px_-24px_rgba(0,0,0,.5)]
                transition-transform hover:-translate-y-0.5"
            >
              <CardContent className="p-6">
                <div className="h-11 w-11 rounded-xl bg-primary/15 grid place-items-center mb-4">
                  <f.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{f.desc}</p>
                <Link to={f.to}>
                  <Button variant="ghost" className="mt-3 px-0">
                    {f.cta} →
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </motion.div>
      </section>

      {/* What is Schedura? */}
      <section className="mx-auto max-w-7xl px-4 mt-14 md:mt-20">
        <motion.div
          {...fadeUp(0)}
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 items-center"
        >
          <div>
            <h2 className="text-2xl md:text-3xl font-bold">What is Schedura?</h2>
            <p className="mt-3 text-muted-foreground">
              A social planning platform for learners. Meet new people, organize study sessions,
              and keep momentum with lightweight tools that stay out of your way.
            </p>

            <ul className="mt-5 space-y-2">
              {[
                "Find partners who share your subject, pace, and availability.",
                "Host or join study groups with recurring sessions and reminders.",
                "Chat in real time, share files, and keep decisions in one place.",
                "Study Desk for focused sprints with timers and presence.",
                "Track streaks and titles to celebrate consistent effort.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                  <span className="text-sm">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/schedule">
                <Button>
                  <Calendar className="h-4 w-4 mr-2" />
                  Plan a session
                </Button>
              </Link>
              <Link to="/groups">
                <Button variant="secondary">Discover groups</Button>
              </Link>
              <Link to="/desk">
                <Button variant="outline">Open Study Desk</Button>
              </Link>
            </div>
          </div>

          {/* Preview block */}
          <div className="relative">
            <div className="aspect-video w-full rounded-xl border bg-gradient-to-br from-muted to-background overflow-hidden">
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center px-6">
                  <div className="text-sm uppercase tracking-wide text-muted-foreground">Preview</div>
                  <div className="mt-1 text-xl font-semibold">Dashboard • Groups • Chat</div>
                  <Separator className="my-4" />
                  <p className="text-sm text-muted-foreground">
                    Swap this placeholder with a product screenshot when you’re ready. The layout uses
                    your existing design tokens and components.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* Techniques (HVA + more) */}
      <section className="mx-auto max-w-7xl px-4 mt-16 md:mt-24">
        <motion.h2 {...fadeUp(0)} className="text-2xl md:text-3xl font-bold text-center">
          Techniques that actually help
        </motion.h2>
        <motion.p {...fadeUp(0.06)} className="mt-2 text-center text-muted-foreground max-w-2xl mx-auto">
          Bring structure without the stress. Pick a method and jump straight into a focused session.
        </motion.p>

        <motion.div
          {...fadeUp(0.12)}
          className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6"
        >
          {Techniques.map((t) => (
            <Card
              key={t.title}
              className="border-border/60 hover:shadow-[0_24px_60px_-24px_rgba(0,0,0,.45)]
                transition-transform hover:-translate-y-0.5"
            >
              <CardContent className="p-6">
                <div className="h-10 w-10 rounded-lg bg-primary/15 grid place-items-center mb-3">
                  <t.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-base font-semibold">{t.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
                <Link to={t.action.to}>
                  <Button variant="ghost" className="mt-3 px-0">
                    {t.action.label} →
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </motion.div>

        {/* HVA spotlight */}
        <motion.div
          {...fadeUp(0.18)}
          className="mt-6 rounded-2xl border bg-gradient-to-r from-primary/10 via-fuchsia-500/5 to-sky-500/10 p-5 md:p-6"
        >
          <div className="flex items-start gap-3">
            <Target className="h-5 w-5 text-primary mt-1" />
            <div className="flex-1">
              <div className="font-semibold">HVA in practice</div>
              <p className="text-sm text-muted-foreground mt-1">
                Each day, choose the 1–3 High-Value Activities that truly move you forward.
                Block time for them in <span className="font-medium">Schedule</span>, then work them in
                <span className="font-medium"> Study Desk</span>. Everything else goes into notes for later.
              </p>
            </div>
            <Link to="/notes">
              <Button variant="secondary" className="shrink-0">Capture HVAs</Button>
            </Link>
          </div>
        </motion.div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 mt-16 md:mt-24">
        <motion.h2 {...fadeUp(0)} className="text-2xl md:text-3xl font-bold text-center">
          How Schedura works
        </motion.h2>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
          {[
            {
              icon: Handshake,
              title: "Create your profile",
              desc: "Share your availability and interests.",
            },
            {
              icon: Users,
              title: "Find your people",
              desc: "Match and join groups that fit your goals.",
            },
            {
              icon: Calendar,
              title: "Plan & show up",
              desc: "Schedule sessions and get gentle reminders.",
            },
            {
              icon: Flame,
              title: "Track momentum",
              desc: "Build streaks, earn titles, and keep going.",
            },
          ].map((s, i) => (
            <motion.div {...fadeUp(0.06 * (i + 1))} key={s.title}>
              <Card className="border-border/60 h-full">
                <CardContent className="p-5 text-center">
                  <div className="mx-auto h-10 w-10 rounded-lg bg-primary/15 grid place-items-center mb-3">
                    <s.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="font-semibold">{s.title}</div>
                  <p className="text-sm text-muted-foreground mt-1">{s.desc}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA (only for guests) */}
      {!user && !loading && (
        <section className="mx-auto max-w-7xl px-4 my-16 md:my-24">
          <Card className="bg-primary/5 border-primary/20 shadow-[0_24px_60px_-24px_rgba(0,0,0,.45)]">
            <CardContent className="p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-xl md:text-2xl font-bold flex items-center gap-2">
                  <Rocket className="h-5 w-5 text-primary" />
                  Ready to meet & study together?
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Create an account in seconds and start planning with Schedura.
                </p>
              </div>
              <div className="flex gap-2">
                <Link to="/register">
                  <Button size="lg">Get started</Button>
                </Link>
                <Link to="/login">
                  <Button size="lg" variant="secondary">
                    Sign in
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t py-8 mt-10">
        <div className="mx-auto max-w-7xl px-4 text-sm text-muted-foreground flex flex-col md:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            © {new Date().getFullYear()} Schedura
            <span className="inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Built with care
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/groups" className="hover:underline">Groups</Link>
            <Link to="/posts" className="hover:underline">Posts</Link>
            <Link to="/friends" className="hover:underline">Friends</Link>
            <Link to="/desk" className="hover:underline">Study Desk</Link>
            <Link to="/schedule" className="hover:underline">Schedule</Link>
            <Link to="/document" className="hover:underline">Docs</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------- export page with its own local ThemeProvider ---------- */
export default function Landing() {
  // Local ThemeProvider so the page can glow on its own
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      storageKey="schedura-landing-theme"
    >
      <LandingInner />
    </ThemeProvider>
  );
}
