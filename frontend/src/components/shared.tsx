// Small pieces shared by Tasks, Commitments and the AION Agent views.
import { useState } from "react";
import { Briefcase } from "lucide-react";
import type { CaseChip } from "../api/client";
import { useUI } from "../store";

/** Case chips: click opens the case in AION Agent > Casos. */
export function CaseChips({ cases }: { cases?: CaseChip[] }) {
  const { setFolder, setAgentCase } = useUI();
  if (!cases?.length) return null;
  return (
    <>
      {cases.map((c) => (
        <button
          key={c.code}
          type="button"
          title={c.title ?? c.code}
          onClick={() => { setFolder("agent_cases"); setAgentCase(c.code); }}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white hover:brightness-110"
          style={{ background: c.color ?? "#4f46e5" }}
        >
          <Briefcase size={11} aria-hidden /> {c.code}{c.inferred ? " ~" : ""}
        </button>
      ))}
    </>
  );
}

const CHANNEL = { whatsapp: "WhatsApp", mail: "Correo", event: "Agenda" } as Record<string, string>;
const ago = (iso: string) => { const h = (Date.now() - new Date(iso).getTime()) / 3_600_000; return h < 1 ? "hace minutos" : h < 36 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} días`; };

/** Everything useful about the email an item came from, without opening it: who, when, a two-line excerpt. */
export function SourceLine({ from, subject, receivedAt, excerpt }: { from?: string | null; subject?: string | null; receivedAt?: string | null; excerpt?: string | null }) {
  const [more, setMore] = useState(false);
  if (!from && !subject) return null;
  return (
    <div className="mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500 [overflow-wrap:anywhere]" data-testid="source-line">
      <div><span className="text-slate-400">Correo de origen · </span><b className="font-medium text-slate-600">{from}</b>{receivedAt ? <span className="text-slate-400"> · {ago(receivedAt)}</span> : null}</div>
      {subject && <div className="font-medium text-slate-600">{subject}</div>}
      {excerpt && (
        <div className="text-slate-500" data-expandable>
          <span className={more ? "" : "line-clamp-2"}>{excerpt}</span>
          {excerpt.length > 110 && <button type="button" onClick={() => setMore(!more)} className="ml-1 text-indigo-600 hover:underline">{more ? "ver menos" : "ver más"}</button>}
        </div>
      )}
    </div>
  );
}

export function NextStep({ text }: { text?: string }) {
  return text ? <div className="mt-1.5 text-xs text-indigo-700"><span className="font-semibold">Siguiente paso:</span> {text}</div> : null;
}

export function CaseLatest({ code, latest }: { code?: string; latest?: { channel: string; at: string | null; summary: string } | null }) {
  if (!code || !latest) return null;
  return <div className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">Lo último en {code}: <span className="text-slate-400">{latest.at ? ago(latest.at) : ""} · {CHANNEL[latest.channel] ?? latest.channel}:</span> {latest.summary}</div>;
}

export function SourceBadge({ kind, ageSeconds }: { kind: string; ageSeconds: number | null }) {
  const label = { full: "copia completa", light: "copia ligera", local: "base local", none: "sin datos" }[kind] ?? kind;
  const age = ageSeconds == null ? "" : ageSeconds < 90 ? " · ahora" : ageSeconds < 5400 ? ` · hace ${Math.round(ageSeconds / 60)} min` : ` · hace ${Math.round(ageSeconds / 3600)} h`;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600" title="De dónde salen los datos de AION Agent">Datos: {label}{age}</span>;
}
