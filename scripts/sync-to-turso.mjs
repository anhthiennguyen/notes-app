import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import { resolve } from "path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) { console.error("Missing env vars"); process.exit(1); }

const local = new Database(resolve("notes.db"), { readonly: true });
const turso = createClient({ url, authToken });

async function sync(table, rows, insertFn) {
  if (!rows.length) { console.log(`${table}: nothing to sync`); return; }
  console.log(`${table}: syncing ${rows.length} rows...`);
  for (const row of rows) await insertFn(row);
  console.log(`${table}: done`);
}

// Clear Turso first to avoid conflicts
await turso.execute("DELETE FROM DiagramKeyword");
await turso.execute("DELETE FROM Note");
await turso.execute("DELETE FROM Category");
await turso.execute("DELETE FROM Notebook");
await turso.execute("DELETE FROM TermDefinition");

// Insert in dependency order
const notebooks = local.prepare("SELECT * FROM Notebook").all();
await sync("Notebook", notebooks, (r) => turso.execute({
  sql: `INSERT INTO Notebook (id, name, coverImage, createdAt, updatedAt, graphManualEdges, graphEdgeLabels, graphNodePositions) VALUES (?,?,?,?,?,?,?,?)`,
  args: [r.id, r.name, r.coverImage ?? null, r.createdAt, r.updatedAt, r.graphManualEdges, r.graphEdgeLabels, r.graphNodePositions],
}));

// Categories: parents before children
const categories = local.prepare("SELECT * FROM Category ORDER BY parentId ASC NULLS FIRST").all();
await sync("Category", categories, (r) => turso.execute({
  sql: `INSERT INTO Category (id, name, "order", parentId, notebookId) VALUES (?,?,?,?,?)`,
  args: [r.id, r.name, r.order, r.parentId ?? null, r.notebookId ?? null],
}));

const notes = local.prepare("SELECT * FROM Note").all();
await sync("Note", notes, (r) => turso.execute({
  sql: `INSERT INTO Note (id, title, titleSetManually, content, maxWidth, drawingData, createdAt, updatedAt, notebookId) VALUES (?,?,?,?,?,?,?,?,?)`,
  args: [r.id, r.title, r.titleSetManually, r.content, r.maxWidth ?? null, r.drawingData, r.createdAt, r.updatedAt, r.notebookId ?? null],
}));

const keywords = local.prepare("SELECT * FROM DiagramKeyword").all();
await sync("DiagramKeyword", keywords, (r) => turso.execute({
  sql: `INSERT INTO DiagramKeyword (id, text, color, "order", x, y, categoryId, notebookId) VALUES (?,?,?,?,?,?,?,?)`,
  args: [r.id, r.text, r.color, r.order, r.x ?? null, r.y ?? null, r.categoryId ?? null, r.notebookId ?? null],
}));

const terms = local.prepare("SELECT * FROM TermDefinition").all();
await sync("TermDefinition", terms, (r) => turso.execute({
  sql: `INSERT INTO TermDefinition (id, term, definition) VALUES (?,?,?)`,
  args: [r.id, r.term, r.definition],
}));

console.log("\nSync complete.");
local.close();
