import { addDays, addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek, startOfDay } from "date-fns";
import type { CalEvent } from "../../api/client";

export type CalView = "month" | "week" | "day" | "agenda";
export const WEEK = { weekStartsOn: 1 as const };            // Monday first

export function rangeFor(view: CalView, cursor: Date): { start: Date; end: Date } {
  if (view === "month") return { start: startOfWeek(startOfMonth(cursor), WEEK), end: addDays(endOfWeek(endOfMonth(cursor), WEEK), 1) };
  if (view === "week") return { start: startOfWeek(cursor, WEEK), end: addDays(endOfWeek(cursor, WEEK), 1) };
  if (view === "day") return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 1) };
  return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 31) };
}

export function shift(view: CalView, cursor: Date, dir: 1 | -1): Date {
  return view === "month" ? addMonths(cursor, dir) : view === "week" ? addDays(cursor, 7 * dir) : addDays(cursor, view === "day" ? dir : 30 * dir);
}

export const evStart = (e: CalEvent) => new Date(e.start ?? 0);
export const evEnd = (e: CalEvent) => new Date(e.end ?? e.start ?? 0);

/** Events that touch a given day. All-day Google events end at the NEXT midnight, so the end is exclusive. */
export function onDay(e: CalEvent, day: Date): boolean {
  const d0 = startOfDay(day).getTime(), d1 = d0 + 86_400_000;
  const s = evStart(e).getTime(), en = Math.max(evEnd(e).getTime(), s);
  return s < d1 && (en > d0 || (s >= d0 && s < d1));
}

/** Column layout for overlapping timed events: each event gets a column index and the cluster's column count. */
export function layout(events: CalEvent[]): { ev: CalEvent; col: number; cols: number }[] {
  const sorted = [...events].sort((a, b) => evStart(a).getTime() - evStart(b).getTime() || evEnd(b).getTime() - evEnd(a).getTime());
  const out: { ev: CalEvent; col: number; cols: number }[] = [];
  let cluster: typeof out = [], clusterEnd = -1;
  const flush = () => { const n = Math.max(1, ...cluster.map((c) => c.col + 1)); cluster.forEach((c) => (c.cols = n)); out.push(...cluster); cluster = []; };
  for (const ev of sorted) {
    const s = evStart(ev).getTime(), e = Math.max(evEnd(ev).getTime(), s + 15 * 60_000);
    if (cluster.length && s >= clusterEnd) { flush(); clusterEnd = -1; }
    const used = new Set(cluster.filter((c) => Math.max(evEnd(c.ev).getTime(), evStart(c.ev).getTime() + 15 * 60_000) > s).map((c) => c.col));
    let col = 0; while (used.has(col)) col++;
    cluster.push({ ev, col, cols: 1 }); clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

export function eventColor(e: CalEvent, by: "case" | "calendar"): string {
  return by === "case" && e.cases[0]?.color ? e.cases[0].color : e.calendar_color;
}
