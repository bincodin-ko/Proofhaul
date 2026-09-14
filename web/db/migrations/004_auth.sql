-- 로그인 세션과 시도 기록 — 05-SECURITY "위협 7 — 계정".

-- user_session이 (user_id, company_id)로 참조할 수 있게 한다.
-- 이렇게 두면 세션의 회사와 사용자의 회사가 어긋난 행을 DB가 거부한다.
ALTER TABLE app_user ADD CONSTRAINT app_user_id_company_key UNIQUE (id, company_id);

CREATE TABLE user_session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  company_id  uuid NOT NULL,

  -- 세션 토큰도 원문을 저장하지 않는다. 증빙 토큰과 같은 규칙이다 (05-SECURITY 위협 1).
  token_hash  bytea NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,

  FOREIGN KEY (user_id, company_id) REFERENCES app_user (id, company_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX user_session_token_hash_key ON user_session (token_hash);
CREATE INDEX user_session_user_idx ON user_session (user_id);
CREATE INDEX user_session_expires_idx ON user_session (expires_at);

ALTER TABLE user_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_session FORCE ROW LEVEL SECURITY;

CREATE POLICY user_session_tenant ON user_session
  USING (company_id = current_company_id())
  WITH CHECK (company_id = current_company_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_session TO proofhaul_app;


-- ── 로그인 시도 기록 ──────────────────────────────────────────────────────
--
-- 속도 제한의 근거다. 회사 맥락 없이 기록·조회해야 하므로 RLS는 켜되 정책을 두지
-- 않는다. 정책이 없으면 전부 거부다. 아래 정의자 함수로만 닿을 수 있다.
--
-- 이메일은 평문으로 남기지 않는다. 실패 로그가 곧 이메일 목록이 되면 안 된다
-- (05-SECURITY "기본 위생": 로그에 연락처를 남기지 않는다).
-- 해시는 되돌릴 수 없는 게 아니라 "훑어서 목록을 만들기 어렵게" 하는 정도다.

CREATE TABLE login_attempt (
  id          bigserial PRIMARY KEY,
  ip          inet,
  email_hash  bytea NOT NULL,
  succeeded   boolean NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempt_ip_idx ON login_attempt (ip, at DESC) WHERE NOT succeeded;
CREATE INDEX login_attempt_email_idx ON login_attempt (email_hash, at DESC) WHERE NOT succeeded;
CREATE INDEX login_attempt_at_idx ON login_attempt (at);

ALTER TABLE login_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempt FORCE ROW LEVEL SECURITY;
-- 정책 없음 = 전부 거부. 아래 함수로만 닿는다.

CREATE FUNCTION auth_note_attempt(p_ip inet, p_email_hash bytea, p_succeeded boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO login_attempt (ip, email_hash, succeeded) VALUES (p_ip, p_email_hash, p_succeeded)
$$;

REVOKE EXECUTE ON FUNCTION auth_note_attempt(inet, bytea, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_note_attempt(inet, bytea, boolean) TO proofhaul_app;

/* 최근 창 안의 실패 횟수. IP 기준과 이메일 기준을 따로 돌려준다. */
CREATE FUNCTION auth_recent_failures(p_ip inet, p_email_hash bytea, p_window interval)
RETURNS TABLE (by_ip bigint, by_email bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    count(*) FILTER (WHERE p_ip IS NOT NULL AND ip = p_ip),
    count(*) FILTER (WHERE email_hash = p_email_hash)
  FROM login_attempt
  WHERE NOT succeeded AND at > now() - p_window
$$;

REVOKE EXECUTE ON FUNCTION auth_recent_failures(inet, bytea, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_recent_failures(inet, bytea, interval) TO proofhaul_app;

/* 오래된 시도 기록 지우기. A7의 파기 배치에서 부른다. */
CREATE FUNCTION auth_purge_attempts(p_older_than interval)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM login_attempt WHERE at < now() - p_older_than;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;

REVOKE EXECUTE ON FUNCTION auth_purge_attempts(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_purge_attempts(interval) TO proofhaul_app;


-- ── 세션 조회 ─────────────────────────────────────────────────────────────
--
-- 쿠키를 들고 온 요청은 아직 회사를 모른다. 회사를 알아내는 것이 이 함수의 일이고,
-- 그 뒤부터는 withCompany로 평소 경로를 탄다.
-- 만료 판정은 여기서 하지 않고 그대로 돌려준다. 앱에서 한 곳으로 모아 처리한다.

CREATE FUNCTION session_lookup(p_token_hash bytea)
RETURNS TABLE (
  session_id  uuid,
  user_id     uuid,
  company_id  uuid,
  expires_at  timestamptz,
  user_name   text,
  user_email  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.user_id, s.company_id, s.expires_at, u.name, u.email
  FROM user_session s
  JOIN app_user u ON u.id = s.user_id AND u.company_id = s.company_id
  WHERE s.token_hash = p_token_hash
$$;

REVOKE EXECUTE ON FUNCTION session_lookup(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION session_lookup(bytea) TO proofhaul_app;
