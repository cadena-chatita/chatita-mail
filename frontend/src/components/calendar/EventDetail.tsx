// Event detail: when, where, how to join, who, which case and what is happening in that case.
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Briefcase, Check, ExternalLink, HelpCircle, MapPin, Pencil, Trash2, Video, X, XCircle } from "lucide-react";
import { getAgentCase, type CalEvent } from "../../api/client";
import { evEnd, evStart } from "./dates";

const RSVP: Record<string, { label: string; cls: string; Icon: typeof Check }> = {
  accepted: { label: "Aceptó", cls: "text-emerald-600", Icon: Check }, declined: { label: "Rechazó", cls: "text-rose-600", Icon: XCircle },
  tentative: { label: "Tal vez", cls: "text-amber-600", Icon: HelpCircle }, pending: { label: "Pendiente", cls: "text-slate-400", Icon: HelpCircle }, needsAction: { label: "Pendiente", cls: "text-slate-400", Icon: HelpCircle },
};
const linkify = (t: string) => t.split(/(https?:\/\/[^\s]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer" className="text-indigo-600 underline [overflow-wrap:anywhere]">{p}</a> : <span key={i}>{p}</span>));

export default function EventDetail({ e, onClose, onEdit, onDelete, onOpenCase }: { e: CalEvent; onClose: () => void; onEdit: () => void; onDelete: () => void; onOpenCase: (code: string) => void }) {
  const code = e.cases[0]?.code;
  const ctx = useQuery({ queryKey: ["agent-case", code], queryFn: () => getAgentCase(code as string), enabled: !!code, staleTime: 300_000 });
  const when = e.all_day ? format(evStart(e), "EEEE d 'de' MMMM yyyy", { locale: es }) : `${format(evStart(e), "EEEE d 'de' MMMM, h:mm a", { locale: es })} – ${format(evEnd(e), "h:mm a", { locale: es })}`;
  return (
    <aside role="dialog" aria-label="Detalle del evento" data-testid="cal-detail" className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl md:w-[420px]">
      <div className="flex items-start justify-between gap-2 border-b border-slate-200 p-4" style={{ borderTop: `4px solid ${e.cases[0]?.color ?? e.calendar_color}` }}>
        <h2 className="break-words text-lg font-semibold text-slate-800">{e.title}</h2>
        <button onClick={onClose} aria-label="Cerrar detalle" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
      </div>
      <div className="space-y-4 p-4 text-sm">
        <div className="text-slate-700 first-letter:uppercase">{when}</div>
        <div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2.5 w-2.5 rounded-full" style={{ background: e.calendar_color }} /> {e.calendar} <span className="rounded bg-slate-100 px-1.5 py-0.5">{e.source === "google" ? "Google Calendar" : "Calendario del equipo"}</span></div>
        {(e.meet_url || e.zoom_url) && (
          <div className="flex flex-wrap gap-2">
            {e.meet_url && <a href={e.meet_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"><Video size={14} /> Unirse con Google Meet</a>}
            {e.zoom_url && <a href={e.zoom_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"><Video size={14} /> Unirse a Zoom</a>}
          </div>
        )}
        {e.location && !/^https?:\/\/(\S*zoom\.us|meet\.google)/.test(e.location) && <div className="flex gap-2 text-slate-700"><MapPin size={15} className="mt-0.5 shrink-0 text-slate-400" /><span className="[overflow-wrap:anywhere]">{linkify(e.location)}</span></div>}
        {e.cases.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Caso</div>
            {e.cases.map((c) => (
              <button key={c.code} onClick={() => onOpenCase(c.code)} className="mr-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ background: c.color }}><Briefcase size={12} /> {c.code}{c.inferred ? " (probable)" : ""}</button>
            ))}
            {ctx.data && (
              <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
                <div className="font-medium text-slate-700">{ctx.data.title}</div>
                {ctx.data.open_items && ctx.data.open_items.length > 0 && <div>{ctx.data.open_items.length} pendiente(s) abierto(s) en este caso</div>}
                {ctx.data.timeline.slice(0, 3).map((t, i) => <div key={i} className="[overflow-wrap:anywhere]"><span className="text-slate-400">{t.at ? format(new Date(t.at), "d MMM", { locale: es }) : ""} · {{ whatsapp: "WhatsApp", mail: "Correo", event: "Agenda" }[t.channel] ?? t.channel}:</span> {t.summary}</div>)}
              </div>
            )}
          </div>
        )}
        {e.attendees.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Invitados ({e.attendees.length})</div>
            <ul className="space-y-1">{e.attendees.map((a, i) => { const r = RSVP[a.status] ?? RSVP.pending; return <li key={i} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 [overflow-wrap:anywhere]">{a.name ? `${a.name} · ` : ""}{a.email}{a.organizer ? " (organiza)" : ""}</span><span className={`inline-flex shrink-0 items-center gap-1 ${r.cls}`}><r.Icon size={12} />{r.label}</span></li>; })}</ul>
          </div>
        )}
        {e.description && <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Descripción</div><p className="whitespace-pre-wrap break-words text-slate-700">{linkify(e.description)}</p></div>}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-200 p-3">
        {e.editable && <button onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><Pencil size={14} /> Editar</button>}
        {e.editable && <button onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50"><Trash2 size={14} /> Eliminar</button>}
        {e.html_link && <a href={e.html_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800"><ExternalLink size={12} /> Abrir en Google</a>}
        {!e.editable && <span className="text-xs text-slate-400">Solo lectura: viene de un calendario que no se edita desde aquí.</span>}
      </div>
    </aside>
  );
}
