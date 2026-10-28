// AION Agent inside Chatita Mail: what's next, agenda, cases, search and direct orders.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Handshake, Loader2, Mail, MessageCircle, RefreshCw, Reply, CheckSquare, Search as SearchIcon, Send } from "lucide-react";
import {
  agentCommand, agentSearch, getAgentCase, getAgentCases, getAgentToday, getCaseBrief, refreshCaseBrief,
  type SearchHit, type TodayItem,
} from "../api/client";
import { TONE_CLASS, deadlineLabel, deadlineTone } from "../lib/format";
import { useUI } from "../store";
import CalendarView from "./calendar/CalendarView";
import { CaseChips, CaseLatest, NextStep, SourceBadge, SourceLine } from "./shared";

export type AgentMode = "today" | "calendar" | "cases" | "search" | "orders";

function Header({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-4 md:px-6">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        <p className="max-w-2xl text-xs text-slate-500">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-slate-500">{text}</div>;
}

const KIND_ICON = { task: CheckSquare, commitment: Handshake, event: CalendarDays, whatsapp: MessageCircle } as const;

function ItemCard({ it }: { it: TodayItem }) {
  const { openEmail, setFolder } = useUI();
  const Icon = KIND_ICON[it.kind] ?? MessageCircle;
  const tone = deadlineTone(it.when);
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3" data-testid="today-item">
      <div className="flex items-start gap-3">
        <Icon size={18} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-medium text-slate-800">{it.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            {it.when && <span className={`rounded-full border px-2 py-0.5 ${TONE_CLASS[tone]}`}>{deadlineLabel(it.when)}</span>}
            <CaseChips cases={it.cases} />
            <span className="text-slate-500">{it.why}</span>
          </div>
          <SourceLine from={it.email_from} subject={it.email_subject} receivedAt={it.email_received_at} excerpt={it.email_excerpt} />
          <NextStep text={it.suggestion} />
          <CaseLatest code={it.cases[0]?.code} latest={it.case_latest} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 pl-8">
        {it.email_id && (
          <button onClick={() => openEmail(it.email_id as string)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <Mail size={13} /> Ver correo
          </button>
        )}
        {it.email_id && it.action === "reply" && (
          <button onClick={() => openEmail(it.email_id as string, "reply")} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500">
            <Reply size={13} /> Redactar respuesta
          </button>
        )}
        {it.kind === "event" && (
          <button onClick={() => setFolder("agent_calendar")} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <CalendarDays size={13} /> Ver en el calendario
          </button>
        )}
      </div>
    </li>
  );
}

function Today() {
  const q = useQuery({ queryKey: ["agent-today"], queryFn: getAgentToday, refetchInterval: 120_000 });
  const { setFolder } = useUI();
  if (q.isLoading) return <div className="flex items-center gap-2 p-6 text-slate-500"><Loader2 className="animate-spin" size={16} /> Cargando…</div>;
  if (q.isError || !q.data) return <Empty text="No pude cargar lo que sigue. Reintenta en un momento." />;
  const { summary, sections, source } = q.data;
  return (
    <div>
      <Header
        title="Hoy: qué sigue"
        subtitle="Lo más urgente de tus tareas, compromisos y eventos, ligado a sus correos y casos. Chatita te propone el siguiente paso en cada uno."
        right={<SourceBadge kind={source.kind} ageSeconds={source.age_s} />}
      />
      <div className="flex flex-wrap gap-2 px-4 pt-3 text-xs md:px-6">
        {[["overdue", "Vencido"], ["today", "Hoy"], ["soon", "72 h"], ["week", "Semana"], ["open", "Sin plazo"]].map(([k, label]) =>
          summary[k] ? <span key={k} className={`rounded-full border px-2.5 py-1 ${k === "overdue" ? TONE_CLASS.overdue : k === "today" || k === "soon" ? TONE_CLASS.soon : TONE_CLASS.later}`}>{label}: {summary[k]}</span> : null)}
        {summary.proposals > 0 && (
          <button onClick={() => setFolder("agent_orders")} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-indigo-700 hover:bg-indigo-100">
            {summary.proposals} vínculos por revisar → Órdenes
          </button>
        )}
      </div>
      {source.kind === "none" && <p className="mx-4 mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-800 md:mx-6">AION Agent no tiene datos en este entorno: se muestran solo las tareas y compromisos de Chatita Mail, sin agenda ni casos.</p>}
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        {sections.length === 0 && <Empty text="No hay nada pendiente. Chatita te avisará cuando aparezca algo." />}
        {sections.map((s) => (
          <section key={s.key} aria-label={s.title}>
            <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${s.key === "overdue" ? "text-rose-600" : "text-slate-500"}`}>{s.title} · {s.items.length}</h3>
            <ul className="space-y-2">{s.items.map((it) => <ItemCard key={`${it.kind}-${it.id}`} it={it} />)}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function CaseBriefCard({ code }: { code: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["case-brief", code], queryFn: () => getCaseBrief(code), retry: false });
  const m = useMutation({
    mutationFn: () => refreshCaseBrief(code),
    onSuccess: (data) => qc.setQueryData(["case-brief", code], data),
  });
  const b = m.data ?? q.data;
  const busy = q.isLoading || m.isPending;
  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3" aria-label="Brief del caso">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Brief del caso</h4>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {b?.generated_at && <span>generado {format(new Date(b.generated_at), "d MMM yyyy, h:mm a", { locale: es })}</span>}
          <button
            onClick={() => m.mutate()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-white px-2 py-0.5 font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >{busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Actualizar</button>
        </div>
      </div>
      {q.isError && !b && <p className="text-xs text-slate-500">No hay brief todavía. Pulsa «Actualizar» para generarlo.</p>}
      {m.isError && <p className="text-xs text-rose-600">No pude generar el brief; inténtalo de nuevo.</p>}
      {b && <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-800">{b.brief_md}</div>}
      {b?.model && <p className="mt-1 text-[10px] text-slate-400">modelo: {b.model} · {b.items_used} elementos analizados</p>}
    </section>
  );
}

function CaseDetailPane({ code }: { code: string }) {
  const q = useQuery({ queryKey: ["agent-case", code], queryFn: () => getAgentCase(code) });
  const { openEmail } = useUI();
  if (q.isLoading) return <div className="p-4 text-slate-500"><Loader2 className="animate-spin" size={16} /></div>;
  if (!q.data) return <Empty text="No pude cargar el caso." />;
  const d = q.data;
  const chan = { whatsapp: "WhatsApp", mail: "Correo", event: "Agenda" } as Record<string, string>;
  return (
    <div className="space-y-4 p-4">
      <div className="border-l-4 pl-3" style={{ borderColor: d.color }}>
        <h3 className="text-base font-semibold text-slate-800 [overflow-wrap:anywhere]">{d.code}</h3>
        <div className="text-sm text-slate-600 [overflow-wrap:anywhere]">{d.title}</div>
        {d.activity_30d && <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">{Object.entries(d.activity_30d).map(([k, n]) => <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5">{chan[k] ?? k}: {n} en 30 días</span>)}</div>}
      </div>
      <CaseBriefCard code={code} />
      {d.open_items && d.open_items.length > 0 && (
        <section><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pendiente en este caso · {d.open_items.length}</h4>
          <ul className="space-y-1.5">{d.open_items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs">
              <div className="min-w-0 [overflow-wrap:anywhere]"><div className="font-medium text-slate-800">{i.title}</div><div className="text-slate-500">{i.kind === "task" ? "Tarea" : "Compromiso"}{i.when ? ` · ${deadlineLabel(i.when)}` : ""} · {i.email_subject}</div></div>
              <button onClick={() => openEmail(i.email_id)} className="shrink-0 rounded-md border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50">Ver correo</button>
            </li>))}</ul></section>
      )}
      {d.upcoming_events && d.upcoming_events.length > 0 && (
        <section><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Próximos eventos</h4>
          <ul className="space-y-1">{d.upcoming_events.map((e, i) => <li key={i} className="text-xs text-slate-700 [overflow-wrap:anywhere]"><span className="text-slate-400">{e.at ? format(new Date(e.at), "EEE d MMM, h:mm a", { locale: es }) : ""}</span> · {e.title} <span className="text-slate-400">({e.calendar})</span></li>)}</ul></section>
      )}
      <p className="text-xs text-slate-500 [overflow-wrap:anywhere]"><b>Palabras clave:</b> {d.keywords.join(", ") || "(ninguna)"}</p>
      {d.organizations.length > 0 && <p className="text-xs text-slate-500 [overflow-wrap:anywhere]"><b>Organizaciones:</b> {d.organizations.join(", ")}</p>}
      {d.groups.length > 0 && <p className="text-xs text-slate-500 [overflow-wrap:anywhere]"><b>Grupos de WhatsApp:</b> {d.groups.join(" · ")}</p>}
      <section><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Línea de tiempo</h4>
        <ul className="space-y-1.5">
          {d.timeline.map((t, i) => (
            <li key={i} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
              <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{chan[t.channel] ?? t.channel}</span>
              <span className="text-slate-400">{t.at ? format(new Date(t.at), "d MMM yyyy", { locale: es }) : ""}</span>
              <div className="mt-1 break-words text-slate-700">{t.summary}</div>
            </li>
          ))}
        </ul></section>
    </div>
  );
}

function Cases() {
  const q = useQuery({ queryKey: ["agent-cases"], queryFn: getAgentCases });
  const { agentCase, setAgentCase } = useUI();
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className={`${agentCase ? "hidden md:block" : ""} md:w-[380px] md:shrink-0 md:overflow-y-auto md:border-r md:border-slate-200`}>
        <Header title="Casos" subtitle="Cada caso une WhatsApp, correo y agenda de un mismo asunto." right={q.data && <SourceBadge kind={q.data.source.kind} ageSeconds={q.data.source.age_s} />} />
        {q.isLoading && <div className="p-4"><Loader2 className="animate-spin text-slate-400" size={16} /></div>}
        {q.data && q.data.cases.length === 0 && <Empty text="AION Agent no tiene casos en este entorno." />}
        <ul className="space-y-2 p-3">
          {q.data?.cases.map((c) => (
            <li key={c.code}>
              <button onClick={() => setAgentCase(c.code)} className={`w-full rounded-lg border p-3 text-left hover:bg-slate-50 ${agentCase === c.code ? "border-indigo-400 bg-indigo-50/40" : "border-slate-200 bg-white"}`}>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.color }} /> <span className="[overflow-wrap:anywhere]">{c.code}</span></div>
                <div className="mt-0.5 text-xs text-slate-500 [overflow-wrap:anywhere]">{c.title}</div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                  <span>{c.groups} grupos</span><span>{c.mail} correos</span><span>{c.events} eventos</span>
                  {c.proposals > 0 && <span className="text-amber-700">{c.proposals} por revisar</span>}
                  {c.last_activity && <span>última actividad {format(new Date(c.last_activity), "d MMM", { locale: es })}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className={`${agentCase ? "" : "hidden md:block"} min-w-0 flex-1 overflow-y-auto`}>
        {agentCase ? (
          <>
            <button onClick={() => setAgentCase(null)} className="m-3 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 md:hidden">← Casos</button>
            <CaseDetailPane code={agentCase} />
          </>
        ) : <Empty text="Elige un caso para ver su línea de tiempo." />}
      </div>
    </div>
  );
}

function Search() {
  const [q, setQ] = useState("");
  const [sent, setSent] = useState("");
  const r = useQuery({ queryKey: ["agent-search", sent], queryFn: () => agentSearch(sent), enabled: sent.length >= 3 });
  return (
    <div>
      <Header title="Buscar en todo" subtitle="Texto completo de WhatsApp, correos, adjuntos y agenda (requiere la copia completa de AION Agent)." right={r.data && <SourceBadge kind={r.data.source.kind} ageSeconds={r.data.source.age_s} />} />
      <form onSubmit={(e) => { e.preventDefault(); setSent(q.trim()); }} className="mx-auto flex max-w-3xl gap-2 p-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="dictamen, Morales, pago…" aria-label="Buscar" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-2 text-sm text-white"><SearchIcon size={14} /> Buscar</button>
      </form>
      <div className="mx-auto max-w-3xl space-y-2 px-4 pb-6">
        {r.isLoading && <Loader2 className="animate-spin text-slate-400" size={16} />}
        {r.data?.message && <Empty text={r.data.message} />}
        {r.data && !r.data.message && r.data.results.length === 0 && <Empty text="Sin resultados." />}
        {r.data?.results.map((h: SearchHit, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 text-sm" data-testid="search-hit">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{h.kind}</span>
              {h.at && <span>{format(new Date(h.at), "d MMM yyyy", { locale: es })}</span>}
              {h.where && <span className="[overflow-wrap:anywhere]">{h.where}</span>}
            </div>
            {h.title && <div className="mt-1 font-medium text-slate-800 [overflow-wrap:anywhere]">{h.title}</div>}
            <div className="mt-1 break-words text-slate-600">{h.snippet}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const EXAMPLES = ["casos", "propuestas", "resumen del caso HMG", "agrega palabras clave Querétaro, Texcoco al caso PIT", "quiénes son los abogados", "ayuda"];

function Orders() {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ q: string; a: string; src?: string }[]>([]);
  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setBusy(true);
    try {
      const r = await agentCommand(t.trim());
      setLog((l) => [{ q: t.trim(), a: r.reply, src: r.source }, ...l]);
      qc.invalidateQueries({ queryKey: ["agent-cases"] });
    } catch (e) {
      setLog((l) => [{ q: t.trim(), a: `No pude ejecutar la orden: ${(e as Error).message}` }, ...l]);
    } finally { setBusy(false); setText(""); }
  };
  return (
    <div>
      <Header title="Órdenes a Chatita" subtitle="Escríbelas como las dirías: agregar palabras clave, crear casos, confirmar vínculos. Si tu computadora está apagada, la orden se anota y se aplica cuando vuelva." />
      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="mx-auto flex max-w-3xl gap-2 p-4">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="agrega palabra clave Querétaro al caso PIT" aria-label="Orden" className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <button disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} Enviar</button>
      </form>
      <div className="mx-auto flex max-w-3xl flex-wrap gap-2 px-4 pb-3">
        {EXAMPLES.map((e) => <button key={e} onClick={() => void send(e)} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">{e}</button>)}
      </div>
      <ul className="mx-auto max-w-3xl space-y-2 px-4 pb-6">
        {log.map((l, i) => (
          <li key={i} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="text-xs font-medium text-slate-500">Tú: {l.q}</div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-slate-800" data-testid="order-reply">{l.a}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AgentView({ mode }: { mode: AgentMode }) {
  const { agentCase, setAgentCase } = useUI();
  useEffect(() => { if (mode !== "cases" && agentCase) setAgentCase(null); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white" data-testid={`agent-${mode}`}>
      {mode === "today" && <Today />}
      {mode === "calendar" && <CalendarView />}
      {mode === "cases" && <Cases />}
      {mode === "search" && <Search />}
      {mode === "orders" && <Orders />}
    </div>
  );
}
