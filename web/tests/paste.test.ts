// 엑셀 붙여넣기 파싱.
//
// 아래 문자열은 엑셀이 클립보드에 넣는 형식 그대로다 —
// 셀은 탭, 줄은 CRLF, 탭·줄바꿈·큰따옴표가 든 셀만 큰따옴표로 감싸고 안의
// 큰따옴표는 둘로 겹친다. 끝에 CRLF가 하나 더 붙는다.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_ROWS,
  normalizePhone,
  parseGrid,
  parsePaste,
  parseShippedOn,
  toDrafts,
} from "../lib/paste";
import { parseCargoType } from "../lib/cargo";

const EXCEL_PASTE =
  "운송일자\t품목\t출발지\t도착지\t차주\t연락처\t화주\t비고\r\n" +
  "2026-08-14\t40FT\t부산 신항 2부두\t경남 양산시 물금읍\t김철수\t010-1234-5678\t평택항 제일물류센터\t오전 상차\r\n" +
  "2026-08-15\t20ft\t인천 남항\t충북 음성군\t박영수\t01098765432\t한빛로지스\t\r\n" +
  '2026.08.16\t시멘트\t단양공장\t충주 현장\t이순신\t010-2222-3333\t대한시멘트\t"게이트 대기,\n야간 하차"\r\n' +
  "\r\n";

test("엑셀이 넣어주는 형식 그대로 격자로 자른다", () => {
  const grid = parseGrid(EXCEL_PASTE);
  assert.equal(grid.length, 4, "헤더 1줄 + 데이터 3줄, 끝의 빈 줄은 버린다");
  assert.equal(grid[0]![0], "운송일자");
  assert.equal(grid[1]![4], "김철수");
  // 큰따옴표로 감싼 셀 안의 줄바꿈이 살아 있어야 한다.
  assert.equal(grid[3]![7], "게이트 대기,\n야간 하차");
});

// 아래는 LibreOffice Calc(리눅스)가 실제로 클립보드에 올린 text/plain을 그대로
// 옮긴 것이다. 위의 EXCEL_PASTE와 두 군데가 다르다.
//
//  - 줄 구분이 LF다 (윈도우 엑셀은 CRLF)
//  - 셀 안의 줄바꿈을 큰따옴표로 감싸지 않고 **공백으로 펴서** 내보낸다
//
// 앱마다 다르므로 둘 다 통과해야 한다. 큰따옴표로 감싸는 쪽(윈도우 엑셀,
// 구글 시트)은 EXCEL_PASTE가, 펴서 내보내는 쪽은 이쪽이 지킨다.
const CALC_PASTE =
  "운송일자\t품목\t출발지\t도착지\t차주\t연락처\t화주\t비고\n" +
  "2026-08-14\t40FT\t부산 신항 2부두\t경남 양산시 물금읍\t김철수\t010-1234-5678\t평택항 제일물류센터\t오전 상차\n" +
  "2026-08-15\t20ft\t인천 남항\t충북 음성군 대소면\t박영수\t01098765432\t한빛로지스\t\n" +
  "2026.08.16\t시멘트\t단양공장\t충주 현장\t이순신\t010-2222-3333\t대한시멘트\t게이트 대기, 야간 하차\n" +
  "2026-08-17\t냉동탑차\t광주\t목포\t최무선\t010-4444-5555\t남도유통\t품목 못 읽는 줄\n" +
  "8/18\t40FT\t평택\t천안\t강감찬\t010-6666-7777\t삼한물류\t연도 없는 날짜\n";

test("LF로 끊고 따옴표를 안 쓰는 앱(LibreOffice Calc)의 클립보드도 읽는다", () => {
  const parsed = parsePaste(CALC_PASTE);
  assert.equal(parsed.looksLikeHeader, true);
  assert.deepEqual(parsed.mapping, [
    "shipped_on", "cargo_type", "origin", "destination",
    "driver_name", "driver_phone", "shipper_name", "memo",
  ]);

  const results = toDrafts(parsed.rows, parsed.mapping, parsed.looksLikeHeader);
  const good = results.filter((r) => r.draft);
  const bad = results.filter((r) => !r.draft && r.errors.length > 0);

  // 결과는 CRLF·따옴표 쓰는 앱과 같아야 한다 — 3건 저장, 2줄 거부.
  assert.equal(good.length, 3);
  assert.equal(bad.length, 2);
  assert.deepEqual(good.map((r) => r.draft!.shipped_on), ["2026-08-14", "2026-08-15", "2026-08-16"]);
  assert.equal(good[1]!.draft!.driver_phone, "010-9876-5432");
  assert.equal(good[2]!.draft!.memo, "게이트 대기, 야간 하차");
});

test("셀 안의 큰따옴표는 둘로 겹쳐서 온다", () => {
  const grid = parseGrid('a\t"그가 ""왔다"" 함"\r\n');
  assert.deepEqual(grid, [["a", '그가 "왔다" 함']]);
});

test("첫 줄을 헤더로 알아보고 칼럼을 짝지어 준다", () => {
  const parsed = parsePaste(EXCEL_PASTE);
  assert.equal(parsed.looksLikeHeader, true);
  assert.deepEqual(parsed.mapping, [
    "shipped_on",
    "cargo_type",
    "origin",
    "destination",
    "driver_name",
    "driver_phone",
    "shipper_name",
    "memo",
  ]);
});

