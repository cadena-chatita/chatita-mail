// Chatita Mail v3.0 - API client
import axios from "axios";
import type {
  Account,
  Commitment,
  EmailCategory,
  EmailDetail,
  EmailListItem,
  EmailStatus,
  InboxStats,
  SyncResult,
  Task,
  TaskCounts,
} from "../types";

// API base: local dev uses the Vite proxy ("/api"); prod behind nginx at
// chatita.ai/mail/ builds with VITE_API_BASE=/mail-api so calls reach the mail
// backend (not the Chatita gateway mounted at "/").
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
  timeout: 60000,
});

// ── Inbox ──────────────────────────────────────────────────
export async function listEmails(params: {
  status?: EmailStatus;
  category?: EmailCategory;
  unread_only?: boolean;
  search?: string;
  sort?: "priority" | "date";
  limit?: number;
  account_id?: string;
}): Promise<EmailListItem[]> {
  const { data } = await api.get<EmailListItem[]>("/inbox/emails", { params });
  return data;
}

export async function getEmail(id: string): Promise<EmailDetail> {
  const { data } = await api.get<EmailDetail>(`/inbox/emails/${id}`);
  return data;
}

// Semantic search (BGE-M3 embeddings + pgvector cosine). status "ALL" searches
// every folder; pass a specific EmailStatus to scope it.
export async function searchSemantic(params: {
  q: string;
  status?: EmailStatus | "ALL";
  limit?: number;
}): Promise<EmailListItem[]> {
  const { data } = await api.get<EmailListItem[]>("/inbox/search/semantic", { params });
  return data;
}

// Emails semantically similar to a given one ("find related").
export async function similarEmails(id: string, limit = 10): Promise<EmailListItem[]> {
  const { data } = await api.get<EmailListItem[]>(`/inbox/emails/${id}/similar`, {
    params: { limit },
  });
  return data;
}

export interface Analytics {
  total: number;
  received: number;
  sent: number;
  auto_handled: number;
  time_saved_minutes: number;
  time_saved_hours: number;
  actionable: number;
  reply_rate: number;
  top_senders: { sender: string; count: number }[];
  volume_by_day: { date: string; count: number }[];
  window_days: number;
}

export async function getAnalytics(days = 14): Promise<Analytics> {
  const { data } = await api.get<Analytics>(`/inbox/analytics`, { params: { days } });
  return data;
}

export async function getStats(accountId?: string): Promise<InboxStats> {
  const { data } = await api.get<InboxStats>("/inbox/stats", { params: accountId ? { account_id: accountId } : {} });
  return data;
}

export async function syncGmail(
  maxResults = 30,
  triage = true
): Promise<SyncResult> {
  const { data } = await api.post<SyncResult>("/inbox/sync/gmail", null, {
    params: { max_results: maxResults, triage },
  });
  return data;
}

export async function gmailHealth(): Promise<Record<string, unknown>> {
  const { data } = await api.get("/inbox/gmail/health");
  return data;
}

// ── Actions ────────────────────────────────────────────────
export async function setStatus(
  id: string,
  status: EmailStatus
): Promise<EmailListItem> {
  const { data } = await api.patch<EmailListItem>(`/inbox/emails/${id}/status`, {
    status,
  });
  return data;
}

export async function setRead(id: string, is_read: boolean): Promise<EmailListItem> {
  const { data } = await api.patch<EmailListItem>(`/inbox/emails/${id}/read`, {
    is_read,
  });
  return data;
}

export async function unsubscribeEmail(id: string): Promise<Record<string, unknown>> {
  const { data } = await api.post(`/inbox/emails/${id}/unsubscribe`);
  return data;
}

// ── Classification / security ──────────────────────────────
export async function triageEmail(id: string): Promise<unknown> {
  const { data } = await api.post(`/classify/${id}`);
  return data;
}

export async function reclassify(id: string, category: EmailCategory): Promise<unknown> {
  const { data } = await api.patch(`/classify/${id}/reclassify`, { category });
  return data;
}

