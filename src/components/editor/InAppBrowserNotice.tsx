'use client';

import { useEffect, useState } from 'react';
import { detectInAppBrowser } from '@/lib/utils/in-app-browser';

/**
 * 편집 화면 상단 안내 배너 — 인앱(내장) 브라우저에서 열었을 때만 노출.
 *
 * 카카오톡·네이버앱 등의 내장 WebView 는 쿠키/세션 유지가 불안정해 편집 도중
 * 로그인이 풀려 로그인 화면으로 튕기는 일이 있다. 이런 환경에서는 기본 브라우저
 * (사파리·크롬)로 여는 것이 안정적이라 안내한다.
 *
 * 안전성: 정식 브라우저(크롬·사파리·삼성인터넷·웨일 등)에서는 감지되지 않아
 * 아무것도 렌더하지 않는다(무영향). 닫기 상태는 sessionStorage 에만 기록한다.
 */

const DISMISS_KEY = 'mw_inapp_notice_dismissed';

export function InAppBrowserNotice() {
  const [show, setShow] = useState(false);
  const [appName, setAppName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const { inApp, name } = detectInAppBrowser(window.navigator.userAgent);
    if (!inApp) return;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // sessionStorage 접근 불가 — 그냥 노출.
    }
    if (dismissed) return;
    setAppName(name);
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // 무시 — 다음 진입 때 다시 보여도 무방.
    }
    setShow(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 차단 환경 — 안내 문구로 대체.
      setCopied(false);
    }
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-amber-900 sm:px-6">
      <div className="mx-auto flex max-w-5xl items-start gap-3">
        <span aria-hidden className="mt-0.5 text-base leading-none">⚠️</span>
        <div className="min-w-0 flex-1 text-[12px] leading-relaxed">
          <p className="font-semibold">
            {appName ? `${appName} 내장 브라우저` : '앱 내장 브라우저'}에서는 편집 중 로그인이
            풀릴 수 있어요.
          </p>
          <p className="mt-0.5 text-amber-800">
            안정적인 편집을 위해 <strong>기본 브라우저(사파리·크롬)</strong>로 여는 것을
            권장해요. 화면 우측 상단 <strong>⋯ 메뉴 → &lsquo;다른 브라우저로 열기&rsquo;</strong>
            를 이용하시거나, 아래에서 링크를 복사해 브라우저 주소창에 붙여넣어 주세요.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-700"
            >
              {copied ? '링크 복사됨 ✓' : '편집 링크 복사'}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-amber-800 underline-offset-2 hover:underline"
            >
              계속 이 브라우저로 편집
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="안내 닫기"
          className="shrink-0 rounded-md px-1.5 text-lg leading-none text-amber-700 hover:bg-amber-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
