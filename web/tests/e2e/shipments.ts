// A3 — 화면 1. 단건 등록과 엑셀 붙여넣기.
//
// docs/06-FAST-TRACK.md A3: "실제 엑셀에서 복사한 데이터로 붙여넣기를
// 테스트하고 결과를 보여줘."
//
// 아래 CLIPBOARD는 **윈도우 엑셀·구글 시트** 계열이 내놓는 text/plain이다 —
// 셀은 탭, 줄은 CRLF, 줄바꿈이 든 셀은 큰따옴표로 감싼다.
//
// 앱마다 다르다는 것을 실제로 확인했다. LibreOffice Calc(리눅스)를 띄워 진짜
// .xlsx에서 A1:H6을 복사해 이 화면에 Ctrl+V로 붙여넣어 보니, 줄을 LF로 끊고
// 셀 안의 줄바꿈은 따옴표 없이 공백으로 펴서 내보냈다. 결과(3건 저장, 2줄 거부)는
// 같았다. 그쪽 형식은 tests/paste.test.ts의 CALC_PASTE가 지킨다.

import type { Browser } from "playwright";
import { BASE_URL, Checks, newContext, signIn, type Account } from "./harness";

export const SPREADSHEET_CLIPBOARD =
  "운송일자\t품목\t출발지\t도착지\t차주\t연락처\t화주\t비고\r\n" +
  "2026-08-14\t40FT\t부산 신항 2부두\t경남 양산시 물금읍\t김철수\t010-1234-5678\t평택항 제일물류센터\t오전 상차\r\n" +
  "2026-08-15\t20ft\t인천 남항\t충북 음성군 대소면\t박영수\t01098765432\t한빛로지스\t\r\n" +
  '2026.08.16\t시멘트\t단양공장\t충주 현장\t이순신\t010-2222-3333\t대한시멘트\t"게이트 대기,\n야간 하차"\r\n' +
  "2026-08-17\t냉동탑차\t광주\t목포\t최무선\t010-4444-5555\t남도유통\t품목 못 읽는 줄\r\n" +
  "8/18\t40FT\t평택\t천안\t강감찬\t010-6666-7777\t삼한물류\t연도 없는 날짜\r\n" +
  "\r\n";

export async function run(browser: Browser, A: Account, B: Account): Promise<Checks> {
  const c = new Checks("A3 화면 1 — 운송 건 등록");

  const { ctx, page } = await newContext(browser, {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await signIn(page, A);

  // ── 단건 등록 ──────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/shipments/new`, { waitUntil: "networkidle" });
  await page.fill("#shipped_on", "2026-08-20");
  await page.selectOption("#cargo_type", "CONTAINER_20");
  await page.fill("#origin", "부산 신항 4부두");
  await page.fill("#destination", "경기 평택시 포승읍");
  await page.fill("#driver_name", "정약용");
  await page.fill("#driver_phone", "01055556666");
  await page.fill("#shipper_name", "가온로지스");
  await page.fill("#memo", "야간 상차");
  await Promise.all([
    page.waitForURL(/\/shipments\/[0-9a-f-]+\?new=1/),
    page.click("button[type=submit].btn-primary"),
  ]);
  const detailUrl = page.url();
  const detail = await page.locator("body").innerText();
  c.ok("단건 저장 후 상세로 가고 저장 안내가 보인다", detail.includes("저장했습니다"));
  c.ok("저장 즉시 증빙 요청이 화면에 있다", detail.includes("서명 링크 만들기"));
  c.ok(
    "입력한 값이 그대로 보인다",
    detail.includes("가온로지스") && detail.includes("수출입 컨테이너 20FT") && detail.includes("010-5555-6666"),
  );

  // ── 엑셀 붙여넣기 ──────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/shipments/new`, { waitUntil: "networkidle" });
  await page.click("text=엑셀에서 붙여넣기");
  await page.waitForSelector("#paste");

  // 클립보드에 넣고 실제로 Ctrl+V를 누른다.
  await page.evaluate((text) => navigator.clipboard.writeText(text), SPREADSHEET_CLIPBOARD);
  await page.click("#paste");
  await page.keyboard.press("Control+V");
  await page.waitForSelector("table.preview-table", { timeout: 15000 });

  c.ok("첫 줄을 제목 줄로 알아본다", await page.locator('.card-head input[type=checkbox]').isChecked());

  const selects = page.locator("table.preview-table thead select");
  const mapping = await selects.evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
  c.ok(
    "칼럼 8개를 자동으로 짝지어 준다",
    JSON.stringify(mapping) ===
      JSON.stringify([
        "shipped_on", "cargo_type", "origin", "destination",
        "driver_name", "driver_phone", "shipper_name", "memo",
      ]),
    mapping.join(","),
  );

  const preview = await page.locator("table.preview-table").innerText();
  c.ok("미리보기에 저장될 값이 보인다 (2026.08.16 → 2026-08-16)", preview.includes("2026-08-16"));
  c.ok("미리보기에 정리된 연락처가 보인다 (01098765432 → 010-9876-5432)", preview.includes("010-9876-5432"));

  const body = await page.locator("body").innerText();
  c.ok(
    "못 읽는 2줄을 이유와 함께 짚어 준다",
    body.includes("2줄은 가져오지 않습니다") && body.includes("냉동탑차") && body.includes("8/18"),
    body.match(/\d줄은 가져오지 않습니다/)?.[0],
  );
  const buttonText = await page.locator("button:has-text('가져오기')").innerText();
  c.ok("가져올 건수를 버튼에 적는다", buttonText.includes("3건 가져오기"), buttonText);

  // 칼럼 매핑을 손으로 바꿔 본다
  await selects.nth(7).selectOption("");
  await page.waitForTimeout(300);
  c.ok("칼럼 매핑을 드롭다운으로 바꿀 수 있다", (await selects.nth(7).inputValue()) === "");
  await selects.nth(7).selectOption("memo");
  await page.waitForTimeout(300);

  await Promise.all([page.waitForURL(`${BASE_URL}/shipments`), page.click("button:has-text('가져오기')")]);
  await page.reload({ waitUntil: "networkidle" });
  const list = await page.locator("body").innerText();
  c.ok(
    "가져온 3건 + 단건 1건이 목록에 있다",
    ["2026-08-20", "2026-08-16", "2026-08-15", "2026-08-14"].every((d) => list.includes(d)),
  );
  c.ok("못 읽은 줄은 들어가지 않았다", !list.includes("2026-08-17") && !list.includes("남도유통"));
  c.ok("증빙이 없는 건은 '없음'으로 보인다", (await page.locator("td .badge-miss").count()) === 4);

  // ── 남의 운송 건 열어보기 ──────────────────────────────────────────
  const { ctx: ctxB, page: pageB } = await newContext(browser);
  await signIn(pageB, B);
  c.ok(
    "B의 목록은 비어 있다 (A의 운송 건이 보이지 않는다)",
    (await pageB.locator("body").innerText()).includes("아직 등록된 운송 건이 없습니다"),
  );
  const response = await pageB.goto(detailUrl.replace("?new=1", ""), { waitUntil: "networkidle" });
  c.ok(
    "B가 A의 운송 건 주소를 직접 열면 404다",
    response?.status() === 404 && !(await pageB.locator("body").innerText()).includes("가온로지스"),
    `status=${response?.status()}`,
  );

  await ctxB.close();
  await ctx.close();
  return c;
}
