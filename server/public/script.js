/**
 * Phase 2 frontend: a board picker (list/create/delete boards) plus
 * the same board UI as Phase 1 (drag & drop, inline edit, labels) --
 * but every mutation goes through the REST API instead of a local
 * reducer. There's deliberately no undo/redo here: that's Phase 1's
 * state-management showcase (a reducer wrapped in history); Phase
 * 2's is a different one -- keeping local state in sync with a
 * server that's the actual source of truth, several clients could in
 * principle be looking at the same board.
 *
 * Everything except drag & drop is simple request-then-refetch: await
 * the API call, then re-GET the board and re-render. Drag & drop is
 * the one place that matters enough to feel instant, so it applies
 * the move to the local board immediately and re-renders (optimistic),
 * fires the API call in the background, and rolls the local board
 * back (with an error banner) if that call fails.
 */

const API = "/api";

let board = null; // current board detail, or null while on the picker

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `La requete a echoue (${res.status}).`);
  return data;
}

async function refreshBoard() {
  board = await api("GET", `/boards/${board.id}`);
  renderBoard();
}

const LABEL_COLORS = {
  bug: "#f87171",
  feature: "#34d399",
  urgent: "#fbbf24",
};

const CARD_MIME = "application/x-kanban-card";
const COLUMN_MIME = "application/x-kanban-column";

// ---- DOM refs ----

const pageTitle = document.getElementById("page-title");
const backBtn = document.getElementById("back-btn");
const errorBanner = document.getElementById("error-banner");
const pickerEl = document.getElementById("picker");
const boardEl = document.getElementById("board");
const newBoardForm = document.getElementById("new-board-form");
const newBoardTitleInput = document.getElementById("new-board-title");
const boardListEl = document.getElementById("board-list");
const noBoardsMessage = document.getElementById("no-boards-message");
const columnTemplate = document.getElementById("column-template");
const cardTemplate = document.getElementById("card-template");

let errorTimer = null;
function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => {
    errorBanner.hidden = true;
  }, 5000);
}

// ---- navigation ----

backBtn.addEventListener("click", () => showPicker());

async function showPicker() {
  board = null;
  pickerEl.hidden = false;
  boardEl.hidden = true;
  backBtn.hidden = true;
  pageTitle.textContent = "Kanban Board";
  try {
    renderPicker(await api("GET", "/boards"));
  } catch (err) {
    showError(err.message);
  }
}

async function openBoard(boardId) {
  try {
    board = await api("GET", `/boards/${boardId}`);
  } catch (err) {
    showError(err.message);
    return;
  }
  pickerEl.hidden = true;
  boardEl.hidden = false;
  backBtn.hidden = false;
  pageTitle.textContent = board.title;
  renderBoard();
}

// ---- picker ----

function renderPicker(boards) {
  boardListEl.innerHTML = "";
  noBoardsMessage.hidden = boards.length > 0;

  for (const b of boards) {
    const li = document.createElement("li");
    li.className = "board-list-item";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "board-open-btn";
    openBtn.textContent = b.title;
    openBtn.addEventListener("click", () => openBoard(b.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "board-delete-btn";
    deleteBtn.textContent = "×";
    deleteBtn.setAttribute("aria-label", "Supprimer le tableau");
    deleteBtn.addEventListener("click", async () => {
      try {
        await api("DELETE", `/boards/${b.id}`);
        renderPicker(await api("GET", "/boards"));
      } catch (err) {
        showError(err.message);
      }
    });

    li.append(openBtn, deleteBtn);
    boardListEl.appendChild(li);
  }
}

newBoardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = newBoardTitleInput.value.trim();
  if (!title) return;
  try {
    const created = await api("POST", "/boards", { title });
    newBoardTitleInput.value = "";
    await openBoard(created.id);
  } catch (err) {
    showError(err.message);
  }
});

// ---- keyboard shortcuts (board view only) ----

let focusCardAfterRender = null;

