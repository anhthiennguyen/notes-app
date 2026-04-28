import { createClient } from "@libsql/client";
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
  process.exit(1);
}

const client = createClient({ url, authToken });

const migrationsDir = resolve("prisma/migrations");
const folders = readdirSync(migrationsDir)
  .filter((f) => f !== "migration_lock.toml")
  .sort();

for (const folder of folders) {
  const sqlPath = join(migrationsDir, folder, "migration.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
  console.log(`Applying ${folder} (${statements.length} statements)...`);
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
    } catch (e) {
      if (e.message?.includes("already exists") || e.message?.includes("duplicate column name")) {
        console.log(`  Skipping (already exists): ${stmt.slice(0, 60)}...`);
      } else {
        throw e;
      }
    }
  }
}

console.log("Done.");
