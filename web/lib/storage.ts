// 파일 저장.
//
// A5에서 비공개 버킷과 권한 검사 프록시로 바꾼다. 지금은 로컬 디렉터리에 쓴다.
// 어떤 구현이든 지켜야 하는 것은 하나다 — **URL만 알면 열리지 않아야 한다.**
// 지금 구현이 그 조건을 만족하는 이유는 단순하다: 이 디렉터리를 아무도 서빙하지 않는다.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ?? 는 빈 문자열을 그대로 통과시킨다. .env.example이 STORAGE_DIR= 로 비워 두고 있어서,
// 그대로 따라 하면 ROOT가 ""가 되고 서명 이미지가 저장소 대신 작업 디렉터리 밑에
// signatures/ 로 떨어졌다. 비어 있으면 없는 것으로 친다.
const ROOT = process.env.STORAGE_DIR?.trim() || path.join(process.cwd(), ".storage");

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const MAX_SIGNATURE_BYTES = 512 * 1024;

export class StorageError extends Error {}

/**
 * 서명 이미지를 저장하고 경로를 돌려준다.
 *
 * 확장자가 아니라 **내용으로** PNG인지 본다 (05-SECURITY 위협 3).
 * 파일명은 사용자 입력을 쓰지 않는다 — 경로 탈출을 만들 여지를 아예 없앤다.
 */
export async function saveSignaturePng(dataUrl: string, companyId: string): Promise<string> {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/png;base64,") || comma < 0) {
    throw new StorageError("서명 이미지를 읽지 못했습니다.");
  }

  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_BYTES) {
    throw new StorageError("서명 이미지 크기가 올바르지 않습니다.");
  }
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new StorageError("서명 이미지가 PNG가 아닙니다.");
  }

  // 회사별로 나눠 담는다. 나중에 회사 단위로 지우거나 옮길 때 편하다.
  const relative = path.posix.join("signatures", companyId, `${randomUUID()}.png`);
  const absolute = path.join(ROOT, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  return relative;
}
