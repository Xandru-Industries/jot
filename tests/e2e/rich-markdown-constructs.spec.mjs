import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { createNote, expectPersistedMarkdown, openOwnerNote } from "../support/jot.mjs";

const fixtures = JSON.parse(await readFile(new URL("../fixtures/markdown-roundtrips.json", import.meta.url), "utf8"));

for (const fixture of fixtures) {
  test(`normalizes ${fixture.name} idempotently after a genuine edit`, async ({ page }) => {
    const note = await createNote(page.request, { markdown: fixture.source });
    await openOwnerNote(page, note.id);
    for (const semantic of fixture.semantics) await expect(page.locator("#richEditor")).toContainText(semantic);
    await page.locator("#richEditor .ProseMirror").press("End");
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    await expectPersistedMarkdown(page.request, note.id, fixture.normalized);
    await page.reload();
    await page.locator("#richEditor .ProseMirror").press("End");
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");
    await expectPersistedMarkdown(page.request, note.id, fixture.normalized);
  });
}

test("supports tasks, highlighted code, tables, images, and safe link activation", async ({ page, context }) => {
  const markdown = "- [ ] ship it\n\n```js\nconst answer = 42;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![pixel](https://example.com/pixel.png)\n\n[safe](https://example.com) [blocked](javascript:alert(1))";
  const note = await createNote(page.request, { markdown });
  await openOwnerNote(page, note.id);
  await expect(page.locator("#richEditor input[type=checkbox]")).toHaveCount(1);
  await page.locator("#richEditor input[type=checkbox]").click();
  await expect.poll(async () => (await (await page.request.get(`/api/notes/${note.id}`)).json()).note.markdown).toContain("[x] ship it");
  await expect(page.locator("#richEditor pre")).toHaveClass(/hljs/);
  await expect(page.locator("#richEditor table")).toContainText("A");
  await expect(page.locator('#richEditor img[alt="pixel"]')).toBeVisible();
  await page.locator("#richEditor a", { hasText: "safe" }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${note.id}`));
  const popup = context.waitForEvent("page");
  await page.locator("#richEditor a", { hasText: "safe" }).click({ modifiers: ["ControlOrMeta"] });
  await (await popup).close();
  await expect(page.locator("#richEditor a", { hasText: "blocked" })).toHaveAttribute("href", "");
  await page.locator("#richEditor a", { hasText: "blocked" }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page).toHaveURL(new RegExp(`/notes/${note.id}`));
  await expect(page.locator("#richEditor script")).toHaveCount(0);
});
