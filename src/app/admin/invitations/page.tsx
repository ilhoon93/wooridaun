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
    //
    // 주의(과거 버그): 예전엔 guest_visits 행을 통째로 select 해서 JS 로 셌는데,
    //  (1) PostgREST 기본 1000행 상한에 걸려 방문이 많은 알림장은 0으로 누락되고,
    //  (2) viewer_role(마이그 076) 컬럼이 없는 환경에선 select 자체가 실패해
    //      모든 카운트가 0으로 떨어졌다.
    // → 알림장별로 서버측 exact head count 를 쓴다(행 전송 없음, 상한 무관).
    //   owner 수는 viewer_role 필터가 실패하면 0 으로 간주(=하객으로 합산)해
    //   076 미적용 환경에서도 총 방문수는 정확히 나오게 한다.
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const results = await Promise.all(
        ids.map(async (id) => {
          const totalRes = await sb
            .from('guest_visits')
            .select('*', { count: 'exact', head: true })
            .eq('invitation_id', id);
          const total = totalRes.count ?? 0;

          // viewer_role 컬럼이 없으면 error 를 돌려줄 뿐 throw 하지 않음 → owner=0.
          const ownerRes = await (
            sb.from('guest_visits') as unknown as {
              select: (
                cols: string,
                opts: { count: 'exact'; head: true },
              ) => {
                eq: (c: string, v: string) => {
                  eq: (c: string, v: string) => Promise<{ count: number | null }>;
                };
              };
            }
          )
            .select('*', { count: 'exact', head: true })
            .eq('invitation_id', id)
            .eq('viewer_role', 'owner');
          const owner = ownerRes.count ?? 0;

          return { id, guest: Math.max(0, total - owner), owner };
        }),
      );
      const map = new Map(results.map((r) => [r.id, r]));
      rows = rows.map((r) => ({
        ...r,
        guestVisits: map.get(r.id)?.guest ?? 0,
        ownerVisits: map.get(r.id)?.owner ?? 0,
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
