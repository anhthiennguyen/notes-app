import { createClient } from "@libsql/client";
import sharp from "sharp";
import { config } from "dotenv";

config({ path: ".env.local" });

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const { rows } = await turso.execute("SELECT id, content FROM Note WHERE content LIKE '%data:image%'");
console.log(`Found ${rows.length} notes with embedded images`);

for (const row of rows) {
  const id = row[0] ?? row.id;
  let content = row[1] ?? row.content;
  const original = content;

  const matches = [...content.matchAll(/data:image\/(png|jpeg|jpg|gif|webp);base64,([^"]+)/g)];
  if (!matches.length) continue;

  console.log(`Note ${id}: compressing ${matches.length} image(s)...`);

  for (const match of matches) {
    const fullDataUrl = match[0];
    const base64 = match[2];
    const buffer = Buffer.from(base64, "base64");
    const before = buffer.length;

    const compressed = await sharp(buffer)
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    const after = compressed.length;
    console.log(`  ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB`);

    const newDataUrl = `data:image/jpeg;base64,${compressed.toString("base64")}`;
    content = content.replace(fullDataUrl, newDataUrl);
  }

  if (content !== original) {
    await turso.execute({ sql: "UPDATE Note SET content = ? WHERE id = ?", args: [content, id] });
    console.log(`  Note ${id} saved`);
  }
}

console.log("Done.");
