// src/services/groups.ts
import { api } from "@/lib/api";

/* ---------- Public types used by the app ---------- */
export interface Group {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  owner_id: number;      // keep backend-style field here if the rest of app expects it
  created_at: string;    // ISO string
  code?: string;
}

export interface Member {
  id: number;
  username: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  isOnline: boolean;
  avatarUrl?: string | null;
}

/* ---------- Backend payload shapes (tolerant to both cases) ---------- */
type RawGroup = {
  id: number;
  name: string;
  description?: string | null;
  location?: string | null;
  owner_id?: number;
  ownerId?: number;
  created_at?: string;
  createdAt?: string;
  code?: string;
};

type RawMember = {
  id: number;
  username: string;
  display_name?: string;
  displayName?: string;
  role: "owner" | "admin" | "member";
  is_online?: boolean;
  isOnline?: boolean;
  avatar_url?: string | null;
  avatarUrl?: string | null;
};

/* ---------- Mappers (snake_case -> camelCase used in UI) ---------- */
function mapGroup(g: RawGroup): Group {
  return {
    id: g.id,
    name: g.name,
    description: g.description ?? null,
    location: g.location ?? null,
    owner_id: (g.owner_id ?? g.ownerId) ?? 0,
    created_at: (g.created_at ?? g.createdAt) ?? "",
    code: g.code,
  };
}

function mapMember(m: RawMember): Member {
  return {
    id: m.id,
    username: m.username,
    displayName: m.displayName ?? m.display_name ?? m.username,
    role: m.role,
    isOnline: m.isOnline ?? m.is_online ?? false,
    avatarUrl: m.avatarUrl ?? m.avatar_url ?? null,
  };
}

/* ---------- API calls (cookie-first; no manual headers needed) ---------- */
export async function fetchGroup(id: string): Promise<Group> {
  const data = await api<RawGroup>(`/groups/${id}`);
  return mapGroup(data);
}

export async function fetchGroupMembers(id: string): Promise<Member[]> {
  const data = await api<RawMember[]>(`/groups/${id}/members`);
  return data.map(mapMember);
}
