'use client';

import { useEffect } from 'react';
import { readGuestIdentity } from './SignatureGate';

interface Props {
  invitationId: string;
  /** Suppress tracking in author preview mode. */
  disabled?: boolean;
  /** 하객용(guest) / 소장용(owner) 조회 구분 — 사회적 증거 분리 집계용. */
  role?: 'guest' | 'owner';
}

// role 별로 세션 키를 분리 → 같은 세션에서 하객/소장용을 각각 1회씩 집계.
const SESSION_KEY = (id: string, role: 'guest' | 'owner') =>
  `wedding-visit:${role}:${id}`;

/**
 * Fires a visit POST once per browser session. We deliberately don't
 * log every page load — sessionStorage de-dupes within a tab session,
 * and the public invitation tends to be loaded once and swiped through.
 */
export function VisitTracker({ invitationId, disabled, role = 'guest' }: Props) {
  useEffect(() => {
    if (disabled) return;
    if (typeof window === 'undefined') return;

    if (window.sessionStorage.getItem(SESSION_KEY(invitationId, role))) return;

    const identity = readGuestIdentity(invitationId);
    const deviceType =
      typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches
        ? 'mobile'
        : 'desktop';

    fetch('/api/guest/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        invitationId,
        visitorName: identity.name ?? undefined,
        visitorSide: identity.side ?? undefined,
        deviceType,
        // guest 는 컬럼 default('guest')에 맡기고 owner 만 명시 전송 → viewer_role
        // 컬럼(마이그 076) 미적용 환경에서도 하객 집계는 계속 동작.
        viewerRole: role === 'owner' ? 'owner' : undefined,
      }),
      keepalive: true,
    })
      .then(() => {
        window.sessionStorage.setItem(SESSION_KEY(invitationId, role), '1');
      })
      .catch(() => {
        // ignore — telemetry should never break the experience
      });
  }, [invitationId, disabled, role]);

  return null;
}