document.addEventListener("keydown", (event) => {
  if (!board) return; // on the picker, nothing to do here

  const active = document.activeElement;
  if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;

  if (event.ctrlKey && active?.classList.contains("card")) {
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
  const column = board.columns.find((c) => c.cardIds.includes(cardId));
  if (!column) return;

  const [rowDelta, colDelta] = delta;
  focusCardAfterRender = cardId;

  if (rowDelta !== 0) {
    const toIndex = column.cardIds.indexOf(cardId) + rowDelta;
    if (toIndex < 0 || toIndex >= column.cardIds.length) {
      focusCardAfterRender = null;
      return;
    }
    moveCardOptimistic(cardId, column.id, toIndex);
    return;
  }

  const columnIndex = board.columns.findIndex((c) => c.id === column.id);
  const targetColumn = board.columns[columnIndex + colDelta];
  if (!targetColumn) {
    focusCardAfterRender = null;
    return;
  }
  moveCardOptimistic(cardId, targetColumn.id, targetColumn.cardIds.length);
}

// ---- render: board ----

function renderBoard() {
  boardEl.innerHTML = "";
  if (board.columns.length === 0) {
    const msg = document.createElement("p");
    msg.className = "empty-board-message";
    msg.textContent = "Ajoutez votre premiere colonne pour commencer.";
    boardEl.appendChild(msg);
  }
  for (const column of board.columns) {
    boardEl.appendChild(renderColumn(column));
  }
  boardEl.appendChild(renderAddColumnAffordance());

  if (focusCardAfterRender) {
    boardEl.querySelector(`.card[data-card-id="${focusCardAfterRender}"]`)?.focus();
    focusCardAfterRender = null;
  }
}

let addingColumn = false;
let addingCardInColumn = null;

function renderColumn(column) {
  const node = columnTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.columnId = column.id;

  const titleEl = node.querySelector(".column-title");
  titleEl.textContent = column.title;
  node.querySelector(".card-count").textContent = String(column.cardIds.length);

  const header = node.querySelector(".column-header");
  header.setAttribute("draggable", "true");
  attachColumnDragHandlers(header, node, column.id);

  titleEl.addEventListener("click", () => beginRenameColumn(titleEl, column));

  node.querySelector(".column-delete-btn").addEventListener("click", async () => {
    try {
      await api("DELETE", `/columns/${column.id}`);
      await refreshBoard();
    } catch (err) {
      showError(err.message);
    }
  });

  const list = node.querySelector(".card-list");
  for (const cardId of column.cardIds) {
    list.appendChild(renderCard(board.cards[cardId], column.id));
  }
  attachCardListDropHandlers(list, column.id);

  const addCardBtn = node.querySelector(".add-card-btn");
  if (addingCardInColumn === column.id) {
    addCardBtn.replaceWith(renderAddCardForm(column.id));
  } else {
    addCardBtn.addEventListener("click", () => {
      addingCardInColumn = column.id;
      renderBoard();
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
  titleEl.addEventListener("click", () => beginEditCard(titleEl, card));

  const labelsEl = node.querySelector(".card-labels");
  for (const label of card.labels) {
    const pill = document.createElement("span");
    pill.className = "card-label";
    pill.style.background = LABEL_COLORS[label] ?? "var(--muted)";
    pill.textContent = label;
    pill.title = "Cliquer pour retirer";
    pill.addEventListener("click", async () => {
      try {
        await api("PATCH", `/cards/${card.id}`, { labels: card.labels.filter((l) => l !== label) });
        await refreshBoard();
      } catch (err) {
        showError(err.message);
      }
    });
    labelsEl.appendChild(pill);
  }

  const availableLabels = Object.keys(LABEL_COLORS).filter((l) => !card.labels.includes(l));
  if (availableLabels.length > 0) {
    const addLabelBtn = document.createElement("button");
    addLabelBtn.type = "button";
    addLabelBtn.className = "card-label-add-btn";
    addLabelBtn.textContent = "+ etiquette";
    addLabelBtn.addEventListener("click", () => openLabelPicker(addLabelBtn, card, availableLabels));
    labelsEl.appendChild(addLabelBtn);
  }

  node.querySelector(".card-delete-btn").addEventListener("click", async () => {
    try {
      await api("DELETE", `/cards/${card.id}`);
      await refreshBoard();
    } catch (err) {
      showError(err.message);
    }
  });

  attachCardDragHandlers(node, card.id, columnId);

  return node;
}

function openLabelPicker(addLabelBtn, card, availableLabels) {
  const picker = document.createElement("div");
  picker.className = "label-picker";

  for (const label of availableLabels) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "label-picker-option";
    option.style.background = LABEL_COLORS[label];
    option.textContent = label;
    option.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await api("PATCH", `/cards/${card.id}`, { labels: [...card.labels, label] });
        await refreshBoard();
      } catch (err) {
        showError(err.message);
      }
    });
    picker.appendChild(option);
  }

  addLabelBtn.replaceWith(picker);

  setTimeout(() => document.addEventListener("click", closeOnOutsideClick), 0);
  function closeOnOutsideClick(event) {
    if (picker.isConnected && !picker.contains(event.target)) {
      picker.replaceWith(addLabelBtn);
    }
    document.removeEventListener("click", closeOnOutsideClick);
  }
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
      renderBoard();
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
    renderBoard();
  });
  actions.append(submitBtn, cancelBtn);

  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      addingColumn = false;
      renderBoard();
    }
  });

  form.append(input, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    try {
      await api("POST", `/boards/${board.id}/columns`, { title });
      addingColumn = false;
      await refreshBoard();
    } catch (err) {
      showError(err.message);
    }
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
    renderBoard();
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
      renderBoard();
    }
  });

  form.append(textarea, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = textarea.value.trim();
    if (!title) return;
    try {
      await api("POST", `/columns/${columnId}/cards`, { title });
      addingCardInColumn = null;
      await refreshBoard();
    } catch (err) {
      showError(err.message);
    }
  });

  return form;
}

