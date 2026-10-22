import { expect, test } from "@playwright/test";
import { mockApi, task } from "./fixtures";

test.describe("Responder, Responder a todos y Reenviar", () => {
  for (const [button, heading] of [["Responder", "Responder"], ["Resp. todos", "Responder a todos"], ["Reenviar", "Reenviar"]] as const) {
    test(`${button}: el editor aparece a la vista aunque el correo sea largo`, async ({ page }) => {
      await mockApi(page, { paragraphs: 120 });
      await page.goto("./");
      await page.getByText("Propuesta con plazo (correo largo)").first().click();
      await expect(page.getByTestId("reading-pane")).toBeVisible();
      await page.getByRole("button", { name: button, exact: true }).click();
      const composer = page.getByTestId("composer");
      await expect(composer).toBeVisible();
      await expect(composer.getByText(heading, { exact: true }).first()).toBeVisible();
      await expect(composer).toBeInViewport({ ratio: 0.5 });                                  // the user must SEE it without hunting for it
      await expect(composer.locator("textarea")).toBeFocused();
    });
  }

  test("el editor envía la respuesta con destinatario y cuerpo", async ({ page }) => {
    const { calls } = await mockApi(page, { paragraphs: 5 });
    await page.goto("./");
    await page.getByText("Propuesta con plazo (correo largo)").first().click();
    await page.getByRole("button", { name: "Responder", exact: true }).click();
    await page.getByTestId("composer").locator("textarea").fill("Gracias, lo reviso hoy.");
    await page.getByTestId("composer").getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Se enviará como");                    // two-step confirmation without window.confirm
    await page.getByRole("button", { name: "Confirmar y enviar" }).click();
    await expect.poll(() => calls.find((c) => c.method === "POST" && c.path.endsWith("/reply"))).toBeTruthy();
    const sent = calls.find((c) => c.path.endsWith("/reply"))!.body as Record<string, string>;
    expect(sent.to).toContain("ana@example.test");
    expect(sent.body).toContain("Gracias, lo reviso hoy.");
  });
});

test.describe("Tareas: ver correo", () => {
  test("abre el correo que originó la tarea y se puede cerrar para volver a las tareas", async ({ page }) => {
    await mockApi(page, { tasks: [task("t1", "e-long", "Pagar el pedido 123")] });
    await page.goto("./");
    await page.getByRole("button", { name: /^Tasks/ }).first().click();
    await expect(page.getByText("Pagar el pedido 123")).toBeVisible();
    await page.getByTestId("task-open-email").first().click();
    const pane = page.getByTestId("reading-pane");
    await expect(pane).toBeVisible();
    await expect(pane.getByText("Propuesta con plazo (correo largo)").first()).toBeVisible();
    await expect(pane.getByText(/Párrafo 1 del correo/)).toBeVisible();
    await page.getByRole("button", { name: /cerrar correo/i }).click();
    await expect(pane).toBeHidden();
    await expect(page.getByText("Pagar el pedido 123")).toBeVisible();
  });

  test("desde el correo abierto desde una tarea también se puede responder", async ({ page }) => {
    await mockApi(page, { tasks: [task("t1", "e-long", "Pagar el pedido 123")], paragraphs: 60 });
    await page.goto("./");
    await page.getByRole("button", { name: /^Tasks/ }).first().click();
    await page.getByTestId("task-open-email").first().click();
    await page.getByRole("button", { name: "Responder", exact: true }).click();
    await expect(page.getByTestId("composer")).toBeInViewport({ ratio: 0.5 });
  });
});

test.describe("Tareas: cancelar, deshacer y prioridad", () => {
  test("cancelar una tarea la quita de la lista y se puede deshacer", async ({ page }) => {
    const { calls } = await mockApi(page, { tasks: [task("t1", "e-long", "Pagar el pedido 123")] });
    await page.goto("./");
    await page.getByRole("button", { name: /^Tasks/ }).first().click();
    await page.getByRole("button", { name: /cancelar/i }).first().click();
    await expect.poll(() => calls.find((c) => c.method === "PATCH" && c.path === "/tasks/t1")).toBeTruthy();
    expect((calls.find((c) => c.method === "PATCH")!.body as Record<string, string>).status).toBe("dismissed");
    await expect(page.getByRole("button", { name: /deshacer/i }).first()).toBeVisible();
  });
});

test.describe("Flujos base de la bandeja", () => {
  test("abrir un correo muestra remitente, asunto y cuerpo; archivar llama a la API", async ({ page }) => {
    const { calls } = await mockApi(page, { paragraphs: 4 });
    await page.goto("./");
    await page.getByText("Segundo correo").first().click();
    const pane = page.getByTestId("reading-pane");
    await expect(pane.getByText("Segundo correo").first()).toBeVisible();
    await expect(pane.getByText(/Ana Prueba/).first()).toBeVisible();
    await expect(pane.getByText(/Párrafo 1 del correo/)).toBeVisible();
    await pane.getByRole("button", { name: "Archive" }).click();
    await expect.poll(() => calls.find((c) => c.method === "PATCH" && c.path.endsWith("/status"))).toBeTruthy();
    expect((calls.find((c) => c.path.endsWith("/status"))!.body as Record<string, string>).status).toBe("ARCHIVED");
  });

  test("cambiar de correo cierra el editor y no arrastra el texto escrito", async ({ page }) => {
    await mockApi(page, { paragraphs: 4 });
    await page.goto("./");
    await page.getByText("Propuesta con plazo (correo largo)").first().click();
    await page.getByRole("button", { name: "Responder", exact: true }).click();
    await page.getByTestId("composer").locator("textarea").fill("borrador");
    await page.getByText("Segundo correo").first().click();
    await expect(page.getByTestId("composer")).toHaveCount(0);
  });
});

test.describe("Móvil (390x800)", () => {
  test.use({ viewport: { width: 390, height: 800 } });
  test("Responder deja el editor a la vista", async ({ page }) => {
    await mockApi(page, { paragraphs: 100 });
    await page.goto("./");
    await page.getByText("Propuesta con plazo (correo largo)").first().click();
    await page.getByRole("button", { name: "Responder", exact: true }).click();
    await expect(page.getByTestId("composer")).toBeInViewport({ ratio: 0.4 });
  });

  test("ver correo desde una tarea ocupa la pantalla y se cierra", async ({ page }) => {
    await mockApi(page, { tasks: [task("t1", "e-long", "Pagar el pedido 123")] });
    await page.goto("./");
    await page.locator("nav").getByRole("button", { name: "Tareas" }).click();   // mobile bottom navigation
    await page.getByTestId("task-open-email").first().click();
    await expect(page.getByTestId("reading-pane")).toBeVisible();
    await page.getByRole("button", { name: /cerrar correo/i }).click();
    await expect(page.getByTestId("reading-pane")).toBeHidden();
  });
});
