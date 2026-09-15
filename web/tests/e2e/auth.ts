// A2 — 로그인과 테넌트 분리를 브라우저에서 확인한다.
//
// docs/06-FAST-TRACK.md A2: "계정 2개를 만들어서, 한쪽 계정으로 다른 쪽
// company_id의 데이터에 접근을 실제로 시도하고 결과를 보고해줘."

import type { Browser } from "playwright";
import { BASE_URL, Checks, newContext, signIn, type Account } from "./harness";

export async function run(browser: Browser, A: Account, B: Account): Promise<Checks> {
  const c = new Checks("A2 로그인과 테넌트 분리");

  // 1. 로그인하지 않으면 보호된 화면이 열리지 않는다
  {
    const { ctx, page } = await newContext(browser);
    await page.goto(`${BASE_URL}/shipments`, { waitUntil: "networkidle" });
    c.ok("로그인 없이 /shipments 를 열면 /login으로 보낸다", page.url().endsWith("/login"), page.url());
    await ctx.close();
  }

  // 2. 실패 응답이 통일되어 있다
  {
    const { ctx, page } = await newContext(browser);
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });

    await page.fill("#email", A.email);
    await page.fill("#password", "완전히틀린비밀번호");
    await page.click("button.primary");
    const wrongPassword = (await page.locator(".error").textContent({ timeout: 15000 }))?.trim();

    await page.fill("#email", "존재하지않는사람@e2e.invalid");
    await page.fill("#password", "완전히틀린비밀번호");
    await page.click("button.primary");
    await page.waitForTimeout(1500);
    const noSuchUser = (await page.locator(".error").textContent())?.trim();

    c.ok(
      "틀린 비밀번호와 없는 계정의 화면 문구가 글자까지 같다",
      Boolean(wrongPassword) && wrongPassword === noSuchUser,
      wrongPassword,
    );
    await ctx.close();
  }

  // 3. A로 로그인
  const { ctx: ctxA, page: pageA } = await newContext(browser);
  await signIn(pageA, A);
  const bodyA = await pageA.locator("body").innerText();
  c.ok("A로 로그인하면 A의 회사가 보인다", bodyA.includes(A.companyName));
  c.ok("A의 화면에 B의 회사 이름이 없다", !bodyA.includes(B.companyName));

  const cookieA = (await ctxA.cookies()).find((k) => k.name === "ph_session");
  c.ok("세션 쿠키가 httpOnly다", cookieA?.httpOnly === true);
  c.ok("세션 쿠키가 sameSite=Lax다", cookieA?.sameSite === "Lax", cookieA?.sameSite);
  c.ok(
    "스크립트가 쿠키를 읽지 못한다",
    (await pageA.evaluate(() => document.cookie)) === "",
    await pageA.evaluate(() => document.cookie),
  );

  // 4. B로 로그인해 토큰 확보
  const { ctx: ctxB, page: pageB } = await newContext(browser);
  await signIn(pageB, B);
  c.ok("B로 로그인하면 B의 회사가 보인다", (await pageB.locator("body").innerText()).includes(B.companyName));
  const cookieB = (await ctxB.cookies()).find((k) => k.name === "ph_session")!;

  // 5. 침범 시도
  const tampered = cookieA!.value.slice(0, -1) + (cookieA!.value.endsWith("a") ? "b" : "a");
  for (const [name, value] of [
    ["세션 토큰을 한 글자 바꾼 쿠키", tampered],
    ["아무 값이나 넣은 쿠키", "a".repeat(43)],
  ] as const) {
    const { ctx, page } = await newContext(browser);
    await ctx.addCookies([{ ...cookieA!, value }]);
    await page.goto(`${BASE_URL}/shipments`, { waitUntil: "networkidle" });
    c.ok(`${name}으로는 아무것도 열리지 않는다`, page.url().endsWith("/login"), page.url());
    await ctx.close();
  }
  {
    const { ctx, page } = await newContext(browser);
    await ctx.addCookies([cookieB]);
    await page.goto(`${BASE_URL}/shipments`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    c.ok(
      "B의 쿠키는 B의 회사만 연다 (A의 데이터가 따라오지 않는다)",
      body.includes(B.companyName) && !body.includes(A.companyName),
    );
    await ctx.close();
  }

  // 6. 로그아웃
  await pageA.click("button.linkish");
  await pageA.waitForURL(`${BASE_URL}/login`);
  await pageA.goto(`${BASE_URL}/shipments`, { waitUntil: "networkidle" });
  c.ok("로그아웃 후에는 보호된 화면이 다시 막힌다", pageA.url().endsWith("/login"));
  {
    const { ctx, page } = await newContext(browser);
    await ctx.addCookies([cookieA!]);
    await page.goto(`${BASE_URL}/shipments`, { waitUntil: "networkidle" });
    c.ok("로그아웃 전에 복사해 둔 쿠키도 더는 통하지 않는다", page.url().endsWith("/login"));
    await ctx.close();
  }

  await ctxA.close();
  await ctxB.close();
  return c;
}
