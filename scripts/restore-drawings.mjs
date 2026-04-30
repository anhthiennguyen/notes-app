import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import { resolve } from "path";
import { config } from "dotenv";

config({ path: ".env.local" });

const local = new Database(resolve("notes.db"), { readonly: true });
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Find notes in Turso that have drawing blocks with JPEG data (broken)
const { rows } = await turso.execute(
  "SELECT id, content FROM Note WHERE content LIKE '%data-drawing=\"data:image/jpeg%'"
);
console.log(`Found ${rows.length} notes with corrupted drawings`);

for (const row of rows) {
  const id = Number(row[0] ?? row.id);

  // Get original content from local SQLite
  const localNote = local.prepare("SELECT content FROM Note WHERE id = ?").get(id);
  if (!localNote) { console.log(`Note ${id}: not found locally, skipping`); continue; }

  // Extract original data-drawing values from local SQLite
  const localDrawings = [...localNote.content.matchAll(/data-drawing="([^"]*)"/g)].map(m => m[1]);
  if (!localDrawings.length) { console.log(`Note ${id}: no drawings in local copy, skipping`); continue; }

  // Replace data-drawing values in Turso content with originals (by order)
  let tursoContent = row[1] ?? row.content;
  let i = 0;
  tursoContent = tursoContent.replace(/data-drawing="([^"]*)"/g, () => {
    const original = localDrawings[i++];
    return original !== undefined ? `data-drawing="${original}"` : `data-drawing=""`;
  });

  await turso.execute({ sql: "UPDATE Note SET content = ? WHERE id = ?", args: [tursoContent, id] });
  console.log(`Note ${id}: restored ${localDrawings.length} drawing(s)`);
}

console.log("Done.");
