// 미끼 도구 브라우저 검증.
//
// docs/03-BUILD-PROMPT.md 명령 0이 요구한 것을 실제로 돌려서 확인한다.
// 특히 "개인정보를 서버로 보내지 않는다"는 화면만 봐서는 확인할 수 없으므로,
// 흐름 내내 나가는 요청을 전부 붙잡아 입력값이 섞여 나가는지 본다.
//
//   npm run build && npm start &
//   node tests/e2e/run.mjs

import { chromium, devices } from "playwright";
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
  note: "하차 대기 중 현장 지시로 3번 게이트 앞에서 대기. 희귀 음절: 뷁 쀍 똠 짊 옰 휭 ※ ₩ ABC 123",
};

const results = [];
const ok = (check, pass, detail) => results.push({ check, pass, detail: detail?.slice(0, 160) });

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
const ctx = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true, locale: "ko-KR" });
const page = await ctx.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push("console: " + m.text()); });

// 나가는 요청을 전부 기록한다 — 주소, 메서드, 본문.
const outbound = [];
ctx.on("request", (r) => {
  outbound.push({ method: r.method(), url: r.url(), body: r.postData() ?? "" });
});

// 카운터는 navigator.sendBeacon(Blob)으로 나간다. Playwright의 request.postData()는
// Blob 본문에 null을 주기 때문에, 그것만 믿으면 "본문에 입력값이 없다"를 **읽지도
// 않고** 통과시키게 된다. 그래서 CDP로 한 겹 더 잡는다.
// Blob 본문은 requestWillBeSent 이벤트에 실려 오지 않는다. hasPostData 표시만 오고,
// 본문은 Network.getRequestPostData 로 따로 받아와야 한다.
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
const bodyReads = [];
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

async function sign() {
  const box = await page.locator("canvas.sig-canvas").boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height * 0.65);
  await page.mouse.down();
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    await page.mouse.move(box.x + 30 + t * (box.width - 70),
                          box.y + box.height * (0.62 - Math.sin(t * Math.PI * 2.4) * 0.24));
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function download(name) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: "PDF 내려받기" }).click(),
  ]);
  await dl.saveAs(path.join(OUT, name));
  return dl.suggestedFilename();
}

// ── 첫 화면 ──────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: "networkidle" });
ok("첫 화면에서 2MB 폰트를 받지 않는다",
   !(await page.evaluate(() => performance.getEntriesByType("resource").some((r) => r.name.includes("NanumGothic")))));
ok("확인서 3종이 모두 있다",
   (await page.locator(".pick button").count()) === 3,
   String(await page.locator(".pick button").count()));
await page.screenshot({ path: path.join(OUT, "1-pick.png"), fullPage: true });

// ── 대기시간 확인서 ───────────────────────────────────────────────────
await page.getByRole("button", { name: /대기시간 확인서/ }).click();
await page.waitForSelector("#f-arrivedAt");
await page.fill("#f-carrierName", SECRET.carrier);
await page.fill("#f-shipperName", SECRET.shipper);
await page.fill("#f-vehicleNo", SECRET.vehicle);
await page.fill("#f-driverName", SECRET.driver);
await page.getByRole("button", { name: "수출입 컨테이너 40FT" }).click();
await page.fill("#f-origin", "부산 신항 2부두");
await page.fill("#f-destination", "경남 양산시 물금읍 증산리");
await page.fill("#f-arrivedAt", "08:40");
await page.fill("#f-loadStartAt", "11:15");
await page.fill("#f-unloadStartAt", "15:05");
await page.fill("#f-leftAt", "16:30");

ok("대기시간 계산란이 '미지원'으로 뜬다",
   (await page.locator("body").innerText()).includes("미지원"));
