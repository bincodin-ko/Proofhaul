// 브라우저 검증 전체 실행.
//
//   npm run dev              (다른 터미널에서)
//   npm run e2e
//
// 검증용 회사 2곳을 새로 만들고, 끝나면 지운다.

import { cleanup, Checks, launch, owner, resetRateLimits, seedAccount, BASE_URL } from "./harness";
import { run as runAuth } from "./auth";
import { run as runShipments } from "./shipments";
import { run as runSign } from "./sign";
import { getAppPool } from "../../db/client";

async function main() {
  const response = await fetch(`${BASE_URL}/login`).catch(() => null);
  if (!response?.ok) {
    console.error(`${BASE_URL} 에 붙지 못했습니다. 먼저 npm run dev 를 띄우세요.`);
    process.exit(1);
  }

  const A = await seedAccount("가나운수");
  const B = await seedAccount("다라물류");
  const browser = await launch();
  const suites: Checks[] = [];

  try {
    await resetRateLimits();
    suites.push(await runAuth(browser, A, B));
    await resetRateLimits();
    suites.push(await runShipments(browser, A, B));
    suites.push(await runSign(browser, A, B));
  } finally {
    await browser.close();
    await cleanup([A, B]);
    await owner.end();
    await getAppPool().end();
  }

  let failed = 0;
  for (const suite of suites) {
    console.log(`\n## ${suite.suite}`);
    for (const item of suite.items) {
      console.log(`${item.pass ? "  PASS" : "  FAIL"}  ${item.check}${item.detail ? ` — ${item.detail}` : ""}`);
    }
    failed += suite.failed.length;
  }

  const total = suites.reduce((n, s) => n + s.items.length, 0);
  console.log(`\n${total - failed}/${total} 통과`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
