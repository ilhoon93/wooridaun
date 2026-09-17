'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * 자동 로그인 게이트
 *
 *   - 로그인 페이지에서 사용자가 "자동 로그인" 체크박스를 끄고 로그인하면
 *     localStorage 에 `mw_auto_login = '0'` 가 기록된다.
 *   - 브라우저를 닫았다가 "한참 뒤" 다시 열면(= 공유 PC 시나리오) 즉시 signOut +
 *     /login 으로 보내 새로 로그인하게 한다.
 *   - 플래그가 미설정이거나 '1' 이면 기존 동작(쿠키 세션 유지) 그대로.
 *
 * 견고화(2026-09): 예전에는 sessionStorage 마커 하나로만 "새 브라우저 세션"을
 * 판정했는데, iOS Safari 가 메모리 압박으로 백그라운드 탭을 정리(evict)했다가
 * 복원하면 sessionStorage 가 비어 같은 브라우저 세션인데도 "브라우저를 닫았다"
 * 로 오인되어 편집 중 강제 로그아웃되는 사례가 있었다(AutoLogout 이 같은 이유로
 * 이미 버린 방식).
 *
 * 그래서 이제는 localStorage 하트비트(`mw_last_seen`)를 함께 본다. 탭이 살아있는
 * 동안 주기적으로(그리고 백그라운드 전환·포커스 시) 현재 시각을 기록해 두고,
 * 마커가 사라진 채 다시 로드됐을 때 "마지막으로 살아있던 시각"이 최근(유예 시간
 * 이내)이면 단순 탭 복원으로 보고 로그아웃하지 않는다. 유예 시간을 넘겨 오랫동안
 * 닫혀 있었을 때만 기존 정책대로 강제 로그아웃한다.
 *
 * 영향 범위: 이 모든 로직은 `mw_auto_login === '0'`(자동 로그인을 끈) 사용자에게만
 * 적용된다. 자동 로그인 ON/미설정 사용자는 아래 첫 분기에서 즉시 종료되어 기존과
 * 100% 동일하게 동작한다(하트비트도 돌지 않음). AutoLogout(30분 유휴)·미들웨어·
 * 로그인 흐름은 이 컴포넌트와 무관하다.
 */

const AUTO_LOGIN_KEY = 'mw_auto_login';
const SESSION_ACTIVE_KEY = 'mw_session_active';
const LAST_SEEN_KEY = 'mw_last_seen';

// 탭이 잠깐 정리(iOS Safari 백그라운드 eviction)됐다 복원된 경우와, 브라우저를
// 실제로 닫았다 한참 뒤 다시 연 경우를 구분하는 유예 시간. 이 시간 이내에 이
// 브라우저가 살아있던 흔적(하트비트)이 있으면 탭 복원으로 보고 유지한다.
const RESTORE_GRACE_MS = 5 * 60 * 1000; // 5분
// 살아있는 동안 하트비트를 남기는 주기.
const HEARTBEAT_MS = 20 * 1000; // 20초

export function AutoLoginGate() {
  const router = useRouter();

  useEffect(() => {
    let canceled = false;

    const safe = <T,>(fn: () => T, fallback: T): T => {
      try {
        return fn();
      } catch {
        return fallback;
      }
    };

    // 자동 로그인 ON/미설정 → 기존 동작 그대로(쿠키 세션 유지). 하트비트 미가동.
    const autoLogin = safe(() => localStorage.getItem(AUTO_LOGIN_KEY), null);
    if (autoLogin !== '0') {
      safe(() => sessionStorage.setItem(SESSION_ACTIVE_KEY, '1'), undefined);
      return;
    }

    // ── 여기부터 자동 로그인을 끈(auto_login === '0') 사용자 전용 ──────────────

    // 마커가 사라진 채 다시 로드됐을 때의 판정을 위해, 이번 로드 "전"의 하트비트를
    // 먼저 읽어둔다(아래에서 곧바로 현재 시각으로 덮어쓰기 때문).
    const prevSeen = Number(safe(() => localStorage.getItem(LAST_SEEN_KEY), null)) || 0;

    const markSeen = () =>
      safe(() => localStorage.setItem(LAST_SEEN_KEY, String(Date.now())), undefined);

    // 이 브라우저가 살아있는 동안 하트비트를 남긴다 — 주기적 + 백그라운드 전환/포커스.
    markSeen();
    const hb = window.setInterval(markSeen, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', markSeen, { passive: true });
    window.addEventListener('pagehide', markSeen, { passive: true });
    window.addEventListener('focus', markSeen, { passive: true });

    const cleanup = () => {
      canceled = true;
      window.clearInterval(hb);
      document.removeEventListener('visibilitychange', markSeen);
      window.removeEventListener('pagehide', markSeen);
      window.removeEventListener('focus', markSeen);
    };

    // 같은 브라우저 세션 안(탭 유지)에서는 검사 생략 — 기존과 동일. 하트비트는 계속.
    const sessionActive = safe(() => sessionStorage.getItem(SESSION_ACTIVE_KEY), null);
    if (sessionActive === '1') {
      return cleanup;
    }

    // 마커가 없다 = 새 로드(브라우저 재실행 또는 탭 eviction 복원).
    // 최근까지 이 브라우저가 살아있었으면(하트비트가 유예 시간 이내) 탭 복원으로
    // 보고 로그아웃하지 않는다. → iOS Safari eviction 오탐 제거.
    const recentlyAlive = prevSeen > 0 && Date.now() - prevSeen < RESTORE_GRACE_MS;
    if (recentlyAlive) {
      safe(() => sessionStorage.setItem(SESSION_ACTIVE_KEY, '1'), undefined);
      return cleanup;
    }

    // 오랫동안 닫혀 있었음(또는 하트비트 기록 자체가 없음) → 기존 정책대로 강제 로그아웃.
    const supabase = createClient();
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (canceled) return;
      if (!session) {
        // 이미 로그아웃 상태라면 마커만 켜두고 종료.
        safe(() => sessionStorage.setItem(SESSION_ACTIVE_KEY, '1'), undefined);
        return;
      }

      try {
        await supabase.auth.signOut();
      } catch {
        // already signed out — proceed
      }
      safe(() => sessionStorage.setItem(SESSION_ACTIVE_KEY, '1'), undefined);
      router.replace('/login?reason=auto_login_off');
      router.refresh();
    })();

    return cleanup;
  }, [router]);

  return null;
}