ok("가로 스크롤이 없다",
   await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

// 폰트에 없는 글자는 서명 전에 막는다
await page.fill("#f-timeNote", "株式會社 로 표기된 서류");
await page.getByRole("button", { name: "서명 받기" }).click();
await page.waitForTimeout(300);
const guard = await page.locator(".bar .error").textContent().catch(() => null);
ok("폰트에 없는 한자를 서명 전에 막는다",
   Boolean(guard) && guard.includes("넣을 수 없는 글자") && guard.includes("株"), guard);
ok("막힌 상태에서 서명 단계로 넘어가지 않는다", (await page.locator("#signer-name").count()) === 0);

await page.fill("#f-timeNote", SECRET.note);
await page.screenshot({ path: path.join(OUT, "2-form.png"), fullPage: true });
await page.getByRole("button", { name: "서명 받기" }).click();
await page.waitForSelector("#signer-name");
ok("드문 한글 음절은 통과한다", true);

await page.fill("#signer-name", SECRET.signer);
await page.getByRole("button", { name: "화주 담당자" }).click();
await sign();
await page.screenshot({ path: path.join(OUT, "3-sign.png"), fullPage: true });

const fileName = await download("cert-wait.pdf");
await page.waitForTimeout(500);
ok("대기시간 PDF를 내려받는다", true, fileName);
ok("파일명이 한글로 나온다", /확인서/.test(fileName) && fileName.endsWith(".pdf"), fileName);
await page.screenshot({ path: path.join(OUT, "4-done.png"), fullPage: true });

// ── 나머지 두 종류 ───────────────────────────────────────────────────
for (const [label, file, fill] of [
  ["험로 · 오지 확인서", "cert-rough.pdf", async () => {
    await page.fill("#f-sectionFrom", "국도 59호선 오미재 삼거리");
    await page.fill("#f-sectionTo", "강원 정선군 임계면 골지천");
    await page.getByRole("button", { name: "비포장" }).click();
    await page.getByRole("button", { name: "급경사" }).click();
  }],
  ["컨테이너 세척 · 손상 교체 확인서", "cert-wash.pdf", async () => {
    await page.getByRole("button", { name: "세척", exact: true }).click();
    await page.fill("#f-containerNo", "ABCU1234567");
    await page.fill("#f-place", "부산 신항 세척장");
  }],
]) {
  await page.getByRole("button", { name: "확인서 하나 더 만들기" }).click();
  await page.getByRole("button", { name: new RegExp(label.replace(/[·.]/g, ".")) }).click();
  await fill();
  await page.getByRole("button", { name: "서명 받기" }).click();
  await page.waitForSelector("#signer-name");
  await page.fill("#signer-name", "이순신");
  await sign();
  const name = await download(file);
  ok(`${label} PDF를 내려받는다`, true, name);
  await page.waitForTimeout(300);
}

// ── 개인정보가 서버로 나갔는가 ────────────────────────────────────────
await Promise.all(bodyReads);
const posts = outbound.filter((r) => r.method !== "GET" && r.via === "cdp");
ok("서버로 보내는 요청은 익명 카운터뿐이다",
   posts.every((r) => new URL(r.url).pathname === "/api/count"),
   posts.map((r) => `${r.method} ${new URL(r.url).pathname}`).join(", ") || "없음");

const leaked = [];
for (const value of Object.values(SECRET)) {
  for (const request of outbound) {
    const haystack = `${decodeURIComponent(request.url)}\n${request.body}`;
    if (haystack.includes(value)) leaked.push(`${value.slice(0, 12)} → ${request.method} ${request.url.slice(0, 60)}`);
  }
}
ok("입력값이 어떤 요청에도 실려 나가지 않는다", leaked.length === 0, leaked.join(" | "));

const counterBodies = posts.map((r) => r.body);
ok("카운터 요청의 본문을 실제로 읽었다",
   counterBodies.length === 3 && counterBodies.every((b) => b.length > 0),
   `${counterBodies.filter((b) => b.length > 0).length}/${counterBodies.length}건`);
ok("카운터가 보내는 값은 종류와 재사용 구간뿐이다",
   counterBodies.length > 0 && counterBodies.every((b) => {
     try {
       const parsed = JSON.parse(b);
       return Object.keys(parsed).sort().join(",") === "kind,repeat";
     } catch { return false; }
   }),
   counterBodies.join(" "));
const kinds = counterBodies.map((b) => { try { return JSON.parse(b).kind; } catch { return "?"; } });
ok("확인서 3종이 각각 한 번씩 집계됐다",
   JSON.stringify(kinds) === JSON.stringify(["WAIT", "ROUGH_ROAD", "WASH_SWAP"]), kinds.join(","));

ok("자바스크립트 오류가 없다", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.check}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 통과  (PDF는 ${OUT} 에 있습니다)`);
process.exit(failed === 0 ? 0 : 1);
