// Chatita Mail v3.0 — middle pane: email list for the active folder
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Paperclip, Loader2, Inbox as InboxIcon, Sparkles } from "lucide-react";
import { listEmails, searchSemantic, setStatus } from "../api/client";
import { folderByKey, useUI } from "../store";
import { CategoryBadge, SecurityBadge } from "./badges";
import { avatarColor, initials, relativeDate } from "../lib/format";

export default function EmailList() {
  const { folderKey, selectedEmailId, selectEmail, search, searchMode, unreadOnly, sortMode, setSortMode } =
    useUI();
  const folder = folderByKey(folderKey);
  const qc = useQueryClient();
  // Correo bajo el puntero (ref: no provoca re-render al mover el mouse).
  const hoveredRef = useRef<{ id: string; status: string } | null>(null);
  // Instante de la ultima navegacion con flechas: durante 600 ms se ignoran los mouseenter sinteticos que
  // el navegador dispara al desplazar la lista bajo un puntero quieto (si no, la seleccion "rebotaria").
  const navAtRef = useRef(0);
  const visibleRef = useRef<{ id: string; status: string }[]>([]);
  // Semantic mode kicks in only when the user has typed a query (>=2 chars);
  // otherwise fall back to the normal folder listing.
  const semantic = searchMode === "meaning" && search.trim().length >= 2;

  const { data: emails = [], isLoading } = useQuery({
    queryKey: [
      "emails",
      folder.key,
      folder.status,
      folder.category,
      search,
      searchMode,
      unreadOnly,
      sortMode,
    ],
    queryFn: () =>
      semantic
        ? searchSemantic({ q: search.trim(), status: "ALL", limit: 50 })
        : listEmails({
            status: folder.status,
            category: folder.category,
            search: search || undefined,
            unread_only: unreadOnly || undefined,
            sort: sortMode,
            limit: 100,
          }),
    // Don't auto-refetch semantic results (each triggers an embedding call).
    refetchInterval: semantic ? false : 20000,
  });

  // Papelera: solo se ve en su carpeta; en las demás (Spam/Noise/búsqueda) se ocultan los eliminados.
  const visible = folder.status === "DELETED" ? emails : emails.filter((e) => e.status !== "DELETED");
  visibleRef.current = visible;

  // Delete / Retroceso (tecla "delete" del Mac) sobre el correo bajo el mouse -> Papelera, con Deshacer.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // Flecha abajo/arriba con el mouse sobre un correo: selecciona el siguiente/anterior en vez de desplazar.
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
        const t = ev.target as HTMLElement | null;
        if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
        const cur = hoveredRef.current;
        const list = visibleRef.current;
        if (!cur || list.length === 0) return;
        const idx = list.findIndex((x) => x.id === cur.id);
        if (idx < 0) return;
        ev.preventDefault(); // evita el scroll de la pagina/lista
        navAtRef.current = Date.now();
        const next = list[Math.min(list.length - 1, Math.max(0, idx + (ev.key === "ArrowDown" ? 1 : -1)))];
        hoveredRef.current = { id: next.id, status: next.status };
        selectEmail(next.id);
        document.querySelector(`[data-email-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (ev.key !== "Delete" && ev.key !== "Backspace") return;
      if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return;
      const t = ev.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      const hov = hoveredRef.current;
      if (!hov || hov.status === "DELETED") return;
      ev.preventDefault();
      const { id, status: prev } = hov;
      hoveredRef.current = null;
      if (useUI.getState().selectedEmailId === id) selectEmail(null);
      // Optimista: quitar de todas las listas en caché al instante.
      qc.setQueriesData<{ id: string }[]>({ queryKey: ["emails"] }, (old) =>
        Array.isArray(old) ? old.filter((x) => x.id !== id) : old
      );
      setStatus(id, "DELETED")
        .then(() => {
          qc.invalidateQueries();
          toast(
            (tt) => (
              <span className="flex items-center gap-3 text-sm">
                Correo movido a la papelera
                <button
                  className="font-semibold text-blue-600 hover:underline"
                  onClick={() => {
                    toast.dismiss(tt.id);
                    setStatus(id, prev as never)
                      .then(() => qc.invalidateQueries())
                      .catch((e) => toast.error(`No se pudo deshacer: ${(e as Error).message}`));
                  }}
                >
                  Deshacer
                </button>
              </span>
            ),
            { duration: 6000 }
          );
        })
        .catch((e) => {
          qc.invalidateQueries();
          toast.error(`No se pudo eliminar: ${(e as Error).message}`);
        });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qc, selectEmail]);

  return (
    <div className="w-[380px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">{folder.label}</h2>
        <div className="flex items-center gap-2">
          {/* Sort toggle: importance-first (default) vs strictly newest-first */}
          <div className="flex rounded-md border border-slate-200 overflow-hidden text-[11px]">
            <button
              onClick={() => setSortMode("priority")}
              title="Ordenar por importancia (Critical primero)"
              className={`px-2 py-0.5 transition ${
                sortMode === "priority"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              Prioridad
            </button>
            <button
              onClick={() => setSortMode("date")}
              title="Ordenar por fecha (más reciente primero)"
              className={`px-2 py-0.5 transition ${
                sortMode === "date"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-500 hover:bg-slate-50"
              }`}
            >
              Fecha
            </button>
          </div>
          <span className="text-xs text-slate-400">{visible.length}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="p-6 flex items-center gap-2 text-slate-400">
            <Loader2 className="animate-spin" size={16} /> Loading…
          </div>
        )}

        {!isLoading && visible.length === 0 && (
          <div className="p-10 text-center text-slate-400">
            <InboxIcon className="mx-auto mb-2" size={28} />
            <div className="font-medium">Nothing here</div>
            <div className="text-xs mt-1">
              {search ? "No matches for your search." : "Inbox zero 🎉"}
            </div>
          </div>
        )}

        {visible.map((e) => {
          const active = selectedEmailId === e.id;
          const name = e.from_name || e.from_address;
          return (
            <button
              key={e.id}
              data-testid="email-row"
              onClick={() => selectEmail(e.id)}
              data-email-id={e.id}
              onMouseEnter={() => { if (Date.now() - navAtRef.current > 600) hoveredRef.current = { id: e.id, status: e.status }; }}
              onMouseMove={(ev) => { if (ev.movementX !== 0 || ev.movementY !== 0) hoveredRef.current = { id: e.id, status: e.status }; }}
              onMouseLeave={() => { if (Date.now() - navAtRef.current > 600 && hoveredRef.current?.id === e.id) hoveredRef.current = null; }}
              className={`w-full text-left px-3 py-3 border-b border-slate-100 flex gap-3 transition ${
                active ? "bg-slate-100" : "hover:bg-slate-50"
              } ${!e.is_read ? "bg-blue-50/40" : ""}`}
            >
              {/* Avatar */}
              <div
                className={`h-9 w-9 shrink-0 rounded-full grid place-items-center text-white text-xs font-semibold ${avatarColor(
                  name
                )}`}
              >
                {initials(e.from_name, e.from_address)}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {!e.is_read && <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />}
                  <span
                    className={`truncate text-sm ${
                      !e.is_read ? "font-semibold text-slate-900" : "text-slate-700"
                    }`}
                  >
                    {name}
                  </span>
                  <span className="ml-auto text-[11px] text-slate-400 shrink-0">
                    {relativeDate(e.received_at)}
                  </span>
                </div>

                <div
                  className={`truncate text-sm ${
                    !e.is_read ? "font-medium text-slate-800" : "text-slate-600"
                  }`}
                >
                  {e.subject || "(no subject)"}
                </div>

                <div className="truncate text-xs text-slate-400">{e.snippet}</div>

                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {typeof e.similarity === "number" && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600">
                      <Sparkles size={10} /> {Math.round(e.similarity * 100)}%
                    </span>
                  )}
                  <CategoryBadge category={e.category} size="xs" />
                  <SecurityBadge level={e.risk_level} score={e.risk_score} size="xs" />
                  {e.is_newsletter && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-600">
                      Newsletter
                    </span>
                  )}
                  {e.has_attachments && <Paperclip size={12} className="text-slate-400" />}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
