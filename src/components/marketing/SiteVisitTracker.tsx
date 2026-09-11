'use client';

import { useEffect } from 'react';

/**
 * 홈페이지(랜딩) 방문 집계 — 사회적 증거 "홈페이지 방문수" 지표용.
 * 세션당 1회만 POST(sessionStorage 로 중복 방지). 텔레메트리라 실패해도 무시.
 */
const SESSION_KEY = 'wd-site-visit';

export function SiteVisitTracker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // sessionStorage 접근 불가(프라이빗 모드 등) — 그냥 진행.
    }

    const deviceType =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 768px)').matches
        ? 'mobile'
        : 'desktop';

    fetch('/api/site/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname, deviceType }),
      keepalive: true,
    })
      .then(() => {
        try {
          window.sessionStorage.setItem(SESSION_KEY, '1');
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // ignore — telemetry should never break the experience
      });
  }, []);

  return null;
}
