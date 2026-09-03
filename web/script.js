/**
 * Wires board-state.js + history.js to the DOM. There's exactly one
 * mutable variable in this whole file (`history`); every change goes
 * through `dispatch(action)`, which runs the action through the
 * undo/redo-wrapped reducer and re-renders the whole board from the
 * result. The DOM is never patched in place -- render() always
 * rebuilds it from `history.present`, which is what keeps this file
 * simple: there's no separate "sync the DOM back to state" logic to
 * get wrong.
 *
 * There are no confirm() dialogs anywhere, including on delete --
 * undo makes them unnecessary.
 */

import { boardReducer, cardsInColumn, findColumnOfCard } from "./board-state.js";
import { canRedo, canUndo, createHistoryReducer, initHistory } from "./history.js";

const LABEL_COLORS = {
  bug: "#f87171",
  feature: "#34d399",
  urgent: "#fbbf24",
};

const CARD_MIME = "application/x-kanban-card";
const COLUMN_MIME = "application/x-kanban-column";

function sampleBoard() {
  let id = 0;
  const nextId = () => `seed-${++id}`;

  const columns = [
    { title: "A faire", cards: [["Ecrire le cahier des charges", ["bug", "urgent"]], ["Choisir la palette de couleurs", []]] },
    { title: "En cours", cards: [["Implementer le drag & drop", ["feature"]]] },
    { title: "Termine", cards: [["Scaffolder le repo", []]] },
  ];

  const board = { columns: [], cards: {} };
  for (const { title, cards } of columns) {
    const columnId = nextId();
    const cardIds = [];
    for (const [cardTitle, labels] of cards) {
      const cardId = nextId();
      board.cards[cardId] = { id: cardId, title: cardTitle, description: "", labels };
      cardIds.push(cardId);
    }
    board.columns.push({ id: columnId, title, cardIds });
  }
  return board;
}

// ---- state ----

const dispatchToHistory = createHistoryReducer(boardReducer);
let history = initHistory(sampleBoard());

// Transient, render-only UI state (which inline form is open, which
// card to refocus after the next render). Reset implicitly on every
// dispatch-triggered re-render.
let addingColumn = false;
let addingCardInColumn = null;
let focusCardAfterRender = null;

function dispatch(action) {
  history = dispatchToHistory(history, action);
  addingColumn = false;
  addingCardInColumn = null;
  update();
}

// ---- DOM refs ----

const boardEl = document.getElementById("board");
const columnTemplate = document.getElementById("column-template");
const cardTemplate = document.getElementById("card-template");
const undoBtn = document.getElementById("undo-btn");
const redoBtn = document.getElementById("redo-btn");

undoBtn.addEventListener("click", () => dispatch({ type: "UNDO" }));
redoBtn.addEventListener("click", () => dispatch({ type: "REDO" }));

document.addEventListener("keydown", (event) => {
  const active = document.activeElement;
  const tag = active?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();

  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    dispatch({ type: "UNDO" });
    return;
  }
  if (key === "y" || (key === "z" && event.shiftKey)) {
    event.preventDefault();
    dispatch({ type: "REDO" });
    return;
  }
  if (active?.classList.contains("card")) {
    moveCardByKeyboard(active, event);
  }
});

/** Keyboard-only fallback for reordering, since drag & drop has no
 * built-in accessible equivalent: with a card focused, Ctrl+Up/Down
 * reorders it within its column and Ctrl+Left/Right moves it to the
 * adjacent column (appended at the end). */
function moveCardByKeyboard(cardEl, event) {
  const deltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const delta = deltas[event.key];
  if (!delta) return;
  event.preventDefault();

  const cardId = cardEl.dataset.cardId;
  const board = history.present;
  const column = findColumnOfCard(board, cardId);
  if (!column) return;

  const [rowDelta, colDelta] = delta;
  focusCardAfterRender = cardId;

  if (rowDelta !== 0) {
    const toIndex = column.cardIds.indexOf(cardId) + rowDelta;
    if (toIndex < 0 || toIndex >= column.cardIds.length) {
      focusCardAfterRender = null;
      return;
    }
    dispatch({ type: "MOVE_CARD", cardId, toColumnId: column.id, toIndex });
    return;
  }

  const columnIndex = board.columns.findIndex((c) => c.id === column.id);
  const targetColumn = board.columns[columnIndex + colDelta];
  if (!targetColumn) {
    focusCardAfterRender = null;
    return;
  }
  dispatch({ type: "MOVE_CARD", cardId, toColumnId: targetColumn.id, toIndex: targetColumn.cardIds.length });
}

