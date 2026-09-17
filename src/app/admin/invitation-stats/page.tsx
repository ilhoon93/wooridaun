import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { checkAdmin } from '@/lib/auth/admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { InvitationContentSchema } from '@/types/invitation';
import {
  COLOR_THEME_LABELS,
  PETAL_LABELS,
  FONT_OPTIONS,
  SECTION_LABELS,
  type ColorTheme,
  type PetalType,
  type FontKey,
  type SectionKey,
} from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Admin · 알림장 통계',
  robots: { index: false, follow: false },
};

// admin route 는 항상 dynamic — 통계는 매 요청마다 fresh aggregate.
export const dynamic = 'force-dynamic';

interface StatsRow {
  signup_count: number;
  made_customer_count: number;
  paid_customer_count: number;
  conversion_paid_count: number;
  conversion_base_count: number;
  archive_customer_count: number;
  invitation_count: number;
  made_invitation_count: number;
  published_count: number;
  archived_count: number;
}

/** a / b 를 정수 퍼센트로. 분모 0 이면 null(표기 생략). */
function ratePct(a: number, b: number): number | null {
  if (!b) return null;
  return Math.round((a / b) * 100);
}

/** 메인 표지 레이아웃 라벨 (content.main.layout). polaroid 는 frame 으로 흡수. */
const MAIN_LAYOUT_LABELS: Record<string, string> = {
  poster: '풀이미지(포스터)',
  frame: '액자 프레임',
  illustration: '일러스트',
  text: '텍스트',
};

/** 발행 알림장에서 켜짐 비율을 볼 슬라이드(옵션 섹션). 메인/엔딩은 항상 노출이라 제외. */
const OPTIONAL_SECTIONS: SectionKey[] = [
  'basic',
  'story',
  'gallery',
  'video',
  'quiz',
  'vote',
  'guestbook',
  'account',
];

type Tally = { key: string; label: string; count: number };

/** 카운트 맵 → 비율 내림차순 정렬 배열. labeler 로 라벨 매핑, 미지의 키는 원문. */
function toDistribution(
  counts: Map<string, number>,
  labeler: (key: string) => string,
): Tally[] {
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: labeler(key), count }))
    .sort((a, b) => b.count - a.count);
}

