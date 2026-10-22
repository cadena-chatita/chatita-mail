// Create / edit an event: Google Calendar, with Google Meet or Zoom, attendees, reminders and the case it belongs to.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMinutes, format, formatISO } from "date-fns";
import toast from "react-hot-toast";
import { Loader2, Sparkles, X } from "lucide-react";
import { createFullCalendarEvent, getAgentCases, getFreeSlots, updateCalendarEvent, type CalCalendar, type CalEvent } from "../../api/client";

export interface Draft { event?: CalEvent; start: Date; end: Date }
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const pad = (d: Date, all: boolean) => (all ? format(d, "yyyy-MM-dd") : format(d, "yyyy-MM-dd'T'HH:mm"));
const parseLocal = (v: string) => new Date(v.length === 10 ? `${v}T00:00:00` : v);

export default function EventDialog({ draft, calendars, zoom, onClose }: { draft: Draft; calendars: CalCalendar[]; zoom: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = draft.event;
  const writable = calendars.filter((c) => c.source === "google" && c.writable);
  const [title, setTitle] = useState(editing?.title ?? "");
  const [allDay, setAllDay] = useState(editing?.all_day ?? false);
  const [start, setStart] = useState(pad(draft.start, editing?.all_day ?? false));
  const [end, setEnd] = useState(pad(draft.end, editing?.all_day ?? false));
  const [calId, setCalId] = useState(editing?.calendar_id ?? writable.find((c) => c.primary)?.id ?? writable[0]?.id ?? "primary");
  const [location, setLocation] = useState(editing?.location ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [attendees, setAttendees] = useState((editing?.attendees ?? []).filter((a) => !a.self).map((a) => a.email).join(", "));
  const [invite, setInvite] = useState(false);
  const [conference, setConference] = useState<"none" | "meet" | "zoom">("none");
  const [caseCode, setCaseCode] = useState(editing?.cases.find((c) => !c.inferred)?.code ?? "");
  const [reminder, setReminder] = useState("default");
  const cases = useQuery({ queryKey: ["agent-cases"], queryFn: getAgentCases, staleTime: 300_000 });
  const emails = useMemo(() => attendees.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), [attendees]);
  const badEmail = emails.find((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  const [slots, setSlots] = useState<{ start: string; end: string; label: string }[]>([]);
  const findSlots = useMutation({ mutationFn: () => getFreeSlots(Math.max(15, Math.round((parseLocal(end).getTime() - parseLocal(start).getTime()) / 60000) || 30)), onSuccess: setSlots, onError: (e) => toast.error(`No pude buscar horarios: ${(e as Error).message}`) });

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const save = useMutation({
    mutationFn: async () => {
      const s = parseLocal(start), e = parseLocal(end);
      const body = { summary: title.trim(), start: allDay ? start.slice(0, 10) : formatISO(s), end: allDay ? end.slice(0, 10) : formatISO(e), all_day: allDay, timezone: TZ, calendar_id: calId,
        location: location || undefined, description: description || undefined, attendees: emails, send_invites: invite && emails.length > 0, case_code: caseCode || null,
        reminders: reminder === "default" ? null : reminder === "none" ? [] : [Number(reminder)] };
      return editing && editing.calendar_id
        ? updateCalendarEvent(editing.calendar_id, editing.event_id, { ...body, add_meet: conference === "meet" })
        : createFullCalendarEvent({ ...body, conference });
    },
    onSuccess: (r) => {
      toast.success("invitations_sent" in r && r.invitations_sent ? "Evento guardado e invitaciones enviadas" : "Evento guardado");
      qc.invalidateQueries({ queryKey: ["cal-events"] }); qc.invalidateQueries({ queryKey: ["agent-today"] }); onClose();
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { detail?: string } }; message?: string }).response?.data?.detail ?? (e as Error).message),
  });
  const invalid = !title.trim() || !!badEmail || parseLocal(end) < parseLocal(start) || (conference === "zoom" && allDay);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 md:items-center md:p-4" onClick={onClose}>
      <div role="dialog" aria-label={editing ? "Editar evento" : "Crear evento"} onClick={(e) => e.stopPropagation()} className="flex max-h-[96dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl md:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-800">{editing ? "Editar evento" : "Crear evento"}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4 text-sm">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título del evento" aria-label="Título" className="w-full border-b-2 border-slate-200 px-1 py-1.5 text-lg focus:border-indigo-500 focus:outline-none" />
          <label className="flex items-center gap-2 text-slate-600"><input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setStart(pad(parseLocal(start), e.target.checked)); setEnd(pad(parseLocal(end), e.target.checked)); }} /> Todo el día</label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-500">Inicio<input type={allDay ? "date" : "datetime-local"} value={start} onChange={(e) => { setStart(e.target.value); if (!allDay && parseLocal(end) <= parseLocal(e.target.value)) setEnd(pad(addMinutes(parseLocal(e.target.value), 60), false)); }} aria-label="Inicio" className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Fin<input type={allDay ? "date" : "datetime-local"} value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Fin" className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" /></label>
          </div>
          {!allDay && (
            <div>
              <button type="button" onClick={() => findSlots.mutate()} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">{findSlots.isPending ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />} Buscar horario libre</button>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{slots.map((s) => <button key={s.start} type="button" onClick={() => { setStart(pad(new Date(s.start), false)); setEnd(pad(new Date(s.end), false)); }} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100">{s.label}</button>)}</div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-500">Calendario
              <select value={calId} onChange={(e) => setCalId(e.target.value)} disabled={!!editing} aria-label="Calendario" className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                {writable.length === 0 && <option value="primary">Principal</option>}
                {writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label className="text-xs text-slate-500">Caso o proyecto
              <select value={caseCode} onChange={(e) => setCaseCode(e.target.value)} aria-label="Caso" className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <option value="">Sin caso</option>
                {cases.data?.cases.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select></label>
          </div>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lugar o enlace" aria-label="Lugar" className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
          <fieldset className="flex flex-wrap items-center gap-3 text-slate-600" aria-label="Videollamada">
            <legend className="sr-only">Videollamada</legend>
            {([["none", "Sin videollamada"], ["meet", "Google Meet"], ["zoom", "Zoom"]] as const).map(([v, l]) => (
              <label key={v} className={`inline-flex items-center gap-1.5 ${v === "zoom" && !zoom ? "opacity-40" : ""}`}><input type="radio" name="conf" value={v} checked={conference === v} disabled={(v === "zoom" && !zoom) || (!!editing && v === "zoom")} onChange={() => setConference(v)} /> {l}</label>
            ))}
          </fieldset>
          <textarea value={attendees} onChange={(e) => setAttendees(e.target.value)} rows={2} placeholder="Invitados (correos separados por coma)" aria-label="Invitados" className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
          {badEmail && <p className="text-xs text-rose-600">“{badEmail}” no parece un correo válido.</p>}
          {emails.length > 0 && (
            <label className={`flex items-start gap-2 rounded-md border p-2 text-xs ${invite ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 text-slate-600"}`}>
              <input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} className="mt-0.5" />
              <span>Enviar invitación por correo a {emails.length} persona(s). <b>{invite ? "Se enviará al guardar." : "Si no lo marcas, el evento se guarda sin avisarles."}</b></span>
            </label>
          )}
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Descripción o agenda" aria-label="Descripción" className="w-full rounded-md border border-slate-300 px-2 py-1.5" />
          <label className="text-xs text-slate-500">Recordatorio
            <select value={reminder} onChange={(e) => setReminder(e.target.value)} aria-label="Recordatorio" className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm sm:w-56">
              <option value="default">El predeterminado del calendario</option><option value="none">Ninguno</option><option value="10">10 minutos antes</option><option value="30">30 minutos antes</option><option value="60">1 hora antes</option><option value="1440">1 día antes</option>
            </select></label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button onClick={() => save.mutate()} disabled={invalid || save.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {save.isPending && <Loader2 className="animate-spin" size={14} />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
