/**
 * 랜딩 "알림장 소개" 섹션 사회적 증거(리뷰 이미지 + 커플 수 등) 설정 read/write.
 * (서버 전용)
 *
 * 저장소: public.marketing_social_proof (migration 051, 단일 행 id=true).
 * 권한: select 는 anon 포함 모두, 변경은 app_metadata.role='admin' 만 (RLS).
 *
 * 설정이 없거나 파싱 실패 시 코드 기본값으로 안전 폴백. 현재는 관리자에서 세팅만
 * 하고 실제 메인 렌더는 아직 연결하지 않는다(enabled 기본 false).
 */

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  InvitationContentSchema,
  type InvitationContent,
} from '@/types/invitation';

export interface SocialProofReview {
  id: string;
  /** (구버전 호환용) 리뷰 텍스트 마퀴에서는 사용하지 않음. */
  imageUrl: string;
  caption: string;
  /** 별점 (0~5). 0 이면 별점 없음으로 간주(평균에서 제외). */
  rating: number;
  /** 표시용 작성자 아이디/닉네임(예: hj***). 비면 미표시. */
  author: string;
}

/** 사회적 증거에 흐르는 "알림장 메인 디자인 사진" 한 장. */
export interface SocialProofDesign {
  id: string;
  imageUrl: string;
}

/**
 * showcase 커버 — 실제 고객 알림장의 메인 디자인을 config 렌더로 그대로 보여주기
 * 위한 스냅샷. content.main.heroImage 에는 얼굴 위 스티커를 합성한 이미지 URL 이
 * 들어가고, 이름은 익명화(이니셜 등)된 상태로 저장된다. InvitationPreview 가
 * 그대로 소비할 수 있는 SampleDesign 형태.
 */
export interface ShowcaseCover {
  id: string;
  /** 원본 알림장 id — 중복 등록 방지·재편집 매칭용. */
  invitationId: string;
  groomName: string;
  brideName: string;
  weddingDate: string;
  /** 홈 노출 여부(관리자 토글). false 면 저장은 유지하되 홈에서 숨김. */
  hidden: boolean;
  content: InvitationContent;
}

/** 자동집계 지표 하나의 노출 토글 + 타일 라벨(관리자 제어). */
export interface SocialProofMetric {
  enabled: boolean;
  label: string;
}

/**
 * 자동집계 지표 묶음 — 조회수(하객/소장용), 홈페이지 방문, 방명록.
 * 값은 RPC 로 자동 집계되고, 여기서는 "홈에 보일지 + 타일 라벨"만 관리한다.
 * (engagement = 하객이 남긴 방명록 메시지 수. 축하 버튼/서명은 제외.)
 */
export interface SocialProofMetrics {
  guestViews: SocialProofMetric;
  ownerViews: SocialProofMetric;
  siteVisits: SocialProofMetric;
  engagement: SocialProofMetric;
}

export const DEFAULT_METRICS: SocialProofMetrics = {
  guestViews: { enabled: false, label: '하객 조회수' },
  ownerViews: { enabled: false, label: '소장용 조회수' },
  siteVisits: { enabled: false, label: '홈페이지 방문' },
  engagement: { enabled: false, label: '방명록' },
};

export interface SocialProofConfig {
  enabled: boolean;
  heading: string;
  subheading: string;
  coupleCount: number;
  coupleCountSuffix: string;
  coupleCountCaption: string;
  /** 사회적 증거에 노출할 평균 별점(0~5). 0 이면 평점 타일 미노출. */
  averageRating: number;
  /** "만들어본 고객의 N%가 2주 내로 구매를 결정했어요" 타일/문구 노출 여부. */
  purchaseStatEnabled: boolean;
  /** 위 문구 템플릿. {pct} 자리에 자동 계산된 전환율(%)이 들어간다. */
  purchaseStatCaption: string;
  /** % 타일 하단 라벨. */
  purchaseStatLabel: string;
  /** 디자인 사진 마퀴(알림장 메인 디자인) — 정적 업로드 이미지(레거시). */
  designs: SocialProofDesign[];
  /** 디자인 사진 마퀴 — config 렌더 커버 스냅샷(스티커 익명화된 실제 고객 디자인). */
  covers: ShowcaseCover[];
  /** 리뷰 텍스트 마퀴(별점 + 문구). */
  reviews: SocialProofReview[];
  /** 자동집계 지표(조회수/홈방문/방명록·축하)의 노출 토글 + 라벨. */
  metrics: SocialProofMetrics;
}

