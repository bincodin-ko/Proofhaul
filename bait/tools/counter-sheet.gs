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
 * 받는 값은 세 개뿐이다. IP도 UA도 입력값도 오지 않는다.
 *   {"evt":"cert_generated","kind":"WAIT","repeat":"first","via":"here"}
 *
 *   kind   — 확인서 종류
 *   repeat — 이 기기에서 몇 번째인지 (구간만)
 *   via    — here(현장에서 바로) / request(링크로 요청함) / link(링크 받은 쪽이 서명함)
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
 *   =COUNTIF(D2:D,"request")          링크로 서명을 요청한 횟수
 *   =COUNTIF(D2:D,"link")             링크를 받은 쪽이 실제로 서명한 횟수
 *
 * 마지막 두 줄이 이번 실험에서 제일 중요하다. request는 많은데 link가 0이면
 * 링크를 보내도 아무도 서명하지 않는다는 뜻이고, 그게 제품의 핵심 가정이 틀렸다는
 * 신호다.
 */

var KINDS = ["WAIT", "ROUGH_ROAD", "WASH_SWAP"];
var REPEATS = ["first", "2-3", "4+"];
var VIAS = ["here", "request", "link"];

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
  var via = VIAS.indexOf(body.via) >= 0 ? body.via : "unknown";

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(["시각(KST)", "종류", "재방문", "경로"]);
  sheet.appendRow([
    Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
    kind,
    repeat,
    via,
  ]);

  return ContentService.createTextOutput("ok");
}
