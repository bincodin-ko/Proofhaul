/**
 * 미끼 도구 카운터 수신구 — Google Apps Script.
 *
 * 왜 필요한가:
 *   카운터는 서버 로그 한 줄이 전부다(app/api/count/route.ts). 그런데 Vercel
 *   Hobby 요금제의 런타임 로그 보관 기간이 **1시간**이다. 2주를 관찰해야 하는데
 *   1시간 뒤에 사라지면 셀 수가 없다.
 *
 *   그래서 COUNTER_WEBHOOK_URL로 한 줄씩 밖으로 밀어내고, 받는 쪽을 구글 시트로 둔다.
 *   공짜이고, 데이터는 본인 계정에 남고, 세는 건 시트 함수로 끝난다.
 *
 * 받는 값은 그대로 두 개뿐이다. IP도 UA도 입력값도 오지 않는다.
 *   {"evt":"cert_generated","kind":"WAIT","repeat":"first"}
 *
 * 시각은 **이 스크립트가 받은 시각**을 적는다. 브라우저가 보낸 시각을 믿지 않는다.
 *
 * 붙이는 법:
 *   1. 구글 시트를 새로 만든다
 *   2. 확장 프로그램 → Apps Script → 이 파일 내용을 붙여넣고 저장
 *   3. 배포 → 새 배포 → 유형 "웹 앱"
 *      - 실행 계정: 나
 *      - 액세스 권한: 모든 사용자   ← 이걸 해야 Vercel이 부를 수 있다
 *   4. 나온 /exec 주소를 Vercel 환경변수 COUNTER_WEBHOOK_URL 에 넣는다
 *
 * 세는 법 (시트 아무 빈 칸에):
 *   =COUNTA(A2:A)                     전체 생성 횟수
 *   =COUNTIF(B2:B,"WAIT")             대기시간 확인서만
 *   =COUNTIF(C2:C,"first")            처음 온 사람
 */

var KINDS = ["WAIT", "ROUGH_ROAD", "WASH_SWAP"];
var REPEATS = ["first", "2-3", "4+"];

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    // 못 읽는 본문은 조용히 버린다. 카운터 실패는 사용자와 무관하다.
  }

  // 허용 목록에 없는 값은 적지 않는다. 시트에 이상한 게 섞이는 걸 막는다.
  var kind = KINDS.indexOf(body.kind) >= 0 ? body.kind : "unknown";
  var repeat = REPEATS.indexOf(body.repeat) >= 0 ? body.repeat : "unknown";

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(["시각(KST)", "종류", "재방문"]);
  sheet.appendRow([
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
    kind,
    repeat,
  ]);

  return ContentService.createTextOutput("ok");
}
