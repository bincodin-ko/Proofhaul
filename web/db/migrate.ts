// 마이그레이션 러너.
//
// db/migrations/*.sql을 이름순으로, 각각 하나의 트랜잭션에서 돌린다.
// 적용한 것은 schema_migrations에 남긴다. 이미 적용된 파일은 건너뛴다.
//
//   npm run migrate

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOwnerPool } from "./client";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "migrations");

export async function migrate(): Promise<string[]> {
  const pool = createOwnerPool();
  const applied: string[] = [];
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    const done = new Set(
      (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(
        (r) => r.name,
      ),
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(DIR, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
        console.log(`applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`${file} 적용 실패: ${(error as Error).message}`, { cause: error });
      } finally {
        client.release();
      }
    }

    if (applied.length === 0) console.log("적용할 마이그레이션이 없습니다.");
    return applied;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  migrate().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