export default async function InvitationStatsAdminPage() {
  const ctx = await checkAdmin();
  if (!ctx) notFound();

  const sb = createAdminClient();

  // ── 1. 스칼라 카운트 (RPC) ────────────────────────────────────
  // admin_invitation_stats 는 자동생성 DB 타입(050 미반영)에 아직 없어 캐스팅.
  const { data: statsData, error: statsError } = await sb.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'admin_invitation_stats' as any,
  );
  const stats: StatsRow | null = Array.isArray(statsData)
    ? ((statsData[0] as StatsRow | undefined) ?? null)
    : null;

  // ── 2. 발행 알림장 content 로 분포 집계 (eligible 필터 동일 적용) ─────
  // admin_published_contents 는 setof jsonb → 각 원소가 content 객체 그 자체.
  const { data: pubRows, error: pubError } = await sb.rpc(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'admin_published_contents' as any,
  );

  const colorCounts = new Map<string, number>();
  const layoutCounts = new Map<string, number>();
  const fontCounts = new Map<string, number>();
  const petalCounts = new Map<string, number>();
  const sectionCounts = new Map<string, number>();
  let parsedPublished = 0;

  for (const row of (Array.isArray(pubRows) ? pubRows : []) as unknown[]) {
    // setof jsonb 는 보통 값이 그대로 오지만, PostgREST 버전에 따라
    // { admin_published_contents: {...} } 로 감싸질 수 있어 방어적으로 언랩.
    const raw =
      row && typeof row === 'object' && 'admin_published_contents' in row
        ? (row as Record<string, unknown>).admin_published_contents
        : row;
    const parsed = InvitationContentSchema.safeParse(raw ?? {});
    if (!parsed.success) continue;
    parsedPublished += 1;
    const c = parsed.data;

    const inc = (m: Map<string, number>, k: string) =>
      m.set(k, (m.get(k) ?? 0) + 1);

    inc(colorCounts, c.theme.colorTheme);
    inc(petalCounts, c.theme.petalType);
    inc(fontCounts, c.theme.font);
    // polaroid 레이아웃 키는 frame 으로 흡수해 집계.
    inc(layoutCounts, c.main.layout === 'polaroid' ? 'frame' : c.main.layout);

    for (const key of OPTIONAL_SECTIONS) {
      const section = c[key as keyof typeof c] as { enabled?: boolean } | undefined;
      if (section?.enabled) inc(sectionCounts, key);
    }
  }

  const colorDist = toDistribution(
    colorCounts,
    (k) => COLOR_THEME_LABELS[k as ColorTheme] ?? k,
  );
  const layoutDist = toDistribution(layoutCounts, (k) => MAIN_LAYOUT_LABELS[k] ?? k);
  const fontDist = toDistribution(fontCounts, (k) => FONT_OPTIONS[k as FontKey]?.label ?? k);
  const petalDist = toDistribution(petalCounts, (k) => PETAL_LABELS[k as PetalType] ?? k);
  // 슬라이드는 "켜짐 비율" 이 의미 있으므로 코드 순서(OPTIONAL_SECTIONS) 유지.
  const sectionDist: Tally[] = OPTIONAL_SECTIONS.map((key) => ({
    key,
    label: SECTION_LABELS[key],
    count: sectionCounts.get(key) ?? 0,
  }));

  // ── 3. 참여(engagement) 집계 — 전체 알림장 누적 ──────────────────
  // 하객/소장용 방문(guest_visits), 방명록(guestbook_messages), 서명(signatures),
  // 축하하기(invitation_cheers.cheers_count 합), 사진 좋아요(gallery_likes.like_count 합).
  // 방문/방명록/서명은 head count 로 행 전송 없이 세고, 축하·좋아요는 합계라 값만 읽어 합산.
  // 홈페이지(랜딩) 방문은 site_visits(마이그 076) — 정확 count(누적) + 최근 7일.
  // (공개 사회적증거의 public_site_visit_count 는 10단위 내림이라, 운영자용은 정확 수치로.)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let engagement: {
    guestVisits: number;
    ownerVisits: number;
    guestbook: number;
    signatures: number;
    cheers: number;
    galleryLikes: number;
    siteVisits: number;
    siteVisits7d: number;
    /** site_visits 최초 기록 시각(ISO) — 이 값부터 누적임을 표시하기 위함. */
    siteVisitsSince: string | null;
  } | null = null;
  let engagementError: string | null = null;
  try {
    const [
      totalVisitsRes,
      ownerVisitsRes,
      gbRes,
      sigRes,
      cheersRes,
      likesRes,
      siteVisitsRes,
      siteVisits7dRes,
      siteSinceRes,
    ] = await Promise.all([
      sb.from('guest_visits').select('*', { count: 'exact', head: true }),
      sb
        .from('guest_visits')
        .select('*', { count: 'exact', head: true })
        .eq('viewer_role', 'owner'),
      sb.from('guestbook_messages').select('*', { count: 'exact', head: true }),
      sb.from('signatures').select('*', { count: 'exact', head: true }),
      sb.from('invitation_cheers').select('cheers_count'),
      sb.from('gallery_likes').select('like_count'),
      sb.from('site_visits').select('*', { count: 'exact', head: true }),
      sb
        .from('site_visits')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo),
      // 최초 방문 기록 시각 — "언제부터의 누적인지" 표시용.
      sb
        .from('site_visits')
        .select('created_at')
        .order('created_at', { ascending: true })
        .limit(1),
    ]);

    const totalVisits = totalVisitsRes.count ?? 0;
    const ownerVisits = ownerVisitsRes.count ?? 0;
    const cheers = (
      (cheersRes.data ?? []) as { cheers_count: number | null }[]
    ).reduce((s, r) => s + (r.cheers_count ?? 0), 0);
    const galleryLikes = (
      (likesRes.data ?? []) as { like_count: number | null }[]
    ).reduce((s, r) => s + (r.like_count ?? 0), 0);

    engagement = {
      guestVisits: Math.max(0, totalVisits - ownerVisits),
      ownerVisits,
      guestbook: gbRes.count ?? 0,
      signatures: sigRes.count ?? 0,
      cheers,
      galleryLikes,
      siteVisits: siteVisitsRes.count ?? 0,
      siteVisits7d: siteVisits7dRes.count ?? 0,
      siteVisitsSince:
        (siteSinceRes.data as { created_at: string }[] | null)?.[0]?.created_at ?? null,
    };
  } catch (e) {
    engagementError = e instanceof Error ? e.message : String(e);
    console.error('[admin/invitation-stats] engagement aggregate failed', e);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-[#3D2E1F]">알림장 통계</h1>
        <p className="mt-1 text-xs leading-relaxed text-[#8B7355]">
          가입·제작·결제 고객 수와 발행된 알림장의 디자인 선택 분포. 매 요청마다
          최신 집계.
          <span className="ml-2">로그인 계정: {ctx.email}</span>
        </p>
      </header>

      {statsError && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          통계 집계 실패: {statsError.message}
          <br />
          (마이그레이션 050 이 적용되었는지 확인해주세요.)
        </p>
      )}

      <p className="mb-3 text-[11px] leading-relaxed text-[#B09B80]">
        운영자 계정(sayoung5·kohkhj902 및 admin 권한)과 카카오 등 예전 테스트 계정은
        집계에서 제외됩니다.
        <br />
        발행 후 30일이 지나 만료된 건, 그리고 제작 후 삭제된 미발행 건도 누적으로
        포함됩니다(삭제 아카이브 기준 — 054 적용 이전에 이미 삭제된 건은 이력이 없어 제외).
      </p>

      {/* ── 핵심 지표 카드 (고객 수) ─────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="가입자 수"
          value={stats?.signup_count ?? 0}
          hint="네이버 연동 가입 계정"
        />
        <StatCard
          label="알림장 제작 고객"
          value={stats?.made_customer_count ?? 0}
          hint="수정한 알림장을 1건이라도 보유"
        />
        <StatCard
          label="알림장 결제 고객"
          value={stats?.paid_customer_count ?? 0}
          hint="발행권(알림장) 구매"
        />
        <StatCard
          label="영구소장 결제 고객"
          value={stats?.archive_customer_count ?? 0}
          hint="영구소장 구매"
        />
      </section>

      {/* ── 전환율 ─────────────────────────────── */}
      <section className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ConversionCard
          label="가입 → 제작 전환율"
          pct={ratePct(stats?.made_customer_count ?? 0, stats?.signup_count ?? 0)}
          from={stats?.signup_count ?? 0}
          to={stats?.made_customer_count ?? 0}
        />
        <ConversionCard
          label="제작 → 결제 전환율"
          pct={ratePct(
            stats?.conversion_paid_count ?? 0,
            stats?.conversion_base_count ?? 0,
          )}
          from={stats?.conversion_base_count ?? 0}
          to={stats?.conversion_paid_count ?? 0}
          note="미결제 & 최종수정 2주 미만 건 제외"
        />
        <ConversionCard
          label="결제 → 영구소장 전환율"
          pct={ratePct(
            stats?.archive_customer_count ?? 0,
            stats?.paid_customer_count ?? 0,
          )}
          from={stats?.paid_customer_count ?? 0}
          to={stats?.archive_customer_count ?? 0}
        />
      </section>

      {/* ── 보조 지표 (알림장 수) ─────────────────────── */}
      <section className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="전체 알림장" value={stats?.invitation_count ?? 0} small unit="건" />
        <StatCard
          label="제작(수정)된 알림장"
          value={stats?.made_invitation_count ?? 0}
          small
          unit="건"
        />
        <StatCard label="발행된 알림장" value={stats?.published_count ?? 0} small unit="건" />
        <StatCard label="영구소장 적용" value={stats?.archived_count ?? 0} small unit="건" />
      </section>

      {/* ── 홈페이지(랜딩) 방문 ─────────────────────────── */}
      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#3D2E1F]">홈페이지 방문</h2>
          <span className="text-[11px] text-[#8B7355]">랜딩 페이지 · 세션 기준</span>
        </div>
        <p className="mb-3 text-[10.5px] leading-relaxed text-[#B09B80]">
          {engagement?.siteVisitsSince
            ? `방문 기록 기능 도입 이후 누적입니다 — 첫 기록: ${new Date(
                engagement.siteVisitsSince,
              ).toLocaleDateString('ko-KR', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}. 서비스 오픈 시점부터의 전체 방문 수는 아닙니다(그 이전 방문은 기록되지 않았습니다).`
            : '방문 기록 기능 도입 이후 누적입니다. 서비스 오픈 시점부터의 전체 방문 수는 아닙니다(그 이전 방문은 기록되지 않았습니다).'}
          {' '}운영자(admin) 본인의 조회는 집계에서 제외됩니다(제외 기능 도입 이후 방문분).
        </p>
        {engagementError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            방문 집계 실패: {engagementError}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label="홈페이지 방문 (누적)"
              value={engagement?.siteVisits ?? 0}
              small
              unit="회"
              hint="랜딩(/) 방문 세션 누적 — 정확 수치"
            />
            <StatCard
              label="홈페이지 방문 (최근 7일)"
              value={engagement?.siteVisits7d ?? 0}
              small
              unit="회"
              hint="최근 7일 랜딩 방문 세션"
            />
          </div>
        )}
      </section>

      {/* ── 참여(engagement) 지표 — 전체 알림장 누적 ─────────── */}
      <section className="mt-8">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#3D2E1F]">방문·참여 지표</h2>
          <span className="text-[11px] text-[#8B7355]">전체 알림장 누적</span>
        </div>
        <p className="mb-3 text-[10.5px] leading-relaxed text-[#B09B80]">
          하객용/소장용 방문 분리 집계는 방문 구분 기능(viewer_role) 도입 이후부터
          정확합니다. 그 이전에 쌓인 소장용 방문은 하객용으로 집계되어 있습니다.
          방문수에서 운영자(admin) 본인의 조회는 제외됩니다(제외 기능 도입 이후 방문분).
        </p>
        {engagementError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            참여 지표 집계 실패: {engagementError}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label="하객용 방문"
              value={engagement?.guestVisits ?? 0}
              small
              unit="회"
              hint="하객용 페이지 방문 세션 수"
            />
            <StatCard
              label="소장용 방문"
              value={engagement?.ownerVisits ?? 0}
              small
              unit="회"
              hint="소장용(신랑·신부) 방문 세션 수"
            />
            <StatCard
              label="축하하기"
              value={engagement?.cheers ?? 0}
              small
              unit="회"
              hint="메인 축하하기 버튼 누적 클릭"
            />
            <StatCard
              label="방명록"
              value={engagement?.guestbook ?? 0}
              small
              unit="개"
              hint="하객이 남긴 방명록 글"
            />
            <StatCard
              label="방명록 서명"
              value={engagement?.signatures ?? 0}
              small
              unit="개"
              hint="하객 서명 참여"
            />
            <StatCard
              label="사진 좋아요"
              value={engagement?.galleryLikes ?? 0}
              small
              unit="개"
              hint="갤러리 사진 좋아요 누적"
            />
          </div>
        )}
      </section>

      {/* ── 발행 알림장 디자인 분포 ─────────────────────── */}
      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#3D2E1F]">
            발행된 알림장 디자인 분포
          </h2>
          <span className="text-[11px] text-[#8B7355]">
            집계 대상 {parsedPublished}건
          </span>
        </div>

        {pubError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            발행 알림장 조회 실패: {pubError.message}
          </p>
        ) : parsedPublished === 0 ? (
          <p className="rounded-md border border-[#E8DCC9] bg-[#FAF7F2] p-4 text-xs text-[#8B7355]">
            아직 발행된 알림장이 없어 분포를 표시할 수 없습니다.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <DistCard title="색상 테마" rows={colorDist} total={parsedPublished} />
            <DistCard title="표지 레이아웃" rows={layoutDist} total={parsedPublished} />
            <DistCard title="폰트" rows={fontDist} total={parsedPublished} />
            <DistCard title="배경 효과" rows={petalDist} total={parsedPublished} />
            <DistCard
              title="슬라이드 사용 비율"
              rows={sectionDist}
              total={parsedPublished}
              note="각 슬라이드가 켜진 알림장 비율"
            />
          </div>
        )}
      </section>
    </main>
  );
}

