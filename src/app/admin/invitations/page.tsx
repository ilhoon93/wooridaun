import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checkAdmin } from '@/lib/auth/admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { InvitationsTable, type InvitationRow } from './InvitationsTable';

export const metadata: Metadata = {
  title: 'Admin · 알림장 목록',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

interface PageProps {
  searchParams: { email?: string; published?: string; page?: string };
}

export default async function AdminInvitationsPage({ searchParams }: PageProps) {
  const admin = await checkAdmin();
  if (!admin) notFound();

  const email = (searchParams.email ?? '').trim();
  const publishedOnly = searchParams.published === '1';
  const page = Math.max(0, Number.parseInt(searchParams.page ?? '0', 10) || 0);

  let rows: InvitationRow[] = [];
  let hasMore = false;
  let errorMsg: string | null = null;

  try {
    const sb = createAdminClient();
    // admin_invitations 는 047 에서 추가된 RPC — 자동생성 Database 타입에 아직
    // 없어 호출부를 느슨한 타입으로 캐스팅. sb.rpc 를 떼어내 호출하면 this 가
    // 끊겨 supabase 내부에서 throw 하므로, 반드시 객체 메서드로 호출한다.
    const adminRpc = sb as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await adminRpc.rpc('admin_invitations', {
      p_email: email || null,
      p_published_only: publishedOnly,
      p_limit: PAGE_SIZE + 1,
      p_offset: page * PAGE_SIZE,
    });
    if (error) throw new Error(error.message);

    const raw = (Array.isArray(data) ? data : []) as InvitationRow[];
    hasMore = raw.length > PAGE_SIZE;
    rows = raw.slice(0, PAGE_SIZE);

    // 하객용(guest)/소장용(owner) 방문 세션 수 집계.
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const counts = new Map<string, { guest: number; owner: number }>();

      // 1) 빠른 경로 — 단일 RPC 로 group by 집계(마이그 078). N+1 제거.
      //    admin_invitations 와 동일하게 느슨한 타입으로 호출.
      const visitRpc = sb as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{
          data:
            | { invitation_id: string; guest_count: number | string; owner_count: number | string }[]
            | null;
          error: { message: string } | null;
        }>;
      };
      const { data: agg, error: aggErr } = await visitRpc.rpc(
        'admin_invitation_visit_counts',
        { inv_ids: ids },
      );
      const rpcOk = !aggErr && Array.isArray(agg);
      if (rpcOk && agg) {
        for (const r of agg) {
          counts.set(r.invitation_id, {
            guest: Number(r.guest_count) || 0,
            owner: Number(r.owner_count) || 0,
          });
        }
      }

      // 2) 폴백 — RPC 미적용(078 미배포)/실패 시 알림장별 서버측 exact head count.
      //    (행 전송 없음·PostgREST 1000행 상한 무관. owner 는 viewer_role 필터로 카운트.)
      if (!rpcOk) {
        const results = await Promise.all(
          ids.map(async (id) => {
            const totalRes = await sb
              .from('guest_visits')
              .select('*', { count: 'exact', head: true })
              .eq('invitation_id', id);
            const total = totalRes.count ?? 0;
            const ownerRes = await sb
              .from('guest_visits')
              .select('*', { count: 'exact', head: true })
              .eq('invitation_id', id)
              .eq('viewer_role', 'owner');
            const owner = ownerRes.count ?? 0;
            return { id, guest: Math.max(0, total - owner), owner };
          }),
        );
        for (const r of results) counts.set(r.id, { guest: r.guest, owner: r.owner });
      }

      rows = rows.map((r) => ({
        ...r,
        guestVisits: counts.get(r.id)?.guest ?? 0,
        ownerVisits: counts.get(r.id)?.owner ?? 0,
      }));
    }
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
    console.error('[admin/invitations] load failed', e);
  }

  const looksMissingRpc =
    !!errorMsg &&
    (/admin_invitations/i.test(errorMsg) ||
      /PGRST202/i.test(errorMsg) ||
      /could not find the function/i.test(errorMsg) ||
      /does not exist/i.test(errorMsg));

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-[#3D2E1F]">알림장 목록</h1>
        <p className="mt-1 text-xs leading-relaxed text-[#8B7355]">
          알림장을 최종 수정일시순으로 조회합니다. 생성자 이메일로 필터링하고, 발행된 것만
          볼 수 있으며, 발행된 알림장은 링크로 바로 열람할 수 있습니다.
          <span className="ml-2">로그인 계정: {admin.email}</span>
          <br />
          <span className="text-[#B09B80]">
            하객용/소장용 방문수 분리 집계는 방문 구분 기능 도입 이후부터 정확합니다
            (이전 소장용 방문은 하객용에 포함).
          </span>
        </p>
      </header>

      {errorMsg ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <p>알림장 목록을 불러오지 못했습니다: {errorMsg}</p>
          {looksMissingRpc && (
            <p className="mt-2 text-[#8B7355]">
              DB 마이그레이션이 아직 적용되지 않은 것 같습니다. 다음을 실행해
              주세요: <code className="font-mono">npx supabase db push</code>{' '}
              (047_admin_invitations.sql)
            </p>
          )}
        </div>
      ) : (
        <InvitationsTable
          rows={rows}
          email={email}
          publishedOnly={publishedOnly}
          page={page}
          hasMore={hasMore}
        />
      )}
    </main>
  );
}
