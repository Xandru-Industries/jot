import { expect, test } from "@playwright/test";

test("maps both affinities at hidden heading syntax", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { createRichEditor } = await import("/static/generated/rich-editor.js");
    const root = document.createElement("div");
    document.body.append(root);
    const editor = await createRichEditor({ root, markdown: "# Heading\n", onChange() {} });
    const bridge = editor.getSelectionBridge();
    const headingStart = editor.findText("Heading").from;
    const mapped = {
      left: bridge.toMarkdown({ anchor: headingStart, head: headingStart }, { anchor: "left", head: "left" }),
      right: bridge.toMarkdown({ anchor: headingStart, head: headingStart }, { anchor: "right", head: "right" }),
      fromHidden: bridge.toProseMirror({ start: 1, end: 1, direction: "none" }),
      headingStart,
    };
    await editor.destroy();
    root.remove();
    return mapped;
  });

  expect(result.left).toEqual({ start: 0, end: 0, direction: "none" });
  expect(result.right).toEqual({ start: 2, end: 2, direction: "none" });
  expect(result.fromHidden).toEqual({ anchor: result.headingStart, head: result.headingStart });
});

test("maps hidden emphasis, link, and inline-code syntax", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { createRichEditor } = await import("/static/generated/rich-editor.js");
    const root = document.createElement("div");
    document.body.append(root);
    const markdown = "A **bold** [link](https://example.com) and `code`.\n";
    const editor = await createRichEditor({ root, markdown, onChange() {} });
    const bridge = editor.getSelectionBridge();
    const spans = {
      bold: editor.findText("bold"),
      link: editor.findText("link"),
      code: editor.findText("code"),
    };
    const mapped = Object.fromEntries(Object.entries(spans).map(([name, span]) => [name, {
      startLeft: bridge.toMarkdown({ anchor: span.from, head: span.from }, { anchor: "left", head: "left" }).start,
      startRight: bridge.toMarkdown({ anchor: span.from, head: span.from }, { anchor: "right", head: "right" }).start,
      endLeft: bridge.toMarkdown({ anchor: span.to, head: span.to }, { anchor: "left", head: "left" }).start,
      endRight: bridge.toMarkdown({ anchor: span.to, head: span.to }, { anchor: "right", head: "right" }).start,
    }]));
    const hiddenOffsets = [3, 9, 11, 18, 30, 43, 48];
    const reverse = hiddenOffsets.map((offset) => bridge.toProseMirror({ start: offset, end: offset, direction: "none" }).anchor);
    await editor.destroy();
    root.remove();
    return { mapped, reverse, spans };
  });

  expect(result.mapped.bold).toEqual({ startLeft: 2, startRight: 4, endLeft: 8, endRight: 10 });
  expect(result.mapped.link).toEqual({ startLeft: 11, startRight: 12, endLeft: 16, endRight: 38 });
  expect(result.mapped.code).toEqual({ startLeft: 43, startRight: 44, endLeft: 48, endRight: 49 });
  expect(result.reverse).toEqual([
    result.spans.bold.from,
    result.spans.bold.to,
    result.spans.link.from,
    result.spans.link.to,
    result.spans.link.to,
    result.spans.code.from,
    result.spans.code.to,
  ]);
});

test("preserves range direction and clamps document boundaries", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { createRichEditor } = await import("/static/generated/rich-editor.js");
    const root = document.createElement("div");
    document.body.append(root);
    const markdown = "Start ![alt](image.png) end\n";
    const editor = await createRichEditor({ root, markdown, onChange() {} });
    const bridge = editor.getSelectionBridge();
    const start = editor.findText("Start");
    const end = editor.findText("end");
    const backward = bridge.toMarkdown({ anchor: end.to, head: start.from });
    const roundTrip = bridge.toProseMirror(backward);
    const boundaries = [
      bridge.toProseMirror({ start: -10, end: -10, direction: "none" }),
      bridge.toProseMirror({ start: 999, end: 999, direction: "none" }),
    ];
    const imageStart = markdown.indexOf("![");
    const imageEnd = markdown.indexOf(")") + 1;
    const image = {
      before: bridge.toProseMirror({ start: imageStart, end: imageStart, direction: "none" }).anchor,
      inside: bridge.toProseMirror({ start: imageStart + 5, end: imageStart + 5, direction: "none" }).anchor,
      after: bridge.toProseMirror({ start: imageEnd, end: imageEnd, direction: "none" }).anchor,
    };
    const revisionBefore = bridge.revision;
    editor.replaceMarkdown("Changed\n");
    const revisionAfter = bridge.revision;
    await editor.destroy();
    root.remove();
    return { backward, roundTrip, boundaries, image, revisionBefore, revisionAfter };
  });

  expect(result.backward.direction).toBe("backward");
  expect(result.roundTrip.anchor).toBeGreaterThan(result.roundTrip.head);
  expect(result.boundaries[0].anchor).toBeGreaterThanOrEqual(1);
  expect(result.boundaries[1].anchor).toBeGreaterThan(result.boundaries[0].anchor);
  expect(result.image.inside).toBe(result.image.after);
  expect(result.image.after).toBeGreaterThan(result.image.before);
  expect(result.revisionAfter).toBeGreaterThan(result.revisionBefore);
});

test("resolves deleted character IDs through endpoint bias", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { SimpleIdList, selectionFromIds } = await import("/static/collab-shared.js");
    const ids = SimpleIdList.load([
      { bunchId: "seed", startCounter: 0, count: 1, isDeleted: false },
      { bunchId: "seed", startCounter: 1, count: 1, isDeleted: true },
      { bunchId: "seed", startCounter: 2, count: 1, isDeleted: false },
    ]);
    return selectionFromIds({ type: "cursor", cursor: { bunchId: "seed", counter: 1 } }, ids);
  });

  expect(result).toEqual({ start: 1, end: 1, direction: "none" });
});
