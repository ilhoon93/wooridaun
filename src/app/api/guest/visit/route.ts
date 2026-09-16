import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

const BodySchema = z.object({
  invitationId: z.string().uuid(),
  visitorName: z.string().max(20).optional(),
  visitorSide: z.enum(['groom', 'bride']).optional(),
  deviceType: z.enum(['mobile', 'desktop']).optional(),
  durationSeconds: z.number().int().min(0).max(86_400).optional(),
  slidesViewed: z.array(z.string().max(40)).max(20).optional(),
  // 하객용(guest) / 소장용(owner) 조회 구분 — 사회적 증거 분리 집계용.
  viewerRole: z.enum(['guest', 'owner']).optional(),
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

  // RLS: insert allowed only for active (published, non-expired) invitations.
  const supabase = createClient();
  const row: Database['public']['Tables']['guest_visits']['Insert'] = {
    invitation_id: body.invitationId,
    visitor_name: body.visitorName ?? null,
    visitor_side: body.visitorSide ?? null,
    device_type: body.deviceType ?? null,
    duration_seconds: body.durationSeconds ?? null,
    slides_viewed: body.slidesViewed ?? [],
  };
  // viewer_role(마이그 076)은 값이 있을 때만 포함해, 미적용 환경에서도 나머지
  // 삽입이 되게 하고 guest 는 컬럼 default('guest')에 맡긴다. (기존 동작 유지)
  if (body.viewerRole) row.viewer_role = body.viewerRole;
  const { error } = await supabase.from('guest_visits').insert(row);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