export async function releaseFromQuarantine(id: string): Promise<unknown> {
  const { data } = await api.post(`/security/${id}/release`);
  return data;
}

// ── Phase 2: Tasks & Commitments ───────────────────────────
export async function listTasks(
  status = "pending",
  opts: { limit?: number; offset?: number; order?: "value" | "deadline" | "created" } = {},
): Promise<Task[]> {
  const { data } = await api.get<Task[]>("/tasks", { params: { status, ...opts } });
  return data;
}

export async function getTaskCounts(): Promise<TaskCounts> {
  const { data } = await api.get<TaskCounts>("/tasks/counts");
  return data;
}

export async function listCommitments(status = "pending"): Promise<Commitment[]> {
  const { data } = await api.get<Commitment[]>("/commitments", { params: { status } });
  return data;
}

export async function extractTasks(id: string): Promise<{
  source: string;
  tasks_extracted: number;
  commitments_extracted: number;
}> {
  const { data } = await api.post(`/inbox/emails/${id}/extract`);
  return data;
}

export async function updateTask(id: string, status: string): Promise<Task> {
  const { data } = await api.patch<Task>(`/tasks/${id}`, { status });
  return data;
}

// ── Phase 2: Composer (summaries + reply drafts) ───────────
export interface EmailSummary {
  tldr: string;
  key_points: string[];
  suggested_action: string;
  requires_reply: boolean;
  source: string;
}

export interface ReplyDraft {
  subject: string;
  body: string;
  tone: string;
  source: string;
  language?: string;
}

export async function summarizeEmail(id: string): Promise<EmailSummary> {
  const { data } = await api.post<EmailSummary>(`/inbox/emails/${id}/summarize`);
  return data;
}

export async function draftReply(
  id: string,
  tone = "professional",
  instructions?: string
): Promise<ReplyDraft> {
  const { data } = await api.post<ReplyDraft>(`/inbox/emails/${id}/draft-reply`, {
    tone,
    instructions,
  });
  return data;
}

// ── Phase 3 (T3.2): multi-style reply variants + XAI ───────
export interface ReplyVariant {
  style: string;
  label: string;
  subject: string;
  body: string;
  why: string;
}

export interface ReplyVariants {
  email_id: string;
  subject: string;
  variants: ReplyVariant[];
  source: string;
  language?: string;
  style_applied: boolean;
  style_samples: number;
}

export async function draftVariants(id: string): Promise<ReplyVariants> {
  const { data } = await api.post<ReplyVariants>(`/inbox/emails/${id}/draft-variants`);
  return data;
}

// ── Phase 3 (T3.3/T3.4): style profile + feedback loop ─────
export interface StyleProfileOut {
  user_key: string;
  sample_size: number;
  profile: Record<string, unknown> | null;
  updated_at?: string;
}

export async function getStyleProfile(): Promise<StyleProfileOut> {
  const { data } = await api.get<StyleProfileOut>(`/inbox/style`);
  return data;
}

export async function recordStyleFeedback(payload: {
  final_body: string;
  ai_body?: string;
  style?: string;
  email_id?: string;
}): Promise<{ edited: boolean; edit_ratio: number; relearned: boolean }> {
  const { data } = await api.post(`/inbox/style/feedback`, payload);
  return data;
}

// ── Phase 4 (T4.1): Voice replies (ElevenLabs TTS) ─────────
export async function voiceHealth(): Promise<{ enabled: boolean; voice_id: string | null }> {
  const { data } = await api.get(`/voice/health`);
  return data;
}

export async function voiceTTS(text: string): Promise<Blob> {
  const { data } = await api.post(`/voice/tts`, { text }, { responseType: "blob" });
  return data as Blob;
}

// ── Phase 4 (T4.2): Drive attachment suggestions ───────────
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  kind: string;
  link: string;
  icon?: string;
  modified?: string;
  size?: number | null;
}

