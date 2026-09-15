// 브라우저 검증 공용 도구.
//
// 단위 테스트가 못 보는 것을 본다 — 쿠키 플래그, 화면에 실제로 찍힌 글자,
// 주소를 직접 쳤을 때의 응답, 붙여넣기.
//
// 이 폴더의 스크립트는 문서가 "실제로 시도해서 확인하라"고 한 항목의 근거다
// (docs/05-SECURITY.md 위협 2, docs/04-VERIFY.md 머리말). 임시 폴더가 아니라
// 저장소에 둔다 — 재현할 수 없는 확인은 확인이 아니다.

import { randomBytes } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createOwnerPool } from "../../db/client";
import { hashPassword } from "../../lib/password";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3322";

/** 이 환경에 미리 깔린 크로미움. 없으면 playwright가 알아서 찾는다. */
const CHROME_PATH = process.env.E2E_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export interface Check {
  check: string;
  pass: boolean;
  detail?: string;
}

export class Checks {
  readonly items: Check[] = [];
  constructor(readonly suite: string) {}

  ok(check: string, pass: boolean, detail?: string) {
    this.items.push({ check, pass, detail: detail?.slice(0, 160) });
  }

  get failed(): Check[] {
    return this.items.filter((c) => !c.pass);
  }
}

export interface Account {
  companyId: string;
  companyName: string;
  email: string;
  password: string;
}

export const owner = createOwnerPool();

/** 검증용 회사 + 계정. 이름에 표식을 넣어 끝나고 지울 수 있게 한다. */
export async function seedAccount(companyName: string): Promise<Account> {
  const password = randomBytes(12).toString("base64url");
  const email = `${randomBytes(5).toString("hex")}@e2e.invalid`;

  const company = await owner.query<{ id: string }>(
    "INSERT INTO company (name) VALUES ($1) RETURNING id",
    [companyName],
  );
  const companyId = company.rows[0]!.id;
  await owner.query(
    "INSERT INTO app_user (company_id, email, password_hash, name) VALUES ($1,$2,$3,$4)",
    [companyId, email, await hashPassword(password), `${companyName} 담당자`],
  );
  return { companyId, companyName, email, password };
}

export async function cleanup(accounts: Account[]): Promise<void> {
  await owner.query("DELETE FROM company WHERE id = ANY($1)", [accounts.map((a) => a.companyId)]);
  await owner.query("DELETE FROM login_attempt");
  await owner.query("DELETE FROM token_lookup");
}

/** 속도 제한 카운터를 비운다. 공격 실험과 정상 흐름을 섞지 않으려는 것. */
export async function resetRateLimits(): Promise<void> {
  await owner.query("DELETE FROM login_attempt");
  await owner.query("DELETE FROM token_lookup");
}

export async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ executablePath: CHROME_PATH });
  } catch {
    return chromium.launch();
  }
}

export async function newContext(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ locale: "ko-KR", ...options });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return { ctx, page, errors };
}

export async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", account.email);
  await page.fill("#password", account.password);
  await Promise.all([page.waitForURL(`${BASE_URL}/shipments`), page.click("button.primary")]);
}

export async function createShipment(
  page: Page,
  values: { shipper: string; driverPhone: string; memo: string },
): Promise<string> {
  await page.goto(`${BASE_URL}/shipments/new`, { waitUntil: "networkidle" });
  await page.fill("#shipped_on", "2026-08-15");
  await page.selectOption("#cargo_type", "CONTAINER_40");
  await page.fill("#driver_name", "김철수");
  await page.fill("#driver_phone", values.driverPhone);
  await page.fill("#shipper_name", values.shipper);
  await page.fill("#memo", values.memo);
  await Promise.all([
    page.waitForURL(/\/shipments\/[0-9a-f-]+/),
    page.click("button.primary"),
  ]);
  return page.url().match(/\/shipments\/([0-9a-f-]+)/)![1]!;
}

/** 증빙 요청 링크를 만들고 주소를 돌려준다. */
export async function createSignLink(page: Page, kindShort: string): Promise<string> {
  await page.click(`.request .chip:has-text("${kindShort}")`);
  await page.click("button.primary:has-text('서명 링크 만들기')");
  await page.waitForSelector(".link-row input");
  return page.locator(".link-row input").inputValue();
}

/** 캔버스에 곡선 하나를 그린다. 손가락 서명 흉내. */
export async function drawSignature(page: Page): Promise<void> {
  const box = (await page.locator("canvas.sig-canvas").boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height * 0.65);
  await page.mouse.down();
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    await page.mouse.move(
      box.x + 30 + t * (box.width - 70),
      box.y + box.height * (0.62 - Math.sin(t * Math.PI * 2.4) * 0.22),
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}
