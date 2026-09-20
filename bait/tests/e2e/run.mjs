// 미끼 도구 브라우저 검증.
//
// docs/03-BUILD-PROMPT.md 명령 0이 요구한 것을 실제로 돌려서 확인한다.
// 특히 "개인정보를 서버로 보내지 않는다"는 화면만 봐서는 확인할 수 없으므로,
// 흐름 내내 나가는 요청을 전부 붙잡아 입력값이 섞여 나가는지 본다.
//
// 링크 서명은 **기기 두 대**로 확인한다. 화주 쪽 브라우저 컨텍스트를 따로 열어서,
// 기사 폰에 저장된 것 없이 링크만으로 서명이 되는지 본다. 같은 탭에서 확인하면
// localStorage를 공유하게 되어 "링크만으로 된다"를 증명하지 못한다.
//
//   npm run build && npm start &
//   node tests/e2e/run.mjs

import { chromium, devices } from "playwright";
import { pdfBytes, pdfText } from "./pdf-text.mjs";
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3311";
const CHROME = process.env.E2E_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = process.env.E2E_OUT ?? path.join(process.cwd(), ".e2e-out");

// 서버로 새어 나가면 안 되는 값들. 폼에 넣고, 나가는 요청에서 찾는다.
const SECRET = {
  carrier: "한빛운수 주식회사",
  shipper: "평택항 제일물류센터",
  vehicle: "12가3456",
  driver: "김철수",
  signer: "박영희",
  guestSigner: "이순신",
  site2: "부산신항 3부두 야적장",
};

const results = [];
const ok = (check, pass, detail) => results.push({ check, pass, detail: String(detail ?? "").slice(0, 160) });

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());

// 나가는 요청을 전부 기록한다 — 주소, 메서드, 본문. 컨텍스트 두 개 모두에서.
const outbound = [];
const bodyReads = [];
const pageErrors = [];

// 공유 기능은 폰에만 있다. 여기서는 없는 셈 치고 내려받기 경로를 돈다.
// (공유 경로는 맨 마지막에 따로 흉내 내서 확인한다.)
const INIT = () => {
  const original = HTMLAnchorElement.prototype.click;
  window.__downloadNames = [];
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__downloadNames.push(this.download);
    return original.apply(this, arguments);
  };
  try {
    delete Navigator.prototype.share;
    delete Navigator.prototype.canShare;
  } catch {
    /* 무시 */
  }
};

async function makeContext() {
  const context = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true, locale: "ko-KR" });
  await context.addInitScript(INIT);
  context.on("request", (r) => outbound.push({ method: r.method(), url: r.url(), body: r.postData() ?? "" }));
  const p = await context.newPage();
  p.on("pageerror", (e) => pageErrors.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

  // 카운터는 navigator.sendBeacon(Blob)으로 나간다. Playwright의 request.postData()는
  // Blob 본문에 null을 주기 때문에, 그것만 믿으면 "본문에 입력값이 없다"를 **읽지도
  // 않고** 통과시키게 된다. 그래서 CDP로 한 겹 더 잡는다.
  const cdp = await context.newCDPSession(p);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", ({ requestId, request }) => {
    if (request.method === "GET") return;
    const record = { method: request.method, url: request.url, body: request.postData ?? "", via: "cdp" };
    outbound.push(record);
    if (!record.body && request.hasPostData) {
      bodyReads.push(
        cdp.send("Network.getRequestPostData", { requestId })
          .then(({ postData }) => { record.body = postData ?? ""; })
          .catch(() => {}),
      );
    }
  });
  return { context, page: p };
}

const { context: ctx, page } = await makeContext();

