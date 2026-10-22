// Full calendar (Google-Calendar-class): month / week / day / agenda, filters by calendar and by case, search,
// create and edit with Google Meet or Zoom. Events carrying a case are colored with the case's color.
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, eachDayOfInterval, addDays, format, formatISO, isSameDay, isSameMonth, isToday, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import toast from "react-hot-toast";
import { ChevronLeft, ChevronRight, Filter, Loader2, Plus, Search } from "lucide-react";
import { deleteCalendarEvent, getAgentCases, getCalendarEvents, getCalendars, type CalEvent } from "../../api/client";
import { useUI } from "../../store";
import { type CalView, evStart, rangeFor, shift } from "./dates";
import EventDetail from "./EventDetail";
import EventDialog, { type Draft } from "./EventDialog";
import { AgendaList, MonthGrid, TimeGrid } from "./Grids";

const VIEWS: { k: CalView; label: string; key: string }[] = [{ k: "month", label: "Mes", key: "m" }, { k: "week", label: "Semana", key: "w" }, { k: "day", label: "Día", key: "d" }, { k: "agenda", label: "Agenda", key: "a" }];
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "") as T; } catch { return d; } };

function MiniMonth({ cursor, onPick }: { cursor: Date; onPick: (d: Date) => void }) {
  const [shown, setShown] = useState(startOfMonth(cursor));
  useEffect(() => setShown(startOfMonth(cursor)), [cursor]);
  const first = rangeFor("month", shown).start;
  const days = eachDayOfInterval({ start: first, end: addDays(first, 41) });
  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-700">
        <span className="first-letter:uppercase">{format(shown, "MMMM yyyy", { locale: es })}</span>
        <span><button aria-label="Mes anterior" onClick={() => setShown(addMonths(shown, -1))} className="rounded p-0.5 hover:bg-slate-200"><ChevronLeft size={14} /></button><button aria-label="Mes siguiente" onClick={() => setShown(addMonths(shown, 1))} className="rounded p-0.5 hover:bg-slate-200"><ChevronRight size={14} /></button></span>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[10px] text-slate-400">{days.slice(0, 7).map((d) => <span key={d.toISOString()}>{format(d, "EEEEE", { locale: es })}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center text-[11px]">
        {days.map((d) => <button key={d.toISOString()} onClick={() => onPick(d)} className={`mx-auto grid h-6 w-6 place-items-center rounded-full ${isToday(d) ? "bg-indigo-600 text-white" : isSameDay(d, cursor) ? "bg-indigo-100 text-indigo-700" : isSameMonth(d, shown) ? "text-slate-700 hover:bg-slate-200" : "text-slate-300 hover:bg-slate-100"}`}>{format(d, "d")}</button>)}
      </div>
    </div>
  );
}

