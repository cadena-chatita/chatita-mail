// Chatita Mail v3.0 — new-email composer (modal). Sends a brand-new message
// via gmail.send (POST /inbox/compose) with a confirmation before sending.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Send, X, Loader2, PenSquare } from "lucide-react";
import { composeEmail, listAccounts } from "../api/client";
import { useUI } from "../store";

const splitAddrs = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function ComposeModal() {
  const { composeOpen, closeCompose, accountId } = useUI();
  const qc = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });
  const senders = accounts.filter((a) => a.status === "connected");
  const [fromId, setFromId] = useState("");
  const from =
    senders.find((a) => a.id === (fromId || (accountId !== "all" ? accountId : ""))) ??
    senders.find((a) => a.is_default) ??
    senders[0];
  const MAILBOX = from?.email_address ?? "";
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const sendMut = useMutation({
    mutationFn: () =>
      composeEmail({
        to: splitAddrs(to),
        cc: splitAddrs(cc),
        subject,
        body,
        from_account_id: from?.id,
      }),
    onSuccess: (r) => {
      toast.success(`Enviado${r.to?.length ? ` a ${r.to.join(", ")}` : ""}`);
      setTo("");
      setCc("");
      setSubject("");
      setBody("");
      closeCompose();
      qc.invalidateQueries();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  if (!composeOpen) return null;

  const confirmSend = () => {
    if (!to.trim()) return;
    if (
      window.confirm(
        `Se enviará como ${MAILBOX}\n\nPara: ${to}\nAsunto: ${subject}\n\n¿Enviar ahora?`
      )
    ) {
      sendMut.mutate();
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-0 sm:p-4">
      <div className="w-full h-full sm:h-auto sm:max-w-2xl sm:rounded-xl bg-white shadow-2xl border border-slate-200 flex flex-col sm:max-h-[90vh] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <PenSquare size={16} className="text-indigo-600" /> Nuevo correo
          </div>
          <button
            onClick={closeCompose}
            className="text-slate-400 hover:text-slate-600"
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto">
          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">De</label>
          <select
            value={from?.id ?? ""}
            onChange={(e) => setFromId(e.target.value)}
            className="w-full mb-2 rounded-md border bg-white px-2.5 py-1.5 text-sm"
            style={{ borderColor: from?.color ?? undefined, borderLeftWidth: 4 }}
          >
            {senders.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name && a.display_name !== a.email_address ? `${a.display_name} <${a.email_address}>` : a.email_address}
              </option>
            ))}
          </select>

          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Para</label>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="correo@dominio.com, otro@dominio.com"
            className="w-full mb-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
          />

          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">CC</label>
          <input
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            placeholder="(opcional)"
            className="w-full mb-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
          />

          <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Asunto</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full mb-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium"
          />

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder="Escribe tu mensaje…"
            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm leading-relaxed resize-y"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-100">
          <button
            onClick={confirmSend}
            disabled={sendMut.isPending || !to.trim() || !from}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-500 disabled:opacity-50"
          >
            {sendMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {sendMut.isPending ? "Enviando…" : "Enviar"}
          </button>
          <button
            onClick={closeCompose}
            className="text-sm rounded-md border border-slate-200 bg-white px-4 py-2 text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <span className="ml-auto text-[11px] text-slate-400">Envía como {MAILBOX}</span>
        </div>
      </div>
    </div>
  );
}
