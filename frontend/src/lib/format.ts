// Chatita Mail v3.0 — presentation helpers
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";
import type { EmailCategory, RiskLevel } from "../types";

export function initials(name: string | null, email: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

export function fullDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "EEE, MMM d, yyyy · h:mm a");
}

export function deadlineLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${format(d, "d MMM, h:mm a", { locale: es })} (${formatDistanceToNow(d, { addSuffix: true, locale: es })})`;
}

export type Tone = "overdue" | "soon" | "week" | "later" | "none";

// Red is for what is already late or due within 72 h; a date a month away must not look like an emergency.
export function deadlineTone(iso: string | null, now = Date.now()): Tone {
  if (!iso) return "none";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "none";
  const h = (ms - now) / 3_600_000;
  return h < 0 ? "overdue" : h <= 72 ? "soon" : h <= 168 ? "week" : "later";
}

export const TONE_CLASS: Record<Tone, string> = {
  overdue: "bg-rose-50 text-rose-700 border-rose-200",
  soon: "bg-amber-50 text-amber-800 border-amber-200",
  week: "bg-sky-50 text-sky-700 border-sky-200",
  later: "bg-slate-50 text-slate-600 border-slate-200",
  none: "bg-slate-50 text-slate-500 border-slate-200",
};

// Deterministic avatar color from a string.
const AVATAR_COLORS = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-lime-500",
  "bg-emerald-500", "bg-teal-500", "bg-cyan-500", "bg-blue-500",
  "bg-indigo-500", "bg-violet-500", "bg-fuchsia-500", "bg-pink-500",
];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export interface CategoryMeta {
  label: string;
  emoji: string;
  chip: string; // tailwind classes
  dot: string;
}

export const CATEGORY_META: Record<EmailCategory, CategoryMeta> = {
  CRITICAL: { label: "Critical", emoji: "🔴", chip: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-500" },
  IMPORTANT: { label: "Important", emoji: "🟠", chip: "bg-orange-100 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  MEDIUM: { label: "Medium", emoji: "🟡", chip: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  LOW: { label: "Low", emoji: "⚪", chip: "bg-slate-100 text-slate-600 border-slate-200", dot: "bg-slate-400" },
  SPAM: { label: "Spam", emoji: "🚫", chip: "bg-zinc-100 text-zinc-600 border-zinc-200", dot: "bg-zinc-400" },
  NOISE: { label: "Noise", emoji: "🔇", chip: "bg-stone-100 text-stone-500 border-stone-200", dot: "bg-stone-400" },
  UNCLASSIFIED: { label: "Unclassified", emoji: "⚫", chip: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-300" },
};

export interface RiskMeta {
  label: string;
  chip: string;
  emoji: string;
}

export const RISK_META: Record<RiskLevel, RiskMeta> = {
  safe: { label: "Safe", chip: "bg-emerald-100 text-emerald-700 border-emerald-200", emoji: "🛡" },
  suspicious: { label: "Suspicious", chip: "bg-amber-100 text-amber-700 border-amber-200", emoji: "⚠️" },
  dangerous: { label: "Dangerous", chip: "bg-red-100 text-red-700 border-red-200", emoji: "☢️" },
};

export function humanMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
