import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addCard,
  addColumn,
  boardReducer,
  cardsInColumn,
  createBoard,
  deleteCard,
  deleteColumn,
  editCard,
  findColumnOfCard,
  moveCard,
  moveColumn,
  renameColumn,
} from "../web/board-state.js";

let nextId = 0;
function testIdGenerator() {
  nextId += 1;
  return `id-${nextId}`;
}

function boardWithTwoColumns() {
  let board = createBoard();
  board = addColumn(board, "To Do", testIdGenerator);
  board = addColumn(board, "Done", testIdGenerator);
  const [todo, done] = board.columns;
  return { board, todo, done };
}

test("createBoard", async (t) => {
  await t.test("starts with no columns and no cards", () => {
    const board = createBoard();
    assert.deepEqual(board.columns, []);
    assert.deepEqual(board.cards, {});
  });
});

test("addColumn", async (t) => {
  await t.test("appends a new column with an empty card list", () => {
    const board = addColumn(createBoard(), "To Do", testIdGenerator);
    assert.equal(board.columns.length, 1);
    assert.equal(board.columns[0].title, "To Do");
    assert.deepEqual(board.columns[0].cardIds, []);
  });

  await t.test("trims surrounding whitespace", () => {
    const board = addColumn(createBoard(), "  To Do  ", testIdGenerator);
    assert.equal(board.columns[0].title, "To Do");
  });

  await t.test("does not mutate the original board", () => {
    const original = createBoard();
    addColumn(original, "To Do", testIdGenerator);
    assert.deepEqual(original.columns, []);
  });

  await t.test("empty title throws", () => {
    assert.throws(() => addColumn(createBoard(), "   ", testIdGenerator));
  });

  await t.test("uses the injected id generator", () => {
    const board = addColumn(createBoard(), "To Do", () => "fixed-id");
    assert.equal(board.columns[0].id, "fixed-id");
  });
});

test("renameColumn", async (t) => {
  await t.test("updates the title of the matching column", () => {
    const { board, todo } = boardWithTwoColumns();
    const next = renameColumn(board, todo.id, "Backlog");
    assert.equal(next.columns[0].title, "Backlog");
  });

  await t.test("empty title throws", () => {
    const { board, todo } = boardWithTwoColumns();
    assert.throws(() => renameColumn(board, todo.id, "  "));
  });

  await t.test("unknown column id is a no-op (same reference)", () => {
    const { board } = boardWithTwoColumns();
    assert.equal(renameColumn(board, "missing", "Backlog"), board);
  });
});

test("deleteColumn", async (t) => {
  await t.test("removes the column and its cards", () => {
    const { board, todo } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];

    const next = deleteColumn(withCard, todo.id);
    assert.equal(next.columns.length, 1);
    assert.equal(next.cards[cardId], undefined);
  });

  await t.test("unknown column id is a no-op (same reference)", () => {
    const { board } = boardWithTwoColumns();
    assert.equal(deleteColumn(board, "missing"), board);
  });
});

test("moveColumn", async (t) => {
  await t.test("reorders columns to the target index", () => {
    const { board } = boardWithTwoColumns();
    const next = moveColumn(board, board.columns[1].id, 0);
    assert.deepEqual(
      next.columns.map((c) => c.title),
      ["Done", "To Do"]
    );
  });

  await t.test("clamps an out-of-range index", () => {
    const { board } = boardWithTwoColumns();
    const next = moveColumn(board, board.columns[0].id, 999);
    assert.deepEqual(
      next.columns.map((c) => c.title),
      ["Done", "To Do"]
    );
  });

  await t.test("unknown column id is a no-op (same reference)", () => {
    const { board } = boardWithTwoColumns();
    assert.equal(moveColumn(board, "missing", 0), board);
  });
});

test("addCard", async (t) => {
  await t.test("appends a card to the given column", () => {
    const { board, todo } = boardWithTwoColumns();
    const next = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = next.columns[0].cardIds[0];
    assert.equal(next.cards[cardId].title, "Buy milk");
    assert.equal(next.cards[cardId].description, "");
    assert.deepEqual(next.cards[cardId].labels, []);
  });

  await t.test("trims surrounding whitespace", () => {
    const { board, todo } = boardWithTwoColumns();
    const next = addCard(board, todo.id, "  Buy milk  ", testIdGenerator);
    const cardId = next.columns[0].cardIds[0];
    assert.equal(next.cards[cardId].title, "Buy milk");
  });

  await t.test("empty title throws", () => {
    const { board, todo } = boardWithTwoColumns();
    assert.throws(() => addCard(board, todo.id, "  ", testIdGenerator));
  });

  await t.test("unknown column id throws", () => {
    const { board } = boardWithTwoColumns();
    assert.throws(() => addCard(board, "missing", "Buy milk", testIdGenerator));
  });
});

