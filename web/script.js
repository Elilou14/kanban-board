/**
 * Phase 1, step 1: state -> DOM only. No event listeners yet (drag &
 * drop, forms, undo/redo) -- that's the next commit. This one just
 * proves the layout and the render function are right, against a
 * small hardcoded sample board.
 */

import { addCard, addColumn, createBoard } from "./board-state.js";

const LABEL_COLORS = {
  bug: "#f87171",
  feature: "#34d399",
  urgent: "#fbbf24",
};

function sampleBoard() {
  let id = 0;
  const nextId = () => `seed-${++id}`;

  let board = createBoard();
  board = addColumn(board, "A faire", nextId);
  board = addColumn(board, "En cours", nextId);
  board = addColumn(board, "Termine", nextId);
  const [todo, doing, done] = board.columns;

  board = addCard(board, todo.id, "Ecrire le cahier des charges", nextId);
  board = addCard(board, todo.id, "Choisir la palette de couleurs", nextId);
  board = addCard(board, doing.id, "Implementer le drag & drop", nextId);
  board = addCard(board, done.id, "Scaffolder le repo", nextId);

  board.cards[Object.keys(board.cards)[2]].labels = ["feature"];
  board.cards[Object.keys(board.cards)[0]].labels = ["bug", "urgent"];

  return board;
}

const boardEl = document.getElementById("board");
const columnTemplate = document.getElementById("column-template");
const cardTemplate = document.getElementById("card-template");

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
  node.querySelector(".column-title").textContent = column.title;
  node.querySelector(".card-count").textContent = String(column.cardIds.length);

  const list = node.querySelector(".card-list");
  for (const cardId of column.cardIds) {
    list.appendChild(renderCard(board.cards[cardId]));
  }
  return node;
}

function renderCard(card) {
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.cardId = card.id;
  node.querySelector(".card-title").textContent = card.title;

  const labelsEl = node.querySelector(".card-labels");
  for (const label of card.labels) {
    const pill = document.createElement("span");
    pill.className = "card-label";
    pill.style.background = LABEL_COLORS[label] ?? "var(--muted)";
    pill.textContent = label;
    labelsEl.appendChild(pill);
  }
  return node;
}

function renderAddColumnAffordance() {
  const wrapper = document.createElement("div");
  wrapper.className = "add-column";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "add-column-btn";
  btn.textContent = "+ Ajouter une colonne";
  wrapper.appendChild(btn);
  return wrapper;
}

render(sampleBoard());
