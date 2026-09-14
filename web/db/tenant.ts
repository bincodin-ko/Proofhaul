// 테넌트 분리의 유일한 진입점.
//
// 회사 데이터를 읽거나 쓰는 코드는 전부 withCompany를 거친다. 다른 경로로 풀을
// 직접 쓰지 않는다. 검사를 앱 곳곳에 흩어두면 하나만 빠져도 새어 나간다
// (05-SECURITY 위협 2 "애플리케이션 코드에 흩어두지 말고 한 곳에서 검사").
//
// 실제 차단은 DB의 RLS가 한다. 이 파일이 하는 일은 트랜잭션마다 "지금 어느 회사인지"를
// 세션에 심어주는 것뿐이다. 심지 않으면 아무 행도 보이지 않는다.

import { getAppPool, sqlOn, type Sql } from "./client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantError extends Error {}

/**
 * 한 회사의 맥락에서 트랜잭션을 연다.
 *
 * SET LOCAL이라 트랜잭션이 끝나면 맥락도 사라진다. 풀에서 다음 요청이 같은 커넥션을
 * 받아도 앞 요청의 회사가 남아 있지 않는다. 이게 SET LOCAL을 쓰는 이유다.
 */
export async function withCompany<T>(
  companyId: string,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(companyId)) {
    // 형식이 틀린 값이 여기까지 왔다는 건 호출부가 검증을 안 했다는 뜻이다.
    throw new TenantError("company_id가 UUID가 아닙니다.");
  }

  const client = await getAppPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

    // 심은 값이 정말로 박혔는지 확인한다. 여기가 조용히 실패하면
    // 이후 쿼리가 전부 빈 결과를 돌려주고, 그건 "데이터가 없다"로 오해된다.
    const check = await client.query<{ id: string | null }>("SELECT current_company_id() AS id");
    if (check.rows[0]?.id !== companyId) {
      throw new TenantError("회사 맥락을 설정하지 못했습니다.");
    }

    const result = await fn(sqlOn(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      /* 이미 끊긴 커넥션이면 무시 */
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 회사 맥락 없이 도는 경로. 로그인과 토큰 조회 둘뿐이다.
 *
 * 여기서 부를 수 있는 것은 db/migrations/003_rls.sql의 SECURITY DEFINER 함수뿐이고,
 * 테이블을 직접 읽으면 RLS에 막혀 빈 결과가 나온다. 그게 의도한 동작이다.
 */
export async function withoutCompany<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await getAppPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(sqlOn(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
