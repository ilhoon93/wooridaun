-- ============================================================
-- 076_social_proof_engagement_metrics.sql
--
-- 사회적 증거(홈 랜딩)용 추가 자동집계 지표.
--   * guest_visits.viewer_role — 하객용(guest) / 소장용(owner) 조회 구분 집계
--   * site_visits — 홈페이지(랜딩) 방문 세션 집계(익명 insert)
--   * marketing_social_proof.metrics(jsonb) — 각 지표의 노출 토글/라벨(관리자 제어)
--   * public_invitation_view_counts / public_site_visit_count /
--     public_engagement_count — 홈(비로그인)에서 쓰는 집계 RPC(익명 실행 허용)
--
-- 모두 집계값만 반환(개인정보 없음). 기존 기능/데이터 무영향(추가만).
-- ============================================================

-- ── 1. guest_visits 조회 주체 구분 ───────────────────────────
-- 기존 행은 하객(guest)으로 간주. 소장용 뷰는 owner 로 기록(하객 페이지 vs 소장용
-- 페이지 모두 InvitationSlides 를 쓰므로 mode 에 따라 클라이언트가 값 전달).
alter table public.guest_visits
  add column if not exists viewer_role text not null default 'guest'
    check (viewer_role in ('guest', 'owner'));

-- ── 2. 홈페이지(랜딩) 방문 집계 ──────────────────────────────
create table if not exists public.site_visits (
  id          uuid primary key default gen_random_uuid(),
  path        text,
  device_type text,
  created_at  timestamptz not null default now()
);

alter table public.site_visits enable row level security;

-- 익명 방문자도 insert 가능(집계 전용, 읽기는 막음 — 집계는 RPC 로만).
drop policy if exists "anyone inserts site visits" on public.site_visits;
create policy "anyone inserts site visits"
  on public.site_visits for insert
  with check (true);

-- ── 3. 사회적 증거 지표 노출/라벨 설정(관리자) ────────────────
-- 새 컬럼 하나(jsonb)만 추가해 마이그 미적용 환경 호환을 단순화한다.
-- (social-proof.ts 의 저장 로직이 이 컬럼이 없으면 metrics 만 빼고 재시도)
alter table public.marketing_social_proof
  add column if not exists metrics jsonb not null default '{}'::jsonb;

-- ── 4. 집계 RPC — 익명(anon) 실행 허용, 집계값만 반환 ─────────

-- 하객용/소장용 누적 조회수(모든 guest_visits 행 기준 — 누적).
create or replace function public.public_invitation_view_counts()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'guest', coalesce(count(*) filter (where viewer_role = 'guest'), 0),
    'owner', coalesce(count(*) filter (where viewer_role = 'owner'), 0)
  )
  from public.guest_visits;
$$;

-- 홈페이지(랜딩) 누적 방문 세션 수.
create or replace function public.public_site_visit_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select coalesce(count(*), 0)::int from public.site_visits;
$$;

-- 누적 방명록·서명·축하(엔게이지먼트) 합계.
create or replace function public.public_engagement_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select (
    (select count(*) from public.guestbook_messages)
    + (select count(*) from public.signatures)
    + (select coalesce(sum(cheers_count), 0) from public.invitation_cheers)
  )::int;
$$;

grant execute on function public.public_invitation_view_counts() to anon, authenticated;
grant execute on function public.public_site_visit_count() to anon, authenticated;
grant execute on function public.public_engagement_count() to anon, authenticated;
