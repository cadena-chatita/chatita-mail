// Chatita Mail v3.0 — UI state (folder navigation, selection, search)
import { create } from "zustand";
import type { EmailCategory, EmailStatus } from "./types";

export interface FolderDef {
  key: string;
  label: string;
  icon: string; // lucide icon name
  status?: EmailStatus;
  category?: EmailCategory;
  group: "primary" | "agent" | "categories" | "system" | "workflow";
  countKey?: string; // key into stats.by_status or by_category
  countSource?: "status" | "category" | "unread" | "tasks" | "commitments";
}

export const FOLDERS: FolderDef[] = [
  { key: "inbox", label: "Bandeja", icon: "Inbox", status: "INBOX", group: "primary", countSource: "unread" },
  { key: "agent_today", label: "Hoy: qué sigue", icon: "Sparkles", group: "agent" },
  { key: "agent_agenda", label: "Agenda", icon: "CalendarDays", group: "agent" },
  { key: "agent_cases", label: "Casos", icon: "Briefcase", group: "agent" },
  { key: "agent_search", label: "Buscar en todo", icon: "Search", group: "agent" },
  { key: "agent_orders", label: "Órdenes a Chatita", icon: "TerminalSquare", group: "agent" },
  { key: "dashboard", label: "Panel", icon: "BarChart3", group: "workflow" },
  { key: "tasks", label: "Tareas", icon: "CheckSquare", group: "workflow", countSource: "tasks" },
  { key: "commitments", label: "Compromisos", icon: "Handshake", group: "workflow", countSource: "commitments" },

  { key: "critical", label: "Críticos", icon: "AlertOctagon", status: "INBOX", category: "CRITICAL", group: "categories", countSource: "category", countKey: "CRITICAL" },
  { key: "important", label: "Importantes", icon: "Star", status: "INBOX", category: "IMPORTANT", group: "categories", countSource: "category", countKey: "IMPORTANT" },
  { key: "medium", label: "Medios", icon: "Circle", status: "INBOX", category: "MEDIUM", group: "categories", countSource: "category", countKey: "MEDIUM" },
  { key: "low", label: "Bajos", icon: "Minus", status: "INBOX", category: "LOW", group: "categories", countSource: "category", countKey: "LOW" },

  { key: "sent", label: "Enviados", icon: "Send", status: "SENT", group: "system", countSource: "status", countKey: "SENT" },
  { key: "archived", label: "Archivados", icon: "Archive", status: "ARCHIVED", group: "system", countSource: "status", countKey: "ARCHIVED" },
  { key: "spam", label: "Spam", icon: "Ban", category: "SPAM", group: "system", countSource: "category", countKey: "SPAM" },
  { key: "noise", label: "Ruido", icon: "VolumeX", category: "NOISE", group: "system", countSource: "category", countKey: "NOISE" },
  { key: "quarantined", label: "Cuarentena", icon: "ShieldAlert", status: "QUARANTINED", group: "system", countSource: "status", countKey: "QUARANTINED" },
  { key: "blocked", label: "Bloqueados", icon: "ShieldX", status: "BLOCKED", group: "system", countSource: "status", countKey: "BLOCKED" },
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
  accountId: string; // "all" = unified inbox
  drawerOpen: boolean;
  agentCase: string | null;
  pendingCompose: "reply" | "replyAll" | "forward" | null;
  setAgentCase: (code: string | null) => void;
  openEmail: (id: string, compose?: "reply" | null) => void;
  clearPendingCompose: () => void;
  setAccount: (id: string) => void;
  setDrawer: (open: boolean) => void;
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
  accountId: localStorage.getItem("chatita_mail_account") || "all",
  drawerOpen: false,
  agentCase: null,
  pendingCompose: null,
  setAgentCase: (code) => set({ agentCase: code }),
  openEmail: (id, compose) => set({ selectedEmailId: id, pendingCompose: compose ?? null }),
  clearPendingCompose: () => set({ pendingCompose: null }),
  setAccount: (id) => {
    localStorage.setItem("chatita_mail_account", id);
    set({ accountId: id, selectedEmailId: null });
  },
  setDrawer: (open) => set({ drawerOpen: open }),
  setFolder: (key) => set({ folderKey: key, selectedEmailId: null, drawerOpen: false }),
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
