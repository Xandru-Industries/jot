import { expect, test } from "@playwright/test";

import { createNote } from "../support/jot.mjs";

test.describe("browser collaboration protocol", () => {
  test("applies inserts, deletes, and server ID-list updates", async ({ page }) => {
    await page.goto("/login");
    const result = await page.evaluate(async () => {
      const { SimpleIdList, applyClientMutation, applyIdListUpdates } = await import("/static/collab-shared.js");
      const initial = SimpleIdList.load([{ bunchId: "seed", startCounter: 0, count: 3, isDeleted: false }]);
      const inserted = applyClientMutation({ text: "abc", idList: initial }, {
        name: "insert",
        clientCounter: 1,
        args: {
          before: { bunchId: "seed", counter: 0 },
          id: { bunchId: "client", counter: 0 },
          content: "XY",
          isInWord: false,
        },
      });
      const deleted = applyClientMutation(inserted, {
        name: "delete",
        clientCounter: 2,
        args: {
          startId: { bunchId: "client", counter: 0 },
          endId: { bunchId: "client", counter: 1 },
          contentLength: 2,
        },
      });
      const updated = applyIdListUpdates(initial, [
        { type: "insertAfter", before: { bunchId: "seed", counter: 2 }, id: { bunchId: "server", counter: 0 }, count: 1 },
        { type: "deleteRange", startIndex: 1, endIndex: 1 },
      ]);
      return {
        insertedText: inserted.text,
        deletedText: deleted.text,
        updatedIds: Array.from({ length: updated.length }, (_, index) => updated.at(index)),
      };
    });

    expect(result).toEqual({
      insertedText: "aXYbc",
      deletedText: "abc",
      updatedIds: [
        { bunchId: "seed", counter: 0 },
        { bunchId: "seed", counter: 2 },
        { bunchId: "server", counter: 0 },
      ],
    });
  });

  test("round-trips source selections through stable IDs", async ({ page }) => {
    await page.goto("/login");
    const selections = await page.evaluate(async () => {
      const { SimpleIdList, selectionFromIds, selectionToIds } = await import("/static/collab-shared.js");
      const ids = SimpleIdList.load([{ bunchId: "seed", startCounter: 0, count: 6, isDeleted: false }]);
      return [
        selectionFromIds(selectionToIds(ids, 0, 0), ids),
        selectionFromIds(selectionToIds(ids, 3, 3), ids),
        selectionFromIds(selectionToIds(ids, 1, 5, "backward"), ids),
      ];
    });

    expect(selections).toEqual([
      { start: 0, end: 0, direction: "none" },
      { start: 3, end: 3, direction: "none" },
      { start: 1, end: 5, direction: "backward" },
    ]);
  });

  test("loads the server articulated state without changing visible IDs", async ({ page }) => {
    const note = await createNote(page.request, { markdown: "# Title\n\nBody" });
    const response = await page.request.get(`/api/notes/${note.id}/collab`);
    const saved = (await response.json()).collabState.idListState;
    await page.goto("/login");

    const browserIds = await page.evaluate(async (idListState) => {
      const { SimpleIdList } = await import("/static/collab-shared.js");
      const ids = SimpleIdList.load(idListState);
      return Array.from({ length: ids.length }, (_, index) => ids.at(index));
    }, saved);
    const serverIds = saved.flatMap((item) => Array.from(
      { length: item.count },
      (_, offset) => ({ bunchId: item.bunchId, counter: item.startCounter + offset, deleted: Boolean(item.isDeleted) }),
    )).filter((item) => !item.deleted).map(({ bunchId, counter }) => ({ bunchId, counter }));

    expect(browserIds).toEqual(serverIds);
    expect(browserIds).toHaveLength(note.markdown.length);
  });
});
