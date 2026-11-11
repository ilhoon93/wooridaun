'use server';

/**
 * 알림장 이름 태그(사용자) — invitation_labels(마이그 079).
 *
 * 세션 사용자 클라이언트로 RLS 를 통과시키므로 본인 알림장에만 저장된다. invitations
 * 를 직접 수정하지 않아 '최종 수정' 시각이 바뀌지 않는다. 빈 값이면 태그를 지운다.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

const LABEL_MAX = 20;

export async function saveInvitationLabel(args: {
  invitationId: string;
  label: string;
}): Promise<{ ok: true; label: string | null } | { ok: false; error: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!args.invitationId || typeof args.invitationId !== 'string') {
    return { ok: false, error: '잘못된 요청입니다.' };
  }
  const label = (args.label ?? '').trim().replace(/\s+/g, ' ');
  if (label.length > LABEL_MAX) {
    return { ok: false, error: `태그는 ${LABEL_MAX}자까지 입력할 수 있어요.` };
  }

  // invitation_labels 는 수기 DB 타입에 없어 캐스팅.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (supabase as any).from('invitation_labels');
  const { error } = label
    ? await t.upsert(
        {
          invitation_id: args.invitationId,
          user_id: user.id,
          label,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'invitation_id' },
      )
    : await t.delete().eq('invitation_id', args.invitationId).eq('user_id', user.id);
  if (error) {
    console.error('[mypage] save label failed', error);
    return { ok: false, error: '태그를 저장하지 못했어요. 잠시 후 다시 시도해주세요.' };
  }
  revalidatePath('/mypage');
  return { ok: true, label: label || null };
}
