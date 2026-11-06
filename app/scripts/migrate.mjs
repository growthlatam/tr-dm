// Applies supabase/migrations/*.sql in order, once each. Usage: npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}
const dir = path.join(process.cwd(), "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())");
const done = new Set((await db.query("select name from public._migrations")).rows.map((r) => r.name));
for (const f of files) {
  if (done.has(f)) {
    console.log("skip   ", f);
    continue;
  }
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  try {
    await db.query("begin");
    await db.query(sql);
    await db.query("insert into public._migrations (name) values ($1)", [f]);
    await db.query("commit");
    console.log("applied", f);
  } catch (e) {
    await db.query("rollback");
    console.error("FAILED ", f, "-", e.message);
    process.exitCode = 1;
    break;
  }
}
await db.end();