export const DEFAULT_SOCIAL_PROOF: SocialProofConfig = {
  enabled: false,
  heading: '이미 우리다운으로 소식을 전한 커플들',
  subheading: '실제 사용자들의 후기예요.',
  coupleCount: 0,
  coupleCountSuffix: '쌍',
  coupleCountCaption: '누적 알림장 제작',
  averageRating: 5.0,
  purchaseStatEnabled: true,
  purchaseStatCaption: '만들어본 고객의 {pct}%가 2주 내로 구매를 결정했어요.',
  purchaseStatLabel: '2주 내 구매 결정',
  designs: [],
  covers: [],
  reviews: [],
  metrics: DEFAULT_METRICS,
};

const ShowcaseCoverSchema = z.object({
  id: z.string(),
  invitationId: z.string().default(''),
  groomName: z.string().default(''),
  brideName: z.string().default(''),
  weddingDate: z.string().default(''),
  hidden: z.boolean().default(false),
  content: InvitationContentSchema,
});

const ReviewSchema = z.object({
  id: z.string(),
  imageUrl: z.string().default(''),
  caption: z.string().default(''),
  // 구버전(별점 없던 저장본) 호환 — 기본 5점.
  rating: z.number().min(0).max(5).default(5),
  // 표시용 아이디/닉네임(구버전 저장본 호환 — 기본 빈 문자열).
  author: z.string().default(''),
});

const DesignSchema = z.object({
  id: z.string(),
  imageUrl: z.string(),
});

const MetricSchema = z.object({
  enabled: z.boolean().default(false),
  label: z.string().default(''),
});
const MetricsSchema = z
  .object({
    guestViews: MetricSchema.default(DEFAULT_METRICS.guestViews),
    ownerViews: MetricSchema.default(DEFAULT_METRICS.ownerViews),
    siteVisits: MetricSchema.default(DEFAULT_METRICS.siteVisits),
    engagement: MetricSchema.default(DEFAULT_METRICS.engagement),
  })
  .default(DEFAULT_METRICS);

const ConfigSchema = z.object({
  enabled: z.boolean().default(false),
  heading: z.string().default(DEFAULT_SOCIAL_PROOF.heading),
  subheading: z.string().default(DEFAULT_SOCIAL_PROOF.subheading),
  coupleCount: z.number().int().min(0).default(0),
  coupleCountSuffix: z.string().default('쌍'),
  coupleCountCaption: z.string().default(''),
  averageRating: z.number().min(0).max(5).default(5),
  purchaseStatEnabled: z.boolean().default(true),
  purchaseStatCaption: z.string().default(DEFAULT_SOCIAL_PROOF.purchaseStatCaption),
  purchaseStatLabel: z.string().default(DEFAULT_SOCIAL_PROOF.purchaseStatLabel),
  designs: z.array(DesignSchema).default([]),
  metrics: MetricsSchema,
  // 개별 커버 파싱 실패(스키마 변화 등) 시 그 커버만 버리고 나머지는 유지.
  covers: z
    .array(z.unknown())
    .default([])
    .transform((arr) => {
      const out: ShowcaseCover[] = [];
      for (const c of arr) {
        const r = ShowcaseCoverSchema.safeParse(c);
        if (r.success) out.push(r.data);
      }
      return out;
    }),
  reviews: z.array(ReviewSchema).default([]),
});

/**
 * 사회적 증거 설정 읽기 — 없거나 파싱 실패 시 코드 기본값.
 * (마이그 051 미적용 등 예외는 삼켜 폴백)
 */