export async function driveSearch(q: string, limit = 8): Promise<{ enabled: boolean; files: DriveFile[] }> {
  const { data } = await api.get(`/inbox/drive/search`, { params: { q, limit } });
  return data;
}

// ── Phase 2 (T2.2/T2.4): Calendar & meetings ───────────────
export interface CalendarSlot {
  start: string;
  end: string;
  label: string;
}

export interface MeetingDetection {
  is_meeting_request: boolean;
  topic: string;
  duration_minutes: number;
  attendees: string[];
  urgency?: string | null;
  slots: CalendarSlot[];
}

export async function detectMeeting(emailId: string): Promise<MeetingDetection> {
  const { data } = await api.post(`/inbox/emails/${emailId}/meeting/detect`);
  return data;
}

export interface CalendarEventResult {
  created: boolean;
  event: { id: string; link: string; start?: string; end?: string; invites_sent?: boolean };
}

export async function createCalendarEvent(payload: {
  summary: string;
  start: string;
  end?: string;
  duration_min?: number;
  description?: string;
  attendees?: string[];
  send_invites?: boolean;
}): Promise<CalendarEventResult> {
  const { data } = await api.post(`/inbox/calendar/events`, payload);
  return data;
}

// ── Phase 2 (T2.3): overdue commitments + follow-up ────────
export interface OverdueCommitment {
  id: string;
  who: string;
  what: string;
  deadline: string | null;
  email_id: string;
}

export async function overdueCommitments(): Promise<{ count: number; commitments: OverdueCommitment[] }> {
  const { data } = await api.get(`/inbox/commitments/overdue`);
  return data;
}

export async function followupDraft(commitmentId: string): Promise<{
  commitment_id: string;
  email_id: string;
  to: string | null;
  subject: string;
  body: string;
  language: string;
}> {
  const { data } = await api.post(`/inbox/commitments/${commitmentId}/followup-draft`);
  return data;
}

// ── Phase 2 (T2.6): document generation to Drive ───────────
export async function docDraft(
  emailId: string,
  instructions?: string
): Promise<{ title: string; content: string; language: string }> {
  const { data } = await api.post(`/inbox/emails/${emailId}/doc-draft`, { instructions });
  return data;
}

export async function createDriveDoc(
  title: string,
  content: string
): Promise<{ created: boolean; doc: { id: string; name: string; link: string } }> {
  const { data } = await api.post(`/inbox/drive/doc`, { title, content });
  return data;
}

// ── Send (reply / reply-all / forward / new) — gmail.send ──
export interface SendResult {
  sent: boolean;
  id?: string;
  threadId?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  attachments?: number;
}

export async function replyEmail(
  id: string,
  payload: { body: string; to?: string[]; cc?: string[]; subject?: string; reply_all?: boolean }
): Promise<SendResult> {
  const { data } = await api.post<SendResult>(`/inbox/emails/${id}/reply`, payload);
  return data;
}

export async function forwardEmail(
  id: string,
  payload: { to: string[]; body?: string; cc?: string[]; subject?: string; include_attachments?: boolean }
): Promise<SendResult> {
  const { data } = await api.post<SendResult>(`/inbox/emails/${id}/forward`, payload);
  return data;
}

export async function composeEmail(payload: {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  from_account_id?: string;
}): Promise<SendResult> {
  const { data } = await api.post<SendResult>("/inbox/compose", payload);
  return data;
}

// ── Accounts (settings) ────────────────────────────────────
export interface NewAccount {
  email_address: string;
  provider: Account["provider"];
  display_name?: string;
  color?: string;
  password?: string;
  imap_preset?: string;
  imap_host?: string;
  smtp_host?: string;
}

export const listAccounts = async (): Promise<Account[]> => (await api.get<Account[]>("/accounts")).data;
export const createAccount = async (b: NewAccount): Promise<Account> => (await api.post<Account>("/accounts", b)).data;
export const patchAccount = async (id: string, b: Partial<Pick<Account, "display_name" | "color" | "is_active" | "is_default">>): Promise<Account> =>
  (await api.patch<Account>(`/accounts/${id}`, b)).data;
