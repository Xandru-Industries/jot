import { expect, test } from "@playwright/test";

import {
  createNote,
  expectPersistedMarkdown,
  openEditShare,
  openOwnerNote,
} from "../support/jot.mjs";

async function openPair(page, browser) {
  const note = await createNote(page.request);
  await openOwnerNote(page, note.id);
  const shareContext = await browser.newContext();
  const sharePage = await shareContext.newPage();
  await openEditShare(sharePage, note.shareId, "Collaborator");
  return { note, shareContext, sharePage };
}

test("concurrent disjoint edits converge and preserve a local selection", async ({ page, browser }) => {
  const { note, shareContext, sharePage } = await openPair(page, browser);
  await page.locator("#richEditor p").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight");

  await Promise.all([
    sharePage.locator("#richEditor h1").click().then(() => sharePage.keyboard.press("End")).then(() => sharePage.keyboard.type(" remote")),
    page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50))),
  ]);

  await expect(page.locator("#richEditor h1")).toHaveText("Collaborative heading remote");
  const selected = await page.evaluate(() => window.__jotRichEditorDebug.getSourceSelection());
  expect(selected.end - selected.start).toBe(1);
  await expectPersistedMarkdown(page.request, note.id, "# Collaborative heading remote\n\nA directly editable paragraph.\n");
  await shareContext.close();
});

test("publishes rich remote cursor labels and removes them on leave", async ({ page, browser }) => {
  const { shareContext, sharePage } = await openPair(page, browser);
  await page.locator("#richEditor p").click();
  await page.keyboard.press("End");
  await expect(sharePage.locator(".remote-cursor-label")).toHaveAttribute("aria-label", "Owner");
  await expect(sharePage.locator(".remote-cursor-caret")).toBeVisible();

  await page.close();
  await expect(sharePage.locator(".remote-cursor-label")).toHaveCount(0);
  await shareContext.close();
});

test("paste and local undo redo serialize through collaboration", async ({ page, browser }) => {
  const { note, shareContext, sharePage } = await openPair(page, browser);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator("#richEditor p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await page.evaluate(() => navigator.clipboard.writeText("Pasted text."));
  await page.keyboard.press("ControlOrMeta+V");
  await expect(sharePage.locator("#richEditor p")).toContainText("Pasted text.");

  await page.keyboard.press("ControlOrMeta+Z");
  await expect(sharePage.locator("#richEditor p")).not.toContainText("Pasted text.");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  await expect(sharePage.locator("#richEditor p")).toContainText("Pasted text.");
  await expectPersistedMarkdown(page.request, note.id, "# Collaborative heading\n\nA directly editable paragraph. Pasted text.\n");
  await shareContext.close();
});

test("replays pending offline edits after reconnect without duplicates", async ({ page, browser }) => {
  const { note, shareContext, sharePage } = await openPair(page, browser);
  await page.context().setOffline(true);
  await expect(page.locator("#disconnectedBanner")).not.toHaveClass(/hidden/);
  await page.locator("#richEditor p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Offline edit.");
  await page.context().setOffline(false);

  await expect(page.locator("#disconnectedBanner")).toHaveClass(/hidden/, { timeout: 15_000 });
  await expect(sharePage.locator("#richEditor p")).toHaveText("A directly editable paragraph. Offline edit.");
  await expectPersistedMarkdown(page.request, note.id, "# Collaborative heading\n\nA directly editable paragraph. Offline edit.\n");
  await shareContext.close();
});

test("defers authoritative replacement during composition", async ({ page, browser }) => {
  const { note, shareContext, sharePage } = await openPair(page, browser);
  await page.evaluate(() => {
    const markdown = window.__jotRichEditorDebug.getMarkdown();
    const offset = markdown.lastIndexOf(".\n") + 1;
    window.__jotRichEditorDebug.setSourceSelection({ start: offset, end: offset, direction: "none" });
    window.__jotRichEditorDebug.beginComposition();
    window.__jotRichEditorDebug.insertText("文");
  });

  await sharePage.locator("#richEditor h1").click();
  await sharePage.keyboard.press("End");
  await sharePage.keyboard.type(" composed");
  await expect(page.locator("#richEditor h1")).not.toContainText("composed");
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__jotRichEditorDebug.endComposition());

  await expect(page.locator("#richEditor h1")).toHaveText("Collaborative heading composed");
  await expect(sharePage.locator("#richEditor p")).toHaveText("A directly editable paragraph. 文");
  await expectPersistedMarkdown(page.request, note.id, await sharePage.evaluate(() => window.__jotRichEditorDebug.getMarkdown()));
  await shareContext.close();
});
