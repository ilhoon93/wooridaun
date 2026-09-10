import { ImageResponse } from 'next/og';
import fs from 'fs';
import path from 'path';
import { createAdminClient } from '@/lib/supabase/admin';
import { THEME_PALETTES, type ColorTheme } from '@/lib/theme';

/**
 * 알림장 공유(OG) 이미지 동적 생성 — 표지 사진이 없는 알림장(일러스트/텍스트/무늬)용
 * 가로형(1200×630) 카드. 카카오톡·네이버·구글 미리보기가 이 카드를 쓴다.
 *
 * "실제 표지처럼": 테마 배경색 위에 신랑·신부 이름 + 예식일 + 인사말 한 줄을
 * 얹고, 일러스트가 있으면 함께 보여 준다. 텍스트는 next/og(satori)가 폰트를
 * 벡터 path 로 변환해 그리므로 서버에 시스템 폰트가 없어도(=Vercel) 한글이
 * 깨지지 않는다. 한글 글리프는 번들된 Noto Sans KR(OTF)로 커버.
 *
 * 사진이 있는 알림장은 [slug]/page.tsx 가 실제 표지 사진을 OG 로 쓰므로 이 라우트를
 * 타지 않는다. (사진 없는 경우에만 여기서 카드 생성 → 예전엔 사이트 기본 og.png =
 * 마케팅 이미지로 폴백되던 문제를 없앰.)
 *
 * 크롤러(카카오톡 등)가 공유 시점에만 호출 + 캐시 → 사용자 성능 영향 없음.
 */
export const dynamic = 'force-dynamic';

const W = 1200;
const H = 630;

// 번들된 한글 폰트(서버 전용 — 클라이언트로 안 나감). public 아래라 기존 illustrations
// 처럼 fs 로 직접 읽는다(프로덕션에서도 동일하게 동작하는 검증된 방식).
let cachedFont: Buffer | null = null;
function loadFont(): Buffer {
  if (!cachedFont) {
    cachedFont = fs.readFileSync(
      path.join(process.cwd(), 'public', 'fonts', 'og', 'NotoSansKR-Regular.otf'),
    );
  }
  return cachedFont;
}

// 상대 휘도 (0=검정 ~ 1=흰색). 어두운 배경 판정용.
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 250, g: 247, b: 242 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** "2026-05-23" → "2026년 5월 23일 토요일" (파싱 실패 시 원본/빈문자). */
function formatWeddingDate(raw: string | null): string {
  if (!raw) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return raw;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const dow = ['일', '월', '화', '수', '목', '금', '토'][dt.getUTCDay()];
  return `${y}년 ${mo}월 ${d}일 ${dow}요일`;
}

export async function GET(
  _req: Request,
  { params }: { params: { slug: string } },
) {
  let bgHex = '#FAF7F2';
  let fgHex = '#3D2E1F';
  let accentHex = '#8B7355';
  let groom = '';
  let bride = '';
  let dateText = '';
  let greeting = '';
  let illustFile: string | null = null;

  try {
    const sb = createAdminClient();
    const { data } = await sb
      .from('publications')
      .select('content, groom_name, bride_name, wedding_date')
      .eq('slug', params.slug)
      .maybeSingle();

    const content = (data?.content ?? null) as {
      theme?: { colorTheme?: ColorTheme };
      main?: {
        layout?: string;
        greeting?: string;
        illustrationDesign?: { variant?: string };
        textDesign?: { variant?: string };
      };
    } | null;

    const colorTheme = content?.theme?.colorTheme;
    if (colorTheme && THEME_PALETTES[colorTheme]) {
      bgHex = THEME_PALETTES[colorTheme].bg;
      fgHex = THEME_PALETTES[colorTheme].fg;
      accentHex = THEME_PALETTES[colorTheme].accent;
    }
    groom = (data?.groom_name ?? '').trim();
    bride = (data?.bride_name ?? '').trim();
    dateText = formatWeddingDate(data?.wedding_date ?? null);

    const main = content?.main ?? {};
    // 표지 인사말 한 줄만(첫 줄, 과도한 길이는 잘라 카드 넘침 방지).
    const g = (main.greeting ?? '').split('\n')[0]?.trim() ?? '';
    greeting = g.length > 28 ? `${g.slice(0, 28)}…` : g;

    if (main.layout === 'illustration') {
      illustFile = `illust-${main.illustrationDesign?.variant ?? 'arch'}.png`;
    } else if (main.layout === 'text') {
      const v = main.textDesign?.variant ?? 'flower';
      if (v !== 'none') illustFile = `text-${v}.png`;
    }
  } catch {
    // 조회 실패 → 테마 기본값으로 최소 카드.
  }

  const darkBg = luminance(bgHex) < 0.4;
  // 일러스트 PNG 를 data URI 로 임베드(satori 는 외부 self-fetch 대신 data URI 를 쓴다).
  let illustDataUri: string | null = null;
  if (illustFile) {
    try {
      const fp = path.join(process.cwd(), 'public', 'illustrations', illustFile);
      if (fs.existsSync(fp)) {
        illustDataUri = `data:image/png;base64,${fs.readFileSync(fp).toString('base64')}`;
      }
    } catch {
      illustDataUri = null;
    }
  }

  const names = groom && bride ? `${groom} · ${bride}` : groom || bride || '결혼합니다';

  try {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            padding: 64,
            background: bgHex,
            fontFamily: 'NotoKR',
          }}
        >
          {illustDataUri && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={illustDataUri}
              width={200}
              height={200}
              alt=""
              style={{
                objectFit: 'contain',
                marginBottom: 8,
                // 다크 배경에서 라인 스케치(text-flower)가 안 보이는 것 방지.
                filter: darkBg && illustFile === 'text-flower.png' ? 'invert(1)' : 'none',
              }}
            />
          )}
          <div
            style={{
              fontSize: 28,
              letterSpacing: 8,
              color: accentHex,
              display: 'flex',
            }}
          >
            WE ARE GETTING MARRIED
          </div>
          <div
            style={{
              fontSize: 76,
              color: fgHex,
              textAlign: 'center',
              maxWidth: 1000,
              lineHeight: 1.2,
              display: 'flex',
            }}
          >
            {names}
          </div>
          {dateText && (
            <div style={{ fontSize: 32, color: fgHex, opacity: 0.85, display: 'flex' }}>
              {dateText}
            </div>
          )}
          {greeting && (
            <div style={{ fontSize: 24, color: accentHex, display: 'flex' }}>
              {greeting}
            </div>
          )}
        </div>
      ),
      {
        width: W,
        height: H,
        fonts: [{ name: 'NotoKR', data: loadFont(), weight: 400, style: 'normal' }],
        headers: {
          'cache-control': 'public, max-age=3600, s-maxage=86400',
        },
      },
    );
  } catch {
    // 렌더 실패 시에도 OG 가 깨지지 않도록 테마 단색 배경 SVG 폴백.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${bgHex}"/></svg>`;
    return new Response(svg, {
      headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=600' },
    });
  }
}
