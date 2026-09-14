# 운임근거함 (본체)

운송 한 건에 붙는 증빙을 **요청하고 · 받고 · 빠뜨린 걸 찾는다.** 사양은 `docs/01-SPEC.md`.

`bait/`(Day 0 미끼 도구)와 코드를 공유하지 않는다. 별개의 앱이다.

## 지금까지 된 것 — A1

`docs/06-FAST-TRACK.md`의 Phase A 중 **A1(프로젝트 골격과 규칙 인터페이스)**.

- Next.js(App Router) + Postgres 골격
- `docs/01-SPEC.md` 데이터 모델대로 스키마와 마이그레이션
- 테넌트 분리 — RLS + 앱 단일 진입점
- `rules/` 인터페이스. **숫자는 하나도 없다**

화면 1·2·3은 A3·A4·A6에서 붙는다. 인증은 A2.

## 돌리기

```
cp .env.example .env        # .env는 커밋하지 않는다
npm install
npm run migrate
npm test
npm run dev
```

`npm test`는 실제 Postgres에 붙어서 돈다. `DATABASE_URL`과 `DATABASE_URL_APP`이 필요하다.

## 규칙은 모양만 있고 값은 비어 있다

```ts
rulesFor("2026-07-31")?.version   // "2026.02"
rulesFor("2026-08-01")?.version   // "2026.08"   ← 7월 건과 8월 건의 기준이 다르다
rulesFor("2026-01-31")            // null        ← 확정된 버전이 없는 날짜
```

`waitThreshold` · `surcharge` · `fuelAdjustment`는 **전부 `null`을 돌려준다.**
국토교통부 고시 원문 대조가 끝나지 않았다(`docs/02-RULES-v2026.md` B절).

- `null`은 "미확정"이다. **0이 아니다.** 화면과 PDF는 `null`을 받으면 "미지원"을 띄운다
- `?? 0`을 쓰고 싶어지면 `requireSupported()`를 쓴다. 조용히 0으로 떨어지는 대신 터진다
- 원문을 확보하면 `rules/v2026-*.ts`의 `null`만 바꾼다. 앱 코드는 건드리지 않는다 (Phase B2)

`tests/rules.test.ts`의 첫 번째 테스트가 "모든 함수가 null을 돌려준다"를 검사한다.
원문 대조 전에 누가 값을 채워 넣으면 여기서 터진다.

### 날짜는 KST로 본다

`2026-08-01 00:30 KST`는 UTC로는 7월 31일이다. UTC로 비교하면 8월 건이 7월 버전으로
계산된다. `toKstDate()`가 이걸 막는다.

## 테넌트 분리

여러 운송사가 한 DB를 쓴다. A 운송사가 B 운송사 데이터를 보면 끝이다
(`docs/05-SECURITY.md` 위협 2).

**두 겹으로 막는다.**

1. **DB — RLS.** 다섯 테이블 전부 `ENABLE` + `FORCE ROW LEVEL SECURITY`.
   정책은 `current_company_id()` 하나만 본다. 세션에 회사가 설정되지 않으면 `NULL`이고,
   `NULL` 비교는 거짓이라 아무 행도 보이지 않는다. **기본값이 차단이다**
2. **앱 — 단일 진입점.** 회사 데이터를 만지는 코드는 전부 `db/tenant.ts`의
   `withCompany()`를 거친다. 검사를 앱 곳곳에 흩어두면 하나만 빠져도 새어 나간다

런타임은 `proofhaul_app` 역할로 붙는다. 테이블 소유자가 아니고 `BYPASSRLS`도 없다.
설정 실수로 슈퍼유저가 들어가면 테넌트 분리가 통째로 무력화되는데 앱은 멀쩡히
동작해서 알아채지 못하므로, `assertAppRoleIsRestricted()`가 시작할 때 막는다.

`SET LOCAL`이라 트랜잭션이 끝나면 회사 맥락도 사라진다. 풀에서 다음 요청이 같은
커넥션을 받아도 앞 요청의 회사가 남지 않는다.

### 회사 맥락 없이 도는 두 경로

