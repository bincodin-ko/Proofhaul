// 미끼 도구 브라우저 검증.
//
// docs/03-BUILD-PROMPT.md 명령 0이 요구한 것을 실제로 돌려서 확인한다.
// 특히 "개인정보를 서버로 보내지 않는다"는 화면만 봐서는 확인할 수 없으므로,
// 흐름 내내 나가는 요청을 전부 붙잡아 입력값이 섞여 나가는지 본다.
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
  note: "하차 대기 중 현장 지시로 3번 게이트 앞에서 대기. 희귀 음절: 뷁 쀍 똠 짊 옰 휭 ※ ₩ ABC 123",
};

const results = [];
const ok = (check, pass, detail) => results.push({ check, pass, detail: detail?.slice(0, 160) });

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
const ctx = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true, locale: "ko-KR" });
const page = await ctx.newPage();

await ctx.addInitScript(() => {
  // 우리가 붙인 파일명을 그대로 붙잡는다.
  const original = HTMLAnchorElement.prototype.click;
  window.__downloadNames = [];
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__downloadNames.push(this.download);
    return original.apply(this, arguments);
  };
});

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
  // 서명 화면이 확인 문구만큼 길어졌다. 서명란이 화면 밖에 있으면 좌표가 어긋나
  // 아무 데도 그려지지 않는다. 먼저 보이는 자리로 끌어온다.
  await page.locator("canvas.sign-pad").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  const box = await page.locator("canvas.sign-pad").boundingBox();
  // 붙박이 버튼 바가 서명란을 덮으면 손가락이 그림 대신 버튼을 누른다.
  const bar = await page.locator(".sign-actionbar").boundingBox();
  ok("서명란이 버튼 바에 가리지 않는다",
     box.y + box.height <= bar.y + 0.5,
     `서명란 ${Math.round(box.y)}~${Math.round(box.y + box.height)} / 버튼 바 ${Math.round(bar.y)}부터`);
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
  try {
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.getByRole("button", { name: "PDF 내려받기" }).click(),
    ]);
    await dl.saveAs(path.join(OUT, name));
    return dl.suggestedFilename();
  } catch (e) {
    // 화면이 막아 세운 이유를 그대로 들고 나온다. 타임아웃만 보면 원인을 알 수 없다.
    const why = await page.locator(".sign-actionbar .why").textContent().catch(() => null);
    throw new Error(`${name} 내려받기 실패 — 화면 메시지: ${why ?? "(없음)"} / ${e.message.split("\n")[0]}`);
  }
}

// ── 첫 화면 ──────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: "networkidle" });
ok("첫 화면에서 2MB 폰트를 받지 않는다",
   !(await page.evaluate(() => performance.getEntriesByType("resource").some((r) => r.name.includes("NanumGothic")))));
ok("확인서 3종이 모두 있다",
   (await page.locator(".pick button").count()) === 3,
   String(await page.locator(".pick button").count()));
await page.screenshot({ path: path.join(OUT, "1-pick.png"), fullPage: true });

// ── 대기시간 확인서 (별지 제4호서식) ────────────────────────────────
await page.getByRole("button", { name: /대기시간 확인서/ }).click();
await page.waitForSelector("#f-requestedEntryAt");

ok("고른 별지 서식 번호가 화면에 뜬다",
   (await page.locator("body").innerText()).includes("별지 제4호서식"));

await page.fill("#f-siteName", SECRET.shipper);
await page.fill("#f-siteLocation", "경기 평택시 포승읍 평택항만길");
await page.fill("#f-containerNo", "ABCU1234567");
await page.fill("#f-vehicleNo", SECRET.vehicle);
await page.fill("#f-driverName", SECRET.driver);
await page.fill("#f-carrierName", SECRET.carrier);

// 서식은 년·월·일·시·분을 받는다. 날짜가 바뀌는 대기를 그대로 적을 수 있어야 한다.
await page.fill("#f-requestedEntryAt", "2026-03-04T21:30");
await page.fill("#f-entryAt", "2026-03-04T22:10");
await page.fill("#f-exitAt", "2026-03-05T01:45");

