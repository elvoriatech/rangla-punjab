import { Pool } from "pg";
async function main(): Promise<void> {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const p = new Pool({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl: false,
  });
  const c = await p.connect();
  const r = await c.query(
    "select migration_name, finished_at is not null done, rolled_back_at is not null rb from _prisma_migrations where finished_at is null or rolled_back_at is not null order by started_at",
  );
  console.log("unfinished / rolled-back rows:", r.rowCount);
  for (const x of r.rows) console.log(`  ${x.migration_name}  done=${x.done} rolledback=${x.rb}`);
  const applied = await c.query(
    "select count(*)::int n from _prisma_migrations where finished_at is not null and rolled_back_at is null",
  );
  console.log("cleanly applied:", applied.rows[0].n);
  c.release();
  await p.end();
}
main().catch((e) => console.error(e instanceof Error ? e.message.split("\n")[0] : e));
