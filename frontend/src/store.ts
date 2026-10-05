// Chatita Mail v3.0 — UI state (folder navigation, selection, search)
import { create } from "zustand";
import type { EmailCategory, EmailStatus } from "./types";

export interface FolderDef {
  key: string;
  label: string;
  icon: string; // lucide icon name
  status?: EmailStatus;
  category?: EmailCategory;
  group: "primary" | "categories" | "system" | "workflow";
  countKey?: string; // key into stats.by_status or by_category
  countSource?: "status" | "category" | "unread" | "tasks" | "commitments";
}

export const FOLDERS: FolderDef[] = [
  { key: "inbox", label: "Inbox", icon: "Inbox", status: "INBOX", group: "primary", countSource: "unread" },
  { key: "dashboard", label: "Panel", icon: "BarChart3", group: "workflow" },
  { key: "tasks", label: "Tasks", icon: "CheckSquare", group: "workflow", countSource: "tasks" },
  { key: "commitments", label: "Commitments", icon: "Handshake", group: "workflow", countSource: "commitments" },

  { key: "critical", label: "Critical", icon: "AlertOctagon", status: "INBOX", category: "CRITICAL", group: "categories", countSource: "category", countKey: "CRITICAL" },
  { key: "important", label: "Important", icon: "Star", status: "INBOX", category: "IMPORTANT", group: "categories", countSource: "category", countKey: "IMPORTANT" },
  { key: "medium", label: "Medium", icon: "Circle", status: "INBOX", category: "MEDIUM", group: "categories", countSource: "category", countKey: "MEDIUM" },
  { key: "low", label: "Low", icon: "Minus", status: "INBOX", category: "LOW", group: "categories", countSource: "category", countKey: "LOW" },

  { key: "sent", label: "Enviados", icon: "Send", status: "SENT", group: "system", countSource: "status", countKey: "SENT" },
  { key: "archived", label: "Archived", icon: "Archive", status: "ARCHIVED", group: "system", countSource: "status", countKey: "ARCHIVED" },
  { key: "spam", label: "Spam", icon: "Ban", category: "SPAM", group: "system", countSource: "category", countKey: "SPAM" },
  { key: "noise", label: "Noise", icon: "VolumeX", category: "NOISE", group: "system", countSource: "category", countKey: "NOISE" },
  { key: "quarantined", label: "Quarantine", icon: "ShieldAlert", status: "QUARANTINED", group: "system", countSource: "status", countKey: "QUARANTINED" },
  { key: "blocked", label: "Blocked", icon: "ShieldX", status: "BLOCKED", group: "system", countSource: "status", countKey: "BLOCKED" },
  { key: "trash", label: "Papelera", icon: "Trash2", status: "DELETED", group: "system", countSource: "status", countKey: "DELETED" },
];

interface UIState {
  folderKey: string;
  selectedEmailId: string | null;
  search: string;
  searchMode: "text" | "meaning";
  unreadOnly: boolean;
  sortMode: "priority" | "date";
  composeOpen: boolean;
  setFolder: (key: string) => void;
  selectEmail: (id: string | null) => void;
  setSearch: (q: string) => void;
  setSearchMode: (mode: "text" | "meaning") => void;
  toggleUnreadOnly: () => void;
  setSortMode: (mode: "priority" | "date") => void;
  openCompose: () => void;
  closeCompose: () => void;
}

export const useUI = create<UIState>((set) => ({
  folderKey: "inbox",
  selectedEmailId: null,
  search: "",
  searchMode: "text",
  unreadOnly: false,
  // Default to importance-first so the most urgent mail always surfaces on top.
  sortMode: "priority",
  composeOpen: false,
  setFolder: (key) => set({ folderKey: key, selectedEmailId: null }),
  selectEmail: (id) => set({ selectedEmailId: id }),
  setSearch: (q) => set({ search: q }),
  setSearchMode: (mode) => set({ searchMode: mode }),
  toggleUnreadOnly: () => set((s) => ({ unreadOnly: !s.unreadOnly })),
  setSortMode: (mode) => set({ sortMode: mode }),
  openCompose: () => set({ composeOpen: true }),
  closeCompose: () => set({ composeOpen: false }),
}));

export function folderByKey(key: string): FolderDef {
  return FOLDERS.find((f) => f.key === key) ?? FOLDERS[0];
}
