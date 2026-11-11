'use server';

/**
 * 가입자 크레딧 가감 — admin 만 통과.
 * admin_adjust_credits RPC(service_role 전용)를 admin 클라이언트로 호출.
 */

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/admin';
import { createAdminClient } from '@/lib/supabase/admin';

const KINDS = ['publish', 'archive', 'snap'] as const;
type CreditKind = (typeof KINDS)[number];

export async function adjustCredits(args: {
  userId: string;
  kind: CreditKind;
  delta: number;
  note?: string;
}): Promise<{ ok: boolean; error?: string; balance?: number }> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: 'forbidden' };
  }
  if (!args.userId || typeof args.userId !== 'string') {
    return { ok: false, error: 'invalid user' };
  }
  if (!KINDS.includes(args.kind)) {
    return { ok: false, error: 'invalid kind' };
  }
  if (!Number.isInteger(args.delta) || args.delta === 0) {
    return { ok: false, error: '가감 수량은 0이 아닌 정수여야 합니다' };
  }
  if (Math.abs(args.delta) > 10000) {
    return { ok: false, error: '한 번에 ±10000 까지만 조정할 수 있습니다' };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('admin_adjust_credits', {
    p_user_id: args.userId,
    p_kind: args.kind,
    p_delta: args.delta,
    p_note: args.note ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const result = data as { balance?: number } | null;
  revalidatePath('/admin/users');
  return { ok: true, balance: result?.balance };
}

/**
 * 쇼케이스 활용 동의 계정 추가/해제(admin) — showcase_consent_users(마이그 079).
 * 추가된 계정의 발행 알림장은 사진 있는 디자인도 /admin/showcase 후보에 포함된다
 * (계정 단위라 추가 이후 발행분도 포함). invitations 를 건드리지 않아 고객 알림장의
 * '최종 수정' 시각은 바뀌지 않는다.
 */
export async function setShowcaseConsentUser(args: {
  userId: string;
  consent: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: 'forbidden' };
  }
  if (!args.userId || typeof args.userId !== 'string') {
    return { ok: false, error: 'invalid user' };
  }
  const admin = createAdminClient();
  // showcase_consent_users 는 수기 DB 타입에 없어 캐스팅.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (admin as any).from('showcase_consent_users');
  const { error } = args.consent
    ? await t.upsert({ user_id: args.userId, note: 'admin' }, { onConflict: 'user_id' })
    : await t.delete().eq('user_id', args.userId);
  if (error) {
    const missing = /showcase_consent_users|does not exist|PGRST205/i.test(error.message);
    return {
      ok: false,
      error: missing
        ? 'DB 마이그레이션 079 가 아직 적용되지 않았습니다(npx supabase db push).'
        : error.message,
    };
  }
  revalidatePath('/admin/users');
  revalidatePath('/admin/showcase');
  return { ok: true };
}