test("editCard", async (t) => {
  await t.test("merges the given changes into the card", () => {
    const { board, todo } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];

    const next = editCard(withCard, cardId, { description: "2%, not skim" });
    assert.equal(next.cards[cardId].title, "Buy milk");
    assert.equal(next.cards[cardId].description, "2%, not skim");
  });

  await t.test("trims a changed title", () => {
    const { board, todo } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];

    const next = editCard(withCard, cardId, { title: "  Buy oat milk  " });
    assert.equal(next.cards[cardId].title, "Buy oat milk");
  });

  await t.test("empty new title throws", () => {
    const { board, todo } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];
    assert.throws(() => editCard(withCard, cardId, { title: "   " }));
  });

  await t.test("unknown card id is a no-op (same reference)", () => {
    const { board } = boardWithTwoColumns();
    assert.equal(editCard(board, "missing", { title: "x" }), board);
  });
});

test("deleteCard", async (t) => {
  await t.test("removes the card from its column and from the card map", () => {
    const { board, todo } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];

    const next = deleteCard(withCard, cardId);
    assert.deepEqual(next.columns[0].cardIds, []);
    assert.equal(next.cards[cardId], undefined);
  });

  await t.test("unknown card id is a no-op (same reference)", () => {
    const { board } = boardWithTwoColumns();
    assert.equal(deleteCard(board, "missing"), board);
  });
});

test("moveCard", async (t) => {
  await t.test("moves a card to a different column", () => {
    const { board, todo, done } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];

    const next = moveCard(withCard, cardId, done.id, 0);
    const nextTodo = next.columns.find((c) => c.id === todo.id);
    const nextDone = next.columns.find((c) => c.id === done.id);
    assert.deepEqual(nextTodo.cardIds, []);
    assert.deepEqual(nextDone.cardIds, [cardId]);
  });

  await t.test("reorders a card within the same column", () => {
    const { board, todo } = boardWithTwoColumns();
    let withCards = addCard(board, todo.id, "A", testIdGenerator);
    withCards = addCard(withCards, todo.id, "B", testIdGenerator);
    const [idA, idB] = withCards.columns[0].cardIds;

    const next = moveCard(withCards, idB, todo.id, 0);
    assert.deepEqual(next.columns[0].cardIds, [idB, idA]);
  });

  await t.test("clamps an out-of-range target index", () => {
    const { board, todo, done } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];

    const next = moveCard(withCard, cardId, done.id, 999);
    assert.deepEqual(next.columns.find((c) => c.id === done.id).cardIds, [cardId]);
  });

  await t.test("unknown card id is a no-op (same reference)", () => {
    const { board, done } = boardWithTwoColumns();
    assert.equal(moveCard(board, "missing", done.id, 0), board);
  });

  await t.test("unknown target column id is a no-op (same reference)", () => {
    const { board, todo } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];
    assert.equal(moveCard(withCard, cardId, "missing", 0), withCard);
  });
});

test("boardReducer", async (t) => {
  await t.test("returns the board unchanged for an unknown action type", () => {
    const { board } = boardWithTwoColumns();
    assert.equal(boardReducer(board, { type: "NOPE" }), board);
  });
});

test("cardsInColumn", async (t) => {
  await t.test("returns the full card objects for a column, in order", () => {
    const { board, todo } = boardWithTwoColumns();
    let withCards = addCard(board, todo.id, "A", testIdGenerator);
    withCards = addCard(withCards, todo.id, "B", testIdGenerator);

    const cards = cardsInColumn(withCards, todo.id);
    assert.deepEqual(
      cards.map((c) => c.title),
      ["A", "B"]
    );
  });

  await t.test("empty for an unknown column", () => {
    const { board } = boardWithTwoColumns();
    assert.deepEqual(cardsInColumn(board, "missing"), []);
  });
});

test("findColumnOfCard", async (t) => {
  await t.test("finds the column currently holding a card", () => {
    const { board, todo } = boardWithTwoColumns();
    const withCard = addCard(board, todo.id, "Buy milk", testIdGenerator);
    const cardId = withCard.columns[0].cardIds[0];

    assert.equal(findColumnOfCard(withCard, cardId).id, todo.id);
  });

  await t.test("null for an unknown card", () => {
    const { board } = boardWithTwoColumns();
    assert.equal(findColumnOfCard(board, "missing"), null);
  });
});
