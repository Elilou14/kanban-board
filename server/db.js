/**
 * SQLite persistence for the multi-board Kanban server, using
 * Node's built-in node:sqlite (no dependency). Ordering (which
 * column comes first, which card is first in its column) is a plain
 * integer `position` per row, renumbered 0..n-1 within its scope
 * (a board for columns, a column for cards) on every mutation that
 * touches order -- simpler than gap-based positioning, and boards
 * are small enough that renumbering everything is cheap.
 *
 * getBoardDetail() shapes its result exactly like the pure client
 * reducer's board -- { columns: [{id, title, cardIds}], cards: {id:
 * {...}} } -- on purpose: the Phase 2 frontend can run the exact same
 * board-state.js selectors (cardsInColumn, findColumnOfCard) against
 * data that came from the server as it does against the client-only
 * Phase 1 board.
 */

import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export function openDb(path = "kanban.sqlite") {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      boardId TEXT NOT NULL,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      columnId TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      labels TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL
    );
  `);
  return db;
}

function defaultId() {
  return crypto.randomUUID();
}

function requireTitle(title, kind) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error(`${kind} title cannot be empty.`);
  return trimmed;
}

function transaction(db, run) {
  db.exec("BEGIN");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function renumber(db, table, scopeColumn, scopeValue, orderedIds) {
  const update = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ? AND ${scopeColumn} = ?`);
  orderedIds.forEach((id, index) => update.run(index, id, scopeValue));
}

// ---- boards ----

export function listBoards(db) {
  return db.prepare("SELECT id, title, createdAt FROM boards ORDER BY createdAt ASC").all();
}

export function createBoard(db, title, idGenerator = defaultId) {
  const trimmed = requireTitle(title, "Board");
  const board = { id: idGenerator(), title: trimmed, createdAt: new Date().toISOString() };
  db.prepare("INSERT INTO boards (id, title, createdAt) VALUES (?, ?, ?)").run(
    board.id,
    board.title,
    board.createdAt
  );
  return board;
}

export function deleteBoard(db, boardId) {
  return transaction(db, () => {
    const columnIds = db.prepare("SELECT id FROM columns WHERE boardId = ?").all(boardId).map((c) => c.id);
    const deleteCards = db.prepare("DELETE FROM cards WHERE columnId = ?");
    for (const columnId of columnIds) deleteCards.run(columnId);
    db.prepare("DELETE FROM columns WHERE boardId = ?").run(boardId);
    const { changes } = db.prepare("DELETE FROM boards WHERE id = ?").run(boardId);
    return changes > 0;
  });
}

export function getBoardDetail(db, boardId) {
  const board = db.prepare("SELECT id, title, createdAt FROM boards WHERE id = ?").get(boardId);
  if (!board) return null;

  const columnRows = db
    .prepare("SELECT id, title FROM columns WHERE boardId = ? ORDER BY position ASC")
    .all(boardId);

  const cards = {};
  const columns = columnRows.map((columnRow) => {
    const cardRows = db
      .prepare("SELECT id, title, description, labels FROM cards WHERE columnId = ? ORDER BY position ASC")
      .all(columnRow.id);
    for (const cardRow of cardRows) {
      cards[cardRow.id] = {
        id: cardRow.id,
        title: cardRow.title,
        description: cardRow.description,
        labels: JSON.parse(cardRow.labels),
      };
    }
    return { id: columnRow.id, title: columnRow.title, cardIds: cardRows.map((c) => c.id) };
  });

  return { id: board.id, title: board.title, createdAt: board.createdAt, columns, cards };
}

// ---- columns ----

export function addColumn(db, boardId, title, idGenerator = defaultId) {
  const trimmed = requireTitle(title, "Column");
  const { maxPos } = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS maxPos FROM columns WHERE boardId = ?")
    .get(boardId);
  const column = { id: idGenerator(), boardId, title: trimmed, cardIds: [] };
  db.prepare("INSERT INTO columns (id, boardId, title, position) VALUES (?, ?, ?, ?)").run(
    column.id,
    boardId,
    trimmed,
    maxPos + 1
  );
  return column;
}

