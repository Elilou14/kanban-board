import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createServer } from "../server.js";

let server;
let baseUrl;

before(async () => {
  server = createServer(":memory:");
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
});

async function request(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function createBoard(title = "Sprint 1") {
  const res = await request("POST", "/api/boards", { title });
  return res.body;
}

async function createColumn(boardId, title = "A faire") {
  const res = await request("POST", `/api/boards/${boardId}/columns`, { title });
  return res.body;
}

// ---- boards ----

test("GET /api/boards starts empty", async () => {
  const res = await request("GET", "/api/boards");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test("POST /api/boards creates a board", async () => {
  const res = await request("POST", "/api/boards", { title: "Sprint 1" });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, "Sprint 1");
  assert.ok(res.body.id);
});

test("POST /api/boards with an empty title returns 400", async () => {
  const res = await request("POST", "/api/boards", { title: "   " });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test("GET /api/boards/:id returns the board with empty columns/cards", async () => {
  const board = await createBoard();
  const res = await request("GET", `/api/boards/${board.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.title, "Sprint 1");
  assert.deepEqual(res.body.columns, []);
  assert.deepEqual(res.body.cards, {});
});

test("GET /api/boards/:id on an unknown id returns 404", async () => {
  const res = await request("GET", "/api/boards/does-not-exist");
  assert.equal(res.status, 404);
});

test("DELETE /api/boards/:id removes the board", async () => {
  const board = await createBoard();
  const del = await request("DELETE", `/api/boards/${board.id}`);
  assert.equal(del.status, 204);

  const get = await request("GET", `/api/boards/${board.id}`);
  assert.equal(get.status, 404);
});

test("DELETE /api/boards/:id on an unknown id returns 404", async () => {
  const res = await request("DELETE", "/api/boards/does-not-exist");
  assert.equal(res.status, 404);
});

// ---- columns ----

test("POST /api/boards/:boardId/columns creates a column", async () => {
  const board = await createBoard();
  const res = await request("POST", `/api/boards/${board.id}/columns`, { title: "A faire" });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, "A faire");

  const detail = await request("GET", `/api/boards/${board.id}`);
  assert.deepEqual(
    detail.body.columns.map((c) => c.title),
    ["A faire"]
  );
});

test("POST columns with an empty title returns 400", async () => {
  const board = await createBoard();
  const res = await request("POST", `/api/boards/${board.id}/columns`, { title: "" });
  assert.equal(res.status, 400);
});

test("PATCH /api/columns/:id renames a column", async () => {
  const board = await createBoard();
  const column = await createColumn(board.id);
  const res = await request("PATCH", `/api/columns/${column.id}`, { title: "Backlog" });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, "Backlog");
});

test("PATCH /api/columns/:id on an unknown id returns 404", async () => {
  const res = await request("PATCH", "/api/columns/does-not-exist", { title: "x" });
  assert.equal(res.status, 404);
});

test("POST /api/columns/:id/move reorders columns", async () => {
  const board = await createBoard();
  await createColumn(board.id, "A faire");
  const second = await createColumn(board.id, "Termine");

  const res = await request("POST", `/api/columns/${second.id}/move`, { toIndex: 0 });
  assert.equal(res.status, 204);

  const detail = await request("GET", `/api/boards/${board.id}`);
  assert.deepEqual(
    detail.body.columns.map((c) => c.title),
    ["Termine", "A faire"]
  );
});

test("POST /api/columns/:id/move on an unknown id returns 404", async () => {
  const res = await request("POST", "/api/columns/does-not-exist/move", { toIndex: 0 });
  assert.equal(res.status, 404);
});

test("DELETE /api/columns/:id removes it (and its cards)", async () => {
  const board = await createBoard();
  const column = await createColumn(board.id);
  await request("POST", `/api/columns/${column.id}/cards`, { title: "Buy milk" });

  const del = await request("DELETE", `/api/columns/${column.id}`);
  assert.equal(del.status, 204);

  const detail = await request("GET", `/api/boards/${board.id}`);
  assert.deepEqual(detail.body.columns, []);
  assert.deepEqual(detail.body.cards, {});
});

test("DELETE /api/columns/:id on an unknown id returns 404", async () => {
  const res = await request("DELETE", "/api/columns/does-not-exist");
  assert.equal(res.status, 404);
});

// ---- cards ----

test("POST /api/columns/:columnId/cards creates a card", async () => {
  const board = await createBoard();
  const column = await createColumn(board.id);
  const res = await request("POST", `/api/columns/${column.id}/cards`, { title: "Buy milk" });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, "Buy milk");
  assert.equal(res.body.description, "");
  assert.deepEqual(res.body.labels, []);
});

test("POST cards with an empty title returns 400", async () => {
  const board = await createBoard();
  const column = await createColumn(board.id);
  const res = await request("POST", `/api/columns/${column.id}/cards`, { title: "   " });
  assert.equal(res.status, 400);
});

test("PATCH /api/cards/:id merges only the given fields", async () => {
  const board = await createBoard();
  const column = await createColumn(board.id);
  const card = await request("POST", `/api/columns/${column.id}/cards`, { title: "Buy milk" });

  const res = await request("PATCH", `/api/cards/${card.body.id}`, { description: "2%, not skim" });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, "Buy milk");
  assert.equal(res.body.description, "2%, not skim");
});

test("PATCH /api/cards/:id on an unknown id returns 404", async () => {
  const res = await request("PATCH", "/api/cards/does-not-exist", { title: "x" });
  assert.equal(res.status, 404);
});

test("PATCH /api/cards/:id with an empty title returns 400", async () => {
  const board = await createBoard();
  const column = await createColumn(board.id);
  const card = await request("POST", `/api/columns/${column.id}/cards`, { title: "Buy milk" });

  const res = await request("PATCH", `/api/cards/${card.body.id}`, { title: "   " });
  assert.equal(res.status, 400);
});

test("POST /api/cards/:id/move moves a card to another column", async () => {
  const board = await createBoard();
  const todo = await createColumn(board.id, "A faire");
  const done = await createColumn(board.id, "Termine");
  const card = await request("POST", `/api/columns/${todo.id}/cards`, { title: "Buy milk" });

  const res = await request("POST", `/api/cards/${card.body.id}/move`, { toColumnId: done.id, toIndex: 0 });
  assert.equal(res.status, 204);

  const detail = await request("GET", `/api/boards/${board.id}`);
  const doneColumn = detail.body.columns.find((c) => c.id === done.id);
  assert.deepEqual(doneColumn.cardIds, [card.body.id]);
});

test("POST /api/cards/:id/move on an unknown id returns 404", async () => {
  const res = await request("POST", "/api/cards/does-not-exist/move", { toColumnId: "x", toIndex: 0 });
  assert.equal(res.status, 404);
});

test("DELETE /api/cards/:id removes it", async () => {
  const board = await createBoard();
  const column = await createColumn(board.id);
  const card = await request("POST", `/api/columns/${column.id}/cards`, { title: "Buy milk" });

  const del = await request("DELETE", `/api/cards/${card.body.id}`);
  assert.equal(del.status, 204);

  const detail = await request("GET", `/api/boards/${board.id}`);
  assert.deepEqual(detail.body.columns[0].cardIds, []);
});

test("DELETE /api/cards/:id on an unknown id returns 404", async () => {
  const res = await request("DELETE", "/api/cards/does-not-exist");
  assert.equal(res.status, 404);
});

test("unknown route returns 404", async () => {
  const res = await request("GET", "/api/nope");
  assert.equal(res.status, 404);
});
