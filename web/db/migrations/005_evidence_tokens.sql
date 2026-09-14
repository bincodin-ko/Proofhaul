-- 증빙 토큰 — 05-SECURITY "위협 1 — 토큰".
--
-- 이 제품에서 가장 위험한 지점이다. 로그인 없이 열리는 링크가 핵심 기능이라
-- 공격 표면이 거기 몰려 있다.

-- ── 토큰 조회 기록 ────────────────────────────────────────────────────────
--
-- 열거 공격 차단의 근거. 로그인 시도 기록과 같은 모양이다 — RLS는 켜되 정책을
-- 두지 않고, 정의자 함수로만 닿는다.
--
-- 토큰은 기록하지 않는다. 시도 로그가 곧 토큰 목록이 되면 안 된다.

CREATE TABLE token_lookup (
  id     bigserial PRIMARY KEY,
  ip     inet,
  found  boolean NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX token_lookup_ip_idx ON token_lookup (ip, at DESC);
CREATE INDEX token_lookup_at_idx ON token_lookup (at);

ALTER TABLE token_lookup ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_lookup FORCE ROW LEVEL SECURITY;

CREATE FUNCTION token_note_lookup(p_ip inet, p_found boolean)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ INSERT INTO token_lookup (ip, found) VALUES (p_ip, p_found) $$;

REVOKE EXECUTE ON FUNCTION token_note_lookup(inet, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION token_note_lookup(inet, boolean) TO proofhaul_app;

/* 창 안의 조회 횟수. 실패만이 아니라 전부 센다 — 맞는 토큰을 반복해서 긁는 것도 막는다. */
CREATE FUNCTION token_recent_lookups(p_ip inet, p_window interval)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT count(*) FROM token_lookup
  WHERE p_ip IS NOT NULL AND ip = p_ip AND at > now() - p_window
$$;

REVOKE EXECUTE ON FUNCTION token_recent_lookups(inet, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION token_recent_lookups(inet, interval) TO proofhaul_app;

CREATE FUNCTION token_purge_lookups(p_older_than interval)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE removed bigint;
BEGIN
  DELETE FROM token_lookup WHERE at < now() - p_older_than;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;

REVOKE EXECUTE ON FUNCTION token_purge_lookups(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION token_purge_lookups(interval) TO proofhaul_app;


-- ── 토큰 조회 ─────────────────────────────────────────────────────────────
--
-- 003에서 만든 것을 저장된 해시까지 함께 돌려주도록 바꾼다. 앱에서 상수 시간
-- 비교를 한 번 더 하기 위한 것이다. 반환 타입이 바뀌므로 지우고 다시 만든다.
--
-- 돌려주는 정보는 여전히 최소한이다 — 운송 건, 날짜, 품목, 요청 회사명.
-- 차주 연락처·메모·출발지·금액은 여기서 나가지 않는다.

DROP FUNCTION evidence_by_token_hash(bytea);

CREATE FUNCTION evidence_by_token_hash(p_token_hash bytea)
RETURNS TABLE (
  evidence_id   uuid,
  company_id    uuid,
  kind          text,
  status        text,
  token_hash    bytea,
  expires_at    timestamptz,
  signed_at     timestamptz,
  shipment_id   uuid,
  shipped_on    date,
  cargo_type    text,
  company_name  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT e.id, e.company_id, e.kind, e.status, e.token_hash, e.expires_at, e.signed_at,
         s.id, s.shipped_on, s.cargo_type, c.name
  FROM evidence e
  JOIN shipment s ON s.id = e.shipment_id AND s.company_id = e.company_id
  JOIN company  c ON c.id = e.company_id
  WHERE e.token_hash = p_token_hash
$$;

REVOKE EXECUTE ON FUNCTION evidence_by_token_hash(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION evidence_by_token_hash(bytea) TO proofhaul_app;


-- ── 서명 저장 ─────────────────────────────────────────────────────────────
--
-- 서명하는 사람은 로그인이 없고 회사도 모른다. 그렇다고 그 요청에 회사 맥락을
-- 통째로 열어 주지 않는다. 토큰이 가리키는 증빙 **한 건만** 건드리는 함수를 둔다.
-- 토큰 1개 = 증빙 1건이라는 규칙을 DB 함수 서명 자체가 지키게 하는 것이다.
--
-- WHERE에 status와 expires_at이 함께 들어간다. 이미 서명된 건이나 만료된 건은
-- 0행이 갱신되고, 앱은 그것을 실패로 받는다. 서명 완료 후 같은 토큰으로 수정하는
-- 경로가 없다.

CREATE FUNCTION evidence_sign(
  p_token_hash      bytea,
  p_signer_name     text,
  p_signer_role     text,
  p_payload         jsonb,
  p_signature_path  text,
  p_ip              inet,
  p_user_agent      text
)
RETURNS TABLE (evidence_id uuid, company_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  UPDATE evidence SET
    status             = 'SIGNED',
    signed_at          = now(),
    signer_name        = p_signer_name,
    signer_role        = p_signer_role,
    payload_json       = p_payload,
    signature_png_path = p_signature_path,
    signer_ip          = p_ip,
    signer_user_agent  = left(p_user_agent, 400)
  WHERE token_hash = p_token_hash
    AND status = 'REQUESTED'
    AND expires_at > now()
  RETURNING id, company_id
$$;

REVOKE EXECUTE ON FUNCTION evidence_sign(bytea, text, text, jsonb, text, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION evidence_sign(bytea, text, text, jsonb, text, inet, text) TO proofhaul_app;
