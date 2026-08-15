import { expect, test } from "@playwright/test";

import {
  createNote,
  expectPersistedMarkdown,
  openEditShare,
  openOwnerNote,
} from "../support/jot.mjs";

test("owner loads and persists directly editable rich Markdown", async ({ page }) => {
  const note = await createNote(page.request);
  await openOwnerNote(page, note.id);

  expect(await page.evaluate(() => window.__RICH_EDITOR_URL__)).toMatch(/^\/static\/generated\/rich-editor\.js\?v=/);
  await expect(page.locator("#editorTextarea")).toHaveCount(0);
  await expect(page.locator("#previewContent")).toHaveCount(0);
  await expect(page.locator("#richEditor h1")).toHaveText("Collaborative heading");
  await expect(page.locator("#richEditor p")).toHaveText("A directly editable paragraph.");
  await expect(page.locator("#richEditor")).not.toContainText("# Collaborative heading");
  await expect(page.locator("#richEditor .ProseMirror")).toHaveCSS("white-space", "pre-wrap");

  await page.locator("#richEditor h1").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" updated");
  await page.locator("#richEditor p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Persisted.");

  const expected = "# Collaborative heading updated\n\nA directly editable paragraph. Persisted.\n";
  await expectPersistedMarkdown(page.request, note.id, expected);
  await page.reload();
  await expect(page.locator("#richEditor h1")).toHaveText("Collaborative heading updated");
  await expect(page.locator("#richEditor p")).toHaveText("A directly editable paragraph. Persisted.");
});

test("owner and edit-share rich editors propagate changes", async ({ page, browser }) => {
  const note = await createNote(page.request);
  await openOwnerNote(page, note.id);

  const shareContext = await browser.newContext();
  const sharePage = await shareContext.newPage();
  await openEditShare(sharePage, note.shareId, "Collaborator");
  await expect(sharePage.locator("#richEditor h1")).toHaveText("Collaborative heading");

  await page.locator("#richEditor h1").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" from owner");
  await expect(sharePage.locator("#richEditor h1")).toHaveText("Collaborative heading from owner");

  await sharePage.locator("#richEditor p").click();
  await sharePage.keyboard.press("End");
  await sharePage.keyboard.type(" Shared edit.");
  await expect(page.locator("#richEditor p")).toHaveText("A directly editable paragraph. Shared edit.");

  await expectPersistedMarkdown(
    page.request,
    note.id,
    "# Collaborative heading from owner\n\nA directly editable paragraph. Shared edit.\n",
  );
  await shareContext.close();
});
