/**
 * 인앱(내장) 브라우저 감지.
 *
 * 카카오톡·네이버앱·인스타그램·페이스북·라인 등에서 링크를 열면 각 앱의 내장
 * WebView 로 뜨는데, 이 WebView 들은 쿠키/스토리지 유지가 불안정해 로그인 세션이
 * 편집 도중 풀리는 사례가 있다(특히 백그라운드 전환·메모리 압박 시). 편집처럼
 * 안정적인 세션이 필요한 화면에서는 "외부 브라우저로 열기" 를 안내한다.
 *
 * 오탐 방지를 위해 **이름이 명확한 앱 WebView 만** 감지한다(네이버 Whale·삼성
 * 인터넷 등 정식 브라우저는 제외).
 */
export interface InAppBrowserInfo {
  inApp: boolean;
  /** 사람이 읽는 앱 이름 (감지된 경우). */
  name: string | null;
}

const PATTERNS: { name: string; re: RegExp }[] = [
  // 네이버 앱 인앱 브라우저 — UA 예: "... NAVER(inapp; search; ...)".
  // (네이버 Whale 브라우저의 "Whale" 은 정식 브라우저이므로 제외.)
  { name: '네이버 앱', re: /naver\(inapp/i },
  { name: '카카오톡', re: /kakaotalk/i },
  { name: '인스타그램', re: /instagram/i },
  { name: '페이스북', re: /\bFBAN\b|\bFBAV\b|FB_IAB/ },
  { name: '라인', re: /\bLine\//i },
  { name: '다음 앱', re: /daumapps/i },
  { name: '밴드', re: /\bBAND\//i },
];

export function detectInAppBrowser(userAgent: string | null | undefined): InAppBrowserInfo {
  const ua = userAgent ?? '';
  if (!ua) return { inApp: false, name: null };
  for (const { name, re } of PATTERNS) {
    if (re.test(ua)) return { inApp: true, name };
  }
  return { inApp: false, name: null };
}
