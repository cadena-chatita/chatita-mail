// Month, week/day and agenda renderings of the calendar. Events are colored by case (default) or by calendar.
import { useEffect, useRef } from "react";
import { addDays, eachDayOfInterval, format, isSameDay, isSameMonth, isToday, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { MapPin, Users, Video } from "lucide-react";
import type { CalEvent } from "../../api/client";
import { type CalView, WEEK, eventColor, evEnd, evStart, layout, onDay, rangeFor } from "./dates";

type Pick = (e: CalEvent) => void;
type Color = "case" | "calendar";
const HOUR = 48;

function Chip({ e, by, onPick, compact }: { e: CalEvent; by: Color; onPick: Pick; compact?: boolean }) {
  const c = eventColor(e, by);
  const inferred = e.cases[0]?.inferred;
  return (
    <button
      type="button"
      data-testid="cal-event"
      onClick={(ev) => { ev.stopPropagation(); onPick(e); }}
      title={`${e.title}${e.cases[0] ? ` · ${e.cases[0].code}${inferred ? " (probable)" : ""}` : ""}`}
      className={`flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-4 ${e.all_day ? "font-medium text-white" : "hover:bg-slate-100"}`}
      style={e.all_day ? { background: c, borderStyle: inferred ? "dashed" : "solid" } : { borderLeft: `3px ${inferred ? "dashed" : "solid"} ${c}` }}
    >
      {!e.all_day && !compact && e.start && <span className="shrink-0 text-slate-500">{format(evStart(e), "h:mma", { locale: es }).toLowerCase()}</span>}
      <span className={`truncate ${e.all_day ? "" : "text-slate-800"}`}>{e.title}</span>
    </button>
  );
}

export function MonthGrid({ cursor, events, by, onPick, onOpenDay, onCreate }: { cursor: Date; events: CalEvent[]; by: Color; onPick: Pick; onOpenDay: (d: Date) => void; onCreate: (d: Date) => void }) {
  const { start, end } = rangeFor("month", cursor);
  const days = eachDayOfInterval({ start, end: addDays(end, -1) });
  const heads = eachDayOfInterval({ start, end: addDays(start, 6) });
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cal-month">
      <div className="grid grid-cols-7 border-b border-slate-200 text-center text-[11px] font-medium uppercase text-slate-500">
        {heads.map((d) => <div key={d.toISOString()} className="py-1.5">{format(d, "EEE", { locale: es })}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 [grid-auto-rows:minmax(112px,auto)] overflow-y-auto">
        {days.map((d) => {
          const evs = events.filter((e) => onDay(e, d)).sort((a, b) => Number(b.all_day) - Number(a.all_day) || evStart(a).getTime() - evStart(b).getTime());
          return (
            <div key={d.toISOString()} onClick={() => onCreate(d)} className={`min-w-0 cursor-pointer overflow-hidden border-b border-r border-slate-100 p-1 hover:bg-slate-50/60 ${isSameMonth(d, cursor) ? "" : "bg-slate-50/50"}`}>
              <button onClick={(ev) => { ev.stopPropagation(); onOpenDay(d); }} className={`mb-0.5 grid h-6 w-6 place-items-center rounded-full text-xs ${isToday(d) ? "bg-indigo-600 font-semibold text-white" : isSameMonth(d, cursor) ? "text-slate-700 hover:bg-slate-200" : "text-slate-400"}`}>{format(d, "d")}</button>
              <div className="space-y-0.5">
                {evs.slice(0, 3).map((e, i) => <div key={e.id} className={i === 2 ? "hidden sm:block" : ""}><Chip e={e} by={by} onPick={onPick} /></div>)}
                {evs.length > 2 && (
                  <button onClick={(ev) => { ev.stopPropagation(); onOpenDay(d); }} className={`whitespace-nowrap px-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 ${evs.length <= 3 ? "sm:hidden" : ""}`}>
                    <span className="sm:hidden">+{evs.length - 2}</span><span className="hidden sm:inline">+{evs.length - 3} más</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimeGrid({ cursor, view, events, by, onPick, onCreate }: { cursor: Date; view: "week" | "day"; events: CalEvent[]; by: Color; onPick: Pick; onCreate: (d: Date) => void }) {
  const { start, end } = rangeFor(view, cursor);
  const days = eachDayOfInterval({ start, end: addDays(end, -1) });
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 7 * HOUR - 8 }); }, [view]);
  const now = new Date();
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={`cal-${view}`}>
      <div className="flex border-b border-slate-200 pr-3">
        <div className="w-14 shrink-0" />
        {days.map((d) => (
          <div key={d.toISOString()} className="min-w-0 flex-1 border-l border-slate-100 px-1 pb-1 pt-1.5 text-center">
            <div className="text-[11px] font-medium uppercase text-slate-500">{format(d, "EEE", { locale: es })}</div>
            <div className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-sm ${isToday(d) ? "bg-indigo-600 font-semibold text-white" : "text-slate-800"}`}>{format(d, "d")}</div>
            <div className="mt-1 space-y-0.5">
              {events.filter((e) => e.all_day && onDay(e, d)).slice(0, 3).map((e) => <Chip key={e.id} e={e} by={by} onPick={onPick} />)}
            </div>
          </div>
        ))}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR }}>
          <div className="w-14 shrink-0">
            {Array.from({ length: 24 }, (_, h) => <div key={h} className="pr-2 text-right text-[10px] text-slate-400" style={{ height: HOUR }}><span className="relative -top-1.5">{h === 0 ? "" : format(new Date(2000, 0, 1, h), "h a", { locale: es }).toLowerCase()}</span></div>)}
          </div>
          {days.map((d) => {
            const timed = layout(events.filter((e) => !e.all_day && onDay(e, d)));
            return (
              <div key={d.toISOString()} className="relative min-w-0 flex-1 border-l border-slate-100"
                onClick={(ev) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); const mins = Math.floor(((ev.clientY - r.top) / HOUR) * 2) * 30; onCreate(new Date(startOfDay(d).getTime() + mins * 60_000)); }}>
                {Array.from({ length: 24 }, (_, h) => <div key={h} className="border-t border-slate-100" style={{ height: HOUR }} />)}
                {isSameDay(d, now) && <div className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-rose-500" style={{ top: (now.getHours() + now.getMinutes() / 60) * HOUR }}><span className="-mt-1 block h-2 w-2 rounded-full bg-rose-500" /></div>}
                {timed.map(({ ev, col, cols }) => {
                  const s = Math.max(evStart(ev).getTime(), startOfDay(d).getTime()), e = Math.min(Math.max(evEnd(ev).getTime(), evStart(ev).getTime() + 20 * 60_000), startOfDay(d).getTime() + 86_400_000);
                  const top = ((s - startOfDay(d).getTime()) / 3_600_000) * HOUR, h = Math.max(((e - s) / 3_600_000) * HOUR, 20);
                  const c = eventColor(ev, by);
                  return (
                    <button key={ev.id} type="button" data-testid="cal-event" onClick={(x) => { x.stopPropagation(); onPick(ev); }}
                      className="absolute overflow-hidden rounded-md border border-white px-1.5 py-0.5 text-left text-[11px] leading-4 text-white shadow-sm hover:brightness-110"
                      style={{ top, height: h - 1, left: `calc(${(col / cols) * 100}% + 1px)`, width: `calc(${100 / cols}% - 3px)`, background: c, opacity: ev.cases[0]?.inferred ? 0.85 : 1 }}
                      title={ev.title}>
                      <div className="truncate font-medium">{ev.title}</div>
                      {h > 34 && <div className="truncate opacity-90">{format(evStart(ev), "h:mm", { locale: es })}–{format(evEnd(ev), "h:mm a", { locale: es })}</div>}
                      {h > 52 && ev.location && <div className="truncate opacity-90">{ev.location}</div>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AgendaList({ cursor, events, by, onPick }: { cursor: Date; events: CalEvent[]; by: Color; onPick: Pick }) {
  const { start, end } = rangeFor("agenda", cursor);
  const days = eachDayOfInterval({ start, end: addDays(end, -1) }).map((d) => ({ d, evs: events.filter((e) => onDay(e, d)).sort((a, b) => Number(b.all_day) - Number(a.all_day) || evStart(a).getTime() - evStart(b).getTime()) })).filter((x) => x.evs.length);
  if (!days.length) return <div className="p-10 text-center text-sm text-slate-500" data-testid="cal-agenda">No hay eventos en este periodo.</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="cal-agenda">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        {days.map(({ d, evs }) => (
          <section key={d.toISOString()}>
            <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className={isToday(d) ? "text-indigo-600" : ""}>{format(d, "EEEE d 'de' MMMM", { locale: es })}</span>{isToday(d) && <span className="rounded bg-indigo-100 px-1.5 text-[10px] text-indigo-700">hoy</span>}
            </h3>
            <ul className="space-y-1.5">
              {evs.map((e) => {
                const c = eventColor(e, by);
                return (
                  <li key={e.id}>
                    <button data-testid="cal-event" onClick={() => onPick(e)} className="flex w-full gap-3 rounded-lg border border-slate-200 bg-white p-2.5 text-left hover:shadow-sm" style={{ borderLeft: `4px solid ${c}` }}>
                      <div className="w-24 shrink-0 text-xs font-medium text-slate-600">{e.all_day ? "Todo el día" : `${format(evStart(e), "h:mm a", { locale: es })}${e.end ? ` – ${format(evEnd(e), "h:mm a", { locale: es })}` : ""}`}</div>
                      <div className="min-w-0 flex-1">
                        <div className="break-words text-sm font-medium text-slate-800">{e.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: e.calendar_color }} />{e.calendar}</span>
                          {e.location && !/zoom\.us|meet\.google/.test(e.location) && <span className="inline-flex items-center gap-1 [overflow-wrap:anywhere]"><MapPin size={11} />{e.location}</span>}
                          {e.attendees.length > 0 && <span className="inline-flex items-center gap-1"><Users size={11} />{e.attendees.length}</span>}
                          {(e.meet_url || e.zoom_url) && <span className="inline-flex items-center gap-1 text-emerald-700"><Video size={11} />{e.zoom_url ? "Zoom" : "Meet"}</span>}
                          {e.cases.map((k) => <span key={k.code} className="rounded-full px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: k.color }}>{k.code}{k.inferred ? " ~" : ""}</span>)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export type { CalView };
export { WEEK };
