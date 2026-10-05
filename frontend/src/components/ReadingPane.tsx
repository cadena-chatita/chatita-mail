// Chatita Mail v3.0 — right pane: full email view + actions + XAI + Phase-2 tasks
import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Archive,
  Ban,
  CheckSquare,
  Square,
  MailOpen,
  ShieldCheck,
  Sparkles,
  Trash2,
  Paperclip,
  Bot,
  ShieldAlert,
  FileText,
  Reply,
  ReplyAll,
  Forward,
  Send,
  X,
  Loader2,
  Layers,
  Volume2,
  CalendarClock,
  FilePlus,
  ExternalLink,
  Undo2,
} from "lucide-react";
import {
  draftReply,
  draftVariants,
  extractTasks,
  getEmail,
  getStyleProfile,
  recordStyleFeedback,
  releaseFromQuarantine,
  setRead,
  forwardEmail,
  replyEmail,
  setStatus,
  similarEmails,
  summarizeEmail,
  unsubscribeEmail,
  updateTask,
  voiceTTS,
  driveSearch,
  detectMeeting,
  createCalendarEvent,
  docDraft,
  createDriveDoc,
  type EmailSummary,
  type ReplyVariant,
  type DriveFile,
  type MeetingDetection,
} from "../api/client";
import { useUI } from "../store";
import { CategoryBadge, SecurityBadge } from "./badges";
import { avatarColor, deadlineLabel, fullDate, initials } from "../lib/format";
import type { EmailDetail, EmailListItem, EmailStatus } from "../types";

// ── Composer (reply / reply-all / forward) ──────────────────
type ComposeMode = "reply" | "replyAll" | "forward";
interface ComposeState {
  mode: ComposeMode;
  to: string;
  cc: string;
  subject: string;
  body: string;
  includeAttachments: boolean;
}
// Display-only: the mailbox the service account impersonates for sending.
const MAILBOX = "jose@manuelcadena.com";
const splitAddrs = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const reSubject = (p: "Re:" | "Fwd:", s: string | null) => {
  const subj = (s || "").trim();
  if (p === "Re:" && /^re:/i.test(subj)) return subj;
  if (p === "Fwd:" && /^(fwd|fw):/i.test(subj)) return subj;
  return `${p} ${subj}`.trim();
};
function emptyReplyState(data: EmailDetail | undefined, mode: ComposeMode = "reply"): ComposeState {
  const cc =
    mode === "replyAll" && data
      ? [...(data.to_addresses || []), ...(data.cc_addresses || [])]
          .filter((a) => a && a !== data.from_address)
          .join(", ")
      : "";
  return {
    mode,
    to: data?.from_address ?? "",
    cc,
    subject: reSubject("Re:", data?.subject ?? null),
    body: "",
    includeAttachments: false,
  };
}
function emptyForwardState(data: EmailDetail): ComposeState {
  return {
    mode: "forward",
    to: "",
    cc: "",
    subject: reSubject("Fwd:", data.subject),
    body: "",
    includeAttachments: true,
  };
}

