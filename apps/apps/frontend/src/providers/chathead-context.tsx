import React, { createContext, useContext } from "react";

/** Public API */
export type ChatUser = {
  id: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
};

export type ChatheadContextValue = {
  openChat: (user: ChatUser) => void;
  closeChat: (userId: number) => void;
  toggleWindow: (userId: number) => void;
  hideChat: (userId: number) => void;
  isOpen: (userId: number) => boolean;
};

export const ChatheadContext = createContext<ChatheadContextValue | null>(null);

export const useChatheads = (): ChatheadContextValue => {
  const ctx = useContext(ChatheadContext);
  if (!ctx) throw new Error("useChatheads must be used inside <ChatheadProvider>");
  return ctx;
};