export const deleteAccount = async (id: string, purge = false) =>
  (await api.delete(`/accounts/${id}`, { params: { purge } })).data;
export const authorizeAccount = async (id: string): Promise<{ url: string }> =>
  (await api.post(`/accounts/${id}/authorize`)).data;
export const testAccount = async (id: string): Promise<{ ok: boolean; error?: string }> =>
  (await api.post(`/accounts/${id}/test`)).data;
export const syncAccount = async (id: string) => (await api.post(`/accounts/${id}/sync`, null, { params: { max_results: 100 } })).data;
export const setAccountPassword = async (id: string, password: string) =>
  (await api.post(`/accounts/${id}/password`, { password })).data;

export interface Detection {
  domain: string;
  provider: "microsoft365" | "google" | "godaddy" | "workmail" | "icloud" | "titan" | "unknown";
  method: "password" | "oauth_microsoft" | "oauth_google";
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  evidence: string[];
}
export interface ConnectResult {
  ok: boolean;
  code: string;
  message: string;
  detection: Detection;
  tried: { imap_host: string | null; imap_port: number | null; username: string };
  imap?: { ok: boolean; code?: string; message?: string; capabilities?: string };
  smtp?: { ok: boolean; code?: string; message?: string };
  suggest?: "oauth_microsoft";
  oauth_ready?: boolean;
}
export const discoverAccount = async (email_address: string): Promise<Detection> =>
  (await api.post<Detection>("/accounts/discover", { email_address })).data;
export const connectPassword = async (
  id: string,
  b: { password: string; username?: string; imap_host?: string; imap_port?: number; smtp_host?: string; smtp_port?: number }
): Promise<ConnectResult> => (await api.post<ConnectResult>(`/accounts/${id}/connect-password`, b)).data;

// ── AION Agent (what's next, agenda, cases, search, orders) ──
export interface CaseChip { code: string; title: string | null; color?: string; inferred?: boolean }
export interface AgentSource { kind: "full" | "light" | "local" | "none"; age_s: number | null }
export interface TodayItem {
  kind: "task" | "commitment" | "event"; id: string; title: string; when: string | null;
  urgency: "overdue" | "today" | "soon" | "week" | "later" | "open"; email_id: string | null;
  email_subject: string | null; email_from: string | null; email_received_at?: string | null; email_excerpt?: string | null; cases: CaseChip[];
  case_latest?: { channel: string; at: string | null; summary: string } | null; why: string; action: string; suggestion?: string;
}
export interface TodayOut {
  generated_at: string; source: AgentSource; summary: Record<string, number>;
  sections: { key: string; title: string; items: TodayItem[] }[];
}
export interface AgendaEvent { id: string; calendar: string | null; title: string; start: string | null; end: string | null; all_day: boolean; location: string | null; attendees: number; cases: CaseChip[] }
export interface CaseRow { code: string; title: string | null; kind: string | null; groups: number; mail: number; events: number; proposals: number; color?: string; last_activity?: string | null }
export interface OpenItem { kind: "task" | "commitment"; id: string; title: string; when: string | null; email_id: string; email_subject: string | null }
export interface CaseDetail {
  code: string; title: string | null; kind: string | null; color?: string; keywords: string[]; organizations: string[]; groups: string[];
  timeline: { channel: string; at: string | null; summary: string | null }[]; source: AgentSource;
  upcoming_events?: { title: string; at: string | null; calendar: string | null }[]; activity_30d?: Record<string, number>; open_items?: OpenItem[];
}
export interface SearchHit { kind: string; at: string | null; where: string | null; title: string; snippet: string }
export interface EmailContext { subject: string | null; from: string | null; from_address?: string | null; received_at: string | null; excerpt?: string; cases: CaseChip[] }

