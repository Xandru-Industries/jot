import { expect, test } from "@playwright/test";

import { createNote, expectPersistedMarkdown, openEditShare, openOwnerNote } from "../support/jot.mjs";

async function replaceMermaidSource(page, source) {
  await page.locator(".mermaid-source").click();
  await page.locator(".mermaid-source").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.type(source);
}

test("renders case-insensitive Mermaid fences and persists source only", async ({ page }) => {
  const note = await createNote(page.request, { markdown: "```MerMaid\ngraph TD\n  A-->B\n```" });
  await openOwnerNote(page, note.id);
  const node = page.locator("#richEditor .mermaid-node");
  await expect(node).toBeVisible();
  await expect(node.locator(".mermaid-preview svg")).toBeVisible();
  await expect(node.locator(".mermaid-source")).toContainText("A-->B");
  await expect(node.locator(".mermaid-preview script, .mermaid-preview foreignObject")).toHaveCount(0);
  const persisted = (await (await page.request.get(`/api/notes/${note.id}`)).json()).note.markdown;
  expect(persisted).toContain("A-->B");
  expect(persisted).not.toMatch(/<svg|mermaid-toolbar|mermaid-preview/);
});

test("edits and collaborates through source-only Markdown", async ({ page, browser }) => {
  const note = await createNote(page.request, { markdown: "```mermaid\ngraph TD\n  A-->B\n```" });
  await openOwnerNote(page, note.id);
  const node = page.locator("#richEditor .mermaid-node");
  const shareContext = await browser.newContext();
  const sharePage = await shareContext.newPage();
  await openEditShare(sharePage, note.shareId, "Diagram editor");

  await replaceMermaidSource(page, "graph LR\n  Start-->Finish");
  await expect(node.locator(".mermaid-preview svg")).toHaveAttribute("viewBox", /0 0/);
  await expect(node.locator(".mermaid-preview svg text", { hasText: "Start" })).toHaveCount(1);
  await expect(sharePage.locator(".mermaid-source")).toContainText("Start-->Finish");
  await expect(sharePage.locator(".mermaid-preview svg text", { hasText: "Finish" })).toHaveCount(1);
  await expectPersistedMarkdown(page.request, note.id, "```mermaid\ngraph LR\n  Start-->Finish\n```\n");
  const persisted = (await (await page.request.get(`/api/notes/${note.id}`)).json()).note.markdown;
  expect(persisted).not.toMatch(/<svg|mermaid-toolbar|mermaid-error/);
  await shareContext.close();
});

test("shows errors, reuses cached source, controls viewport, and rerenders for theme", async ({ page }) => {
  const source = "graph TD\n  A-->B";
  const note = await createNote(page.request, { markdown: `\`\`\`mermaid\n${source}\n\`\`\`` });
  await openOwnerNote(page, note.id);
  const node = page.locator("#richEditor .mermaid-node");
  const diagram = node.locator(".mermaid-diagram");
  await expect(diagram.locator("svg")).toBeVisible();
  const initialCount = await node.getAttribute("data-render-count");
  await page.waitForTimeout(350);
  expect(await node.getAttribute("data-render-count")).toBe(initialCount);

  const zoomIn = node.getByRole("button", { name: "Zoom in" });
  const panRight = node.getByRole("button", { name: "Pan right" });
  const reset = node.getByRole("button", { name: "Reset diagram view" });
  await expect(node.locator(".mermaid-toolbar")).toHaveCSS("opacity", "0.35");
  await zoomIn.click();
  await panRight.press("Enter");
  await reset.click();
  await zoomIn.evaluate((button) => button.click());
  await reset.click();
  await expect(diagram).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  await page.evaluate(() => {
    window.__mermaidRenderCalls = 0;
    const original = window.__mermaid.render.bind(window.__mermaid);
    window.__mermaid.render = (...args) => {
      window.__mermaidRenderCalls += 1;
      return original(...args);
    };
  });
  await replaceMermaidSource(page, "not valid mermaid {");
  await expect(node.locator(".mermaid-error")).toBeVisible();
  await replaceMermaidSource(page, source);
  await expect(diagram.locator("svg")).toBeVisible();
  expect(await page.evaluate(() => window.__mermaidRenderCalls)).toBe(0);

  await page.locator(".theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => page.evaluate(() => window.__mermaidRenderCalls)).toBe(1);
});
