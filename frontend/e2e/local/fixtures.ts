// FICTITIOUS data only (this repository is public). Shapes mirror the real API.
import type { Page } from "@playwright/test";

export const ACCOUNT = { id: "acc-1", provider: "gmail", email_address: "demo@example.test", display_name: "Demo", color: "#6366f1", auth_type: "oauth", status: "connected",
  is_active: true, is_default: true, last_sync_at: "2026-10-21T12:00:00Z", last_error: null, email_count: 2, unread_count: 1, oauth_ready: true };

export function emailItem(id: string, subject: string) {
  return { id, account_id: ACCOUNT.id, from_address: "ana@example.test", from_name: "Ana Prueba", subject, snippet: "Resumen corto", status: "INBOX", is_read: false,
    received_at: "2026-10-21T10:00:00Z", thread_id: `t-${id}`, has_html: true, has_attachments: false, category: "IMPORTANT", confidence: 0.9, is_newsletter: false,
    unsubscribe_url: null, risk_level: "safe", risk_score: 0.01 };
}

export function emailDetail(id: string, subject: string, paragraphs = 3) {
  const body = Array.from({ length: paragraphs }, (_, i) => `<p>Párrafo ${i + 1} del correo de prueba ${id}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>`).join("");
  return { id, from_address: "ana@example.test", from_name: "Ana Prueba", to_addresses: ["demo@example.test"], cc_addresses: ["otra@example.test"], subject,
    body_text: "texto", body_html: body, snippet: "Resumen corto", attachments: [], status: "INBOX", is_read: false, thread_id: `t-${id}`, received_at: "2026-10-21T10:00:00Z",
    classification: { category: "IMPORTANT", confidence: 0.9, stage: "llm", reasoning: "demo", is_newsletter: false, unsubscribe_url: null },
    security: { risk_score: 0.01, risk_level: "safe", explanation: "", risk_factors: [], recommended_action: "none" }, tasks: [], commitments: [] };
}

export function task(id: string, emailId: string, description: string, over: Record<string, unknown> = {}) {
  return { id, email_id: emailId, description, task_type: "payment", priority: "high", deadline: "2026-10-23T18:00:00Z", status: "pending",
    created_at: "2026-10-21T10:00:00Z", completed_at: null, closed_via: null, ...over };
}

export const CASE = { code: "HMG", title: "Hospital HMG", color: "#4f46e5" };
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

export function todayPayload() {
  const item = (kind: string, id: string, title: string, when: string | null, urgency: string, extra: Record<string, unknown> = {}) => ({
    kind, id, title, when, urgency, email_id: kind === "event" ? null : "e-long", email_subject: "Propuesta con plazo (correo largo)", email_from: "Ana Prueba",
    email_received_at: inHours(-30), email_excerpt: "Adjunto la propuesta con el monto y el plazo de pago acordado para el pedido.",
    case_latest: { channel: "whatsapp", at: inHours(-20), summary: "Quedamos en revisar el dictamen mañana" }, suggestion: kind === "event" ? "Preparar: revisa lo último del caso HMG" : "Revisar el monto y registrar el pago",
    cases: [CASE], why: kind === "event" ? "Evento de Work con 2 invitado(s)" : "Tarea abierta con plazo · prioridad high", action: kind === "event" ? "agenda" : "open_email", ...extra });
  return { generated_at: new Date().toISOString(), source: { kind: "full", age_s: 120 },
    summary: { total: 4, overdue: 1, today: 1, soon: 1, week: 0, later: 0, open: 1, proposals: 3 },
    sections: [
      { key: "overdue", title: "Vencido", items: [item("task", "t1", "Pagar el pedido 123 con un texto muy largo que debe verse completo sin cortarse ni encimarse con los botones de la derecha", inHours(-30), "overdue")] },
      { key: "today", title: "Hoy", items: [item("task", "t2", "Responder a Ana sobre los honorarios", inHours(5), "today", { action: "reply" })] },
      { key: "soon", title: "Próximas 72 horas", items: [item("event", "ev1", "Junta del caso HMG", inHours(30), "soon")] },
      { key: "open", title: "Abierto, sin plazo", items: [item("commitment", "c1", "Tú: Enviar el dictamen", null, "open")] },
    ] };
}

function at(h: number, m = 0, plusDays = 0) { const d = new Date(); d.setDate(d.getDate() + plusDays); d.setHours(h, m, 0, 0); return d; }
export function calEvents() {
  const ev = (id: string, title: string, s: Date, e: Date, extra: Record<string, unknown> = {}) => ({ id, source: "google", calendar_id: "primary@x", event_id: id, calendar: "Trabajo", calendar_color: "#0b8043", title, start: s.toISOString(), end: e.toISOString(),
    all_day: false, location: null, description: "", attendees: [], meet_url: null, zoom_url: null, cases: [], editable: true, ...extra });
  return [
    ev("e1", "Junta del caso HMG", at(10), at(11), { cases: [CASE], meet_url: "https://meet.google.com/abc-defg-hij", location: "Sala de juntas, Torre Norte", attendees: [{ email: "ana@alfa.example", name: "Ana", status: "accepted" }, { email: "luis@beta.example", name: null, status: "pending" }], description: "Revisar el dictamen. Zoom alterno: https://us02web.zoom.us/j/123" }),
    ev("e2", "Llamada con proveedor", at(10, 30), at(11, 30), { zoom_url: "https://us02web.zoom.us/j/555" }),
    ev("e3", "Comida familiar", at(14), at(15), { calendar: "Personal", calendar_color: "#8e24aa", source: "aion", editable: false }),
    ev("e4", "Viaje a Querétaro", at(0), at(0, 0, 1), { all_day: true, cases: [{ code: "QRO", title: "Querétaro", color: "#059669", inferred: true }] }),
  ];
}