export const getAgentStatus = async () => (await api.get<{ available: boolean; source: AgentSource; counts?: Record<string, number>; has_search?: boolean; message?: string }>("/agent/status")).data;
export const getAgentToday = async () => (await api.get<TodayOut>("/agent/today")).data;
export const getAgentAgenda = async (days = 14) => (await api.get<{ source: AgentSource; days: { date: string; events: AgendaEvent[] }[] }>("/agent/agenda", { params: { days } })).data;
export const getAgentCases = async () => (await api.get<{ source: AgentSource; cases: CaseRow[] }>("/agent/cases")).data;
export const getAgentCase = async (code: string) => (await api.get<CaseDetail>(`/agent/cases/${encodeURIComponent(code)}`)).data;
export interface CaseBriefOut { case_code: string; brief_md: string; model: string | null; items_used: number; generated_at: string | null }
export const getCaseBrief = async (code: string) => (await api.get<CaseBriefOut>(`/agent/cases/${encodeURIComponent(code)}/brief`)).data;
export const refreshCaseBrief = async (code: string) => (await api.post<CaseBriefOut>(`/agent/cases/${encodeURIComponent(code)}/brief`)).data;
export const agentSearch = async (q: string) => (await api.get<{ source: AgentSource; results: SearchHit[]; message?: string }>("/agent/search", { params: { q } })).data;
export const agentCommand = async (text: string) => (await api.post<{ reply: string; source?: string }>("/agent/command", { text, session: "mail-ui" })).data;
export const getEmailContext = async (ids: string[]) =>
  ids.length ? (await api.get<{ items: Record<string, EmailContext> }>("/agent/email-context", { params: { ids: ids.join(",") } })).data.items : {};

// ── Calendar ──
export interface CalAttendee { email: string | null; name: string | null; status: string; self?: boolean; organizer?: boolean }
export interface CalEvent {
  id: string; source: "aion" | "google"; calendar_id: string | null; event_id: string; calendar: string | null; calendar_color: string; title: string;
  start: string | null; end: string | null; all_day: boolean; location: string | null; description: string; attendees: CalAttendee[];
  meet_url: string | null; zoom_url: string | null; cases: CaseChip[]; editable: boolean; html_link?: string;
}
export interface CalCalendar { id: string; name: string; color: string; source: "aion" | "google"; writable: boolean; count?: number; primary?: boolean; also_in_aion?: boolean }
export interface CalEventInput {
  summary: string; start: string; end: string; all_day: boolean; timezone: string; calendar_id: string; location?: string; description?: string;
  attendees: string[]; send_invites: boolean; conference: "none" | "meet" | "zoom"; case_code?: string | null; reminders?: number[] | null;
}
export const getCalendars = async () => (await api.get<{ source: AgentSource; google_error: string | null; zoom: boolean; calendars: CalCalendar[] }>("/agent/calendar/calendars")).data;
export const getCalendarEvents = async (start: string, end: string) => (await api.get<{ source: AgentSource; google_error: string | null; count: number; events: CalEvent[] }>("/agent/calendar/events", { params: { start, end } })).data;
export const createFullCalendarEvent = async (b: CalEventInput) => (await api.post<{ created: boolean; invitations_sent: boolean; event: CalEvent }>("/agent/calendar/events", b)).data;
export const updateCalendarEvent = async (cal: string, id: string, b: Partial<CalEventInput> & { add_meet?: boolean }) => (await api.patch<{ updated: boolean; event: CalEvent }>(`/agent/calendar/events/${encodeURIComponent(cal)}/${encodeURIComponent(id)}`, b)).data;
export const deleteCalendarEvent = async (cal: string, id: string) => (await api.delete(`/agent/calendar/events/${encodeURIComponent(cal)}/${encodeURIComponent(id)}`)).data;
export const getFreeSlots = async (duration: number, days = 7) => (await api.get<{ slots: { start: string; end: string; label: string }[] }>("/agent/calendar/free-slots", { params: { duration, days } })).data.slots;

export default api;
