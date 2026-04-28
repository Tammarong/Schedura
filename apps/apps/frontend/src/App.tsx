import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";

import Dashboard from "./pages/Dashboard";
import Friends from "./pages/Friends";
import Profile from "./pages/Profile";
import Groups from "./pages/Groups";
import GroupView from "./pages/GroupView";
import Posts from "./pages/Posts";
import PostView from "./pages/PostView"; // <-- public single-post route
import Schedule from "./pages/Schedule";
import NotFound from "./pages/NotFound";
import StickyNotes from "./pages/StickyNotes";
import StudyDesk from "./pages/StudyDesk";
import Document from "./pages/Document"; // <-- Schedura Docs editor
import GroupSchedule from "./pages/GroupSchedule"; // <-- NEW: Group schedule page

// ✅ New pages
import Story from "./pages/Story";
import StoryCreate from "./pages/StoryCreate";
import Highlight from "./pages/Highlight";

import ProtectedRoute from "./routes/ProtectedRoute";
import { Layout } from "./components/Layout";
import ChatheadProvider from "@/chathead/ChatheadProvider";

import { AuthProvider, useAuth } from "@/context/AuthContext";

/** Redirect /profile -> /profile/:username once auth has hydrated */
function SelfProfileRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }
  return <Navigate to={`/profile/${encodeURIComponent(user.username)}`} replace />;
}

/** Show Landing if guest; jump to /dashboard if authed */
function LandingGate() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ height: 1 }} />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Landing />;
}

/** Block login/register when already authenticated */
function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ height: 1 }} />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* ---------- Public routes ---------- */}
          <Route path="/" element={<LandingGate />} />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnlyRoute>
                <Register />
              </PublicOnlyRoute>
            }
          />
          <Route path="/posts/:id" element={<PostView />} />

          {/* ---------- Auth-only shell + chatheads ---------- */}
          <Route
            element={
              <ProtectedRoute>
                <ChatheadProvider>
                  <Layout />
                </ChatheadProvider>
              </ProtectedRoute>
            }
          >
            {/* App pages */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/groups/:groupId" element={<GroupView />} />
            <Route path="/posts" element={<Posts />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/group-schedule" element={<GroupSchedule />} /> {/* <-- NEW */}
            <Route path="/notes" element={<StickyNotes />} />
            <Route path="/desk" element={<StudyDesk />} />

            {/* Document editor */}
            <Route path="/document" element={<Document />} />

            {/* Stories & Highlights */}
            <Route path="/story" element={<Story />} />
            <Route path="/story/new" element={<StoryCreate />} />
            <Route path="/highlight" element={<Highlight />} />

            {/* Profile */}
            <Route path="/profile" element={<SelfProfileRoute />} />
            <Route path="/profile/:username" element={<Profile />} />
          </Route>

          {/* ---------- 404 ---------- */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