// ---- render ----

function update() {
  render(history.present);
  undoBtn.disabled = !canUndo(history);
  redoBtn.disabled = !canRedo(history);
  if (focusCardAfterRender) {
    boardEl.querySelector(`.card[data-card-id="${focusCardAfterRender}"]`)?.focus();
    focusCardAfterRender = null;
  }
}

function render(board) {
  boardEl.innerHTML = "";
  for (const column of board.columns) {
    boardEl.appendChild(renderColumn(board, column));
  }
  boardEl.appendChild(renderAddColumnAffordance());
}

function renderColumn(board, column) {
  const node = columnTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.columnId = column.id;

  const titleEl = node.querySelector(".column-title");
  titleEl.textContent = column.title;
  node.querySelector(".card-count").textContent = String(column.cardIds.length);

  const header = node.querySelector(".column-header");
  header.setAttribute("draggable", "true");
  attachColumnDragHandlers(header, node, column.id);

  titleEl.addEventListener("click", () => beginRenameColumn(node, titleEl, column));

  node.querySelector(".column-delete-btn").addEventListener("click", () => {
    dispatch({ type: "DELETE_COLUMN", columnId: column.id });
  });

  const list = node.querySelector(".card-list");
  for (const card of cardsInColumn(board, column.id)) {
    list.appendChild(renderCard(card, column.id));
  }
  attachCardListDropHandlers(list, column.id);

  const addCardBtn = node.querySelector(".add-card-btn");
  if (addingCardInColumn === column.id) {
    addCardBtn.replaceWith(renderAddCardForm(column.id));
  } else {
    addCardBtn.addEventListener("click", () => {
      addingCardInColumn = column.id;
      update();
      focusOpenForm();
    });
  }

  return node;
}

function renderCard(card, columnId) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.cardId = card.id;

  const titleEl = node.querySelector(".card-title");
  titleEl.textContent = card.title;
  titleEl.addEventListener("click", () => beginEditCard(node, titleEl, card));

  const labelsEl = node.querySelector(".card-labels");
  for (const label of card.labels) {
    const pill = document.createElement("span");
    pill.className = "card-label";
    pill.style.background = LABEL_COLORS[label] ?? "var(--muted)";
    pill.textContent = label;
    labelsEl.appendChild(pill);
  }

  node.querySelector(".card-delete-btn").addEventListener("click", () => {
    dispatch({ type: "DELETE_CARD", cardId: card.id });
  });

  attachCardDragHandlers(node, card.id, columnId);

  return node;
}

function renderAddColumnAffordance() {
  const wrapper = document.createElement("div");
  wrapper.className = "add-column";

  if (!addingColumn) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add-column-btn";
    btn.textContent = "+ Ajouter une colonne";
    btn.addEventListener("click", () => {
      addingColumn = true;
      update();
      focusOpenForm();
    });
    wrapper.appendChild(btn);
    return wrapper;
  }

  const form = document.createElement("form");
  form.className = "add-column-form";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Titre de la colonne";
  input.maxLength = 100;

  const actions = document.createElement("div");
  actions.className = "add-form-actions";
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = "Ajouter";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Annuler";
  cancelBtn.addEventListener("click", () => {
    addingColumn = false;
    update();
  });
  actions.append(submitBtn, cancelBtn);

  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      addingColumn = false;
      update();
    }
  });

  form.append(input, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    dispatch({ type: "ADD_COLUMN", columnId: crypto.randomUUID(), title });
  });

  wrapper.appendChild(form);
  return wrapper;
}

function renderAddCardForm(columnId) {
  const form = document.createElement("form");
  form.className = "add-card-form";

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Titre de la carte";
  textarea.rows = 2;
  textarea.maxLength = 300;

  const actions = document.createElement("div");
  actions.className = "add-form-actions";
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = "Ajouter";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Annuler";
  cancelBtn.addEventListener("click", () => {
    addingCardInColumn = null;
    update();
  });
  actions.append(submitBtn, cancelBtn);

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      addingCardInColumn = null;
      update();
    }
  });

  form.append(textarea, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = textarea.value.trim();
    if (!title) return;
    dispatch({ type: "ADD_CARD", cardId: crypto.randomUUID(), columnId, title });
  });

  return form;
}