// Force every link inside a rendered email body to open in a NEW browser tab.
// The Mail app runs inside an iframe (chatita.ai/mail/). A default (same-frame)
// click navigates that iframe to the external URL, which most sites refuse via
// X-Frame-Options / frame-ancestors → the browser shows a blank grey
// "This content is blocked" screen. Opening top-level (_blank) loads the site
// normally and keeps Mail untouched so the user can return to it.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export default function ReadingPane() {
  const { selectedEmailId, selectEmail } = useUI();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["email", selectedEmailId],
    queryFn: () => getEmail(selectedEmailId as string),
    enabled: !!selectedEmailId,
  });

  const refresh = () => qc.invalidateQueries();

  const statusMut = useMutation({
    mutationFn: (s: EmailStatus) => setStatus(selectedEmailId as string, s),
    onSuccess: (_d, s) => {
      toast.success(`Moved to ${s}`);
      selectEmail(null);
      refresh();
    },
  });
  const readMut = useMutation({
    mutationFn: (r: boolean) => setRead(selectedEmailId as string, r),
    onSuccess: () => refresh(),
  });
  const unsubMut = useMutation({
    mutationFn: () => unsubscribeEmail(selectedEmailId as string),
    onSuccess: (r) => {
      toast.success(r?.ok ? "Unsubscribed" : "Unsubscribe attempted");
      refresh();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const releaseMut = useMutation({
    mutationFn: () => releaseFromQuarantine(selectedEmailId as string),
    onSuccess: () => {
      toast.success("Released to inbox");
      refresh();
    },
  });
  const extractMut = useMutation({
    mutationFn: () => extractTasks(selectedEmailId as string),
    onSuccess: (r) => {
      toast.success(`Extracted ${r.tasks_extracted} task(s), ${r.commitments_extracted} commitment(s)`);
      refresh();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const taskMut = useMutation({
    mutationFn: (v: { id: string; status: string }) => updateTask(v.id, v.status),
    onSuccess: () => refresh(),
  });

  // Phase 2: composer state
  const [summary, setSummary] = useState<EmailSummary | null>(null);
  const [tone] = useState("professional");  // single-draft fallback tone
  const [similar, setSimilar] = useState<EmailListItem[] | null>(null);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [variants, setVariants] = useState<ReplyVariant[] | null>(null);
  const [styleMeta, setStyleMeta] = useState<{ applied: boolean; samples: number } | null>(null);
  const [replyLang, setReplyLang] = useState<string | null>(null);
  // Track the AI text applied to the composer so we can measure edits on send (T3.3).
  const [aiDraft, setAiDraft] = useState<{ body: string; style: string } | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);

  const similarMut = useMutation({
    mutationFn: () => similarEmails(selectedEmailId as string, 8),
    onSuccess: (r) => setSimilar(r),
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const summarizeMut = useMutation({
    mutationFn: () => summarizeEmail(selectedEmailId as string),
    onSuccess: (r) => setSummary(r),
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  // Learned style profile — powers the "¿Por qué?" XAI expander (T3.4).
  const { data: styleProfile } = useQuery({
    queryKey: ["styleProfile"],
    queryFn: getStyleProfile,
    staleTime: 60_000,
  });
  // AI draft fills the open composer (opens a reply first if none is open).
  const draftMut = useMutation({
    mutationFn: () => draftReply(selectedEmailId as string, tone),
    onSuccess: (r) => {
      setReplyLang(r.language ?? null);
      setAiDraft({ body: r.body, style: "single" });
      setCompose((prev) => {
        const base = prev ?? emptyReplyState(data);
        return { ...base, body: r.body, subject: base.subject || r.subject };
      });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  // T3.2 — generate 3 styled options (Natural/Profesional/Breve) with XAI 'why'.
  const variantsMut = useMutation({
    mutationFn: () => draftVariants(selectedEmailId as string),
    onSuccess: (r) => {
      setVariants(r.variants);
      setStyleMeta({ applied: r.style_applied, samples: r.style_samples });
      setReplyLang(r.language ?? null);
      setCompose((prev) => prev ?? emptyReplyState(data));
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const applyVariant = (v: ReplyVariant) => {
    setAiDraft({ body: v.body, style: v.style });
    setCompose((prev) => {
      const base = prev ?? emptyReplyState(data);
      return { ...base, body: v.body, subject: base.subject || v.subject };
    });
  };

  // T4.2 — Drive attachment suggestions.
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveResults, setDriveResults] = useState<DriveFile[] | null>(null);
  const [driveQuery, setDriveQuery] = useState("");
  const driveMut = useMutation({
    mutationFn: (q: string) => driveSearch(q, 8),
    onSuccess: (r) => setDriveResults(r.files),
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const insertDriveLink = (f: DriveFile) => {
    setCompose((prev) => {
      const base = prev ?? emptyReplyState(data);
      const line = `📎 ${f.name}: ${f.link}`;
      const body = base.body ? `${base.body.replace(/\s+$/, "")}\n\n${line}` : line;
      return { ...base, body };
    });
    toast.success("Enlace de Drive insertado");
  };

  // T2.4 — meeting detection + scheduling.
  const [meeting, setMeeting] = useState<MeetingDetection | null>(null);
  const [meetingSlot, setMeetingSlot] = useState<string | null>(null);
  const [sendInvites, setSendInvites] = useState(false);
  const meetingMut = useMutation({
    mutationFn: () => detectMeeting(selectedEmailId as string),
    onSuccess: (r) => {
      setMeeting(r);
      setMeetingSlot(r.slots[0]?.start ?? null);
      if (!r.is_meeting_request) toast("No parece una solicitud de reunión", { icon: "🤔" });
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const createEventMut = useMutation({
    mutationFn: () => {
      const slot = meeting!.slots.find((s) => s.start === meetingSlot);
      return createCalendarEvent({
        summary: meeting!.topic,
        start: slot!.start,
        end: slot!.end,
        duration_min: meeting!.duration_minutes,
        description: `Agendado desde Chatita Mail · ${data?.subject ?? ""}`,
        attendees: meeting!.attendees,
        send_invites: sendInvites,
      });
    },
    onSuccess: (r) => {
      toast.success(r.event.invites_sent ? "Evento creado + invitación enviada" : "Evento creado en tu calendario");
      window.open(r.event.link, "_blank", "noopener");
      setMeeting(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  // T2.6 — document generation to Drive.
  const [doc, setDoc] = useState<{ title: string; content: string } | null>(null);
  const docMut = useMutation({
    mutationFn: () => docDraft(selectedEmailId as string),
    onSuccess: (r) => setDoc({ title: r.title, content: r.content }),
    onError: (e: unknown) => toast.error((e as Error).message),
  });
  const createDocMut = useMutation({
    mutationFn: () => createDriveDoc(doc!.title, doc!.content),
    onSuccess: (r) => {
      toast.success("Documento creado en Drive");
      window.open(r.doc.link, "_blank", "noopener");
      setDoc(null);
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  // T4.1 — play the composed reply aloud (ElevenLabs TTS via backend).
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const voiceMut = useMutation({
    mutationFn: () => voiceTTS(compose?.body?.trim() || ""),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      voiceRef.current?.pause();
      const audio = new Audio(url);
      voiceRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      void audio.play();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!compose || !selectedEmailId) throw new Error("Nada para enviar");
      const to = splitAddrs(compose.to);
      const cc = splitAddrs(compose.cc);
      if (compose.mode === "forward") {
        return forwardEmail(selectedEmailId, {
          to,
          cc,
          subject: compose.subject,
          body: compose.body,
          include_attachments: compose.includeAttachments,
        });
      }
      const sent = await replyEmail(selectedEmailId, {
        body: compose.body,
        to,
        cc,
        subject: compose.subject,
        reply_all: compose.mode === "replyAll",
      });
      // T3.3 — learn from how Manny edited the AI draft (fire-and-forget).
      if (aiDraft) {
        recordStyleFeedback({
          final_body: compose.body,
          ai_body: aiDraft.body,
          style: aiDraft.style,
          email_id: selectedEmailId,
        }).catch(() => {});
      }
      return sent;
    },
    onSuccess: (r) => {
      toast.success(`Enviado${r.to?.length ? ` a ${r.to.join(", ")}` : ""}`);
      setCompose(null);
      setAiDraft(null);
      refresh();
    },
    onError: (e: unknown) => toast.error((e as Error).message),
  });

  const openCompose = (mode: ComposeMode) => {
    if (!data) return;
    setCompose(mode === "forward" ? emptyForwardState(data) : emptyReplyState(data, mode));
  };

  // Clear AI summary/composer/similar when the selected email changes.
  useEffect(() => {
    setSummary(null);
    setSimilar(null);
    setCompose(null);
    setVariants(null);
    setStyleMeta(null);
    setReplyLang(null);
    setAiDraft(null);
    setWhyOpen(false);
    setDriveOpen(false);
    setDriveResults(null);
    setDriveQuery("");
    setMeeting(null);
    setMeetingSlot(null);
    setSendInvites(false);
    setDoc(null);
  }, [selectedEmailId]);

  // Open any clicked in-email link OUTSIDE the Mail iframe so external sites
  // (which refuse framing via X-Frame-Options) never render the grey
  // "This content is blocked" screen.
  //   1. Try a SEPARATE browser window (popup with dimensions).
  //   2. If the popup blocker nixes it (common inside an embedded iframe),
  //      fall back to a new top-level TAB via the native anchor (target=_blank),
  //      which browsers do NOT popup-block — so a link ALWAYS opens somewhere
  //      and Mail stays intact for the user to return to.
  const openLinkInWindow = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href || !/^https?:\/\//i.test(href)) return; // ignore anchors/mailto/etc.
    const w = Math.min(1280, Math.round(window.screen.availWidth * 0.8));
    const h = Math.min(900, Math.round(window.screen.availHeight * 0.85));
    const left = Math.round((window.screen.availWidth - w) / 2);
    const top = Math.round((window.screen.availHeight - h) / 2);
    let win: Window | null = null;
    try {
      win = window.open(
        href,
        "_blank",
        `popup=yes,width=${w},height=${h},left=${left},top=${top}`
      );
    } catch {
      win = null;
    }
    if (win) {
      // Popup allowed → separate window. Sever opener for security and stop the
      // native navigation so the link does NOT also load inside the iframe.
      try { win.opener = null; } catch { /* cross-origin, ignore */ }
      e.preventDefault();
    }
    // else: popup blocked → let the native target=_blank anchor open a new tab.
  };

  const sanitized = useMemo(() => {
    if (!data?.body_html) return null;
    return DOMPurify.sanitize(data.body_html, {
      FORBID_TAGS: ["script", "style", "iframe", "form", "input", "object", "embed", "base"],
      FORBID_ATTR: ["onerror", "onload", "onclick"],
      ADD_ATTR: ["target"],
    });
  }, [data?.body_html]);

  if (!selectedEmailId) {
    return (
      <div className="flex-1 grid place-items-center text-slate-400">
        <div className="text-center">
          <MailOpen className="mx-auto mb-2" size={32} />
          <div>Select an email to read</div>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return <div className="flex-1 p-8 text-slate-400">Loading…</div>;
  }

  const name = data.from_name || data.from_address;
  const isQuarantined = data.status === "QUARANTINED" || data.status === "BLOCKED";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-1.5 flex-wrap">
        <ToolbarBtn icon={<Archive size={16} />} label="Archive" onClick={() => statusMut.mutate("ARCHIVED")} />
        <ToolbarBtn icon={<Trash2 size={16} />} label="Delete" onClick={() => statusMut.mutate("DELETED")} />
        {data.status === "DELETED" && (
          <ToolbarBtn icon={<Undo2 size={16} />} label="Restaurar" onClick={() => statusMut.mutate("INBOX")} />
        )}
        <ToolbarBtn
          icon={data.is_read ? <MailOpen size={16} /> : <MailOpen size={16} />}
          label={data.is_read ? "Mark unread" : "Mark read"}
          onClick={() => readMut.mutate(!data.is_read)}
        />
        {data.classification?.unsubscribe_url && (
          <ToolbarBtn icon={<Ban size={16} />} label="Unsubscribe" onClick={() => unsubMut.mutate()} />
        )}
        {isQuarantined && (
          <ToolbarBtn icon={<ShieldCheck size={16} />} label="Release" onClick={() => releaseMut.mutate()} />
        )}
        <ToolbarBtn
          icon={<Sparkles size={16} />}
          label={extractMut.isPending ? "Extracting…" : "Extract tasks"}
          onClick={() => extractMut.mutate()}
          disabled={extractMut.isPending}
        />
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <ToolbarBtn icon={<Reply size={16} />} label="Responder" onClick={() => openCompose("reply")} />
        <ToolbarBtn icon={<ReplyAll size={16} />} label="Resp. todos" onClick={() => openCompose("replyAll")} />
        <ToolbarBtn icon={<Forward size={16} />} label="Reenviar" onClick={() => openCompose("forward")} />
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <ToolbarBtn
          icon={summarizeMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
          label={summarizeMut.isPending ? "Summarizing…" : "Summarize"}
          onClick={() => summarizeMut.mutate()}
          disabled={summarizeMut.isPending}
        />
        <ToolbarBtn
          icon={similarMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />}
          label={similarMut.isPending ? "Buscando…" : "Similares"}
          onClick={() => similarMut.mutate()}
          disabled={similarMut.isPending}
        />
        <ToolbarBtn
          icon={meetingMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <CalendarClock size={16} />}
          label={meetingMut.isPending ? "Analizando…" : "Reunión"}
          onClick={() => meetingMut.mutate()}
          disabled={meetingMut.isPending}
        />
        <ToolbarBtn
          icon={docMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <FilePlus size={16} />}
          label={docMut.isPending ? "Redactando…" : "Doc"}
          onClick={() => docMut.mutate()}
          disabled={docMut.isPending}
        />
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <h1 className="text-2xl font-semibold text-slate-900 mb-3">
          {data.subject || "(no subject)"}
        </h1>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <CategoryBadge category={data.classification?.category ?? null} />
          <SecurityBadge
            level={data.security?.risk_level ?? null}
            score={data.security?.risk_score ?? null}
          />
        </div>

        {/* AI summary (Phase 2) */}
        {summary && (
          <Panel
            icon={<FileText size={14} />}
            tone="slate"
            title={`AI summary${summary.source === "fallback" ? " (fallback)" : ""}`}
          >
            <p className="text-sm text-slate-800 mb-2">{summary.tldr}</p>
            {summary.key_points.length > 0 && (
              <ul className="list-disc list-inside text-sm text-slate-600 mb-2">
                {summary.key_points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {summary.suggested_action && (
              <p className="text-xs text-slate-500">
                <b>Next:</b> {summary.suggested_action}
              </p>
            )}
          </Panel>
        )}

        {/* T2.4 — Meeting scheduling */}
        {meeting && (
          <Panel icon={<CalendarClock size={14} />} tone="indigo" title="Agendar reunión">
            {!meeting.is_meeting_request && (
              <p className="text-sm text-slate-600 mb-2">
                AION no detectó una solicitud de reunión. Puedes agendar igualmente eligiendo un horario.
              </p>
            )}
            <div className="text-sm text-slate-800 mb-1">
              <b>{meeting.topic}</b> · {meeting.duration_minutes} min
            </div>
            <div className="text-xs text-slate-500 mb-2">
              Invitados: {meeting.attendees.join(", ") || "—"}
            </div>
            {meeting.slots.length > 0 ? (
              <div className="space-y-1 mb-3">
                {meeting.slots.map((s) => (
                  <label key={s.start} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name="slot"
                      checked={meetingSlot === s.start}
                      onChange={() => setMeetingSlot(s.start)}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-rose-500 mb-2">Sin horarios libres en los próximos 10 días.</p>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-600 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={sendInvites}
                onChange={(e) => setSendInvites(e.target.checked)}
              />
              Enviar invitación por email a los asistentes
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => createEventMut.mutate()}
                disabled={!meetingSlot || createEventMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {createEventMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                Crear evento
              </button>
              <button
                onClick={() => setMeeting(null)}
                className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
              >
                Cancelar
              </button>
            </div>
          </Panel>
        )}

        {/* T2.6 — Document generation to Drive */}
        {doc && (
          <Panel icon={<FilePlus size={14} />} tone="slate" title="Borrador de documento (Drive)">
            <input
              value={doc.title}
              onChange={(e) => setDoc({ ...doc, title: e.target.value })}
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm font-medium mb-2"
            />
            <textarea
              value={doc.content}
              onChange={(e) => setDoc({ ...doc, content: e.target.value })}
              rows={10}
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm font-mono mb-3"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => createDocMut.mutate()}
                disabled={createDocMut.isPending || !doc.content.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {createDocMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                Crear en Drive
              </button>
              <button
                onClick={() => setDoc(null)}
                className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700"
              >
                Descartar
              </button>
            </div>
          </Panel>
        )}

        {/* Sender block */}
        <div className="flex items-start gap-3 pb-4 mb-4 border-b border-slate-100">
          <div
            className={`h-10 w-10 shrink-0 rounded-full grid place-items-center text-white text-sm font-semibold ${avatarColor(
              name
            )}`}
          >
            {initials(data.from_name, data.from_address)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-800">
              {data.from_name ? `${data.from_name} ` : ""}
              <span className="text-slate-400 font-normal">&lt;{data.from_address}&gt;</span>
            </div>
            {data.to_addresses?.length > 0 && (
              <div className="text-xs text-slate-400 truncate">
                to {data.to_addresses.join(", ")}
              </div>
            )}
            <div className="text-xs text-slate-400">{fullDate(data.received_at)}</div>
          </div>
        </div>

        {/* XAI: classification */}
        {data.classification?.reasoning && (
          <Panel
            icon={<Bot size={14} />}
            tone="slate"
            title={`Why ${data.classification.category} · ${Math.round(
              (data.classification.confidence ?? 0) * 100
            )}% · ${data.classification.stage}`}
          >
            <p className="text-sm text-slate-700">{data.classification.reasoning}</p>
          </Panel>
        )}

        {/* XAI: security */}
        {data.security && data.security.risk_level !== "safe" && (
          <Panel
            icon={<ShieldAlert size={14} />}
            tone="amber"
            title={`Security: ${data.security.risk_level} (${data.security.risk_score}/100) · ${data.security.recommended_action}`}
          >
            {data.security.explanation && (
              <p className="text-sm text-amber-800 mb-1">{data.security.explanation}</p>
            )}
            {data.security.risk_factors?.length > 0 && (
              <ul className="list-disc list-inside text-sm text-amber-800">
                {data.security.risk_factors.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* Phase 2: tasks & commitments */}
        {(data.tasks.length > 0 || data.commitments.length > 0) && (
          <Panel icon={<CheckSquare size={14} />} tone="emerald" title="Action items (AION)">
            <ul className="space-y-1.5">
              {data.tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-2 text-sm">
                  <button
                    onClick={() =>
                      taskMut.mutate({ id: t.id, status: t.status === "done" ? "pending" : "done" })
                    }
                    className="mt-0.5 text-emerald-600"
                  >
                    {t.status === "done" ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                  <span className={t.status === "done" ? "line-through text-slate-400" : "text-slate-700"}>
                    {t.description}
                    {t.deadline && (
                      <span className="ml-1 text-xs text-rose-500">· {deadlineLabel(t.deadline)}</span>
                    )}
                  </span>
                </li>
              ))}
              {data.commitments.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 text-indigo-500">🤝</span>
                  <span>
                    <b>{c.who}</b>: {c.what}
                    {c.deadline && (
                      <span className="ml-1 text-xs text-rose-500">· {deadlineLabel(c.deadline)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* Attachments */}
        {data.attachments?.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {data.attachments.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
              >
                <Paperclip size={12} />
                {a.filename || `attachment-${i + 1}`}
              </span>
            ))}
          </div>
        )}

        {/* Body */}
        {sanitized ? (
          <div
            className="email-html prose prose-sm max-w-none text-slate-800"
            onClick={openLinkInWindow}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: sanitized }}
          />
        ) : (
          <div className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed">
            {data.body_text || "(empty body)"}
          </div>
        )}

        {/* Similar emails (semantic) */}
        {similar && (
          <Panel icon={<Layers size={14} />} tone="slate" title={`Emails similares (${similar.length})`}>
            {similar.length === 0 ? (
              <p className="text-sm text-slate-500">
                Sin similares aún (este correo o los relacionados pueden no estar indexados todavía).
              </p>
            ) : (
              <ul className="space-y-1">
                {similar.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => selectEmail(s.id)}
                      className="w-full text-left flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white transition"
                    >
                      {typeof s.similarity === "number" && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600">
                          {Math.round(s.similarity * 100)}%
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-800">
                          {s.subject || "(no subject)"}
                        </span>
                        <span className="block truncate text-xs text-slate-400">
                          {s.from_name || s.from_address}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {/* Composer: reply / reply-all / forward (sends via gmail.send) */}
        {compose && (
          <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-600">
                {compose.mode === "forward" ? (
                  <Forward size={14} />
                ) : compose.mode === "replyAll" ? (
                  <ReplyAll size={14} />
                ) : (
                  <Reply size={14} />
                )}
                {compose.mode === "forward"
                  ? "Reenviar"
                  : compose.mode === "replyAll"
                  ? "Responder a todos"
                  : "Responder"}
              </div>
              <button
                onClick={() => setCompose(null)}
                title="Cerrar"
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Para</label>
            <input
              value={compose.to}
              onChange={(e) => setCompose({ ...compose, to: e.target.value })}
              placeholder="correo@dominio.com, otro@dominio.com"
              className="w-full mb-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
            />

            <label className="block text-[11px] font-medium text-slate-500 mb-0.5">CC</label>
            <input
              value={compose.cc}
              onChange={(e) => setCompose({ ...compose, cc: e.target.value })}
              placeholder="(opcional)"
              className="w-full mb-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
            />

            <input
              value={compose.subject}
              onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
              className="w-full mb-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium"
            />

            <textarea
              value={compose.body}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
              rows={9}
              placeholder="Escribe tu mensaje…"
              className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm leading-relaxed resize-y"
            />

            {compose.mode === "forward" && (
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={compose.includeAttachments}
                  onChange={(e) => setCompose({ ...compose, includeAttachments: e.target.checked })}
                />
                Incluir adjuntos originales
                {data.attachments?.length ? ` (${data.attachments.length})` : ""}
              </label>
            )}

            {/* T3.2/T3.4/T3.5 — 3 opciones de estilo + XAI + idioma detectado */}
            {compose.mode !== "forward" && variants && variants.length > 0 && (
              <div className="mt-3 rounded-lg border border-indigo-100 bg-white p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 mb-2 flex-wrap">
                  <Sparkles size={12} /> Opciones IA
                  {styleMeta?.applied && (
                    <span className="rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-[9px]">
                      tu estilo · {styleMeta.samples} muestras
                    </span>
                  )}
                  {replyLang && (
                    <span className="rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[9px] uppercase">
                      responde en {replyLang}
                    </span>
                  )}
                  <button
                    onClick={() => setWhyOpen((v) => !v)}
                    className="ml-auto text-[9px] text-indigo-500 hover:text-indigo-700 underline"
                  >
                    {whyOpen ? "ocultar" : "¿Por qué?"}
                  </button>
                </div>

                {whyOpen && (
                  <div className="mb-2 rounded-md bg-slate-50 border border-slate-100 p-2 text-[10px] text-slate-600 leading-relaxed">
                    {(() => {
                      const p = (styleProfile?.profile ?? {}) as Record<string, unknown>;
                      const tones = (p.tone_descriptors as string[] | undefined)?.join(", ");
                      return (
                        <ul className="space-y-0.5">
                          <li><b>Idioma detectado del correo:</b> {replyLang?.toUpperCase() ?? "—"}</li>
                          <li><b>Estilo aprendido de:</b> {styleProfile?.sample_size ?? 0} correos enviados</li>
                          {p.formality ? <li><b>Registro:</b> {String(p.formality)}</li> : null}
                          {tones ? <li><b>Tono:</b> {tones}</li> : null}
                          {p.greeting ? <li><b>Saludo típico:</b> "{String(p.greeting)}"</li> : null}
                          {p.signoff ? <li><b>Despedida típica:</b> "{String(p.signoff)}"</li> : null}
                        </ul>
                      );
                    })()}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {variants.map((v) => (
                    <button
                      key={v.style}
                      onClick={() => applyVariant(v)}
                      title={v.body}
                      className="text-left rounded-md border border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50 px-2.5 py-2 transition"
                    >
                      <div className="text-xs font-semibold text-slate-700">{v.label}</div>
                      {v.why && <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{v.why}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* T4.2 — Drive attachment suggestions */}
            {compose.mode !== "forward" && driveOpen && (
              <div className="mt-3 rounded-lg border border-amber-100 bg-white p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 mb-2">
                  <Paperclip size={12} /> Adjuntar de Drive
                </div>
                <div className="flex gap-2">
                  <input
                    value={driveQuery}
                    onChange={(e) => setDriveQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && driveMut.mutate(driveQuery)}
                    placeholder="Buscar archivos en Drive…"
                    className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm"
                  />
                  <button
                    onClick={() => driveMut.mutate(driveQuery)}
                    disabled={driveMut.isPending}
                    className="rounded-md bg-amber-500 text-white text-xs px-3 py-1.5 hover:bg-amber-400 disabled:opacity-50"
                  >
                    {driveMut.isPending ? "…" : "Buscar"}
                  </button>
                </div>
                {driveResults && (
                  <div className="mt-2 max-h-56 overflow-y-auto divide-y divide-slate-100">
                    {driveResults.length === 0 && (
                      <div className="text-xs text-slate-400 py-2">Sin resultados.</div>
                    )}
                    {driveResults.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => insertDriveLink(f)}
                        title={`Insertar enlace a ${f.name}`}
                        className="w-full text-left flex items-center gap-2 py-1.5 hover:bg-amber-50 rounded px-1"
                      >
                        <span className="text-[9px] font-semibold uppercase text-amber-600 bg-amber-100 rounded px-1 py-0.5 shrink-0">
                          {f.kind}
                        </span>
                        <span className="flex-1 truncate text-sm text-slate-700">{f.name}</span>
                        <span className="text-[10px] text-indigo-500 shrink-0">+ insertar</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => {
                  const dest = compose.to || "(sin destinatario)";
                  if (
                    window.confirm(
                      `Se enviará como ${MAILBOX}\n\nPara: ${dest}\nAsunto: ${compose.subject}\n\n¿Enviar ahora?`
                    )
                  ) {
                    sendMut.mutate();
                  }
                }}
                disabled={sendMut.isPending || !compose.to.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 text-white text-xs px-3 py-1.5 hover:bg-indigo-500 disabled:opacity-50"
              >
                {sendMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sendMut.isPending ? "Enviando…" : "Enviar"}
              </button>

              {compose.mode !== "forward" && (
                <>
                  <button
                    onClick={() => variantsMut.mutate()}
                    disabled={variantsMut.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-white text-indigo-600 text-xs px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {variantsMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {variantsMut.isPending ? "Generando…" : "Generar opciones (IA)"}
                  </button>
                  <button
                    onClick={() => draftMut.mutate()}
                    disabled={draftMut.isPending}
                    title="Un solo borrador rápido"
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white text-slate-500 text-xs px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {draftMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    {draftMut.isPending ? "…" : "Borrador"}
                  </button>
                  <button
                    onClick={() => {
                      if (!compose.body.trim()) {
                        toast.error("Escribe o genera un mensaje primero");
                        return;
                      }
                      voiceMut.mutate();
                    }}
                    disabled={voiceMut.isPending}
                    title="Escuchar el mensaje en voz (ElevenLabs)"
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white text-slate-500 text-xs px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {voiceMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />}
                    {voiceMut.isPending ? "…" : "Escuchar"}
                  </button>
                  <button
                    onClick={() => {
                      const next = !driveOpen;
                      setDriveOpen(next);
                      // Prefill the search with subject keywords on first open.
                      if (next && driveResults === null) {
                        const seed = (compose.subject || data.subject || "")
                          .replace(/^re:\s*/i, "")
                          .slice(0, 60);
                        setDriveQuery(seed);
                        driveMut.mutate(seed);
                      }
                    }}
                    title="Sugerir archivos de Google Drive"
                    className={`inline-flex items-center gap-1.5 rounded-md border text-xs px-2.5 py-1.5 ${
                      driveOpen
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    <Paperclip size={14} /> Drive
                  </button>
                </>
              )}

              <button
                onClick={() => setCompose(null)}
                className="text-xs rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <span className="text-[11px] text-slate-400">Envía como {MAILBOX}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarBtn({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

const TONES: Record<string, string> = {
  slate: "border-slate-200 bg-slate-50",
  amber: "border-amber-200 bg-amber-50",
  emerald: "border-emerald-200 bg-emerald-50",
  indigo: "border-indigo-200 bg-indigo-50",
};

function Panel({
  icon,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone: keyof typeof TONES | string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mb-4 rounded-lg border p-3.5 ${TONES[tone] ?? TONES.slate}`}>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