export async function getSocialProof(): Promise<SocialProofConfig> {
  try {
    const supabase = createClient();
    // marketing_social_proof 는 자동생성 DB 타입(051 미반영)에 아직 없어 캐스팅.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('marketing_social_proof')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error || !data) return DEFAULT_SOCIAL_PROOF;
    const row = data as unknown as {
      enabled?: boolean;
      heading?: string;
      subheading?: string;
      couple_count?: number;
      couple_count_suffix?: string;
      couple_count_caption?: string;
      average_rating?: number | string;
      purchase_stat_enabled?: boolean;
      purchase_stat_caption?: string;
      purchase_stat_label?: string;
      designs?: unknown;
      covers?: unknown;
      reviews?: unknown;
      metrics?: unknown;
    };
    const parsed = ConfigSchema.safeParse({
      enabled: row.enabled ?? false,
      heading: row.heading ?? DEFAULT_SOCIAL_PROOF.heading,
      subheading: row.subheading ?? DEFAULT_SOCIAL_PROOF.subheading,
      coupleCount: row.couple_count ?? 0,
      coupleCountSuffix: row.couple_count_suffix ?? '쌍',
      coupleCountCaption: row.couple_count_caption ?? '',
      // numeric 컬럼은 드라이버에 따라 문자열로 올 수 있어 Number() 로 정규화.
      averageRating: row.average_rating != null ? Number(row.average_rating) : 5,
      purchaseStatEnabled: row.purchase_stat_enabled ?? true,
      purchaseStatCaption:
        row.purchase_stat_caption ?? DEFAULT_SOCIAL_PROOF.purchaseStatCaption,
      purchaseStatLabel:
        row.purchase_stat_label ?? DEFAULT_SOCIAL_PROOF.purchaseStatLabel,
      designs: row.designs ?? [],
      covers: row.covers ?? [],
      reviews: row.reviews ?? [],
      // metrics 컬럼(마이그 076) 미적용 환경이면 undefined → 스키마 기본값(모두 off).
      metrics: (row.metrics as object | null | undefined) ?? undefined,
    });
    if (!parsed.success) return DEFAULT_SOCIAL_PROOF;
    return parsed.data;
  } catch {
    return DEFAULT_SOCIAL_PROOF;
  }
}

/** 설정 저장 (admin server action 에서 호출 — RLS 가 admin 만 통과). */
export async function saveSocialProof(
  config: SocialProofConfig,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = ConfigSchema.safeParse(config);
  if (!parsed.success) return { ok: false, error: 'invalid config' };
  const supabase = createClient();
  const upsertRow = {
    id: true,
    enabled: parsed.data.enabled,
    heading: parsed.data.heading,
    subheading: parsed.data.subheading,
    couple_count: parsed.data.coupleCount,
    couple_count_suffix: parsed.data.coupleCountSuffix,
    couple_count_caption: parsed.data.coupleCountCaption,
    average_rating: parsed.data.averageRating,
    purchase_stat_enabled: parsed.data.purchaseStatEnabled,
    purchase_stat_caption: parsed.data.purchaseStatCaption,
    purchase_stat_label: parsed.data.purchaseStatLabel,
    designs: parsed.data.designs,
    covers: parsed.data.covers,
    reviews: parsed.data.reviews,
    metrics: parsed.data.metrics,
  };
  // marketing_social_proof 는 자동생성 DB 타입(051 미반영)에 아직 없어 캐스팅.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { error } = await (supabase as any)
    .from('marketing_social_proof')
    .upsert(upsertRow, { onConflict: 'id' });
  // migration 076(metrics 컬럼) 미적용 환경 호환 — 그 컬럼 때문에 실패하면 metrics 만
  // 빼고 재시도해 나머지 설정은 저장되게 한다(지표 토글은 마이그 후 저장됨).
  if (error && /metrics/i.test(error.message)) {
    const rowWithoutMetrics: Record<string, unknown> = { ...upsertRow };
    delete rowWithoutMetrics.metrics;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ error } = await (supabase as any)
      .from('marketing_social_proof')
      .upsert(rowWithoutMetrics, { onConflict: 'id' }));
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 집계값 표시용 반올림 — 100 이상만 10단위로 내려 큰 숫자를 정돈하고, 100 미만은
 * 그대로 노출한다(초기의 작은 수치가 0으로 내려가 사라지지 않도록). 0 이하는 0.
 */
