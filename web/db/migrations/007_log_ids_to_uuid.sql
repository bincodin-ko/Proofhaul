-- 속도 제한 로그 두 개의 id를 UUID로 바꾼다.
--
-- "모든 id는 UUID. 자동증가 정수 금지" (docs/06-FAST-TRACK.md A1,
-- docs/03-BUILD-PROMPT.md 명령 3). login_attempt와 token_lookup이 bigserial이었다.
--
-- 이 두 테이블은 주소창에도 API에도 나오지 않고 RLS가 전부 막고 있어서 실제
-- 위험은 없었다. 그래도 예외를 두지 않는다 — "여기는 괜찮다"가 쌓이면 규칙이
-- 규칙이 아니게 된다. 점검은 그런 예외를 잡으라고 하는 것이다.
--
-- 둘 다 덧붙이기만 하는 로그라 기존 행을 보존할 이유가 없다. 비우고 다시 만든다.

DROP TABLE login_attempt;
DROP TABLE token_lookup;

CREATE TABLE login_attempt (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE token_lookup (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip     inet,
  found  boolean NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX token_lookup_ip_idx ON token_lookup (ip, at DESC);
CREATE INDEX token_lookup_at_idx ON token_lookup (at);

ALTER TABLE token_lookup ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_lookup FORCE ROW LEVEL SECURITY;

-- 정책은 여전히 없다 = 전부 거부. 정의자 함수로만 닿는다.
-- 함수들은 테이블을 이름으로 참조하므로 다시 만들 필요가 없다.
