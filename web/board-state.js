/**
 * Pure Kanban board state -- no DOM, no localStorage, no globals.
 *
 * A board is:
 *   { columns: [{ id, title, cardIds: [id, ...] }, ...],
 *     cards: { [id]: { id, title, description, labels: [] } } }
 *
 * `boardReducer(board, action)` is the single source of truth for
 * every state transition; the named functions below it (addColumn,
 * moveCard, ...) are thin, ergonomic wrappers that build the action
 * (generating an id where one is needed) and dispatch it -- so
 * there's exactly one place the actual rules live, and two ways to
 * reach them: call a function directly, or dispatch an action object
 * (which is what the undo/redo history wrapper in history.js needs).
 *
 * A no-op (unknown id, moving something into the position it's
 * already in isn't specially detected -- see the note on MOVE_COLUMN
 * / MOVE_CARD below) always returns the exact same board reference,
 * matching the rest of this portfolio's *-logic.js modules; that's
 * also what lets the history wrapper avoid polluting the undo stack
 * with actions that changed nothing.
 */

function defaultIdGenerator() {
  return crypto.randomUUID();
}

export function createBoard() {
  return { columns: [], cards: {} };
}

// ---- action-creator-style wrappers ----

export function addColumn(board, title, idGenerator = defaultIdGenerator) {
  return boardReducer(board, { type: "ADD_COLUMN", columnId: idGenerator(), title });
}

export function renameColumn(board, columnId, title) {
  return boardReducer(board, { type: "RENAME_COLUMN", columnId, title });
}

export function deleteColumn(board, columnId) {
  return boardReducer(board, { type: "DELETE_COLUMN", columnId });
}

export function moveColumn(board, columnId, toIndex) {
  return boardReducer(board, { type: "MOVE_COLUMN", columnId, toIndex });
}

export function addCard(board, columnId, title, idGenerator = defaultIdGenerator) {
  return boardReducer(board, { type: "ADD_CARD", cardId: idGenerator(), columnId, title });
}

export function editCard(board, cardId, changes) {
  return boardReducer(board, { type: "EDIT_CARD", cardId, changes });
}

export function deleteCard(board, cardId) {
  return boardReducer(board, { type: "DELETE_CARD", cardId });
}

export function moveCard(board, cardId, toColumnId, toIndex) {
  return boardReducer(board, { type: "MOVE_CARD", cardId, toColumnId, toIndex });
}

// ---- the reducer ----

export function boardReducer(board, action) {
  switch (action.type) {
    case "ADD_COLUMN": {
      const title = requireTitle(action.title, "Column");
      const column = { id: action.columnId, title, cardIds: [] };
      return { ...board, columns: [...board.columns, column] };
    }

    case "RENAME_COLUMN": {
      const title = requireTitle(action.title, "Column");
      const index = board.columns.findIndex((c) => c.id === action.columnId);
      if (index === -1) return board;
      const columns = [...board.columns];
      columns[index] = { ...columns[index], title };
      return { ...board, columns };
    }

    case "DELETE_COLUMN": {
      const column = board.columns.find((c) => c.id === action.columnId);
      if (!column) return board;
      const cards = { ...board.cards };
      for (const cardId of column.cardIds) delete cards[cardId];
      return { columns: board.columns.filter((c) => c.id !== action.columnId), cards };
    }

    case "MOVE_COLUMN": {
      const fromIndex = board.columns.findIndex((c) => c.id === action.columnId);
      if (fromIndex === -1) return board;
      const columns = [...board.columns];
      const [moved] = columns.splice(fromIndex, 1);
      const toIndex = clamp(action.toIndex, 0, columns.length);
      columns.splice(toIndex, 0, moved);
      return { ...board, columns };
    }

    case "ADD_CARD": {
      const title = requireTitle(action.title, "Card");
      const column = board.columns.find((c) => c.id === action.columnId);
      if (!column) throw new Error(`Unknown column: ${action.columnId}`);
      const card = { id: action.cardId, title, description: "", labels: [] };
      return {
        columns: board.columns.map((c) =>
          c.id === action.columnId ? { ...c, cardIds: [...c.cardIds, card.id] } : c
        ),
        cards: { ...board.cards, [card.id]: card },
      };
    }

    case "EDIT_CARD": {
      const card = board.cards[action.cardId];
      if (!card) return board;
      let changes = action.changes;
      if (changes.title !== undefined) {
        changes = { ...changes, title: requireTitle(changes.title, "Card") };
      }
      return { ...board, cards: { ...board.cards, [action.cardId]: { ...card, ...changes } } };
    }

    case "DELETE_CARD": {
      if (!board.cards[action.cardId]) return board;
      const cards = { ...board.cards };
      delete cards[action.cardId];
      return {
        columns: board.columns.map((c) =>
          c.cardIds.includes(action.cardId)
            ? { ...c, cardIds: c.cardIds.filter((id) => id !== action.cardId) }
            : c
        ),
        cards,
      };
    }

    case "MOVE_CARD": {
      if (!board.cards[action.cardId]) return board;
      const targetExists = board.columns.some((c) => c.id === action.toColumnId);
      if (!targetExists) return board;

      const columns = board.columns.map((c) => ({
        ...c,
        cardIds: c.cardIds.filter((id) => id !== action.cardId),
      }));
      const targetIndex = columns.findIndex((c) => c.id === action.toColumnId);
      const target = columns[targetIndex];
      const toIndex = clamp(action.toIndex, 0, target.cardIds.length);
      const cardIds = [...target.cardIds];
      cardIds.splice(toIndex, 0, action.cardId);
      columns[targetIndex] = { ...target, cardIds };

      return { ...board, columns };
    }

    default:
      return board;
  }
}

function requireTitle(title, kind) {
  const trimmed = title.trim();
  if (!trimmed) throw new Error(`${kind} title cannot be empty.`);
  return trimmed;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

// ---- selectors ----

export function cardsInColumn(board, columnId) {
  const column = board.columns.find((c) => c.id === columnId);
  if (!column) return [];
  return column.cardIds.map((id) => board.cards[id]);
}

export function findColumnOfCard(board, cardId) {
  return board.columns.find((c) => c.cardIds.includes(cardId)) ?? null;
}
