// 비밀번호 해시 — 05-SECURITY 위협 7: "bcrypt 또는 argon2. 직접 만든 해시 금지."

import { hash, verify } from "@node-rs/argon2";

// Argon2id. @node-rs/argon2의 기본값이지만 명시해 둔다 — 기본값이 바뀌어도
// 기존 해시를 못 읽는 일이 없게. (Algorithm enum은 ambient const enum이라
// isolatedModules에서 못 쓴다. 값은 2.)
const ARGON2ID = 2;
const OPTIONS = { algorithm: ARGON2ID } as const;

/**
 * 존재하지 않는 계정으로 로그인을 시도했을 때 대신 검증할 해시.
 *
 * 계정이 없다고 바로 돌려주면 응답 시간이 눈에 띄게 짧아진다. 문구를 통일해도
 * 시간이 계정 존재 여부를 알려준다. 그래서 없는 계정에도 같은 비용을 치른다.
 *
 * 아무도 모르는 임의 문자열의 해시다. 비밀이 아니라서 코드에 두어도 된다.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$wUq9ILaa8EI5Hx5hucFa9A$yLNI7mMxDY7oTExvbK4M2wD+BuLi6OnJCaFfpQpWqyg";

export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  }
  // argon2는 길이 제한이 없지만, 아주 긴 입력을 그대로 해싱하면 그 자체가 부하가 된다.
  if (Buffer.byteLength(plain, "utf8") > 1024) return "비밀번호가 너무 깁니다.";
  return null;
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    // 해시 형식이 깨진 경우. 통과시키지 않는다.
    return false;
  }
}

/** 계정이 없을 때 부른다. 결과는 항상 false이고, 목적은 시간을 맞추는 것뿐이다. */
export async function burnVerifyTime(plain: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plain);
}