ok("대기료 계산란이 '미지원'으로 뜬다",
   (await page.locator("body").innerText()).includes("미지원"));
ok("가로 스크롤이 없다",
   await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

// 품목을 시멘트로 바꾸면 별지 제6호서식이 되고, 서식에 없는 칸은 사라진다.
await page.getByRole("button", { name: "시멘트", exact: true }).click();
await page.waitForTimeout(150);
const cementText = await page.locator("body").innerText();
ok("품목을 바꾸면 별지 제6호서식으로 바뀐다", cementText.includes("별지 제6호서식"));
ok("제6호서식에는 컨테이너번호 칸이 없다", (await page.locator("#f-containerNo").count()) === 0);
ok("제6호서식에는 운수사 명 칸이 없다", (await page.locator("#f-carrierName").count()) === 0);
await page.getByRole("button", { name: "수출입 컨테이너", exact: true }).click();
await page.waitForSelector("#f-containerNo");

// 서식을 바꾸면 입력값을 비운다. 다시 채운다.
await page.fill("#f-siteLocation", "경기 평택시 포승읍 평택항만길");
await page.fill("#f-containerNo", "ABCU1234567");
await page.fill("#f-vehicleNo", SECRET.vehicle);
await page.fill("#f-driverName", SECRET.driver);
await page.fill("#f-carrierName", SECRET.carrier);
await page.fill("#f-requestedEntryAt", "2026-03-04T21:30");
await page.fill("#f-entryAt", "2026-03-04T22:10");
await page.fill("#f-exitAt", "2026-03-05T01:45");

// 폰트에 없는 글자는 서명 전에 막는다
await page.fill("#f-siteName", "株式會社 제일물류센터");
await page.getByRole("button", { name: "서명 받기" }).click();
await page.waitForTimeout(300);
const guard = await page.locator(".sign-actionbar .why").textContent().catch(() => null);
ok("폰트에 없는 한자를 서명 전에 막는다",
   Boolean(guard) && guard.includes("넣을 수 없는 글자") && guard.includes("株"), guard);
ok("막힌 상태에서 서명 단계로 넘어가지 않는다", (await page.locator("#f-confirmerName").count()) === 0);

await page.fill("#f-siteName", SECRET.shipper);
await page.screenshot({ path: path.join(OUT, "2-form.png"), fullPage: true });
await page.getByRole("button", { name: "서명 받기" }).click();
await page.waitForSelector("#f-confirmerName");
ok("드문 한글 음절은 통과한다", true);

const signText = await page.locator("body").innerText();
ok("서명 화면에 고시의 확인 문구가 그대로 나온다",
   signText.includes("대기시간 증빙을 위해 위와 같이 사업장에 출입하였음을 확인합니다"));
ok("서명 화면에 화주의 서명 의무 조항이 나온다",
   signText.includes("서명 의무 조항") && signText.includes("별표 1 24.다."));

await page.fill("#f-confirmerOrg", "평택항 제일물류센터 운영팀");
await page.fill("#f-confirmerName", SECRET.signer);
await sign();
await page.screenshot({ path: path.join(OUT, "3-sign.png"), fullPage: true });

const fileName = await download("cert-wait.pdf");
await page.waitForTimeout(500);
ok("대기시간 PDF를 내려받는다", true, fileName);
const savedName = (await page.evaluate(() => window.__downloadNames.at(-1))) ?? "";
ok("파일명을 한글 서식 이름 · 입차 날짜 · 차량번호로 짓는다",
   savedName === `컨테이너대기시간확인서_2026-03-04_${SECRET.vehicle}.pdf`, savedName);
await page.screenshot({ path: path.join(OUT, "4-done.png"), fullPage: true });

// ── 나머지 두 종류 ───────────────────────────────────────────────────
for (const [label, file, fill, after] of [
  ["험로·오지 확인서", "cert-rough.pdf", async () => {
    await page.fill("#f-siteName", "강원 정선 레미콘 현장");
    await page.fill("#f-vehicleNo", "81버9900");
    await page.fill("#f-occurredAt", "2026-03-06T09:20");
    await page.getByRole("button", { name: "비포장, 자갈길 등 불량도로" }).click();
    await page.getByRole("button", { name: "급경사 구간" }).click();
  }, async () => {
    const text = await page.locator("body").innerText();
    ok("험로·오지 확인서에는 서명 의무 조항을 붙이지 않는다", !text.includes("서명 의무 조항"));
  }],
  ["컨테이너 세척 · 손상 교체 확인서", "cert-wash.pdf", async () => {
    await page.fill("#f-siteName", "부산 신항 세척장");
    await page.fill("#f-containerNo", "ABCU1234567");
    await page.fill("#f-vehicleNo", "12가3456");
    await page.fill("#f-occurredAt", "2026-03-07T13:05");
  }, async () => {
    const text = await page.locator("body").innerText();
    ok("세척 확인서에는 지시자의 서명 의무 조항이 나온다",
       text.includes("서명 의무 조항") && text.includes("별표 1 18.가."));
  }],
]) {
  await page.getByRole("button", { name: "확인서 하나 더 만들기" }).click();
  await page.getByRole("button", { name: new RegExp(label.replace(/[·.]/g, ".")) }).click();
  await fill();
  await page.getByRole("button", { name: "서명 받기" }).click();
  await page.waitForSelector("#f-confirmerName");
  await after();
  await page.fill("#f-confirmerName", "이순신");
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

// ── 만들어진 PDF를 다시 열어 본다 ────────────────────────────────────
const waitPdf = path.join(OUT, "cert-wait.pdf");
const waitText = await pdfText(waitPdf);

ok("PDF 제목이 별지 서식의 제목이다", waitText.includes("컨테이너 대기시간 확인서"), waitText.slice(0, 80));
ok("PDF에 별지 서식 번호가 찍힌다", waitText.includes("[별지 제4호서식]"));
ok("PDF에 입차요청시각 칸이 있다", waitText.includes("입차요청시각(화주)"));
ok("날짜가 바뀐 대기를 서식 표기 그대로 찍는다",
   waitText.includes("2026년 3월 4일 21시 30분") && waitText.includes("2026년 3월 5일 01시 45분"),
   waitText.match(/2026년 3월 [45]일[^)]{0,20}/g)?.join(" | "));
ok("PDF에 고시의 확인 문구와 근거 조항이 들어간다",
   waitText.includes("별표 1 24.다.") && waitText.includes("상호 보완하여 사용할 수 있습니다"));
ok("PDF에 서식의 참고 설명이 들어간다", waitText.includes("입차요청시각 : 화주가 상·하차지에 입차를 요청한 시각"));
ok("계산하지 않은 자리는 PDF에도 미지원으로 남는다", waitText.includes("미지원"));
ok("다 채운 서식에는 (미기재)가 없다", !waitText.includes("(미기재)"), waitText.slice(0, 120));

const roughText = await pdfText(path.join(OUT, "cert-rough.pdf"));
ok("고른 항목은 채운 네모로 찍힌다", roughText.includes("\u25a0 비포장, 자갈길 등 불량도로"), roughText.slice(0, 120));
ok("고르지 않은 항목도 빈 네모로 남는다", roughText.includes("\u25a1 당사자 간 합의하는 경우"));
ok("적지 않은 칸은 (미기재)로 찍힌다", roughText.includes("(미기재)"));

// 폰트를 통째로 임베드했는지를 크기로 본다. subset: true로 바뀌면 한글이 빈칸이 되면서
// 크기가 뚝 떨어진다. 글자 추출만으로는 그 사고를 잡지 못한다.
const size = await pdfBytes(waitPdf);
ok("한글 폰트를 통째로 임베드한다", size > 600_000, `${Math.round(size / 1024)}KB`);

ok("자바스크립트 오류가 없다", pageErrors.length === 0, pageErrors.join(" | "));

await browser.close();

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.check}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 통과  (PDF는 ${OUT} 에 있습니다)`);
process.exit(failed === 0 ? 0 : 1);
