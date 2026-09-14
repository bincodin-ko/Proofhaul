-- 역할 분리.
--
-- 마이그레이션은 소유자 역할로, 앱 런타임은 proofhaul_app 역할로 붙는다.
-- 앱 역할은 테이블 소유자가 아니고 BYPASSRLS도 없다. 앱 코드에 버그가 있어도
-- RLS를 벗어날 방법이 없어야 한다 (05-SECURITY 위협 2).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proofhaul_app') THEN
    CREATE ROLE proofhaul_app LOGIN NOINHERIT;
  END IF;
END
$$;

-- 실수로 권한이 올라가 있으면 여기서 되돌린다.
ALTER ROLE proofhaul_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- public 스키마에 아무나 테이블을 만들지 못하게
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO proofhaul_app;

-- 현재 세션이 보고 있는 회사. 설정되지 않으면 NULL이고, 모든 RLS 정책이 거짓이 된다.
-- 기본값이 "전부 허용"이 아니라 "전부 차단"이어야 한다.
CREATE OR REPLACE FUNCTION current_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION current_company_id() TO proofhaul_app;
