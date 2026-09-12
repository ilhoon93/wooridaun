import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/snap/jobs/[id]/download
 *
 * 웨딩스냅 결과 이미지를 "동일 출처"로 스트리밍 + Content-Disposition: attachment.
 * 클라이언트가 외부(Supabase) URL 을 직접 fetch 하면 CORS/모바일 저장 이슈가 있고,
 * a[download] 는 iOS Safari 가 무시한다. 이 라우트로 받으면:
 *   - 동일 출처라 CORS 문제 없음(브라우저 저장/공유 안정적)
 *   - attachment 헤더로 브라우저가 파일로 저장하도록 유도
 * 권한: 본인 user_id 의 job 만.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobId = ctx.params.id;
  if (!jobId) {
    return NextResponse.json({ error: 'job id required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: job, error } = await admin
    .from('snap_jobs')
    .select('id, user_id, result_url')
    .eq('id', jobId)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 });
  }
  if (job.user_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!job.result_url) {
    return NextResponse.json({ error: 'no image' }, { status: 404 });
  }

  // 원본(공개 storage URL) 을 서버에서 받아 그대로 흘려보낸다.
  const upstream = await fetch(job.result_url, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'upstream fetch failed' }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const filename = `wedding-snap-${jobId.slice(0, 8)}.${ext}`;

  return new NextResponse(upstream.body, {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
}