export function renameColumn(db, columnId, title) {
  const trimmed = requireTitle(title, "Column");
  const { changes } = db.prepare("UPDATE columns SET title = ? WHERE id = ?").run(trimmed, columnId);
  return changes > 0;
}

export function deleteColumn(db, columnId) {
  return transaction(db, () => {
    db.prepare("DELETE FROM cards WHERE columnId = ?").run(columnId);
    const { changes } = db.prepare("DELETE FROM columns WHERE id = ?").run(columnId);
    return changes > 0;
  });
}

export function moveColumn(db, columnId, toIndex) {
  return transaction(db, () => {
    const column = db.prepare("SELECT boardId FROM columns WHERE id = ?").get(columnId);
    if (!column) return false;

    const ids = db
      .prepare("SELECT id FROM columns WHERE boardId = ? ORDER BY position ASC")
      .all(column.boardId)
      .map((c) => c.id);
    const fromIndex = ids.indexOf(columnId);
    ids.splice(fromIndex, 1);
    const clamped = Math.max(0, Math.min(toIndex, ids.length));
    ids.splice(clamped, 0, columnId);

    renumber(db, "columns", "boardId", column.boardId, ids);
    return true;
  });
}

// ---- cards ----

export function addCard(db, columnId, title, idGenerator = defaultId) {
  const trimmed = requireTitle(title, "Card");
  const { maxPos } = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS maxPos FROM cards WHERE columnId = ?")
    .get(columnId);
  const card = { id: idGenerator(), columnId, title: trimmed, description: "", labels: [] };
  db.prepare("INSERT INTO cards (id, columnId, title, description, labels, position) VALUES (?, ?, ?, ?, ?, ?)").run(
    card.id,
    columnId,
    trimmed,
    "",
    "[]",
    maxPos + 1
  );
  return card;
}

/** Returns the updated card, or null if `cardId` doesn't exist. */
export function editCard(db, cardId, changes) {
  const current = db.prepare("SELECT title, description, labels FROM cards WHERE id = ?").get(cardId);
  if (!current) return null;

  const title = changes.title !== undefined ? requireTitle(changes.title, "Card") : current.title;
  const description = changes.description !== undefined ? changes.description : current.description;
  const labels = changes.labels !== undefined ? changes.labels : JSON.parse(current.labels);

  db.prepare("UPDATE cards SET title = ?, description = ?, labels = ? WHERE id = ?").run(
    title,
    description,
    JSON.stringify(labels),
    cardId
  );
  return { id: cardId, title, description, labels };
}

export function deleteCard(db, cardId) {
  const { changes } = db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);
  return changes > 0;
}

export function moveCard(db, cardId, toColumnId, toIndex) {
  return transaction(db, () => {
    const card = db.prepare("SELECT columnId FROM cards WHERE id = ?").get(cardId);
    if (!card) return false;
    const fromColumnId = card.columnId;

    const targetIds = db
      .prepare("SELECT id FROM cards WHERE columnId = ? AND id != ? ORDER BY position ASC")
      .all(toColumnId, cardId)
      .map((c) => c.id);

    const clamped = Math.max(0, Math.min(toIndex, targetIds.length));
    targetIds.splice(clamped, 0, cardId);

    db.prepare("UPDATE cards SET columnId = ? WHERE id = ?").run(toColumnId, cardId);
    renumber(db, "cards", "columnId", toColumnId, targetIds);

    if (fromColumnId !== toColumnId) {
      const sourceIds = db
        .prepare("SELECT id FROM cards WHERE columnId = ? ORDER BY position ASC")
        .all(fromColumnId)
        .map((c) => c.id);
      renumber(db, "cards", "columnId", fromColumnId, sourceIds);
    }
    return true;
  });
}