/* ─────────────────────── presentational ─────────────────────── */

function StatCard({
  label,
  value,
  hint,
  small,
  unit = '명',
}: {
  label: string;
  value: number;
  hint?: string;
  small?: boolean;
  unit?: string;
}) {
  return (
    <div className="rounded-md border border-[#E8DCC9] bg-white p-4">
      <div className="text-[11px] font-medium text-[#8B7355]">{label}</div>
      <div
        className={`mt-1 font-semibold text-[#3D2E1F] ${small ? 'text-xl' : 'text-2xl'}`}
      >
        {value.toLocaleString('ko-KR')}
        <span className="ml-1 text-xs font-normal text-[#8B7355]">{unit}</span>
      </div>
      {hint && <div className="mt-1 text-[10.5px] text-[#B09B80]">{hint}</div>}
    </div>
  );
}

/** 전환율 카드 — 큰 퍼센트 + "from → to" 보조 표기. */
function ConversionCard({
  label,
  pct,
  from,
  to,
  note,
}: {
  label: string;
  pct: number | null;
  from: number;
  to: number;
  note?: string;
}) {
  return (
    <div className="rounded-md border border-[#E8DCC9] bg-[#FAF7F2] p-4">
      <div className="text-[11px] font-medium text-[#8B7355]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[#8B5E34]">
        {pct === null ? '—' : `${pct}%`}
      </div>
      <div className="mt-1 text-[10.5px] text-[#B09B80]">
        {from.toLocaleString('ko-KR')}명 → {to.toLocaleString('ko-KR')}명
      </div>
      {note && <div className="mt-0.5 text-[10px] text-[#B09B80]">{note}</div>}
    </div>
  );
}

function DistCard({
  title,
  rows,
  total,
  note,
}: {
  title: string;
  rows: Tally[];
  total: number;
  note?: string;
}) {
  return (
    <div className="rounded-md border border-[#E8DCC9] bg-white p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[12.5px] font-semibold text-[#3D2E1F]">{title}</h3>
        {note && <span className="text-[10px] text-[#B09B80]">{note}</span>}
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
          return (
            <li key={r.key} className="text-[11.5px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[#3D2E1F]">{r.label}</span>
                <span className="flex-shrink-0 tabular-nums text-[#8B7355]">
                  {r.count}건 · {pct}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F0E9DE]">
                <div
                  className="h-full rounded-full bg-[#8B7355]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
