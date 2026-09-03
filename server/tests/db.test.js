import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addCard,
  addColumn,
  createBoard,
  deleteBoard,
  deleteCard,
  deleteColumn,
  editCard,
  getBoardDetail,
  listBoards,
  moveCard,
  moveColumn,
  openDb,
  renameColumn,
} from "../db.js";

let nextId = 0;
function testId() {
  nextId += 1;
  return `id-${nextId}`;
}

function seededBoard(db) {
  const board = createBoard(db, "Sprint 1", testId);
  const todo = addColumn(db, board.id, "A faire", testId);
  const done = addColumn(db, board.id, "Termine", testId);
  return { db, board, todo, done };
}

test("listBoards / createBoard", async (t) => {
  await t.test("starts empty", () => {
    assert.deepEqual(listBoards(openDb(":memory:")), []);
  });

  await t.test("creates a board and lists it", () => {
    const db = openDb(":memory:");
    createBoard(db, "Sprint 1", testId);
    const boards = listBoards(db);
    assert.equal(boards.length, 1);
    assert.equal(boards[0].title, "Sprint 1");
  });

  await t.test("trims whitespace and rejects an empty title", () => {
    const db = openDb(":memory:");
    const board = createBoard(db, "  Sprint 1  ", testId);
    assert.equal(board.title, "Sprint 1");
    assert.throws(() => createBoard(db, "   ", testId));
  });
});

test("deleteBoard", async (t) => {
  await t.test("removes the board and its columns/cards", () => {
    const { db, board, todo } = seededBoard(openDb(":memory:"));
    addCard(db, todo.id, "Buy milk", testId);

    deleteBoard(db, board.id);

    assert.deepEqual(listBoards(db), []);
    assert.equal(getBoardDetail(db, board.id), null);
  });
});

test("getBoardDetail", async (t) => {
  await t.test("null for an unknown board", () => {
    assert.equal(getBoardDetail(openDb(":memory:"), "missing"), null);
  });

  await t.test("shapes columns and cards like the client's board-state.js", () => {
    const { db, board, todo, done } = seededBoard(openDb(":memory:"));
    const card = addCard(db, todo.id, "Buy milk", testId);

    const detail = getBoardDetail(db, board.id);
    assert.equal(detail.title, "Sprint 1");
    assert.deepEqual(
      detail.columns.map((c) => c.title),
      ["A faire", "Termine"]
    );
    assert.deepEqual(detail.columns[0].cardIds, [card.id]);
    assert.equal(detail.cards[card.id].title, "Buy milk");
    assert.deepEqual(detail.cards[card.id].labels, []);
    assert.deepEqual(detail.columns[1].cardIds, []);
  });
});

test("addColumn / renameColumn / deleteColumn", async (t) => {
  await t.test("appends columns in order and rejects an empty title", () => {
    const { db, board } = seededBoard(openDb(":memory:"));
    assert.deepEqual(
      getBoardDetail(db, board.id).columns.map((c) => c.title),
      ["A faire", "Termine"]
    );
    assert.throws(() => addColumn(db, board.id, "   ", testId));
  });

  await t.test("renames a column", () => {
    const { db, board, todo } = seededBoard(openDb(":memory:"));
    renameColumn(db, todo.id, "Backlog");
    assert.equal(getBoardDetail(db, board.id).columns[0].title, "Backlog");
  });

  await t.test("deleting a column also deletes its cards", () => {
    const { db, board, todo } = seededBoard(openDb(":memory:"));
    const card = addCard(db, todo.id, "Buy milk", testId);
    deleteColumn(db, todo.id);

    const detail = getBoardDetail(db, board.id);
    assert.equal(detail.columns.length, 1);
    assert.equal(detail.cards[card.id], undefined);
  });
});

