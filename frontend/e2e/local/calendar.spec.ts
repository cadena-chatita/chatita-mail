import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures";

const goCalendar = async (page: Page, opts = {}) => {
  const api = await mockApi(page, opts);
  await page.goto("./");
  await page.getByRole("button", { name: /^Calendario/ }).first().click();
  return api;
};

test.describe("Calendario completo", () => {
  test("ofrece las cuatro vistas y recuerda la elegida", async ({ page }) => {
    await goCalendar(page);
    for (const v of ["Mes", "Semana", "Día", "Agenda"]) await expect(page.getByRole("tab", { name: v })).toBeVisible();
    await page.getByRole("tab", { name: "Mes" }).click();
    await expect(page.getByTestId("cal-month")).toBeVisible();
    await page.getByRole("tab", { name: "Día" }).click();
    await expect(page.getByTestId("cal-day")).toBeVisible();
    await page.getByRole("tab", { name: "Semana" }).click();
    await expect(page.getByTestId("cal-week")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /^Calendario/ }).first().click();
    await expect(page.getByTestId("cal-week")).toBeVisible();
  });

  test("los eventos con caso se pintan con el color del caso y los demás con el de su calendario", async ({ page }) => {
    await goCalendar(page);
    await page.getByRole("tab", { name: "Agenda" }).click();
    const caseEv = page.getByTestId("cal-event").filter({ hasText: "Junta del caso HMG" });
    await expect(caseEv).toHaveCSS("border-left-color", "rgb(79, 70, 229)");             // #4f46e5, the case color
    await expect(caseEv).toContainText("HMG");
    await expect(page.getByTestId("cal-event").filter({ hasText: "Comida familiar" })).toHaveCSS("border-left-color", "rgb(142, 36, 170)");   // calendar color
    await expect(page.getByTestId("cal-event").filter({ hasText: "Viaje a Querétaro" })).toContainText("QRO ~");                              // inferred case is flagged
    await page.getByLabel("Colorear por").selectOption("calendar");
    await expect(caseEv).toHaveCSS("border-left-color", "rgb(11, 128, 67)");
  });

  test("se puede filtrar por calendario, por caso y buscar", async ({ page }) => {
    await goCalendar(page);
    await page.getByRole("tab", { name: "Agenda" }).click();
    await page.getByRole("checkbox", { name: /Personal/ }).uncheck();
    await expect(page.getByText("Comida familiar")).toHaveCount(0);
    await page.getByRole("button", { name: /^HMG/ }).first().click();
    await expect(page.getByTestId("cal-event")).toHaveCount(1);
    await page.getByRole("button", { name: /^HMG/ }).first().click();
    await page.getByLabel("Buscar eventos").fill("proveedor");
    await expect(page.getByTestId("cal-event")).toHaveCount(1);
  });

  test("el detalle muestra cómo unirse, los invitados con su respuesta y el caso", async ({ page }) => {
    await goCalendar(page);
    await page.getByRole("tab", { name: "Agenda" }).click();
    await page.getByTestId("cal-event").filter({ hasText: "Junta del caso HMG" }).click();
    const d = page.getByTestId("cal-detail");
    await expect(d.getByRole("link", { name: /Unirse con Google Meet/ })).toHaveAttribute("href", "https://meet.google.com/abc-defg-hij");
    await expect(d).toContainText("Aceptó");
    await expect(d).toContainText("Pendiente");
    await expect(d).toContainText("Sala de juntas, Torre Norte");
    await expect(d.getByRole("link", { name: "https://us02web.zoom.us/j/123" })).toBeVisible();                // links in the description are clickable
    await expect(d.getByRole("button", { name: /HMG/ })).toBeVisible();
    await expect(d).toContainText("Honorarios del dictamen");                                           // what is happening in the case
    await d.getByRole("button", { name: "Cerrar detalle" }).click();
    await page.getByTestId("cal-event").filter({ hasText: "Comida familiar" }).click();
    await expect(page.getByTestId("cal-detail")).toContainText("Solo lectura");
    await expect(page.getByRole("button", { name: "Eliminar" })).toHaveCount(0);
  });

  test("crear un evento con Google Meet e invitados no envía invitaciones salvo que se marque", async ({ page }) => {
    const api = await goCalendar(page);
    await page.getByRole("button", { name: "Crear", exact: true }).first().click();
    await page.getByLabel("Título").fill("Reunión de seguimiento");
    await page.getByRole("radio", { name: "Google Meet" }).check();
    await page.getByLabel("Invitados").fill("ana@alfa.example, luis@beta.example");
    await page.getByRole("dialog").locator('select[aria-label="Caso"]').selectOption("HMG");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Evento guardado", { exact: true })).toBeVisible();
    const post = api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/agent/calendar/events")).at(-1)!.body as Record<string, unknown>;
    expect(post).toMatchObject({ summary: "Reunión de seguimiento", conference: "meet", send_invites: false, case_code: "HMG", attendees: ["ana@alfa.example", "luis@beta.example"] });
    await page.getByRole("button", { name: "Crear", exact: true }).first().click();
    await page.getByLabel("Título").fill("Con aviso");
    await page.getByLabel("Invitados").fill("ana@alfa.example");
    await page.getByRole("checkbox", { name: /Enviar invitación por correo/ }).check();
    await page.getByRole("radio", { name: "Zoom" }).check();
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Evento guardado e invitaciones enviadas")).toBeVisible();
    expect(api.calls.filter((c) => c.method === "POST" && c.path.endsWith("/agent/calendar/events")).at(-1)!.body).toMatchObject({ send_invites: true, conference: "zoom" });
  });

  test("valida correos y no deja guardar sin título", async ({ page }) => {
    await goCalendar(page);
    await page.getByRole("button", { name: "Crear", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await page.getByLabel("Título").fill("X");
    await page.getByLabel("Invitados").fill("no-es-correo");
    await expect(page.getByText(/no parece un correo válido/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  test("eliminar pide confirmación y borra solo eventos editables", async ({ page }) => {
    const api = await goCalendar(page);
    await page.getByRole("tab", { name: "Agenda" }).click();
    await page.getByTestId("cal-event").filter({ hasText: "Llamada con proveedor" }).click();
    await page.getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Llamada con proveedor");
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    await page.getByRole("alertdialog").getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByText("Evento eliminado")).toBeVisible();
    expect(api.calls.some((c) => c.method === "DELETE" && c.path.includes("primary%40x"))).toBe(true);
  });

  test("en la vista de semana los eventos que se traslapan quedan lado a lado, sin encimarse", async ({ page }) => {
    await goCalendar(page);
    await page.getByRole("tab", { name: "Día" }).click();
    const a = await page.getByTestId("cal-event").filter({ hasText: "Junta del caso HMG" }).boundingBox();
    const b = await page.getByTestId("cal-event").filter({ hasText: "Llamada con proveedor" }).boundingBox();
    expect(a && b && (a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1)).toBe(true);
  });

  test("el calendario también funciona en el teléfono: vista de agenda por defecto y crear a mano", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await mockApi(page);
    await page.goto("./");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: /^Calendario/ }).first().click();
    await expect(page.getByTestId("cal-agenda")).toBeVisible();
    await page.getByRole("button", { name: "Crear", exact: true }).first().click();
    await expect(page.getByRole("dialog", { name: "Crear evento" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
