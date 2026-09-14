-- 데이터 모델 — docs/01-SPEC.md "데이터 모델" 절.
--
-- 모든 id는 UUID. 자동증가 정수를 쓰면 주소창 숫자만 바꿔도 남의 데이터가 열린다
-- (01-SPEC, 05-SECURITY 위협 2).
--
-- SPEC과 다른 점이 하나 있다. evidence와 fee_calc에 company_id를 들고 있다.
-- SPEC에서는 shipment를 타고 올라가야 회사를 알 수 있는데, 그러면 RLS 정책마다
-- 서브쿼리가 붙고 정책 하나만 틀려도 새어 나간다. 대신 복합 외래키로
-- "남의 회사 운송 건에 증빙을 달 수 없게" DB가 막는다. 아래 주석 참조.

CREATE TABLE company (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  biz_no      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- "user"는 예약어라 app_user로 둔다.
CREATE TABLE app_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  -- 이메일은 소문자로만 저장한다. 확장 없이 대소문자 구분을 없앤다.
  email          text NOT NULL CHECK (email = lower(email) AND position('@' in email) > 1),
  password_hash  text NOT NULL,
  name           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_user_email_key ON app_user (email);
CREATE INDEX app_user_company_idx ON app_user (company_id);

CREATE TABLE shipment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  cargo_type    text NOT NULL CHECK (cargo_type IN ('CONTAINER_20', 'CONTAINER_40', 'CEMENT', 'ETC')),
  origin        text,
  destination   text,
  shipped_on    date NOT NULL,
  driver_name   text,
  driver_phone  text,
  shipper_name  text,
  memo          text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- evidence가 (shipment_id, company_id)로 참조할 수 있게 한다.
  UNIQUE (id, company_id)
);

CREATE INDEX shipment_company_month_idx ON shipment (company_id, shipped_on DESC);
CREATE INDEX shipment_company_shipper_idx ON shipment (company_id, shipper_name);

CREATE TABLE evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id  uuid NOT NULL,
  company_id   uuid NOT NULL,

  kind    text NOT NULL CHECK (kind IN ('WAIT', 'ROUGH_ROAD', 'WASH_SWAP', 'RECEIPT', 'ETC')),
  status  text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'SIGNED', 'EXPIRED')),

  -- 토큰 원문은 저장하지 않는다. 해시만 (05-SECURITY 위협 1).
  -- DB 덤프가 유출돼도 서명 링크를 복원할 수 없어야 한다.
  token_hash  bytea NOT NULL,

  requested_at  timestamptz NOT NULL DEFAULT now(),
  signed_at     timestamptz,
  expires_at    timestamptz NOT NULL,

  signer_name  text,
  signer_role  text CHECK (signer_role IS NULL OR signer_role IN ('SHIPPER', 'DRIVER')),

  payload_json  jsonb NOT NULL DEFAULT '{}'::jsonb,

  signature_png_path  text,
  pdf_path            text,

  -- 분쟁 대비. 개인정보이므로 보관 기간 대상이다 (A7에서 파기 스크립트).
  signer_ip          inet,
  signer_user_agent  text,

  -- 남의 회사 운송 건에 증빙을 달 수 없다. 앱이 실수해도 DB가 거부한다.
  FOREIGN KEY (shipment_id, company_id) REFERENCES shipment (id, company_id) ON DELETE CASCADE,

  -- fee_calc가 (evidence_id, company_id)로 참조할 수 있게 한다.
  UNIQUE (id, company_id),

  -- 서명된 증빙은 서명 시각과 서명자가 있어야 한다.
  CONSTRAINT evidence_signed_shape CHECK (
    (status <> 'SIGNED') OR (signed_at IS NOT NULL AND signer_name IS NOT NULL)
  )
);

-- 토큰 조회는 해시 하나로 한 건만 찾는다. 토큰 1개 = 증빙 1건.
CREATE UNIQUE INDEX evidence_token_hash_key ON evidence (token_hash);
CREATE INDEX evidence_shipment_idx ON evidence (shipment_id);
CREATE INDEX evidence_company_status_idx ON evidence (company_id, status);

CREATE TABLE fee_calc (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id  uuid NOT NULL,
  company_id   uuid NOT NULL,

  -- 적용한 고시/개정 시점. 과거 건은 최신 규칙이 아니라 이 버전으로 재계산한다
  -- (01-SPEC "calc_version이 핵심이다").
  calc_version  text NOT NULL,

  input_json  jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- NULL은 "미지원"이다. 0이 아니다.
  -- 규칙이 확정되지 않은 항목을 0으로 채우면 틀린 금액을 청구하게 된다
  -- (02-RULES "코드 반영 규칙" 2·3항).
  base_amount     numeric(14, 2) CHECK (base_amount IS NULL OR base_amount >= 0),
  surcharge_json  jsonb,
  total_amount    numeric(14, 2) CHECK (total_amount IS NULL OR total_amount >= 0),

  calculated_at  timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (evidence_id, company_id) REFERENCES evidence (id, company_id) ON DELETE CASCADE
);

CREATE INDEX fee_calc_evidence_idx ON fee_calc (evidence_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON company, app_user, shipment, evidence, fee_calc TO proofhaul_app;
