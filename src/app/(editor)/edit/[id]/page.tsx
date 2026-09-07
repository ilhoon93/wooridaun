import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InvitationContentSchema } from '@/types/invitation';
import { getHomeSamplesConfig } from '@/lib/marketing/home-samples';
import { buildDesign, sampleHasPhoto } from '@/lib/marketing/sample-invitations';
import type { EditorSampleDesign } from '@/lib/editor/design-presets';
import { EditorClient } from './editor-client';

const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://wooridaun.com';

/**
 * 운영자 admin "알림장 샘플 설정"(getHomeSamplesConfig)의 노출 디자인을 에디터
 * 추천 디자인 형태로 매핑한다. /designs 미리보기와 같은 소스라 항상 일치한다.
 * heroImageUrl 은 카탈로그 사진의 절대 URL(heroImage 는 url() 검증이 필요).
 */
async function loadSampleDesigns(): Promise<EditorSampleDesign[]> {
  const { designs, template } = await getHomeSamplesConfig();
  return designs
    .filter((d) => d.enabled)
    .map((d) => ({
      id: d.id,
      name: d.name,
      layoutLabel: d.layoutLabel,
      colorTheme: d.colorTheme,
      petalType: d.petalType,
      font: d.font,
      main: d.main,
      heroImageUrl: d.heroImageId
        ? `${SITE_URL}/wedding-snap/catalog/${d.heroImageId}.jpg`
        : null,
      groomName: d.groomName,
      brideName: d.brideName,
      weddingDate: d.weddingDate,
      hasPhoto: sampleHasPhoto(d),
      number: d.number,
      // 실제 표지 미리보기(정적) 썸네일용 — /designs 카드와 같은 렌더러.
      preview: buildDesign(d, template),
    }));
}

// 다른 기기에서 저장한 최신 본이 즉시 보이도록 캐시 우회.
// Supabase 클라이언트가 cookies() 를 쓰기 때문에 사실상 dynamic 이 강제되지만,
// 명시적으로 표시해 빌드 분석이나 향후 변경에서 캐시되는 사고를 방지.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function EditPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { start?: string };
}) {
  // "비슷하게 만들기"(preset)로 들어온 진입 — 추천구성 패널을 열지 않고 모바일
  // 실시간 미리보기가 펼쳐진 상태로 시작한다.
  const fromPreset = searchParams.start === 'preview';
  const supabase = createClient();
  const { data, error } = await supabase
    .from('invitations')
    .select('id, groom_name, bride_name, wedding_date, content, is_published, created_at, updated_at')
    .eq('id', params.id)
    .maybeSingle();

  if (error || !data) notFound();

  // With the credit + publications model, drafts can be edited freely;
  // each publish creates a new URL while previously shared links stay
  // valid until they expire (snapshot is captured at publish time).

  // Coerce stored JSONB through Zod so missing/legacy fields get defaults.
  const content = InvitationContentSchema.parse(data.content ?? {});

  // 추천 디자인 = 운영자 샘플. 한 번도 저장 안 된 새 알림장이면 샘플 데이터도 로딩.
  const isFresh = data.updated_at === data.created_at;
  const sampleDesigns = await loadSampleDesigns();

  return (
    <EditorClient
      invitationId={data.id}
      meta={{
        groomName: data.groom_name,
        brideName: data.bride_name,
        weddingDate: data.wedding_date,
      }}
      content={content}
      serverUpdatedAt={data.updated_at}
      // 한 번도 저장된 적 없는 신규 알림장이면 "추천으로 시작하기" 패널을 펼쳐 안내.
      // 단, 이미 디자인을 고르고 온 "비슷하게 만들기" 진입에서는 열지 않는다.
      recommendOpen={isFresh && !fromPreset}
      // preset 진입이면 모바일 실시간 미리보기를 펼친 채로 시작.
      mobilePreviewDefaultOpen={fromPreset}
      sampleDesigns={sampleDesigns}
      isFresh={isFresh}
    />
  );
}