export interface MockOpts { paragraphs?: number; tasks?: ReturnType<typeof task>[]; commitments?: { id: string; email_id: string; who: string; what: string; deadline: string | null; status: string }[] }

/** Mocks every /api call. Returns the list of calls nobody handled, so tests can fail on surprises. */
export async function mockApi(page: Page, opts: MockOpts = {}) {
  const unhandled: string[] = [];
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const emails = { "e-long": "Propuesta con plazo (correo largo)", "e-two": "Segundo correo" };
  const tasks = opts.tasks ?? [];
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const method = req.method();
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    calls.push({ method, path, body: req.postData() ? JSON.parse(req.postData() as string) : undefined });
    if (method === "GET" && path === "/accounts") return json([ACCOUNT]);
    if (method === "GET" && path === "/inbox/stats") return json({ total: 2, unread: 1, by_status: { INBOX: 2 }, by_category: { IMPORTANT: 2 }, open_tasks: tasks.length, open_commitments: 0, time_saved_minutes: 0 });
    if (method === "GET" && path === "/inbox/emails") return json(Object.entries(emails).map(([id, s]) => emailItem(id, s)));
    const m = path.match(/^\/inbox\/emails\/([^/]+)$/);
    if (method === "GET" && m && (emails as Record<string, string>)[m[1]]) return json(emailDetail(m[1], (emails as Record<string, string>)[m[1]], m[1] === "e-long" ? (opts.paragraphs ?? 80) : 3));
    if (method === "GET" && path === "/tasks/counts") return json({ pending: tasks.length, done: 0, dismissed: 0, overdue: 0, today: 0, week: tasks.length, no_date: 0 });
    if (method === "GET" && path === "/tasks") return json(tasks);
    if (method === "PATCH" && path.startsWith("/tasks/")) return json({ ...tasks.find((t) => path.endsWith(t.id)), ...(JSON.parse(req.postData() || "{}")) });
    if (method === "GET" && path === "/commitments") return json(opts.commitments ?? []);
    if (method === "GET" && path === "/agent/today") return json(todayPayload());
    if (method === "GET" && path === "/agent/status") return json({ available: true, source: { kind: "full", age_s: 60 }, has_search: true });
    if (method === "GET" && path === "/agent/email-context") {
      const ids = (new URL(req.url()).searchParams.get("ids") ?? "").split(",").filter(Boolean);
      return json({ items: Object.fromEntries(ids.map((i) => [i, { subject: "Propuesta con plazo (correo largo)", from: "Ana Prueba", received_at: inHours(-5), excerpt: "Adjunto la propuesta con el monto y el plazo de pago acordado.", cases: [CASE] }])) });
    }
    if (method === "GET" && path === "/agent/calendar/calendars") return json({ source: { kind: "full", age_s: 60 }, google_error: null, zoom: true, calendars: [
      { id: "primary@x", name: "Trabajo", color: "#0b8043", source: "google", writable: true, primary: true }, { id: "aion:Personal", name: "Personal", color: "#8e24aa", source: "aion", writable: false, count: 42 }] });
    if (method === "GET" && path === "/agent/calendar/events") return json({ source: { kind: "full", age_s: 60 }, google_error: null, count: 4, events: calEvents() });
    if (method === "GET" && path === "/agent/calendar/free-slots") return json({ slots: [{ start: inHours(24), end: inHours(25), label: "mañana 10:00" }] });
    if (method === "POST" && path === "/agent/calendar/events") return json({ created: true, invitations_sent: !!(req.postDataJSON() as { send_invites?: boolean }).send_invites, event: { ...calEvents()[0], title: (req.postDataJSON() as { summary: string }).summary } });
    if (method === "DELETE" && path.startsWith("/agent/calendar/events/")) return json({ deleted: true });
    if (method === "GET" && path === "/agent/cases") return json({ source: { kind: "full", age_s: 60 }, cases: [{ ...CASE, kind: "matter", groups: 3, mail: 297, events: 121, proposals: 8 }, { code: "CORPORATIVO-CADENA", title: "Corporativo familia Cadena y empresas del grupo", kind: "project", groups: 5, mail: 312, events: 10, proposals: 0 }] });
    if (method === "GET" && path === "/agent/cases/HMG") return json({ source: { kind: "full", age_s: 60 }, ...CASE, kind: "matter", keywords: ["HMG", "HSAI"], organizations: ["CDA Abogados"], groups: ["HMG - Penal", "HMG Operación"],
      timeline: [{ channel: "mail", at: inHours(-48), summary: "Honorarios del dictamen" }, { channel: "whatsapp", at: inHours(-50), summary: "Nos reunimos mañana para revisar el dictamen pericial" }] });
    if (method === "GET" && path === "/agent/search") return json({ source: { kind: "full", age_s: 60 }, results: [{ kind: "whatsapp", at: inHours(-100), where: "HMG - Penal", title: "", snippet: "Revisar el dictamen pericial antes del viernes" }] });
    if (method === "POST" && path === "/agent/command") return json({ ok: true, reply: "Anotado: agregar Querétaro (caso HMG). Se aplicará en cuanto tu equipo esté en línea.", source: "replica" });
    if (method === "POST" && /\/reply$/.test(path)) return json({ ok: true, id: "sent-1" });
    unhandled.push(`${method} ${path}`);
    return json(method === "GET" ? [] : {});
  });
  return { unhandled, calls };
}