test("헤더 없이 데이터만 붙여넣어도 값의 생김새로 짚어 준다", () => {
  const parsed = parsePaste("2026-08-14\t40FT\t010-1234-5678\r\n2026-08-15\t20FT\t010-2222-3333\r\n");
  assert.equal(parsed.looksLikeHeader, false, "날짜가 있으면 헤더가 아니다");
  assert.deepEqual(parsed.mapping, ["shipped_on", "cargo_type", "driver_phone"]);
});

test("줄마다 초안으로 바꾼다", () => {
  const parsed = parsePaste(EXCEL_PASTE);
  const results = toDrafts(parsed.rows, parsed.mapping, parsed.looksLikeHeader);

  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.errors), [[], [], []]);

  assert.deepEqual(results[0]!.draft, {
    shipped_on: "2026-08-14",
    cargo_type: "CONTAINER_40",
    origin: "부산 신항 2부두",
    destination: "경남 양산시 물금읍",
    driver_name: "김철수",
    driver_phone: "010-1234-5678",
    shipper_name: "평택항 제일물류센터",
    memo: "오전 상차",
  });

  // 하이픈 없이 붙여 쓴 번호도 맞춰 준다.
  assert.equal(results[1]!.draft?.driver_phone, "010-9876-5432");
  // 2026.08.16 처럼 점으로 쓴 날짜, "시멘트" 품목
  assert.equal(results[2]!.draft?.shipped_on, "2026-08-16");
  assert.equal(results[2]!.draft?.cargo_type, "CEMENT");
  assert.equal(results[2]!.draft?.memo, "게이트 대기,\n야간 하차");
});

test("못 읽은 줄은 조용히 버리지 않고 이유를 남긴다", () => {
  const parsed = parsePaste(
    "운송일자\t품목\r\n" +
      "2026-08-14\t40FT\r\n" +
      "8/15\t40FT\r\n" +
      "2026-08-16\t냉동탑차\r\n" +
      "2026-02-30\t20FT\r\n",
  );
  const results = toDrafts(parsed.rows, parsed.mapping, parsed.looksLikeHeader);

  assert.equal(results[0]!.draft?.shipped_on, "2026-08-14");

  // 연도 없는 날짜는 올해로 짐작하지 않는다.
  assert.equal(results[1]!.draft, null);
  assert.match(results[1]!.errors[0]!, /운송 일자를 읽지 못했습니다.*8\/15/);

  assert.equal(results[2]!.draft, null);
  assert.match(results[2]!.errors[0]!, /품목을 알아보지 못했습니다.*냉동탑차/);

  // 있지도 않은 날짜
  assert.equal(results[3]!.draft, null);
  assert.match(results[3]!.errors[0]!, /운송 일자/);

  // 줄 번호는 원본 기준이라 헤더 다음이 2다.
  assert.deepEqual(results.map((r) => r.lineNumber), [2, 3, 4, 5]);
});

test("필수 칼럼이 지정되지 않으면 그 이유를 말해 준다", () => {
  const parsed = parsePaste("부산\t양산\r\n인천\t음성\r\n");
  const results = toDrafts(parsed.rows, parsed.mapping, parsed.looksLikeHeader);
  assert.equal(results[0]!.draft, null);
  assert.match(results[0]!.errors.join(" "), /운송 일자 칼럼이 지정되지 않았습니다/);
  assert.match(results[0]!.errors.join(" "), /품목 칼럼이 지정되지 않았습니다/);
});

test("중간의 빈 줄은 오류가 아니라 건너뛴다", () => {
  const parsed = parsePaste("2026-08-14\t40FT\r\n\t\r\n2026-08-15\t20FT\r\n");
  const results = toDrafts(parsed.rows, parsed.mapping, parsed.looksLikeHeader);
  assert.equal(results[1]!.draft, null);
  assert.deepEqual(results[1]!.errors, []);
  assert.equal(results.filter((r) => r.draft).length, 2);
});

test("행수 상한을 넘으면 잘랐다고 알려준다", () => {
  const many = Array.from({ length: MAX_ROWS + 10 }, () => "2026-08-14\t40FT").join("\r\n");
  const parsed = parsePaste(many);
  assert.equal(parsed.rows.length, MAX_ROWS);
  assert.deepEqual(parsed.truncated, { rows: 10 });
});

test("날짜 표기 여러 가지", () => {
  assert.equal(parseShippedOn("2026-08-15"), "2026-08-15");
  assert.equal(parseShippedOn("2026.8.5"), "2026-08-05");
  assert.equal(parseShippedOn("2026/08/15"), "2026-08-15");
  assert.equal(parseShippedOn("2026년 8월 15일"), "2026-08-15");
  assert.equal(parseShippedOn("8/15"), null, "연도가 없으면 짐작하지 않는다");
  assert.equal(parseShippedOn("어제"), null);
});

test("품목 표기 여러 가지", () => {
  assert.equal(parseCargoType("40FT"), "CONTAINER_40");
  assert.equal(parseCargoType("40피트"), "CONTAINER_40");
  assert.equal(parseCargoType("20'"), "CONTAINER_20");
  assert.equal(parseCargoType("시멘트"), "CEMENT");
  assert.equal(parseCargoType("기타"), "ETC");
  assert.equal(parseCargoType("냉동"), null, "모르면 기타로 떨어뜨리지 않는다");
});

test("연락처는 알아볼 수 있을 때만 손댄다", () => {
  assert.equal(normalizePhone("01012345678"), "010-1234-5678");
  assert.equal(normalizePhone("010 1234 5678"), "010-1234-5678");
  assert.equal(normalizePhone("051-123-4567"), "051-123-4567", "유선번호는 그대로 둔다");
  assert.equal(normalizePhone("내선 302"), "내선 302");
});
