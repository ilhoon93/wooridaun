-- 079_showcase_consent_users_and_invitation_labels.sql
--
-- 1) showcase_consent_users — 운영자가 가입자 내역에서 "쇼케이스 활용 동의"로 직접 추가한
--    계정. 이 계정의 발행 알림장(사진 있는 디자인 포함)은 showcase 후보가 된다. 계정
--    단위라 추가 이후 새로 발행한 알림장도 포함된다. service_role(관리자 서버 액션)
--    전용 — 정책이 없어 일반 사용자는 읽기·쓰기 불가.
--
-- 2) invitation_labels — 사용자가 마이페이지에서 알림장마다 붙이는 이름 태그.
--    invitations 테이블에 컬럼으로 두지 않는 이유: invitations 는 어떤 컬럼이 바뀌어도
--    updated_at 을 갱신하는 트리거(invitations_touch_updated_at)가 있어, 태그만 바꿔도
--    "최종 수정" 시각과 미발행 자동삭제(14일) 기준이 바뀌기 때문.

create table if not exists public.showcase_consent_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.showcase_consent_users enable row level security;
revoke all on public.showcase_consent_users from anon, authenticated;

comment on table public.showcase_consent_users is
  '운영자가 쇼케이스 활용 동의로 추가한 계정(service_role 전용). showcase 후보 판정에 사용.';

create table if not exists public.invitation_labels (
  invitation_id uuid primary key references public.invitations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null check (char_length(btrim(label)) between 1 and 20),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_invitation_labels_user on public.invitation_labels (user_id);

alter table public.invitation_labels enable row level security;
revoke all on public.invitation_labels from anon;
grant select, insert, update, delete on public.invitation_labels to authenticated;

drop policy if exists "owners read own invitation labels" on public.invitation_labels;
create policy "owners read own invitation labels"
  on public.invitation_labels for select
  using (auth.uid() = user_id);

-- 본인 알림장에만 태그를 붙일 수 있다.
drop policy if exists "owners insert own invitation labels" on public.invitation_labels;
create policy "owners insert own invitation labels"
  on public.invitation_labels for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.invitations i
      where i.id = invitation_id and i.user_id = auth.uid()
    )
  );

drop policy if exists "owners update own invitation labels" on public.invitation_labels;
create policy "owners update own invitation labels"
  on public.invitation_labels for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owners delete own invitation labels" on public.invitation_labels;
create policy "owners delete own invitation labels"
  on public.invitation_labels for delete
  using (auth.uid() = user_id);

comment on table public.invitation_labels is
  '마이페이지 알림장 이름 태그(사용자 구분용). invitations 의 updated_at 을 건드리지 않도록 분리.';