async function signOn(target, label) {
  // 서명 화면이 확인 문구만큼 길어졌다. 서명란이 화면 밖에 있으면 좌표가 어긋나
  // 아무 데도 그려지지 않는다. 먼저 보이는 자리로 끌어온다.
  await target.locator("canvas.sign-pad").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await target.waitForTimeout(200);
  const box = await target.locator("canvas.sign-pad").boundingBox();
  // 붙박이 버튼 바가 서명란을 덮으면 손가락이 그림 대신 버튼을 누른다.
  const bar = await target.locator(".sign-actionbar").boundingBox();
  ok(`서명란이 버튼 바에 가리지 않는다 (${label})`,
     box.y + box.height <= bar.y + 0.5,
     `서명란 ${Math.round(box.y)}~${Math.round(box.y + box.height)} / 버튼 바 ${Math.round(bar.y)}부터`);
  await target.mouse.move(box.x + 30, box.y + box.height * 0.65);
  await target.mouse.down();
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    await target.mouse.move(box.x + 30 + t * (box.width - 70),
                            box.y + box.height * (0.62 - Math.sin(t * Math.PI * 2.4) * 0.24));
  }
  await target.mouse.up();
  await target.waitForTimeout(120);
}

async function downloadOn(target, name) {
  try {
    const [dl] = await Promise.all([
      target.waitForEvent("download", { timeout: 30000 }),
      target.getByRole("button", { name: "서명 완료 · PDF 만들기" }).click(),
    ]);
    await dl.saveAs(path.join(OUT, name));
    return dl.suggestedFilename();
  } catch (e) {
    // 화면이 막아 세운 이유를 그대로 들고 나온다. 타임아웃만 보면 원인을 알 수 없다.
    const why = await target.locator(".sign-actionbar .why").textContent().catch(() => null);
    throw new Error(`${name} 내려받기 실패 — 화면 메시지: ${why ?? "(없음)"} / ${e.message.split("\n")[0]}`);
  }
}

/** 화주 쪽은 서명 → 완료 화면 → "보내기"에서 파일이 나온다. 한 번에 안 떨어진다. */
async function downloadGuest(target, name) {
  await target.getByRole("button", { name: "서명 완료 · PDF 만들기" }).click();
  await target.waitForSelector("text=서명이 끝났습니다", { timeout: 30000 });
  const [dl] = await Promise.all([
    target.waitForEvent("download", { timeout: 30000 }),
    target.getByRole("button", { name: /PDF 보내기/ }).click(),
  ]);
  await dl.saveAs(path.join(OUT, name));
  return dl.suggestedFilename();
}

const sign = (label) => signOn(page, label);
const download = (name) => downloadOn(page, name);

async function fillWaitForm(site) {
  await page.fill("#f-siteName", site);
  await page.fill("#f-siteLocation", "경기 평택시 포승읍 평택항만길");
  await page.fill("#f-containerNo", "ABCU1234567");
  await page.fill("#f-vehicleNo", SECRET.vehicle);
  await page.fill("#f-driverName", SECRET.driver);
  await page.fill("#f-carrierName", SECRET.carrier);
  await page.fill("#f-requestedEntryAt", "2026-03-04T21:30");
  await page.fill("#f-entryAt", "2026-03-04T22:10");
  await page.fill("#f-exitAt", "2026-03-05T01:45");
}

// ── 첫 화면 ──────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: "networkidle" });
ok("첫 화면에서 2MB 폰트를 받지 않는다",
   !(await page.evaluate(() => performance.getEntriesByType("resource").some((r) => r.name.includes("NanumGothic")))));
ok("확인서 3종이 모두 있다", (await page.locator(".pick button").count()) === 3);
ok("아무것도 만들기 전에는 목록이 없다", (await page.locator("[data-testid=doc-list]").count()) === 0);
await page.screenshot({ path: path.join(OUT, "1-pick.png"), fullPage: true });

// ── 대기시간 확인서 (별지 제4호서식) ────────────────────────────────
await page.getByRole("button", { name: /대기시간 확인서/ }).click();
await page.waitForSelector("#f-requestedEntryAt");
ok("고른 별지 서식 번호가 화면에 뜬다", (await page.locator("body").innerText()).includes("별지 제4호서식"));