test("moveColumn", async (t) => {
  await t.test("reorders columns within the board", () => {
    const { db, board, done } = seededBoard(openDb(":memory:"));
    moveColumn(db, board.id, done.id, 0);
    assert.deepEqual(
      getBoardDetail(db, board.id).columns.map((c) => c.title),
      ["Termine", "A faire"]
    );
  });

  await t.test("clamps an out-of-range index", () => {
    const { db, board, todo } = seededBoard(openDb(":memory:"));
    moveColumn(db, board.id, todo.id, 999);
    assert.deepEqual(
      getBoardDetail(db, board.id).columns.map((c) => c.title),
      ["Termine", "A faire"]
    );
  });
});

test("addCard / editCard / deleteCard", async (t) => {
  await t.test("appends a card with empty description/labels and rejects an empty title", () => {
    const { db, board, todo } = seededBoard(openDb(":memory:"));
    const card = addCard(db, todo.id, "  Buy milk  ", testId);
    assert.equal(card.title, "Buy milk");

    const detail = getBoardDetail(db, board.id);
    assert.equal(detail.cards[card.id].description, "");
    assert.deepEqual(detail.cards[card.id].labels, []);
    assert.throws(() => addCard(db, todo.id, "   ", testId));
  });

  await t.test("editCard merges only the given fields", () => {
    const { db, board, todo } = seededBoard(openDb(":memory:"));
    const card = addCard(db, todo.id, "Buy milk", testId);

    editCard(db, card.id, { description: "2%, not skim" });
    let detail = getBoardDetail(db, board.id);
    assert.equal(detail.cards[card.id].title, "Buy milk");
    assert.equal(detail.cards[card.id].description, "2%, not skim");

    editCard(db, card.id, { labels: ["urgent"] });
    detail = getBoardDetail(db, board.id);
    assert.deepEqual(detail.cards[card.id].labels, ["urgent"]);
    assert.equal(detail.cards[card.id].description, "2%, not skim"); // untouched
  });

  await t.test("editCard on an unknown id is a no-op", () => {
    const db = openDb(":memory:");
    assert.doesNotThrow(() => editCard(db, "missing", { title: "x" }));
  });

  await t.test("deleteCard removes it from its column", () => {
    const { db, board, todo } = seededBoard(openDb(":memory:"));
    const card = addCard(db, todo.id, "Buy milk", testId);
    deleteCard(db, card.id);

    const detail = getBoardDetail(db, board.id);
    assert.deepEqual(detail.columns[0].cardIds, []);
    assert.equal(detail.cards[card.id], undefined);
  });
});

test("moveCard", async (t) => {
  await t.test("reorders a card within the same column", () => {
    const { db, board, todo } = seededBoard(openDb(":memory:"));
    const a = addCard(db, todo.id, "A", testId);
    const b = addCard(db, todo.id, "B", testId);

    moveCard(db, b.id, todo.id, 0);
    assert.deepEqual(getBoardDetail(db, board.id).columns[0].cardIds, [b.id, a.id]);
  });

  await t.test("moves a card to a different column", () => {
    const { db, board, todo, done } = seededBoard(openDb(":memory:"));
    const card = addCard(db, todo.id, "Buy milk", testId);

    moveCard(db, card.id, done.id, 0);
    const detail = getBoardDetail(db, board.id);
    assert.deepEqual(detail.columns[0].cardIds, []);
    assert.deepEqual(detail.columns[1].cardIds, [card.id]);
  });

  await t.test("clamps an out-of-range target index", () => {
    const { db, board, todo, done } = seededBoard(openDb(":memory:"));
    const card = addCard(db, todo.id, "Buy milk", testId);

    moveCard(db, card.id, done.id, 999);
    assert.deepEqual(getBoardDetail(db, board.id).columns[1].cardIds, [card.id]);
  });

  await t.test("unknown card id is a no-op", () => {
    const { db } = seededBoard(openDb(":memory:"));
    assert.doesNotThrow(() => moveCard(db, "missing", "also-missing", 0));
  });
});
