-- 토큰 조회 제한을 실패 기준과 전체 기준으로 나눈다.
--
-- 처음에는 분당 10회를 전부 세었는데, 그러면 정상 서명자가 화면을 몇 번
-- 새로고침하는 것만으로 잠긴다. 서명이 막히는 것은 이 제품에서 가장 나쁜 일이다.
--
-- 막으려는 것은 열거 공격이고, 열거는 **실패**로 나타난다. 그래서 실패를 좁게
-- 막고(분당 10회) 전체는 넉넉히 둔다(분당 60회). 맞는 토큰을 반복해서 긁는 것도
-- 전체 상한에 걸린다.

DROP FUNCTION token_recent_lookups(inet, interval);

CREATE FUNCTION token_recent_lookups(p_ip inet, p_window interval)
RETURNS TABLE (total bigint, failures bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT count(*), count(*) FILTER (WHERE NOT found)
  FROM token_lookup
  WHERE p_ip IS NOT NULL AND ip = p_ip AND at > now() - p_window
$$;

REVOKE EXECUTE ON FUNCTION token_recent_lookups(inet, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION token_recent_lookups(inet, interval) TO proofhaul_app;