await fillWaitForm(SECRET.shipper);
ok("대기료 계산란이 '미지원'으로 뜬다", (await page.locator("body").innerText()).includes("미지원"));
ok("가로 스크롤이 없다",
   await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

// 품목을 시멘트로 바꾸면 별지 제6호서식이 되고, 서식에 없는 칸은 사라진다.
await page.getByRole("button", { name: "시멘트", exact: true }).click();
await page.waitForTimeout(150);
ok("품목을 바꾸면 별지 제6호서식으로 바뀐다", (await page.locator("body").innerText()).includes("별지 제6호서식"));
ok("제6호서식에는 컨테이너번호 칸이 없다", (await page.locator("#f-containerNo").count()) === 0);
ok("제6호서식에는 운수사 명 칸이 없다", (await page.locator("#f-carrierName").count()) === 0);
await page.getByRole("button", { name: "수출입 컨테이너", exact: true }).click();
await page.waitForSelector("#f-containerNo");
await fillWaitForm(SECRET.shipper);

// 폰트에 없는 글자는 서명 전에 막는다
await page.fill("#f-siteName", "株式會社 제일물류센터");
await page.getByRole("button", { name: "여기서 서명받기" }).click();
await page.waitForTimeout(300);
const guard = await page.locator(".sign-actionbar .why").textContent().catch(() => null);
ok("폰트에 없는 한자를 서명 전에 막는다",
   Boolean(guard) && guard.includes("넣을 수 없는 글자") && guard.includes("株"), guard);
ok("막힌 상태에서 서명 단계로 넘어가지 않는다", (await page.locator("#f-confirmerName").count()) === 0);

await page.fill("#f-siteName", SECRET.shipper);
await page.screenshot({ path: path.join(OUT, "2-form.png"), fullPage: true });
await page.getByRole("button", { name: "여기서 서명받기" }).click();
await page.waitForSelector("#f-confirmerName");

const signText = await page.locator("body").innerText();
ok("서명 화면에 고시의 확인 문구가 그대로 나온다",
   signText.includes("대기시간 증빙을 위해 위와 같이 사업장에 출입하였음을 확인합니다"));
ok("서명 화면에 화주의 서명 의무 조항이 나온다",
   signText.includes("서명 의무 조항") && signText.includes("별표 1 24.다."));

await page.fill("#f-confirmerOrg", "평택항 제일물류센터 운영팀");
await page.fill("#f-confirmerName", SECRET.signer);
await sign("현장");
await page.screenshot({ path: path.join(OUT, "3-sign.png"), fullPage: true });
await download("cert-wait.pdf");
await page.waitForTimeout(500);

const savedName = (await page.evaluate(() => window.__downloadNames.at(-1))) ?? "";
ok("파일명을 한글 서식 이름 · 입차 날짜 · 차량번호로 짓는다",
   savedName === `컨테이너대기시간확인서_2026-03-04_${SECRET.vehicle}.pdf`, savedName);
await page.screenshot({ path: path.join(OUT, "4-done.png"), fullPage: true });

// ── PDF를 준 다음에 묻는 설문 ────────────────────────────────────────
ok("PDF를 받은 뒤에 설문이 뜬다", (await page.locator(".survey").count()) === 1);
ok("설문이 PDF를 인질로 잡지 않는다 (이미 내려받은 뒤다)",
   (await page.evaluate(() => window.__downloadNames.length)) === 1);
ok("설문이 몇 문항인지 먼저 보여준다",
   (await page.locator(".survey .sv-step").innerText()).trim() === "1 / 3");
await page.getByRole("button", { name: "운송사 · 주선사" }).click();
await page.waitForTimeout(150);
await page.getByRole("button", { name: "한 달에 100만원쯤" }).click();
await page.waitForTimeout(150);
await page.getByRole("button", { name: "카톡 사진으로 남긴다" }).click();
await page.waitForTimeout(400);
ok("다 답하면 고맙다고 하고 끝난다",
   (await page.locator(".survey").innerText()).includes("고맙습니다"));
await page.screenshot({ path: path.join(OUT, "9-survey.png"), fullPage: true });
await page.getByRole("button", { name: "닫기" }).click();

// ── 이 폰에 남는 기록 ────────────────────────────────────────────────
await page.getByRole("button", { name: "확인서 하나 더 만들기" }).click();
await page.waitForSelector("[data-testid=doc-list]");
const listText = await page.locator("[data-testid=doc-list]").innerText();
ok("만든 확인서가 목록에 남는다", listText.includes(SECRET.shipper), listText);
ok("목록에 '서명 완료' 상태가 보인다", listText.includes("서명 완료"));
ok("목록이 이 폰에만 있다고 알려준다", listText.includes("이 폰 안에만"));
await page.screenshot({ path: path.join(OUT, "5-home-list.png"), fullPage: true });

// ── 두 번째 확인서: 내 정보가 자동으로 채워진다 ──────────────────────
await page.getByRole("button", { name: /대기시간 확인서/ }).click();
await page.waitForSelector("#f-requestedEntryAt");
ok("차량번호가 자동으로 채워진다", (await page.inputValue("#f-vehicleNo")) === SECRET.vehicle);
ok("차주 성명이 자동으로 채워진다", (await page.inputValue("#f-driverName")) === SECRET.driver);
ok("운수사 명이 자동으로 채워진다", (await page.inputValue("#f-carrierName")) === SECRET.carrier);
ok("건마다 달라지는 사업장은 비어 있다", (await page.inputValue("#f-siteName")) === "");

// ── 링크로 서명 요청 ─────────────────────────────────────────────────
await page.fill("#f-siteName", SECRET.site2);
await page.fill("#f-siteLocation", "부산 강서구 신항남로");
await page.fill("#f-containerNo", "TEMU7654321");
await page.fill("#f-requestedEntryAt", "2026-03-09T07:00");
await page.fill("#f-entryAt", "2026-03-09T07:35");
await page.fill("#f-exitAt", "2026-03-09T11:20");
await page.getByRole("button", { name: "카톡으로 서명 요청" }).click();
await page.waitForSelector("[data-testid=share-url]");

const shareUrl = (await page.locator("[data-testid=share-url]").innerText()).trim();
ok("서명 요청 링크가 만들어진다", shareUrl.startsWith(BASE) && shareUrl.includes("#r="), shareUrl.slice(0, 80));
ok("링크가 카톡에 넣을 만한 길이다", shareUrl.length < 2000, `${shareUrl.length}자`);
const linkNotice = await page.locator("body").innerText();
ok("링크에 내용이 들어 있다는 사실을 숨기지 않는다", linkNotice.includes("링크 주소 안에 들어 있습니다"));
ok("PDF를 기사에게 되돌려줘야 한다고 알려준다", linkNotice.includes("다시 보내주어야"));
await page.screenshot({ path: path.join(OUT, "6-link.png"), fullPage: true });

await page.getByRole("button", { name: "목록으로" }).click();
await page.waitForSelector("[data-testid=doc-list]");
ok("링크로 요청한 건은 '서명 기다리는 중'으로 남는다",
   (await page.locator("[data-testid=doc-list]").innerText()).includes("서명 기다리는 중"));

// ── 화주 기기: 링크만으로 서명한다 ───────────────────────────────────
const { context: guestCtx, page: guestPage } = await makeContext();
await guestPage.goto(shareUrl, { waitUntil: "networkidle" });
const guestText = await guestPage.locator("body").innerText();
ok("링크를 열면 누가 요청했는지 먼저 보인다", guestText.includes(`${SECRET.carrier} 요청`), guestText.slice(0, 60));
ok("링크를 열면 확인서 내용이 그대로 보인다",
   guestText.includes(SECRET.site2) && guestText.includes("TEMU7654321") && guestText.includes("2026년 3월 9일 11시 20분"),
   guestText.slice(0, 200));
ok("화주 화면에도 서명 의무 조항이 나온다",
   guestText.includes("서명 의무 조항") && guestText.includes("별표 1 24.다."));
ok("화주 화면에는 입력 칸이 없다 (읽고 서명만 한다)",
   (await guestPage.locator("#f-siteName").count()) === 0);
await guestPage.screenshot({ path: path.join(OUT, "7-guest.png"), fullPage: true });

await guestPage.fill("#f-confirmerOrg", "부산신항 운영팀");
await guestPage.fill("#f-confirmerName", SECRET.guestSigner);
await signOn(guestPage, "화주");
await downloadGuest(guestPage, "cert-wait-link.pdf");
await guestPage.waitForTimeout(400);
ok("화주가 서명하면 되돌려 보내라고 안내한다",
   (await guestPage.locator("body").innerText()).includes("보내주셔야"));
ok("화주 기기에는 확인서를 저장하지 않는다",
   await guestPage.evaluate(() => !window.localStorage.getItem("bait.docs.v1")));

// 화주에게는 다른 것을 묻는다. 이쪽 답이 제일 귀하다.
ok("화주에게도 설문이 뜬다", (await guestPage.locator(".survey").count()) === 1);
await guestPage.getByRole("button", { name: "화주 · 물류센터 · 현장" }).click();
await guestPage.waitForTimeout(150);
ok("화주에게는 손실액이 아니라 서명 태도를 묻는다",
   (await guestPage.locator(".survey").innerText()).includes("서명 요청을 받으면"));
await guestPage.getByRole("button", { name: "잘 안 해준다" }).click();
await guestPage.waitForTimeout(150);
await guestPage.getByRole("button", { name: "카톡으로 사진을 보낸다" }).click();
await guestPage.waitForTimeout(400);
ok("화주 설문도 끝까지 간다", (await guestPage.locator(".survey").innerText()).includes("고맙습니다"));
await guestPage.screenshot({ path: path.join(OUT, "8-guest-done.png"), fullPage: true });

// ── 받았음 표시 ──────────────────────────────────────────────────────
await page.bringToFront();
await page.getByRole("button", { name: "받았음" }).first().click();
await page.waitForTimeout(200);
ok("서명된 PDF를 받으면 목록에서 '받음'으로 바뀐다",
   (await page.locator("[data-testid=doc-list]").innerText()).includes("받음"));

// ── 나머지 두 종류 ───────────────────────────────────────────────────
for (const [label, file, fill, after] of [
  ["험로·오지 확인서", "cert-rough.pdf", async () => {
    await page.fill("#f-siteName", "강원 정선 레미콘 현장");
    await page.fill("#f-occurredAt", "2026-03-06T09:20");
    await page.getByRole("button", { name: "비포장, 자갈길 등 불량도로" }).click();
    await page.getByRole("button", { name: "급경사 구간" }).click();
  }, async () => {
    ok("험로·오지 확인서에는 서명 의무 조항을 붙이지 않는다",
       !(await page.locator("body").innerText()).includes("서명 의무 조항"));
  }],
  ["컨테이너 세척 · 손상 교체 확인서", "cert-wash.pdf", async () => {
    await page.fill("#f-siteName", "부산 신항 세척장");
    await page.fill("#f-containerNo", "ABCU1234567");
    await page.fill("#f-occurredAt", "2026-03-07T13:05");
  }, async () => {
    const text = await page.locator("body").innerText();
    ok("세척 확인서에는 지시자의 서명 의무 조항이 나온다",
       text.includes("서명 의무 조항") && text.includes("별표 1 18.가."));
  }],
]) {
  await page.getByRole("button", { name: new RegExp(label.replace(/[·.]/g, ".")) }).click();
  await page.waitForSelector("#f-siteName");
  await fill();
  await page.getByRole("button", { name: "여기서 서명받기" }).click();
  await page.waitForSelector("#f-confirmerName");
  await after();
  await page.fill("#f-confirmerName", SECRET.guestSigner);
  await sign(label);
  await download(file);
  await page.waitForTimeout(300);
  ok(`이미 답한 사람에게 다시 묻지 않는다 (${label})`, (await page.locator(".survey").count()) === 0);
  await page.getByRole("button", { name: "확인서 하나 더 만들기" }).click();
  await page.waitForSelector("[data-testid=doc-list]");
}

// ── 개인정보가 서버로 나갔는가 ────────────────────────────────────────
await Promise.all(bodyReads);
const posts = outbound.filter((r) => r.method !== "GET" && r.via === "cdp");
ok("서버로 보내는 요청은 익명 카운터와 설문뿐이다",
   posts.every((r) => ["/api/count", "/api/survey"].includes(new URL(r.url).pathname)),
   posts.map((r) => `${r.method} ${new URL(r.url).pathname}`).join(", ") || "없음");
const counters = posts.filter((r) => new URL(r.url).pathname === "/api/count");
const surveys = posts.filter((r) => new URL(r.url).pathname === "/api/survey");

const leaked = [];
for (const value of Object.values(SECRET)) {
  for (const request of outbound) {
    const haystack = `${decodeURIComponent(request.url)}\n${request.body}`;
    if (haystack.includes(value)) leaked.push(`${value.slice(0, 12)} → ${request.method} ${request.url.slice(0, 60)}`);
  }
}
ok("입력값이 어떤 요청에도 실려 나가지 않는다", leaked.length === 0, leaked.join(" | "));

// 링크의 내용은 `#` 뒤에 있다. 브라우저가 서버로 보내지 않아야 한다.
const payload = shareUrl.split("#r=")[1] ?? "";
ok("링크에 담은 내용이 서버 요청에 실리지 않는다",
   payload.length > 0 && !outbound.some((r) => r.url.includes(payload.slice(0, 40))),
   `${payload.length}자`);

const counterBodies = counters.map((r) => r.body);
ok("카운터 요청의 본문을 실제로 읽었다",
   counterBodies.length >= 5 && counterBodies.every((b) => b.length > 0),
   `${counterBodies.filter((b) => b.length > 0).length}/${counterBodies.length}건`);
ok("카운터가 보내는 값은 종류·재사용 구간·경로뿐이다",
   counterBodies.every((b) => {
     try {
       return Object.keys(JSON.parse(b)).sort().join(",") === "kind,repeat,via";
     } catch { return false; }
   }),
   counterBodies.join(" ").slice(0, 150));
const vias = counterBodies.map((b) => { try { return JSON.parse(b).via; } catch { return "?"; } });
ok("현장 서명·링크 요청·링크 서명이 각각 구분되어 집계된다",
   vias.includes("here") && vias.includes("request") && vias.includes("link"),
   vias.join(","));

// 설문이 보내는 것은 고른 보기 값뿐이다.
const surveyBodies = surveys.map((r) => r.body);
ok("설문 응답이 서버로 간다", surveyBodies.length === 2, `${surveyBodies.length}건`);
ok("설문은 고른 보기 값만 보낸다",
   surveyBodies.every((b) => {
     try {
       const parsed = JSON.parse(b);
       const values = Object.values(parsed.answers ?? {});
       return Object.keys(parsed).sort().join(",") === "answers,set"
         && values.length === 3
         && values.every((v) => typeof v === "string" && /^[a-z0-9]+$/.test(v));
     } catch { return false; }
   }),
   surveyBodies.join(" ").slice(0, 200));
ok("운송사 쪽 답과 화주 쪽 답이 구분된다",
   surveyBodies.some((b) => b.includes('"set":"maker"')) && surveyBodies.some((b) => b.includes('"set":"signer"')),
   surveyBodies.join(" ").slice(0, 120));

// ── 만들어진 PDF를 다시 열어 본다 ────────────────────────────────────
const waitPdf = path.join(OUT, "cert-wait.pdf");
const waitText = await pdfText(waitPdf);

ok("PDF 제목이 별지 서식의 제목이다", waitText.includes("컨테이너 대기시간 확인서"), waitText.slice(0, 80));
ok("PDF에 별지 서식 번호가 찍힌다", waitText.includes("[별지 제4호서식]"));
ok("PDF에 입차요청시각 칸이 있다", waitText.includes("입차요청시각(화주)"));
ok("날짜가 바뀐 대기를 서식 표기 그대로 찍는다",
   waitText.includes("2026년 3월 4일 21시 30분") && waitText.includes("2026년 3월 5일 01시 45분"));
ok("PDF에 고시의 확인 문구와 근거 조항이 들어간다",
   waitText.includes("별표 1 24.다.") && waitText.includes("상호 보완하여 사용할 수 있습니다"));
ok("PDF에 서식의 참고 설명이 들어간다", waitText.includes("입차요청시각 : 화주가 상·하차지에 입차를 요청한 시각"));
ok("계산하지 않은 자리는 PDF에도 미지원으로 남는다", waitText.includes("미지원"));
ok("다 채운 서식에는 (미기재)가 없다", !waitText.includes("(미기재)"));

const linkPdf = await pdfText(path.join(OUT, "cert-wait-link.pdf"));
ok("링크로 받은 서명도 같은 서식의 PDF가 된다",
   linkPdf.includes("[별지 제4호서식]") && linkPdf.includes(SECRET.site2) && linkPdf.includes(SECRET.guestSigner),
   linkPdf.slice(0, 120));
ok("링크로 받은 PDF에도 입차요청시각이 들어간다", linkPdf.includes("2026년 3월 9일 07시 00분"));

const roughText = await pdfText(path.join(OUT, "cert-rough.pdf"));
ok("고른 항목은 채운 네모로 찍힌다", roughText.includes("■ 비포장, 자갈길 등 불량도로"), roughText.slice(0, 120));
ok("고르지 않은 항목도 빈 네모로 남는다", roughText.includes("□ 당사자 간 합의하는 경우"));
ok("적지 않은 칸은 (미기재)로 찍힌다", roughText.includes("(미기재)"));

// 폰트를 통째로 임베드했는지를 크기로 본다. subset: true로 바뀌면 한글이 빈칸이 되면서
// 크기가 뚝 떨어진다. 글자 추출만으로는 그 사고를 잡지 못한다.
ok("한글 폰트를 통째로 임베드한다", (await pdfBytes(waitPdf)) > 600_000,
   `${Math.round((await pdfBytes(waitPdf)) / 1024)}KB`);

// ── 폰의 공유 기능을 쓸 수 있으면 그걸 먼저 쓴다 ─────────────────────
{
  const shareCtx = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true, locale: "ko-KR" });
  await shareCtx.addInitScript(() => {
    window.__shared = [];
    Navigator.prototype.canShare = () => true;
    Navigator.prototype.share = async (data) => {
      window.__shared.push((data.files ?? []).map((f) => `${f.name}:${f.type}`));
    };
  });
  const sharePage = await shareCtx.newPage();
  await sharePage.goto(shareUrl, { waitUntil: "networkidle" });
  await sharePage.fill("#f-confirmerName", "최무선");
  await signOn(sharePage, "공유");
  await sharePage.getByRole("button", { name: "서명 완료 · PDF 만들기" }).click();
  await sharePage.waitForSelector("text=서명이 끝났습니다");
  await sharePage.getByRole("button", { name: /PDF 보내기/ }).click();
  await sharePage.waitForTimeout(500);
  const shared = await sharePage.evaluate(() => window.__shared);
  ok("공유 기능이 있으면 PDF 파일을 그대로 넘긴다",
     shared.length === 1 && shared[0][0]?.endsWith(":application/pdf"),
     JSON.stringify(shared));
  await shareCtx.close();
}

// ── 이 폰에 저장된 것을 한 번에 지울 수 있다 ─────────────────────────
page.once("dialog", (d) => void d.accept());
await page.getByRole("button", { name: "이 폰에 저장된 기록 전부 지우기" }).click();
await page.waitForTimeout(300);
ok("전부 지우면 목록이 사라진다", (await page.locator("[data-testid=doc-list]").count()) === 0);
ok("전부 지우면 저장소도 비어 있다",
   await page.evaluate(() => !window.localStorage.getItem("bait.docs.v1") && !window.localStorage.getItem("bait.me.v1")));

ok("자바스크립트 오류가 없다", pageErrors.length === 0, pageErrors.join(" | "));

await guestCtx.close();
await ctx.close();
await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.check}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 통과  (PDF는 ${OUT} 에 있습니다)`);
process.exit(failed === 0 ? 0 : 1);
