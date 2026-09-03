/**
 * Kanban REST API + static frontend on Node's built-in http module --
 * no framework dependency. Serves the Phase 2 UI (server/public/) and
 * the /api/* endpoints from the same origin, so there's no CORS to
 * deal with. Routing is a plain switch over path segments, same shape
 * as todo-list's server.js.
 */

import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
} from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new Error("Invalid JSON body.");
  }
}

/** Wraps a handler that may throw (validation errors from db.js, e.g.
 * an empty title) into a 400 response instead of a 500. */
async function guarded(res, run) {
  try {
    await run();
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

async function handleApiRequest(db, req, res, segments) {
  // /api/boards, /api/boards/:boardId
  if (segments[1] === "boards" && segments.length <= 3) {
    if (req.method === "GET" && segments.length === 2) {
      sendJson(res, 200, listBoards(db));
      return;
    }
    if (req.method === "POST" && segments.length === 2) {
      await guarded(res, async () => {
        const body = await readJsonBody(req);
        sendJson(res, 201, createBoard(db, body.title ?? ""));
      });
      return;
    }
    if (req.method === "GET" && segments.length === 3) {
      const detail = getBoardDetail(db, segments[2]);
      if (!detail) return sendJson(res, 404, { error: "Board not found." });
      sendJson(res, 200, detail);
      return;
    }
    if (req.method === "DELETE" && segments.length === 3) {
      if (!deleteBoard(db, segments[2])) return sendJson(res, 404, { error: "Board not found." });
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // /api/boards/:boardId/columns
  if (req.method === "POST" && segments[1] === "boards" && segments[3] === "columns" && segments.length === 4) {
    await guarded(res, async () => {
      const body = await readJsonBody(req);
      sendJson(res, 201, addColumn(db, segments[2], body.title ?? ""));
    });
    return;
  }

  // /api/columns/:columnId, /api/columns/:columnId/move, /api/columns/:columnId/cards
  if (segments[1] === "columns" && segments.length >= 3) {
    const columnId = segments[2];

    if (req.method === "PATCH" && segments.length === 3) {
      await guarded(res, async () => {
        const body = await readJsonBody(req);
        const title = body.title ?? "";
        if (!renameColumn(db, columnId, title)) return sendJson(res, 404, { error: "Column not found." });
        sendJson(res, 200, { id: columnId, title: title.trim() });
      });
      return;
    }
    if (req.method === "DELETE" && segments.length === 3) {
      if (!deleteColumn(db, columnId)) return sendJson(res, 404, { error: "Column not found." });
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST" && segments[3] === "move" && segments.length === 4) {
      const body = await readJsonBody(req).catch(() => ({}));
      if (!moveColumn(db, columnId, Number(body.toIndex))) return sendJson(res, 404, { error: "Column not found." });
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST" && segments[3] === "cards" && segments.length === 4) {
      await guarded(res, async () => {
        const body = await readJsonBody(req);
        sendJson(res, 201, addCard(db, columnId, body.title ?? ""));
      });
      return;
    }
  }

  // /api/cards/:cardId, /api/cards/:cardId/move
  if (segments[1] === "cards" && segments.length >= 3) {
    const cardId = segments[2];

    if (req.method === "PATCH" && segments.length === 3) {
      await guarded(res, async () => {
        const body = await readJsonBody(req);
        const card = editCard(db, cardId, body);
        if (!card) return sendJson(res, 404, { error: "Card not found." });
        sendJson(res, 200, card);
      });
      return;
    }
    if (req.method === "DELETE" && segments.length === 3) {
      if (!deleteCard(db, cardId)) return sendJson(res, 404, { error: "Card not found." });
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST" && segments[3] === "move" && segments.length === 4) {
      const body = await readJsonBody(req).catch(() => ({}));
      if (!moveCard(db, cardId, body.toColumnId, Number(body.toIndex))) {
        return sendJson(res, 404, { error: "Card not found." });
      }
      res.writeHead(204);
      res.end();
      return;
    }
  }

  sendJson(res, 404, { error: "Not found." });
}

async function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  try {
    const data = await readFile(filePath);
    const contentType = CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found." });
  }
}

export function createServer(dbPath) {
  const db = openDb(dbPath);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] === "api") {
      handleApiRequest(db, req, res, segments).catch(() => {
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    if (req.method === "GET") {
      serveStatic(res, url.pathname).catch(() => {
        sendJson(res, 500, { error: "Internal server error." });
      });
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  });

  server.db = db;
  return server;
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const port = process.env.PORT || 3000;
  const server = createServer(process.env.DB_PATH || "kanban.sqlite");
  server.listen(port, () => {
    console.log(`Kanban API listening on http://localhost:${port}`);
  });
}