function focusOpenForm() {
  boardEl.querySelector(".add-column-form input, .add-card-form textarea")?.focus();
}

// ---- inline rename / edit ----

function beginRenameColumn(columnNode, titleEl, column) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "column-title-input";
  input.value = column.title;
  input.maxLength = 100;

  const commit = () => {
    const title = input.value.trim();
    if (title && title !== column.title) {
      dispatch({ type: "RENAME_COLUMN", columnId: column.id, title });
    } else {
      input.replaceWith(titleEl);
    }
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      input.removeEventListener("blur", commit);
      input.replaceWith(titleEl);
    }
  });

  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

function beginEditCard(cardNode, titleEl, card) {
  const textarea = document.createElement("textarea");
  textarea.className = "card-title-input";
  textarea.value = card.title;
  textarea.rows = 2;
  textarea.maxLength = 300;

  const commit = () => {
    const title = textarea.value.trim();
    if (title && title !== card.title) {
      dispatch({ type: "EDIT_CARD", cardId: card.id, changes: { title } });
    } else {
      textarea.replaceWith(titleEl);
    }
  };

  textarea.addEventListener("blur", commit);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      textarea.blur();
    } else if (event.key === "Escape") {
      textarea.removeEventListener("blur", commit);
      textarea.replaceWith(titleEl);
    }
  });

  titleEl.replaceWith(textarea);
  textarea.focus();
  textarea.select();
}

// ---- drag & drop: cards ----

function attachCardDragHandlers(cardEl, cardId, columnId) {
  cardEl.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData(CARD_MIME, JSON.stringify({ cardId, fromColumnId: columnId }));
    event.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => cardEl.classList.add("dragging"));
  });
  cardEl.addEventListener("dragend", () => cardEl.classList.remove("dragging"));
}

function attachCardListDropHandlers(listEl, columnId) {
  listEl.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes(CARD_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    listEl.classList.add("drag-over");
  });

  listEl.addEventListener("dragleave", (event) => {
    if (event.target === listEl) listEl.classList.remove("drag-over");
  });

  listEl.addEventListener("drop", (event) => {
    if (!event.dataTransfer.types.includes(CARD_MIME)) return;
    event.preventDefault();
    listEl.classList.remove("drag-over");

    const { cardId } = JSON.parse(event.dataTransfer.getData(CARD_MIME));
    const toIndex = dropIndexAmong(listEl.querySelectorAll(".card"), cardId, event.clientY, "vertical");
    dispatch({ type: "MOVE_CARD", cardId, toColumnId: columnId, toIndex });
  });
}

// ---- drag & drop: columns ----

function attachColumnDragHandlers(headerEl, columnEl, columnId) {
  headerEl.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData(COLUMN_MIME, columnId);
    event.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => columnEl.classList.add("dragging"));
  });
  headerEl.addEventListener("dragend", () => columnEl.classList.remove("dragging"));
}

// Attached once (not per-column, since boardEl itself is never
// recreated by render()) -- reordering columns is a drop on the board
// background, not on any one column.
function attachBoardColumnDropHandlers() {
  boardEl.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes(COLUMN_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  boardEl.addEventListener("drop", (event) => {
    if (!event.dataTransfer.types.includes(COLUMN_MIME)) return;
    event.preventDefault();

    const draggedColumnId = event.dataTransfer.getData(COLUMN_MIME);
    const toIndex = dropIndexAmong(boardEl.querySelectorAll(".column"), draggedColumnId, event.clientX, "horizontal");
    dispatch({ type: "MOVE_COLUMN", columnId: draggedColumnId, toIndex });
  });
}

/** Where, among `elements` (each with a data-card-id or data-column-id), a
 * drop at `position` (clientY for vertical lists, clientX for horizontal)
 * should insert -- skipping the element being dragged (`draggedId`), since
 * board-state.js's MOVE_CARD/MOVE_COLUMN both index into the list *after*
 * the dragged item has already been removed from it. */
function dropIndexAmong(elements, draggedId, position, axis) {
  const others = [...elements].filter((el) => el.dataset.cardId !== draggedId && el.dataset.columnId !== draggedId);
  for (let i = 0; i < others.length; i++) {
    const rect = others[i].getBoundingClientRect();
    const midpoint = axis === "vertical" ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    if (position < midpoint) return i;
  }
  return others.length;
}

attachBoardColumnDropHandlers();
update();
