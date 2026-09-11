import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * 홈페이지(랜딩) 방문 집계 — 사회적 증거의 "홈페이지 방문수" 지표용.
 * 익명 insert(RLS: site_visits insert with check true). 세션당 1회는 클라이언트
 * (SiteVisitTracker)가 sessionStorage 로 제어한다. 집계는 public_site_visit_count RPC.
 */
const BodySchema = z.object({
  path: z.string().max(200).optional(),
  deviceType: z.enum(['mobile', 'desktop']).optional(),
});

export async function POST(req: Request) {
  let body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const supabase = createClient();
  // site_visits 는 마이그 076. 자동생성 DB 타입에 아직 없어 클라이언트를 캐스팅.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('site_visits')
    .insert({ path: body.path ?? null, device_type: body.deviceType ?? null });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
