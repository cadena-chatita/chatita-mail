import { expect, test, type Page } from "@playwright/test";
import { mockApi, task } from "./fixtures";

const open = async (page: Page, label: string | RegExp) => { await page.getByRole("button", { name: label }).first().click(); };

test.describe("AION Agent dentro de Chatita Mail", () => {
  test("una pestaña vieja avisa que hay versión nueva, y la pantalla muestra su versión", async ({ page }) => {
    await mockApi(page);
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {      // the dev server has no hashed bundle: simulate the one a deployed build has
      const s = document.createElement("script"); s.type = "text/plain"; s.src = "/mail/assets/index-VIEJO000.js"; document.head.appendChild(s);
    }));
    await page.goto("./");
    await expect(page.getByTestId("build-id")).toContainText("versión");
    await expect(page.getByTestId("new-version")).toHaveCount(0);
    await page.route("**/index.html**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: '<script type="module" src="/mail/assets/index-NUEVO123.js"></script>' }));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByTestId("new-version")).toBeVisible();
    await expect(page.getByRole("button", { name: "Actualizar" })).toBeVisible();
  });

  test("un enlace con # abre directo la vista pedida (así lo usa el menú de Chatita Workspace) y reacciona a cambios del #", async ({ page }) => {
    await mockApi(page);
    await page.goto("./#agent_calendar");
    await expect(page.getByTestId("agent-calendar")).toBeVisible();
    await page.evaluate(() => { location.hash = "agent_cases"; });
    await expect(page.getByTestId("agent-cases")).toBeVisible();
    await page.getByRole("button", { name: /^Tareas/ }).first().click();
    expect(await page.evaluate(() => location.hash)).toBe("#tasks");
  });

  test("la barra lateral junta lo de uso diario en AION Agent y pliega lo demás", async ({ page }) => {
    await mockApi(page);
    await page.goto("./");
    await expect(page.getByText("AION Agent", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Críticos" })).toHaveCount(0);                       // folded away until opened
    await page.getByRole("button", { name: /Correo por prioridad/ }).click();
    await expect(page.getByRole("button", { name: /^Críticos/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /^Críticos/ })).toBeVisible();                       // the choice is remembered
    for (const l of ["Hoy", "Calendario", "Correo", "Tareas", "Compromisos", "Casos", "Buscar en todo", "Órdenes a Chatita"]) await expect(page.getByRole("button", { name: new RegExp(`^${l}`) }).first()).toBeVisible();
  });

  test("Hoy: qué sigue agrupa por urgencia, muestra caso y correo de origen, y abre el correo", async ({ page }) => {
    await mockApi(page);
    await page.goto("./");
    await open(page, /^Hoy/);
    await expect(page.getByRole("heading", { name: /Vencido · 1/ })).toBeVisible();
    await expect(page.getByTestId("today-item")).toHaveCount(4);
    const first = page.getByTestId("today-item").first();
    await expect(first.getByRole("button", { name: "HMG" })).toBeVisible();
    await expect(first).toContainText("Correo de origen");
    await expect(first).toContainText("Ana Prueba");
    await expect(first).toContainText("Adjunto la propuesta con el monto");                    // excerpt, without opening the mail
    await expect(first).toContainText("Siguiente paso: Revisar el monto y registrar el pago");
    await expect(first).toContainText("Lo último en HMG");
    await expect(first).toContainText("sin cortarse ni encimarse");                           // long titles wrap, never truncated
    await first.getByRole("button", { name: "Ver correo" }).click();
    await expect(page.getByTestId("reading-pane").getByText(/Párrafo 1 del correo/)).toBeVisible();
    await page.getByRole("button", { name: /cerrar correo/i }).click();
    await expect(page.getByTestId("reading-pane")).toBeHidden();
  });

  test("Redactar respuesta abre el correo con el editor ya abierto y a la vista", async ({ page }) => {
    await mockApi(page, { paragraphs: 90 });
    await page.goto("./");
    await open(page, /^Hoy/);
    await page.getByRole("button", { name: "Redactar respuesta" }).first().click();
    await expect(page.getByTestId("composer")).toBeVisible();
    await expect(page.getByTestId("composer")).toBeInViewport({ ratio: 0.4 });
  });

  test("el chip del caso lleva al caso con su línea de tiempo", async ({ page }) => {
    await mockApi(page);
    await page.goto("./");
    await open(page, /^Hoy/);
    await page.getByTestId("today-item").first().getByRole("button", { name: "HMG" }).click();
    await expect(page.getByTestId("agent-cases")).toBeVisible();
    await expect(page.getByText("Honorarios del dictamen")).toBeVisible();
    await expect(page.locator("p", { hasText: "Palabras clave:" })).toContainText("HSAI");
  });

  test("Buscar en todo y Órdenes devuelven resultados", async ({ page }) => {
    await mockApi(page);
    await page.goto("./");
    await open(page, "Buscar en todo");
    await page.getByLabel("Buscar", { exact: true }).fill("dictamen");
    await page.getByRole("button", { name: "Buscar" }).last().click();
    await expect(page.getByTestId("search-hit")).toContainText("Revisar el dictamen pericial");
    await open(page, "Órdenes a Chatita");
    await page.getByLabel("Orden").fill("agrega palabra clave Querétaro al caso HMG");
    await page.getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByTestId("order-reply")).toContainText("Anotado: agregar Querétaro");
  });

  test("Compromisos: ver correo abre el correo de origen y muestra caso y remitente", async ({ page }) => {
    await mockApi(page, { commitments: [{ id: "c1", email_id: "e-long", who: "me", what: "Enviar el dictamen firmado", deadline: new Date(Date.now() + 86400_000).toISOString(), status: "pending" }] });
    await page.goto("./");
    await open(page, /^Compromisos/);
    await expect(page.getByText("Enviar el dictamen firmado")).toBeVisible();
    await expect(page.getByRole("button", { name: "HMG" })).toBeVisible();
    await page.getByTestId("commitment-open-email").click();
    await expect(page.getByTestId("reading-pane").getByText(/Párrafo 1 del correo/)).toBeVisible();
  });

  test("Tareas muestran caso, correo de origen y botones visibles; una fecha lejana no se pinta de rojo", async ({ page }) => {
    const far = new Date(Date.now() + 30 * 86400_000).toISOString();
    await mockApi(page, { tasks: [task("t1", "e-long", "Actualizar el método de pago", { deadline: far, task_type: "payment" }), task("t2", "e-long", "Informar al proveedor que el pago está completo", { deadline: null, task_type: "reply" })] });
    await page.goto("./");
    await open(page, /^Tareas/);
    await expect(page.getByTestId("source-line").first()).toContainText("Ana Prueba");
    await expect(page.getByRole("button", { name: "HMG" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver correo" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Redactar respuesta" })).toHaveCount(1);
    const chip = page.locator("span", { hasText: /dentro de|en \d+ días|en un mes|en \d+ mes/ }).first();
    await expect(chip).not.toHaveClass(/rose/);
  });
});
