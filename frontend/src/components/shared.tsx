// Small pieces shared by Tasks, Commitments and the AION Agent views.
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
          className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
        >
          <Briefcase size={11} aria-hidden /> {c.code}
        </button>
      ))}
    </>
  );
}

export function SourceBadge({ kind, ageSeconds }: { kind: string; ageSeconds: number | null }) {
  const label = { full: "copia completa", light: "copia ligera", local: "base local", none: "sin datos" }[kind] ?? kind;
  const age = ageSeconds == null ? "" : ageSeconds < 90 ? " · ahora" : ageSeconds < 5400 ? ` · hace ${Math.round(ageSeconds / 60)} min` : ` · hace ${Math.round(ageSeconds / 3600)} h`;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600" title="De dónde salen los datos de AION Agent">Datos: {label}{age}</span>;
}
