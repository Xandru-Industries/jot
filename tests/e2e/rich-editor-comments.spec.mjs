import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { createNote, expectPersistedMarkdown, openOwnerNote } from "../support/jot.mjs";

const fixtures = JSON.parse(await readFile(new URL("../fixtures/comment-text.json", import.meta.url), "utf8"));

for (const fixture of fixtures) {
  test(`editable and public comment projections agree: ${fixture.name}`, async ({ page }) => {
    const note = await createNote(page.request, { markdown: fixture.markdown, shareAccess: "comment" });
    await openOwnerNote(page, note.id);
    const editable = await page.locator("#richEditor").evaluate(async (root) => {
      const { extractCommentText } = await import(window.__RICH_EDITOR_URL__);
      return extractCommentText(root).fullText;
    });
    expect(editable).toBe(fixture.expected);
    await page.goto(`/s/${note.shareId}`);
    await expect(page.locator("#previewContent")).toContainText(fixture.name.includes("Mermaid") ? "After" : "Heading");
    const publicText = await page.locator("#previewContent").evaluate(async (root) => {
      const { extractCommentText } = await import(window.__RICH_EDITOR_URL__);
      return extractCommentText(root).fullText;
    });
    expect(publicText).toBe(fixture.expected);
  });
}

test("creates a rich selection comment and keeps Markdown widget-free", async ({ page }) => {
  const markdown = "# Commentable\n\nSelect this anchor text.";
  const note = await createNote(page.request, { markdown, shareAccess: "comment" });
  await openOwnerNote(page, note.id);
  await page.getByText("anchor text", { exact: false }).evaluate((element) => {
    const node = element.firstChild;
    const start = node.nodeValue.indexOf("anchor text");
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + "anchor text".length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(page.locator("#selectionBubble")).toBeVisible();
  await page.locator("#selectionBubble").click();
  await page.getByPlaceholder("Write a comment").fill("Rich comment");
  await page.getByRole("button", { name: /comment/i }).last().click();
  await expect(page.locator(".anchor-highlight")).toHaveCount(1);
  await expect(page.locator(".thread-card")).toContainText("Rich comment");
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.locator(".anchor-highlight")).toHaveCount(1);
  await page.locator(".theme-toggle").click();
  await expect(page.locator(".anchor-highlight")).toHaveCount(1);
  await expectPersistedMarkdown(page.request, note.id, markdown);
});

test("relocates a thread after a local edit and authoritative reload", async ({ page }) => {
  const note = await createNote(page.request, { markdown: "Before anchor text after", shareAccess: "comment" });
  const created = await page.request.post(`/api/share/${note.shareId}/threads`, {
    data: { anchor: { quote: "anchor text", prefix: "Before ", suffix: " after", start: 7, end: 18 }, body: "Relocate me" },
  });
  expect(created.ok()).toBeTruthy();
  await openOwnerNote(page, note.id);
  await expect(page.locator(".anchor-highlight")).toHaveCount(1);
  await page.getByText("Before anchor text after").click();
  await page.keyboard.press("Home");
  await page.keyboard.type("Now ");
  await expect(page.locator(".anchor-highlight")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".anchor-highlight")).toHaveCount(1);
});

test("keeps an unavailable anchor thread accessible", async ({ page }) => {
  const note = await createNote(page.request, { markdown: "Before anchor text after", shareAccess: "comment" });
  const created = await page.request.post(`/api/share/${note.shareId}/threads`, {
    data: { anchor: { quote: "anchor text", prefix: "Before ", suffix: " after", start: 7, end: 18 }, body: "Still accessible" },
  });
  expect(created.ok()).toBeTruthy();
  await openOwnerNote(page, note.id);
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.type("Anchor removed");
  await expectPersistedMarkdown(page.request, note.id, "Anchor removed\n");
  await page.reload();
  await expect(page.locator(".thread-card.unavailable")).toContainText("Anchor unavailable");
  await expect(page.locator(".thread-card.unavailable")).toContainText("Still accessible");
});