function roundMetric(n: number): number {
  if (n <= 0) return 0;
  return n < 100 ? Math.floor(n) : Math.floor(n / 10) * 10;
}

/**
 * 하객용/소장용 누적 조회수 — public_invitation_view_counts() RPC(076).
 * 실패 시 {0,0}. 각 값은 10단위 내림.
 */
export async function getInvitationViewCounts(): Promise<{
  guest: number;
  owner: number;
}> {
  try {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('public_invitation_view_counts');
    if (error || !data || typeof data !== 'object') return { guest: 0, owner: 0 };
    const g = Number((data as { guest?: unknown }).guest ?? 0);
    const o = Number((data as { owner?: unknown }).owner ?? 0);
    return { guest: roundMetric(g), owner: roundMetric(o) };
  } catch {
    return { guest: 0, owner: 0 };
  }
}

/** 홈페이지(랜딩) 누적 방문 수 — public_site_visit_count() RPC(076). 10단위 내림. */
export async function getSiteVisitCount(): Promise<number> {
  try {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('public_site_visit_count');
    const n = typeof data === 'number' ? data : 0;
    if (error || n <= 0) return 0;
    return roundMetric(n);
  } catch {
    return 0;
  }
}

/** 누적 방명록 메시지 수 — public_engagement_count() RPC(077, 방명록만). */
export async function getEngagementCount(): Promise<number> {
  try {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('public_engagement_count');
    const n = typeof data === 'number' ? data : 0;
    if (error || n <= 0) return 0;
    return roundMetric(n);
  } catch {
    return 0;
  }
}

/**
 * 랜딩 사회적 증거 "커플 수" — 발행된 알림장 건수를 10단위로 올림한 값.
 * public_published_couple_count() RPC(056)로 건수를 읽어 Math.ceil(n/10)*10.
 * 실패 시 0 폴백(0 이면 커플 수 타일은 미노출).
 */
export async function getPublishedCoupleCount(): Promise<number> {
  try {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('public_published_couple_count');
    const n = typeof data === 'number' ? data : 0;
    if (error || n <= 0) return 0;
    return Math.ceil(n / 10) * 10;
  } catch {
    return 0;
  }
}

/**
 * showcase 커버의 원본 알림장 id 중 "현재 발행 중"인 것만 반환(065 RPC).
 * 삭제·발행취소된 원본을 홈에서 자동으로 감추기 위한 검증용. 실패 시 null →
 * 호출부는 전체를 그대로 노출(fail-open, 빈 홈 방지).
 */
export async function getActiveShowcaseIds(
  ids: string[],
): Promise<Set<string> | null> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Set();
  try {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc(
      'public_active_showcase_ids',
      { ids: unique },
    );
    if (error || !Array.isArray(data)) return null;
    const out = new Set<string>();
    for (const r of data) {
      const v =
        typeof r === 'string'
          ? r
          : r && typeof r === 'object'
            ? (Object.values(r)[0] as unknown)
            : null;
      if (typeof v === 'string') out.add(v);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * "만들어본 고객의 N%가 2주 내로 구매를 결정했어요" 의 N — 제작→결제 전환율(%).
 * public_purchase_conversion_pct() RPC(061). 통계 페이지의 정의와 동일
 * (미결제 & 최종수정 2주 미만 건 제외). 실패·0 이면 0 폴백(문구/타일 미노출).
 */
export async function getPurchaseConversionPct(): Promise<number> {
  try {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('public_purchase_conversion_pct');
    const n = typeof data === 'number' ? data : 0;
    if (error || n <= 0) return 0;
    return n;
  } catch {
    return 0;
  }
}