로그인과 토큰 서명은 회사를 알기 전에 일어난다. RLS를 끄는 대신 **필요한 것만
돌려주는 `SECURITY DEFINER` 함수 두 개**로만 뚫는다. 뚫린 구멍이 어디인지
`db/migrations/003_rls.sql` 하나만 보면 알 수 있게 했다.

| 함수 | 돌려주는 것 |
|---|---|
| `auth_lookup_user(email)` | 인증에 필요한 4개 칼럼만 |
| `evidence_by_token_hash(hash)` | 증빙 1건 + 서명 전 화면에 띄울 최소 정보 |

`evidence_by_token_hash`는 운송 건, 날짜, 품목, 요청 회사명까지만 돌려준다.
**차주 연락처·메모·출발지·다른 운송 건·금액은 나가지 않는다.** 테스트가 이걸 검사한다.

서명 쓰기는 A4에서 붙인다. 토큰으로 회사를 알아낸 뒤 그 회사 맥락에서 `withCompany`로
쓸지, 증빙 1건만 건드리는 정의자 함수를 하나 더 둘지는 A4에서 정한다.

## SPEC과 다른 곳 — 한 군데

`docs/01-SPEC.md`에서 `evidence`와 `fee_calc`는 `shipment`를 타고 올라가야 회사를 알 수 있다.
스키마에서는 **두 테이블에 `company_id`를 들고 있다.**

- 이유: RLS 정책마다 서브쿼리가 붙으면 정책 하나만 틀려도 새어 나간다.
  정책을 `company_id = current_company_id()` 한 줄로 유지하려는 것
- 일관성은 복합 외래키로 DB가 강제한다.
  `evidence (shipment_id, company_id) → shipment (id, company_id)`.
  **남의 회사 운송 건에 증빙을 달 수 없다.** 앱이 실수해도 DB가 거부한다
  (`tests/tenant.test.ts`에서 실제로 시도해서 확인)

나머지는 SPEC 그대로다.

## 스키마에 박아둔 것

- **모든 `id`는 UUID.** 자동증가 정수는 주소창 숫자만 바꿔도 남의 데이터가 열린다
- **`evidence.token_hash`** — 토큰 원문은 저장하지 않는다. DB 덤프가 유출돼도
  서명 링크를 복원할 수 없다. `UNIQUE`라서 토큰 1개는 증빙 1건에만 대응한다
- **`fee_calc.calc_version`** — 적용한 고시 시점. 과거 건은 최신 규칙이 아니라
  이 버전으로 재계산한다 (`docs/01-SPEC.md` "calc_version이 핵심이다")
- **`fee_calc.base_amount` / `total_amount`는 `NULL` 허용.** `NULL`이 미지원이고 0이 아니다
- `evidence.signer_ip` / `signer_user_agent` — 분쟁 대비. 개인정보이므로
  보관 기간 대상이다 (A7에서 파기 스크립트)

## 검증한 것

`tests/tenant.test.ts` — **실제 Postgres에 붙어서** 회사 2곳을 만들고 남의 데이터에
닿는지 시도한다. 코드를 읽는 건 검증이 아니다 (`docs/05-SECURITY.md` 위협 2).

- 남의 `shipment` · `evidence` · `app_user` · `company`를 id로 직접 조회 → 0건
- 남의 데이터 수정·삭제 → 0건 (소유자 눈으로 원본이 그대로인지 재확인)
- 남의 `company_id`로 삽입 → RLS 위반으로 거부
- 남의 운송 건에 증빙 달기 → 외래키 위반으로 거부
- 회사 맥락 없이 조회 → 0건
- 토큰 문자열 1글자 변조 → 0건
- 토큰 조회 응답에 연락처·메모가 섞여 있지 않은지
- 다섯 테이블 `FORCE ROW LEVEL SECURITY` 확인, 다섯 테이블 `id` 칼럼 타입이 `uuid`인지 확인

`tests/rules.test.ts` — 규칙 함수가 전부 `null`인지, 버전 선택이 KST 기준으로 맞는지.

## 아직 안 한 것

A2부터. 인증(bcrypt/argon2, 세션 쿠키, 속도 제한, 응답 통일), 화면 1·2·3,
파일 업로드와 PDF, 개인정보 장치와 킬 스위치.
