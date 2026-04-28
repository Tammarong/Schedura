// src/components/Layout.tsx
import { Outlet, useLocation } from 'react-router-dom';
import { RightNavbar } from './RightNavbar';
import { AnimatedBackground } from './AnimatedBackground';
import { useIsMobile } from '@/hooks/use-mobile';
import Vinyl from '@/chathead/Vinyl';
import Clock from '@/chathead/Clock';
import OnboardingTour from '@/components/OnboardingTour';
import { useContext, useMemo } from 'react';
import { AuthContext } from '@/context/AuthContext';

const VINYL_BLOCKLIST_PREFIXES = ['/calls'];

export const Layout = () => {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const hideVinyl = VINYL_BLOCKLIST_PREFIXES.some((p) => pathname.startsWith(p));

  // pull username for per-account “seen” key
  const auth = useContext(AuthContext) as { user?: { username?: string } | null } | null;
  const username = auth?.user?.username ?? null;

  // define tour steps (ids added below)
  const tourSteps = useMemo(
    () => [
      { id: "nav-pulse",   title: "Pulse",      body: "See what's happening now across Schedura." },
      { id: "nav-stacks",   title: "Stacks",      body: "Your sticky-note whiteboard for quick ideas." },
      { id: "nav-schedule",title: "Schedule",   body: "Plan your week and align with groups." },
      { id: "vinyl-widget",title: "Focus music",body: "A music player for your focus" },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-gradient-primary relative overflow-hidden">
      <AnimatedBackground />

      <div className="flex min-h-screen flex-col md:flex-row">
        {/* Main Content */}
        <main className={`flex-1 relative z-10 ${isMobile ? 'pb-20' : 'pr-20'}`}>
          <Outlet />
        </main>

        {/* Right Sidebar */}
        <RightNavbar />
      </div>

      {/* Floating Vinyl */}
      {!hideVinyl && (
        <div id="vinyl-widget" className="relative z-[60]">
          <Vinyl
            title="Your Personal Music Player"
            videoId="jfKfPfyJRdk"
            startSeconds={0}
            className="!bottom-20 !right-5 md:!right-24"
          />
        </div>
      )}

      {/* Floating Handy Clock */}
      <Clock className="!top-4 !left-4 z-[95]" />

      {/* One-time per account tutorial */}
      <OnboardingTour
        username={username}
        enabled={true}
        steps={tourSteps}
      />
    </div>
  );
};
