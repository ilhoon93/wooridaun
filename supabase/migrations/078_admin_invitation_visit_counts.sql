-- 078: 관리자 알림장 목록의 하객/소장 방문수 일괄 집계 RPC.
--
-- 배경: /admin/invitations 목록에서 알림장별 방문수를 알림장마다 count 쿼리로
-- 개별 조회하면 페이지당 최대 (알림장수 × 2)회의 왕복이 발생한다(N+1).
-- 이 함수는 주어진 알림장 id 배열에 대해 guest_visits 를 단일 group by 로 집계해
-- 하객(guest)/소장(owner) 방문수를 한 번에 돌려준다.
--
-- security definer + service_role 전용(anon/authenticated revoke). 앱은 requireAdmin
-- 이후 service-role 클라이언트로만 호출한다. 조회 전용(개인정보 없음, 카운트만).
-- 앱 코드는 이 함수가 없으면(마이그 미적용) 기존 per-invitation count 로 폴백하므로
-- 배포 순서에 관계없이 안전하다.

create or replace function public.admin_invitation_visit_counts(inv_ids uuid[])
returns table (
  invitation_id uuid,
  guest_count bigint,
  owner_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.invitation_id,
    count(*) filter (where v.viewer_role is distinct from 'owner') as guest_count,
    count(*) filter (where v.viewer_role = 'owner')                as owner_count
  from public.guest_visits v
  where v.invitation_id = any(inv_ids)
  group by v.invitation_id;
$$;

revoke execute on function public.admin_invitation_visit_counts(uuid[]) from anon, authenticated;
