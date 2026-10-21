// Chatita Mail v3.0 — workflow view: open tasks & commitments across the mailbox.
// Tasks: vistas por plazo, prioridad con color + texto + forma, cancelar con deshacer,
// completar que se recuerda, y carga progresiva (Quipu DISENO_07 §5).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  AlertOctagon,
  AlertTriangle,
  CheckSquare,
  Circle,
  Handshake,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  Square,
  X,
} from "lucide-react";
import { getTaskCounts, listCommitments, listTasks, updateTask } from "../api/client";
import { deadlineLabel } from "../lib/format";
import { useUI } from "../store";
import type { Task } from "../types";

type View = "all" | "today" | "week" | "overdue" | "nodate" | "done";

const PAGE = 200;

// Prioridad: color + texto + forma (el color nunca es la única señal).
const PRIORITY = {
  critical: { label: "Crítica", bar: "bg-red-600", chip: "bg-red-50 text-red-700", Icon: AlertOctagon },
  high: { label: "Importante", bar: "bg-orange-500", chip: "bg-orange-50 text-orange-700", Icon: AlertTriangle },
  medium: { label: "Media", bar: "bg-blue-500", chip: "bg-blue-50 text-blue-700", Icon: Circle },
  low: { label: "Baja", bar: "bg-slate-300", chip: "bg-slate-100 text-slate-600", Icon: Minus },
} as const;

const TYPE_LABEL: Record<string, string> = {
  payment: "Pago",
  reply: "Responder",
  document: "Documento",
  calendar: "Agenda",
  reminder: "Recordatorio",
  other: "Otro",
};

const VIEWS: { key: View; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "today", label: "Hoy" },
  { key: "week", label: "Esta semana" },
  { key: "overdue", label: "Vencidas" },
  { key: "nodate", label: "Sin fecha" },
  { key: "done", label: "Completadas" },
];

function priorityOf(t: Task) {
  return PRIORITY[(t.priority as keyof typeof PRIORITY) ?? "medium"] ?? PRIORITY.medium;
}

function inView(t: Task, view: View, now: number): boolean {
  if (view === "all" || view === "done") return true;
  if (!t.deadline) return view === "nodate";
  const ms = new Date(t.deadline).getTime();
  if (Number.isNaN(ms)) return view === "nodate";
  const endToday = new Date();
  endToday.setHours(23, 59, 59, 999);
  if (view === "overdue") return ms < now;
  if (view === "today") return ms >= now && ms <= endToday.getTime();
  if (view === "week") return ms > endToday.getTime() && ms <= now + 7 * 86_400_000;
  return false;
}