export default function CalendarView() {
  const qc = useQueryClient();
  const { setFolder, setAgentCase } = useUI();
  const [view, setView] = useState<CalView>(() => load<CalView>("cal.view", window.innerWidth < 768 ? "agenda" : "week"));
  const [cursor, setCursor] = useState(() => new Date());
  const [by, setBy] = useState<"case" | "calendar">(() => load("cal.by", "case"));
  const [hidden, setHidden] = useState<string[]>(() => load("cal.hidden", []));
  const [onlyCase, setOnlyCase] = useState<string | null>(null);
  const [onlyWithCase, setOnlyWithCase] = useState(false);
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState(window.innerWidth >= 1024);
  const [picked, setPicked] = useState<CalEvent | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDel, setConfirmDel] = useState<CalEvent | null>(null);
  useEffect(() => { localStorage.setItem("cal.view", JSON.stringify(view)); }, [view]);
  useEffect(() => { localStorage.setItem("cal.by", JSON.stringify(by)); }, [by]);
  useEffect(() => { localStorage.setItem("cal.hidden", JSON.stringify(hidden)); }, [hidden]);

  const { start, end } = rangeFor(view, cursor);
  const evQ = useQuery({ queryKey: ["cal-events", formatISO(start), formatISO(end)], queryFn: () => getCalendarEvents(formatISO(start), formatISO(end)), placeholderData: keepPreviousData, refetchInterval: 120_000 });
  const calQ = useQuery({ queryKey: ["cal-calendars"], queryFn: getCalendars, staleTime: 300_000 });
  const casesQ = useQuery({ queryKey: ["agent-cases"], queryFn: getAgentCases, staleTime: 300_000 });
  const calendars = calQ.data?.calendars ?? [];

  const events = useMemo(() => (evQ.data?.events ?? []).filter((e) =>
    !hidden.includes(e.calendar ?? "") && (!onlyCase || e.cases.some((c) => c.code === onlyCase)) && (!onlyWithCase || e.cases.length > 0) &&
    (!q.trim() || `${e.title} ${e.location ?? ""} ${e.description} ${e.attendees.map((a) => a.email).join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()))), [evQ.data, hidden, onlyCase, onlyWithCase, q]);

  const del = useMutation({
    mutationFn: (e: CalEvent) => deleteCalendarEvent(e.calendar_id as string, e.event_id),
    onSuccess: () => { toast.success("Evento eliminado"); setConfirmDel(null); setPicked(null); qc.invalidateQueries({ queryKey: ["cal-events"] }); qc.invalidateQueries({ queryKey: ["agent-today"] }); },
    onError: (e) => toast.error(`No se pudo eliminar: ${(e as Error).message}`),
  });
  const create = (d: Date) => setDraft({ start: d, end: new Date(d.getTime() + 60 * 60_000) });

  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement; if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || ev.metaKey || ev.ctrlKey || draft) return;
      const v = VIEWS.find((x) => x.key === ev.key); if (v) return setView(v.k);
      if (ev.key === "t") setCursor(new Date()); else if (ev.key === "c") create(new Date()); else if (ev.key === "ArrowLeft") setCursor((c) => shift(view, c, -1)); else if (ev.key === "ArrowRight") setCursor((c) => shift(view, c, 1));
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [view, draft]);

  const title = view === "month" ? format(cursor, "MMMM yyyy", { locale: es }) : view === "day" ? format(cursor, "EEEE d 'de' MMMM yyyy", { locale: es }) : view === "week" ? `${format(start, "d MMM", { locale: es })} – ${format(addDays(end, -1), "d MMM yyyy", { locale: es })}` : `Desde el ${format(cursor, "d MMM", { locale: es })} · 30 días`;
  const toggleCal = (n: string) => setHidden((h) => (h.includes(n) ? h.filter((x) => x !== n) : [...h, n]));

  return (
    <div className="flex min-h-0 flex-1 bg-white" data-testid="calendar-root">
      {panel && (
        <aside className="hidden w-60 shrink-0 space-y-4 overflow-y-auto border-r border-slate-200 bg-slate-50/70 p-3 md:block" aria-label="Filtros del calendario">
          <button onClick={() => create(new Date())} className="flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-500"><Plus size={16} /> Crear</button>
          <MiniMonth cursor={cursor} onPick={(d) => { setCursor(d); if (view === "month") setView("day"); }} />
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">Colorear por
              <select value={by} onChange={(e) => setBy(e.target.value as "case" | "calendar")} aria-label="Colorear por" className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] normal-case"><option value="case">Caso</option><option value="calendar">Calendario</option></select></div>
            <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={onlyWithCase} onChange={(e) => setOnlyWithCase(e.target.checked)} /> Solo eventos con caso</label>
          </div>
          <details open>
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-500">Casos</summary>
            <ul className="mt-1 space-y-0.5">{casesQ.data?.cases.map((c) => <li key={c.code}><button onClick={() => setOnlyCase(onlyCase === c.code ? null : c.code)} className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-slate-200 ${onlyCase === c.code ? "bg-slate-200 font-medium" : ""}`}><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.color }} /><span className="truncate" title={c.title ?? c.code}>{c.code}</span></button></li>)}</ul>
          </details>
          <details open>
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-500">Mis calendarios</summary>
            <ul className="mt-1 space-y-0.5">{calendars.map((c) => <li key={c.id}><label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={!hidden.includes(c.name)} onChange={() => toggleCal(c.name)} style={{ accentColor: c.color }} /><span className="truncate" title={`${c.name}${c.source === "google" ? " · Google" : ""}`}>{c.name}</span>{c.count != null && <span className="ml-auto text-[10px] text-slate-400">{c.count}</span>}</label></li>)}</ul>
            {calQ.data?.google_error && <p className="mt-1 text-[11px] text-amber-700">Google Calendar no respondió ({calQ.data.google_error}); se muestran los calendarios del equipo.</p>}
          </details>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <button onClick={() => setPanel((p) => !p)} aria-label="Filtros" className="rounded p-1.5 text-slate-600 hover:bg-slate-100"><Filter size={16} /></button>
          <button onClick={() => setCursor(new Date())} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">Hoy</button>
          <button aria-label="Anterior" onClick={() => setCursor(shift(view, cursor, -1))} className="rounded p-1 hover:bg-slate-100"><ChevronLeft size={18} /></button>
          <button aria-label="Siguiente" onClick={() => setCursor(shift(view, cursor, 1))} className="rounded p-1 hover:bg-slate-100"><ChevronRight size={18} /></button>
          <h2 className="min-w-0 flex-1 break-words text-base font-semibold capitalize leading-tight text-slate-800 md:text-lg" data-testid="cal-title">{title}</h2>
          {evQ.isFetching && <Loader2 className="animate-spin text-slate-400" size={16} />}
          <label className="hidden items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 sm:flex"><Search size={12} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar eventos" aria-label="Buscar eventos" className="w-32 bg-transparent outline-none" /></label>
          <div role="tablist" aria-label="Vista" className="flex overflow-hidden rounded-md border border-slate-300 text-sm">{VIEWS.map((v) => <button key={v.k} role="tab" aria-selected={view === v.k} onClick={() => setView(v.k)} className={`px-2.5 py-1 ${view === v.k ? "bg-slate-800 text-white" : "hover:bg-slate-50"}`}>{v.label}</button>)}</div>
          <button onClick={() => create(new Date())} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 md:hidden"><Plus size={14} /> Crear</button>
        </div>
        {evQ.data?.google_error && <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">Google Calendar no respondió ({evQ.data.google_error}). Se muestran los eventos del equipo; crear y editar no está disponible por ahora.</div>}
        {evQ.isError && <div className="p-6 text-sm text-rose-600">No pude cargar el calendario. Reintenta en un momento.</div>}
        {view === "month" && <MonthGrid cursor={cursor} events={events} by={by} onPick={setPicked} onOpenDay={(d) => { setCursor(d); setView("day"); }} onCreate={create} />}
        {(view === "week" || view === "day") && <TimeGrid cursor={cursor} view={view} events={events} by={by} onPick={setPicked} onCreate={create} />}
        {view === "agenda" && <AgendaList cursor={cursor} events={events} by={by} onPick={setPicked} />}
        <div className="border-t border-slate-100 px-3 py-1 text-[11px] text-slate-400">{events.length} evento(s) · atajos: c crear, t hoy, m/w/d/a vista, ← → navegar</div>
      </div>
      {picked && <EventDetail e={picked} onClose={() => setPicked(null)} onEdit={() => { setDraft({ event: picked, start: evStart(picked), end: new Date(picked.end ?? picked.start ?? 0) }); setPicked(null); }} onDelete={() => setConfirmDel(picked)} onOpenCase={(code) => { setFolder("agent_cases"); setAgentCase(code); }} />}
      {draft && <EventDialog draft={draft} calendars={calendars} zoom={!!calQ.data?.zoom} onClose={() => setDraft(null)} />}
      {confirmDel && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/40 p-4" onClick={() => setConfirmDel(null)}>
          <div role="alertdialog" aria-label="Eliminar evento" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl bg-white p-4 shadow-2xl">
            <p className="text-sm text-slate-800">¿Eliminar “{confirmDel.title}”? {confirmDel.attendees.length > 1 ? "Los invitados no recibirán aviso." : ""}</p>
            <div className="mt-3 flex justify-end gap-2"><button onClick={() => setConfirmDel(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">Cancelar</button><button onClick={() => del.mutate(confirmDel)} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white">Eliminar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
