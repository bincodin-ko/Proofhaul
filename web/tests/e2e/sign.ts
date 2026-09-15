// A4 — 화면 2. 토큰 링크와 로그인 없는 서명.
//
// docs/06-FAST-TRACK.md A4: "토큰 문자열을 임의로 바꿔 다른 증빙에 접근을
// 시도하고 결과를 보고해줘."
// docs/03-BUILD-PROMPT.md 명령 3: "계정 2개를 만들어 남의 ID·토큰을 실제로
// 넣어보고 결과를 보고해줘."

import type { Browser } from "playwright";
import {
  BASE_URL, Checks, createShipment, createSignLink, drawSignature,
  newContext, owner, resetRateLimits, signIn, type Account,
} from "./harness";
import { hashToken } from "../../lib/token";

export async function run(browser: Browser, A: Account, B: Account): Promise<Checks> {
  const c = new Checks("A4 화면 2 — 토큰과 서명");
  await resetRateLimits();

  // ── A: 운송 건 + 증빙 요청 ────────────────────────────────────────
  const { ctx: ctxA, page: pageA } = await newContext(browser);
  await signIn(pageA, A);
  await createShipment(pageA, {
    shipper: "평택항 제일물류센터",
    driverPhone: "010-1234-5678",
    memo: "대외비 내부 메모",
  });
  const linkA = await createSignLink(pageA, "대기시간");
  const tokenA = linkA.split("/s/")[1]!;
  c.ok("서명 링크를 만든다", /\/s\/[A-Za-z0-9_-]{43}$/.test(linkA));

  const leaked = await owner.query<{ n: string }>(
    "SELECT count(*) AS n FROM evidence WHERE evidence::text LIKE $1",
    [`%${tokenA.slice(0, 16)}%`],
  );
  c.ok("DB에는 원문 토큰이 없다", leaked.rows[0]!.n === "0");

  const listed = await pageA.locator(".card:has-text('증빙') table").innerText();
  c.ok("상태가 '요청됨'으로 보인다", listed.includes("요청됨"));

  // ── B: 다른 회사의 증빙 ───────────────────────────────────────────
  const { ctx: ctxB, page: pageB } = await newContext(browser);
  await signIn(pageB, B);
  const shipmentB = await createShipment(pageB, {
    shipper: "한빛로지스",
    driverPhone: "010-9999-8888",
    memo: "B의 메모",
  });
  const linkB = await createSignLink(pageB, "험로·오지");
  const tokenB = linkB.split("/s/")[1]!;

  // ── 서명자: 로그인 없이 링크 열기 ─────────────────────────────────
  const { ctx: signerCtx, page: signer, errors: signerErrors } = await newContext(browser, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await signer.goto(linkA, { waitUntil: "networkidle" });
  const view = await signer.locator("body").innerText();
  c.ok("로그인 없이 서명 화면이 열린다", view.includes("대기시간 확인서"));
  c.ok(
    "요청 회사명·날짜·품목이 보인다",
    view.includes(A.companyName) && view.includes("2026-08-15") && view.includes("수출입 컨테이너 40FT"),
  );
  c.ok("차주 연락처가 서명 화면에 없다", !view.includes("010-1234-5678"));
  c.ok("메모가 서명 화면에 없다", !view.includes("대외비"));
  c.ok("화주명이 서명 화면에 없다", !view.includes("평택항 제일물류센터"));
  c.ok("계산란이 '미지원'으로 뜬다", view.includes("미지원") && view.includes("기산 기준"));
  const metrics = await signer.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
  }));
  c.ok("모바일에서 가로 스크롤이 없다", metrics.scrollW <= metrics.clientW, `${metrics.scrollW}/${metrics.clientW}px`);
  // "모바일 한 화면"은 단계를 나누지 않는다는 뜻으로 지킨다 — 입력·서명·보내기가
  // 한 페이지에 있다. 세로로는 스크롤이 생긴다. 항목이 다섯 개인 대기시간
  // 확인서를 폰 한 화면 높이에 밀어 넣으면 글자가 읽을 수 없게 작아진다.
  // 수치를 남겨서 나중에 더 길어지면 눈에 띄게 한다.
  c.ok(
    "세로 길이가 화면 두 배를 넘지 않는다",
    metrics.scrollH <= metrics.clientH * 2,
    `세로 ${metrics.scrollH}px / 화면 ${metrics.clientH}px`,
  );
  c.ok(
    "입력·서명·보내기가 한 페이지에 있다 (단계를 나누지 않는다)",
    (await signer.locator("canvas.sig-canvas").count()) === 1 &&
      (await signer.locator("#f-arrivedAt").count()) === 1 &&
      (await signer.locator("button.primary:has-text('서명하고 보내기')").count()) === 1,
  );

  // ── 침범 시도: 토큰 문자열 변조 ───────────────────────────────────
  const attacks: [string, string][] = [
    ["끝 한 글자를 바꾼 토큰", tokenA.slice(0, -1) + (tokenA.endsWith("a") ? "b" : "a")],
    ["앞 한 글자를 바꾼 토큰", (tokenA[0] === "a" ? "b" : "a") + tokenA.slice(1)],
    ["한 글자 잘라낸 토큰", tokenA.slice(0, -1)],
    ["대문자로 바꾼 토큰", tokenA.toUpperCase()],
    ["아예 없는 토큰", "z".repeat(43)],
  ];
  for (const [name, token] of attacks) {
    if (token === tokenA) continue;
    const { ctx, page } = await newContext(browser);
    await page.goto(`${BASE_URL}/s/${token}`, { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();
    c.ok(
      `${name}으로는 아무것도 열리지 않는다`,
      text.includes("만료되었거나 올바르지 않은") &&
        !text.includes(A.companyName) &&
        !text.includes(B.companyName),
      text.split("\n")[0],
    );
    await ctx.close();
  }

  // B의 토큰은 B의 것만 연다
  {
    const { ctx, page } = await newContext(browser);
    await page.goto(linkB, { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();
    c.ok(
      "B의 토큰은 B의 증빙만 연다 (A의 회사·운송 건이 따라오지 않는다)",
      text.includes(B.companyName) && text.includes("험로") && !text.includes(A.companyName),
      text.split("\n")[0],
    );
    await ctx.close();
  }

  // 만료된 토큰과 없는 토큰의 화면이 글자까지 같은가
  {
    await resetRateLimits();
    const row = await owner.query<{ id: string }>(
      "SELECT id FROM evidence WHERE shipment_id = $1 LIMIT 1",
      [shipmentB],
    );
    await owner.query("UPDATE evidence SET expires_at = now() - interval '1 hour' WHERE id = $1", [
      row.rows[0]!.id,
    ]);
    const { ctx, page } = await newContext(browser);
    await page.goto(`${BASE_URL}/s/${tokenB}`, { waitUntil: "networkidle" });
    const expired = await page.locator("body").innerText();
    await page.goto(`${BASE_URL}/s/${"y".repeat(43)}`, { waitUntil: "networkidle" });
    const missing = await page.locator("body").innerText();
    c.ok("만료된 토큰과 없는 토큰의 화면이 글자까지 같다", expired === missing, expired.split("\n")[0]);
    c.ok("만료 화면이 재발송 방법을 안내한다", expired.includes("재발송"));
    await ctx.close();
  }

  // ── 서명하기 ─────────────────────────────────────────────────────
  await resetRateLimits();
  await signer.fill("#f-arrivedAt", "08:40");
  await signer.fill("#f-loadStartAt", "11:15");
  await signer.fill("#f-unloadStartAt", "15:05");
  await signer.fill("#f-note", "3번 게이트 앞 대기");
  await signer.fill("#signer-name", "박영희");
  await signer.click(".chip:has-text('화주 담당자')");
  await drawSignature(signer);
  await signer.click("button.primary:has-text('서명하고 보내기')");
  await signer.waitForSelector(".ok-notice", { timeout: 20000 });
  c.ok("서명이 완료된다", (await signer.locator("body").innerText()).includes("서명이 완료"));

  await resetRateLimits();
  await signer.goto(linkA, { waitUntil: "networkidle" });
  const reopened = await signer.locator("body").innerText();
  c.ok(
    "서명 후 같은 링크로는 고칠 수 없다",
    reopened.includes("이미 서명이 끝난") && !reopened.includes("서명하고 보내기"),
    reopened.split("\n")[0],
  );

  const signed = await owner.query<{
    status: string; signer_name: string; signer_role: string; signer_ip: string;
    signer_user_agent: string | null; signature_png_path: string | null;
    payload_json: Record<string, string>;
    // 해시는 앱이 쓰는 함수 그대로 만든다. DB 확장(pgcrypto)에 기대지 않는다.
  }>("SELECT * FROM evidence WHERE token_hash = $1", [hashToken(tokenA)]);
  const row = signed.rows[0]!;
  c.ok(
    "상태·서명자·IP·UA·서명이미지·입력값이 모두 기록된다",
    row.status === "SIGNED" &&
      row.signer_name === "박영희" &&
      row.signer_role === "SHIPPER" &&
      Boolean(row.signer_ip) &&
      Boolean(row.signer_user_agent) &&
      Boolean(row.signature_png_path) &&
      row.payload_json.arrivedAt === "08:40",
    `${row.status}/${row.signer_name}/${row.signer_ip}`,
  );

  await pageA.reload({ waitUntil: "networkidle" });
  const afterSign = await pageA.locator(".card:has-text('증빙') table").innerText();
  c.ok("요청 쪽에 '서명됨'과 서명자가 보인다", afterSign.includes("서명됨") && afterSign.includes("박영희"));

  c.ok("서명 화면에 자바스크립트 오류가 없다", signerErrors.length === 0, signerErrors.join(" | "));

  // ── 속도 제한 ────────────────────────────────────────────────────
  {
    await resetRateLimits();
    const { ctx, page } = await newContext(browser);
    let throttledAt: number | null = null;
    for (let i = 0; i < 13; i++) {
      await page.goto(`${BASE_URL}/s/${"q".repeat(42)}${i % 10}`, { waitUntil: "domcontentloaded" });
      const text = await page.locator("body").innerText();
      if (text.includes("잠시 후 다시") && throttledAt === null) throttledAt = i + 1;
    }
    c.ok("실패가 몰리면 IP 속도 제한이 걸린다", throttledAt !== null && throttledAt <= 12, `${throttledAt}번째에서 차단`);
    await ctx.close();
  }
  {
    // 정상 서명자는 새로고침해도 잠기지 않아야 한다.
    await resetRateLimits();
    const { ctx, page } = await newContext(browser);
    let blocked = false;
    for (let i = 0; i < 15; i++) {
      await page.goto(linkB.replace(tokenB, tokenB), { waitUntil: "domcontentloaded" });
      if ((await page.locator("body").innerText()).includes("잠시 후 다시")) blocked = true;
    }
    c.ok("정상 링크를 15번 새로고침해도 잠기지 않는다", !blocked);
    await ctx.close();
  }

  await signerCtx.close();
  await ctxA.close();
  await ctxB.close();
  return c;
}
