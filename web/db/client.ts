// Postgres 연결.
//
// 풀이 두 개다. 마이그레이션은 테이블 소유자로, 런타임은 RLS를 벗어날 수 없는
// 제한된 역할로 붙는다. 런타임이 소유자로 붙으면 정책이 있어도 의미가 없다.

import { Pool, type PoolClient, type QueryResultRow } from "pg";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`환경변수 ${name}가 없습니다. .env.example을 보세요.`);
  return value;
}

let appPool: Pool | null = null;

/** 런타임용 풀. 모든 테넌트 쿼리는 db/tenant.ts를 거쳐 이 풀을 쓴다. */
export function getAppPool(): Pool {
  if (!appPool) {
    appPool = new Pool({ connectionString: required("DATABASE_URL_APP"), max: 8 });
  }
  return appPool;
}

/** 마이그레이션 전용. 애플리케이션 코드에서 부르지 않는다. */
export function createOwnerPool(): Pool {
  return new Pool({ connectionString: required("DATABASE_URL"), max: 2 });
}

/**
 * 런타임 역할이 정말로 제한된 역할인지 확인한다.
 * 설정 실수로 슈퍼유저나 BYPASSRLS 역할이 들어가면 테넌트 분리가 통째로 무력화되는데,
 * 그 상태에서도 앱은 멀쩡히 동작해서 알아채지 못한다. 그래서 시작할 때 막는다.
 */
export async function assertAppRoleIsRestricted(): Promise<void> {
  const { rows } = await getAppPool().query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolname: string;
  }>("SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");

  const role = rows[0];
  if (!role) throw new Error("현재 역할을 확인할 수 없습니다.");
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `DATABASE_URL_APP의 역할 ${role.rolname}이(가) RLS를 우회할 수 있습니다. ` +
        "제한된 역할(proofhaul_app)로 붙어야 합니다.",
    );
  }
}

export type Sql = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

export function sqlOn(client: PoolClient): Sql {
  return async <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => {
    const result = await client.query<T>(text, params);
    return result.rows;
  };
}
