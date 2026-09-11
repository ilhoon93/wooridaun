-- ============================================================
-- 077_engagement_guestbook_only.sql
--
--   * public_engagement_count() 를 "방명록 메시지"만 세도록 변경
--     (기존: 방명록 + 서명 + 축하하기 합계 → 변경: 방명록 메시지만).
--     운영자 요청: 하객이 남긴 방명록만 집계, 축하 버튼/서명은 제외.
--   * site_visits 익명 insert 권한을 명시적으로 부여(기본 권한 의존 제거) —
--     홈페이지 방문 집계가 확실히 기록되도록.
-- ============================================================

create or replace function public.public_engagement_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(count(*), 0)::int from public.guestbook_messages;
$$;

grant execute on function public.public_engagement_count() to anon, authenticated;

-- 홈페이지 방문(site_visits) 익명 insert 보장.
grant insert on public.site_visits to anon, authenticated;