export default function TasksView({ mode }: { mode: "tasks" | "commitments" }) {
  const qc = useQueryClient();
  const { selectEmail } = useUI();
  const [view, setView] = useState<View>("all");
  const [limit, setLimit] = useState(PAGE);
  const [search, setSearch] = useState("");

  const statusForView = view === "done" ? "done" : "pending";

  const tasksQ = useQuery({
    queryKey: ["tasks", statusForView, limit],
    queryFn: () => listTasks(statusForView, { limit, order: view === "done" ? "created" : "value" }),
    enabled: mode === "tasks",
  });
  const countsQ = useQuery({
    queryKey: ["task-counts"],
    queryFn: getTaskCounts,
    enabled: mode === "tasks",
    refetchInterval: 60_000,
  });
  const commitsQ = useQuery({
    queryKey: ["commitments", "pending"],
    queryFn: () => listCommitments("pending"),
    enabled: mode === "commitments",
  });

  const taskMut = useMutation({
    mutationFn: (v: { id: string; status: "pending" | "done" | "dismissed" }) => updateTask(v.id, v.status),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast.error(`No se pudo actualizar: ${(e as Error).message}`),
  });

  // Cancelar con deshacer: nunca se borra, solo cambia de estado.
  const dismiss = (t: Task) => {
    taskMut.mutate({ id: t.id, status: "dismissed" });
    toast(
      (tt) => (
        <span className="flex items-center gap-3 text-sm">
          Tarea cancelada
          <button
            className="font-semibold text-indigo-600"
            onClick={() => {
              toast.dismiss(tt.id);
              taskMut.mutate({ id: t.id, status: "pending" });
            }}
          >
            Deshacer
          </button>
        </span>
      ),
      { duration: 8000 },
    );
  };

  const complete = (t: Task) => {
    taskMut.mutate({ id: t.id, status: "done" });
    toast.success("Completada. Ya no volverá a generarse.", { duration: 3500 });
  };

  const now = Date.now();
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tasksQ.data ?? []).filter(
      (t) => inView(t, view, now) && (!q || t.description.toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksQ.data, view, search]);

  const loading = mode === "tasks" ? tasksQ.isLoading : commitsQ.isLoading;
  const counts = countsQ.data;
  const countFor = (v: View): number | undefined => {
    if (!counts) return undefined;
    return { all: counts.pending, today: counts.today, week: counts.week, overdue: counts.overdue, nodate: counts.no_date, done: counts.done }[v];
  };
  const canLoadMore = (tasksQ.data?.length ?? 0) >= limit;

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 className="text-lg font-semibold text-slate-800">
          {mode === "tasks" ? "Tareas abiertas" : "Compromisos"}
        </h2>
        <p className="text-xs text-slate-500">
          {mode === "tasks"
            ? "Solo se generan desde correos recibidos a partir del 1 de octubre de 2026. Al completar o cancelar una tarea, no se vuelve a crear."
            : "Extraídos por AION Brain de tus correos importantes."}
        </p>
      </div>

      {mode === "tasks" && (
        <div className="px-6 pt-3 flex flex-wrap items-center gap-2">
          {VIEWS.map((v) => {
            const n = countFor(v.key);
            const active = view === v.key;
            return (
              <button
                key={v.key}
                onClick={() => {
                  setView(v.key);
                  setLimit(PAGE);
                }}
                className={`rounded-full px-3 py-1 text-xs border transition ${
                  active
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {v.label}
                {n !== undefined && <span className="ml-1 opacity-70">{n}</span>}
              </button>
            );
          })}
          <label className="ml-auto flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500">
            <Search size={12} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en las tareas"
              className="outline-none bg-transparent w-44"
            />
          </label>
        </div>
      )}

      {loading && (
        <div className="p-6 flex items-center gap-2 text-slate-400">
          <Loader2 className="animate-spin" size={16} /> Cargando…
        </div>
      )}

      <div className="max-w-3xl mx-auto p-4 space-y-2">
        {mode === "tasks" &&
          visible.map((t) => {
            const p = priorityOf(t);
            const closed = t.status !== "pending";
            return (
              <div
                key={t.id}
                className="flex items-stretch gap-3 rounded-lg border border-slate-200 bg-white hover:shadow-sm transition overflow-hidden"
              >
                <div className={`w-1.5 shrink-0 ${p.bar}`} aria-hidden />
                <div className="flex items-start gap-3 p-3 flex-1 min-w-0">
                  {closed ? (
                    <button
                      onClick={() => taskMut.mutate({ id: t.id, status: "pending" })}
                      className="mt-0.5 text-slate-400 hover:text-slate-600"
                      title="Reabrir"
                    >
                      <RotateCcw size={16} />
                    </button>
                  ) : (
                    <button onClick={() => complete(t)} className="mt-0.5 text-emerald-600" title="Marcar como completada">
                      <Square size={18} />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${closed ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {t.description}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${p.chip}`}>
                        <p.Icon size={11} /> {p.label}
                      </span>
                      {t.task_type && (
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">
                          {TYPE_LABEL[t.task_type] ?? t.task_type}
                        </span>
                      )}
                      {t.deadline && (
                        <span
                          className={
                            !closed && new Date(t.deadline).getTime() < now ? "text-rose-600 font-medium" : "text-slate-500"
                          }
                        >
                          {!closed && new Date(t.deadline).getTime() < now ? "Vencida · " : ""}
                          {deadlineLabel(t.deadline)}
                        </span>
                      )}
                      {closed && t.completed_at && (
                        <span className="text-emerald-700">
                          Completada {new Date(t.completed_at).toLocaleDateString()}
                          {t.closed_via === "duplicate" ? " (mismo aviso)" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => selectEmail(t.email_id)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      ver correo →
                    </button>
                    {!closed && (
                      <button
                        onClick={() => dismiss(t)}
                        className="text-slate-300 hover:text-rose-500"
                        title="Cancelar tarea (no se borra; puedes deshacer)"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

        {mode === "tasks" && !loading && visible.length === 0 && (
          <Empty
            icon={<CheckSquare size={26} />}
            text={view === "done" ? "Aún no hay tareas completadas." : "No hay tareas en esta vista."}
          />
        )}

        {mode === "tasks" && canLoadMore && !loading && (
          <button
            onClick={() => setLimit((l) => l + PAGE)}
            className="mx-auto block rounded-md border border-slate-200 px-4 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            Ver más
          </button>
        )}

        {mode === "commitments" &&
          (commitsQ.data ?? []).map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <span className="mt-0.5 text-indigo-500">🤝</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800">
                  <b>{c.who}</b>: {c.what}
                </div>
                {c.deadline && <div className="text-xs text-rose-500 mt-1">{deadlineLabel(c.deadline)}</div>}
              </div>
              <button onClick={() => selectEmail(c.email_id)} className="text-xs text-slate-400 hover:text-slate-600">
                ver correo →
              </button>
            </div>
          ))}

        {mode === "commitments" && !loading && (commitsQ.data ?? []).length === 0 && (
          <Empty icon={<Handshake size={26} />} text="Aún no hay compromisos registrados." />
        )}
      </div>
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="p-12 text-center text-slate-400">
      <div className="mx-auto mb-2 grid place-items-center">{icon}</div>
      <div className="text-sm">{text}</div>
    </div>
  );
}
