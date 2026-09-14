// 운송사와 첫 계정 만들기.
//
// 셀프 가입은 아직 없다. 지금은 이 스크립트로 계정을 만든다.
//
//   npx tsx scripts/create-company.ts "가나운수" you@example.com
//
// 비밀번호는 인자로 받지 않는다. 명령행 인자는 셸 기록과 프로세스 목록에 남는다.
// 임의로 만들어 화면에 한 번만 출력한다.

import { randomBytes } from "node:crypto";
import { createOwnerPool } from "../db/client";
import { hashPassword } from "../lib/password";
import { normalizeEmail } from "../lib/auth";

async function main() {
  const [name, rawEmail] = process.argv.slice(2);
  if (!name || !rawEmail) {
    console.error('사용법: npx tsx scripts/create-company.ts "회사 이름" 이메일');
    process.exit(1);
  }

  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) {
    console.error("이메일 형식이 아닙니다.");
    process.exit(1);
  }

  // 사람이 옮겨 적을 수 있는 길이로. 어차피 첫 로그인 후 바꾸는 값이다.
  const password = randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(password);

  const pool = createOwnerPool();
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const company = await client.query<{ id: string }>(
        "INSERT INTO company (name) VALUES ($1) RETURNING id",
        [name],
      );
      const companyId = company.rows[0]!.id;
      await client.query(
        "INSERT INTO app_user (company_id, email, password_hash, name) VALUES ($1, $2, $3, $4)",
        [companyId, email, passwordHash, name],
      );
      await client.query("COMMIT");

      console.log(`회사: ${name} (${companyId})`);
      console.log(`이메일: ${email}`);
      console.log(`비밀번호: ${password}`);
      console.log("\n이 비밀번호는 다시 볼 수 없습니다. 지금 옮겨 적으세요.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
