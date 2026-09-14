-- 테넌트 분리 — 05-SECURITY "위협 2".
--
-- 앱 코드가 WHERE company_id를 빠뜨려도 DB가 막는다. 앱 레벨 검사만 믿지 않는다.
-- 정책은 전부 current_company_id()를 본다. 세션에 회사가 설정되지 않으면 NULL이고,
-- NULL 비교는 거짓이라 아무 행도 보이지 않는다. 기본값이 차단이다.

ALTER TABLE company  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_calc ENABLE ROW LEVEL SECURITY;

-- FORCE — 테이블 소유자도 정책을 따른다. 앱이 실수로 소유자 역할로 붙어도 새지 않는다.
ALTER TABLE company  FORCE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
ALTER TABLE shipment FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE fee_calc FORCE ROW LEVEL SECURITY;

CREATE POLICY company_tenant ON company
  USING (id = current_company_id())
  WITH CHECK (id = current_company_id());

CREATE POLICY app_user_tenant ON app_user
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY shipment_tenant ON shipment
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY evidence_tenant ON evidence
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

CREATE POLICY fee_calc_tenant ON fee_calc
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());


-- ── 회사 맥락 없이 들어오는 두 경로 ────────────────────────────────────────
--
-- 로그인과 토큰 서명은 회사를 알기 전에 일어난다. RLS를 끄는 대신, 필요한 것만
-- 돌려주는 SECURITY DEFINER 함수 두 개로만 뚫는다. 뚫린 구멍이 어디인지 이
-- 파일만 보면 알 수 있게 하려는 것이다.
--
-- SECURITY DEFINER 함수는 search_path를 고정한다. 고정하지 않으면 호출자가
-- 만든 동명의 객체가 함수 안에서 실행될 수 있다.

-- 1) 로그인. 인증에 필요한 칼럼만 돌려준다.
--    계정 존재 여부가 응답에서 드러나지 않게 하는 것과 속도 제한은 앱의 몫이다
--    (05-SECURITY 위협 7, A2에서 구현).
CREATE FUNCTION auth_lookup_user(p_email text)
RETURNS TABLE (id uuid, company_id uuid, password_hash text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.company_id, u.password_hash, u.name
  FROM app_user u
  WHERE u.email = lower(btrim(p_email))
$$;

REVOKE EXECUTE ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO proofhaul_app;

-- 2) 토큰으로 증빙 1건 찾기.
--    토큰 1개 = 증빙 1건이다. 운송 건 전체나 회사에 접근시키지 않는다.
--    서명 전 화면에 띄울 최소 정보만 돌려준다 — 운송 건, 날짜, 품목, 요청 회사명.
--    차주 연락처·메모·다른 운송 건·금액은 여기서 나가지 않는다
--    (05-SECURITY 위협 1 "서명 전 화면에 노출할 정보를 최소화한다").
--
--    만료 여부를 판단해서 거르지 않고 그대로 돌려준다. 없는 토큰과 만료된 토큰의
--    응답을 구분할 수 없게 만드는 일은 앱에서 한 곳으로 모아 처리한다.
CREATE FUNCTION evidence_by_token_hash(p_token_hash bytea)
RETURNS TABLE (
  evidence_id   uuid,
  company_id    uuid,
  kind          text,
  status        text,
  expires_at    timestamptz,
  signed_at     timestamptz,
  shipment_id   uuid,
  shipped_on    date,
  cargo_type    text,
  company_name  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT e.id, e.company_id, e.kind, e.status, e.expires_at, e.signed_at,
         s.id, s.shipped_on, s.cargo_type, c.name
  FROM evidence e
  JOIN shipment s ON s.id = e.shipment_id AND s.company_id = e.company_id
  JOIN company  c ON c.id = e.company_id
  WHERE e.token_hash = p_token_hash
$$;

REVOKE EXECUTE ON FUNCTION evidence_by_token_hash(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION evidence_by_token_hash(bytea) TO proofhaul_app;