function focusOpenForm() {
  boardEl.querySelector(".add-column-form input, .add-card-form textarea")?.focus();
}

// ---- inline rename / edit ----

function beginRenameColumn(titleEl, column) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "column-title-input";
  input.value = column.title;
  input.maxLength = 100;

  const commit = async () => {
    const title = input.value.trim();
    if (!title || title === column.title) {
      input.replaceWith(titleEl);
      return;
    }
    try {
      await api("PATCH", `/columns/${column.id}`, { title });
      await refreshBoard();
    } catch (err) {
      showError(err.message);
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

function beginEditCard(titleEl, card) {
  const textarea = document.createElement("textarea");
  textarea.className = "card-title-input";
  textarea.value = card.title;
  textarea.rows = 2;
  textarea.maxLength = 300;

  const commit = async () => {
    const title = textarea.value.trim();
    if (!title || title === card.title) {
      textarea.replaceWith(titleEl);
      return;
    }
    try {
      await api("PATCH", `/cards/${card.id}`, { title });
      await refreshBoard();
    } catch (err) {
      showError(err.message);
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

// ---- drag & drop: cards (optimistic) ----

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
    moveCardOptimistic(cardId, columnId, toIndex);
  });
}

function locallyMoveCard(boardData, cardId, toColumnId, toIndex) {
  const columns = boardData.columns.map((c) => ({ ...c, cardIds: c.cardIds.filter((id) => id !== cardId) }));
  const targetIndex = columns.findIndex((c) => c.id === toColumnId);
  const target = columns[targetIndex];
  const clamped = Math.max(0, Math.min(toIndex, target.cardIds.length));
  const cardIds = [...target.cardIds];
  cardIds.splice(clamped, 0, cardId);
  columns[targetIndex] = { ...target, cardIds };
  return { ...boardData, columns };
}

async function moveCardOptimistic(cardId, toColumnId, toIndex) {
  const previous = board;
  board = locallyMoveCard(board, cardId, toColumnId, toIndex);
  renderBoard();
  try {
    await api("POST", `/cards/${cardId}/move`, { toColumnId, toIndex });
  } catch (err) {
    board = previous;
    renderBoard();
    showError(err.message);
  }
}

// ---- drag & drop: columns (optimistic) ----

function attachColumnDragHandlers(headerEl, columnEl, columnId) {
  headerEl.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData(COLUMN_MIME, columnId);
    event.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => columnEl.classList.add("dragging"));
  });
  headerEl.addEventListener("dragend", () => columnEl.classList.remove("dragging"));
}

function attachBoardColumnDropHandlers() {
  boardEl.addEventListener("dragover", (event) => {
    if (!event.dataTransfer.types.includes(COLUMN_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  boardEl.addEventListener("drop", (event) => {
    if (!event.dataTransfer.types.includes(COLUMN_MIME)) return;
    event.preventDefault();

    const columnId = event.dataTransfer.getData(COLUMN_MIME);
    const toIndex = dropIndexAmong(boardEl.querySelectorAll(".column"), columnId, event.clientX, "horizontal");
    moveColumnOptimistic(columnId, toIndex);
  });
}

function locallyMoveColumn(boardData, columnId, toIndex) {
  const columns = [...boardData.columns];
  const fromIndex = columns.findIndex((c) => c.id === columnId);
  const [moved] = columns.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(toIndex, columns.length));
  columns.splice(clamped, 0, moved);
  return { ...boardData, columns };
}

async function moveColumnOptimistic(columnId, toIndex) {
  const previous = board;
  board = locallyMoveColumn(board, columnId, toIndex);
  renderBoard();
  try {
    await api("POST", `/columns/${columnId}/move`, { toIndex });
  } catch (err) {
    board = previous;
    renderBoard();
    showError(err.message);
  }
}

/** Where, among `elements`, a drop at `position` (clientY for vertical
 * lists, clientX for horizontal) should insert -- skipping the
 * element being dragged, since the server's move endpoints (like
 * board-state.js's MOVE_CARD/MOVE_COLUMN on the Phase 1 side) index
 * into the list *after* the dragged item has already been removed
 * from it. */
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
showPicker();
