'use client';

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { FallingPetals } from '@/components/shared/FallingPetals';
import { BgmPlayer } from './BgmPlayer';
import {
  FONT_OPTIONS,
  THEME_PALETTES,
  type ColorTheme,
  type FontKey,
  type PetalType,
} from '@/lib/theme';

const SWIPE_THRESHOLD = 50;
const VERTICAL_BIAS = 1.2;

interface Props {
  children: ReactNode[];
  colorTheme?: ColorTheme;
  petalType?: PetalType;
  font?: FontKey;
  bgmUrl?: string | null;
  /**
   * scoped: 컨테이너의 부모 박스 안에서만 동작하도록 viewport 단위(`vw`/`dvh`)
   * 대신 부모 상대 단위(`%`/`h-full`)를 사용한다. 에디터 좌측 미리보기 패널처럼
   * 화면 일부에만 슬라이드를 보여줄 때 사용. 기본 false (= 풀스크린).
   */
  scoped?: boolean;
  /**
   * isPreview: 에디터 좌측 미리보기. true 면 배경음악 플레이어를 띄우지 않는다
   * (편집 중 자동 재생 방지). 데스크톱 폰 프레임 게스트 뷰처럼 scoped 이지만
   * 실제 하객/소장용 화면에서는 음악이 나와야 하므로 scoped 가 아닌 isPreview 로
   * 판별한다.
   */
  isPreview?: boolean;
  /**
   * forceBgm: isPreview 여도 배경음악 플레이어를 노출 + 자동재생. 마케팅 디자인
   * 전체보기 모달처럼 "샘플 음악을 들려주고 싶은" 미리보기 한정으로 켠다.
   */
  forceBgm?: boolean;
  /**
   * manualBgm: isPreview 인데 음악 버튼은 보여주되 자동재생은 하지 않는다.
   * 에디터 실시간 미리보기용 — 편집 중 소리가 저절로 나지 않게 하면서도 버튼을
   * 탭하면 음악을 확인할 수 있다.
   */
  manualBgm?: boolean;
  /** 혼주용 큰 글씨 모드 — 본문(rem 기반) 텍스트를 전반적으로 키운다(globals.css .wd-host-text). */
  hostMode?: boolean;
  /**
   * 슬라이드별 등장 방식(children 인덱스와 정렬):
   *   'none'     — 효과 없음(메인 표지 / 옵션 off)
   *   'stagger'  — 제목부터 아래로 계단식 순차 등장
   *   'together' — 제목만 먼저 뜨고 나머지는 한번에(요소 많은 방명록 등)
   *   'account'  — 헤더 → 글귀 → 그 외 전체 3단계(계좌 슬라이드)
   * 미지정 시 전부 'none'.
   */
  slideReveal?: Array<'none' | 'stagger' | 'together' | 'account'>;
  /**
   * 넘기기 방식. 'horizontal'(기본) = 좌우 스와이프 트랙.
   * 'vertical' = 위아래로 이어지는 자연 스크롤. 첫 슬라이드(표지)는 한 화면
   * 높이로 고정하고, 마지막(엔딩)은 최소 한 화면, 그 사이 슬라이드는 내용 높이에 맞춘다(스냅 없음).
   * 슬라이드 전환 효과가 켜져 있으면 처음 내려갈 때 구간마다 멈추고 등장 효과를 보여준다.
   */
  direction?: 'horizontal' | 'vertical';
}

export function SlideContainer({
  children,
  colorTheme = 'cream',
  petalType = 'flower',
  font = 'serif',
  bgmUrl = null,
  scoped = false,
  isPreview = false,
  forceBgm = false,
  manualBgm = false,
  hostMode = false,
  slideReveal,
  direction = 'horizontal',
}: Props) {
  const isVertical = direction === 'vertical';
  const slides = children.filter(Boolean);
  const [index, setIndex] = useState(0);
  // 스와이프(가로 트랙 이동)가 끝나 "정착"한 슬라이드 인덱스. 전환 효과가 켜진
  // 슬라이드는 이 값이 자기 인덱스가 될 때만 콘텐츠를 드러낸다 → 스와이프 도중에는
  // 다음 슬라이드가 보이지 않고, 정착 후에야 위에서부터 순서대로 떠오른다.
  const [settledIndex, setSettledIndex] = useState(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const palette = THEME_PALETTES[colorTheme];
  const fontFamily = FONT_OPTIONS[font].family;

  const slidesLen = slides.length;
  const startRef = useRef<{ x: number; y: number } | null>(null);

  // ── 세로 모드 전용 ────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  // 세로 + 슬라이드 전환 효과(slideReveal 중 하나라도 'none' 이 아님)일 때만 "구간 멈춤
  // + 등장 효과" 를 쓴다. 효과를 끈 세로 모드는 모든 내용이 보이는 자연 스크롤 그대로.
  const gateOn = isVertical && !!slideReveal?.some((m) => m !== 'none');
  // 열린(등장 효과가 실행된) 슬라이드. 한 번 열리면 계속 열린 상태 → 다시 올렸다 내려도
  // 효과가 반복되지 않고 막힘 없이 스크롤된다.
  const [openSet, setOpenSet] = useState<ReadonlySet<number>>(() => new Set([0]));
  // 스크롤 가능한 높이 한도(px). 트랙 높이를 이 값으로 잘라 그 아래로는 내려갈 수 없게
  // 해서, 한 번에 크게 쓸어내려도 다음 구간에서 멈춘다. 스크롤이 멈추면 다음 구간까지
  // 한도를 늘린다. null = 아직 측정 전 / 끝까지 열림(제한 없음).
  const [limit, setLimit] = useState<number | null>(null);
  const limitRef = useRef(limit);
  limitRef.current = limit;

  useEffect(() => {
    if (!isVertical) return;
    const root = scrollerRef.current;
    if (!root) return;
    let raf = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;

    // 다음 멈춤 위치(scrollTop) 계산. 한 번에 최소 반 화면 ~ 최대 한 화면만큼 내려가도록
    // 하고, 그 범위 안에 "섹션 시작(윗변이 화면 맨 위)" 또는 "긴 섹션의 끝(아랫변이 화면
    // 맨 아래)" 이 있으면 그 위치에 맞춰 멈춘다(가장 가까운 것). 범위 안에 기준점이 없으면
    // 화면 85% 만큼 내려간다. 끝까지 반 화면도 안 남으면 끝으로 바로 간다.
    const nextStop = (cur: number) => {
      const vh = root.clientHeight;
      const marks: number[] = [];
      let total = 0;
      slideRefs.current.forEach((el, i) => {
        if (!el) return;
        const top = el.offsetTop;
        const h = el.offsetHeight;
        total = Math.max(total, top + h);
        if (i === 0) return;
        marks.push(top);
        if (h > vh) marks.push(top + h - vh);
      });
      const max = Math.max(0, total - vh);
      const lo = cur + vh * 0.5;
      const hi = cur + vh;
      const inRange = marks.filter((m) => m >= lo && m <= hi).sort((x, y) => x - y);
      let next = inRange.length > 0 ? inRange[0] : cur + Math.round(vh * 0.85);
      if (max - next < vh * 0.5) next = max;
      return { next: Math.min(next, max), max, vh };
    };

    // 다음 멈춤 위치까지 한도를 늘린다. 끝에 닿으면 제한 해제(null).
    const extendLimit = () => {
      const vh = root.clientHeight;
      const cur = (limitRef.current ?? vh) - vh;
      const { next, max } = nextStop(cur);
      if (next >= max - 2) setLimit(null);
      else setLimit(next + vh);
    };

    // 스크롤이 멈췄을 때 — 화면 위쪽 75% 안으로 들어온 슬라이드를 연다(등장 효과).
    // 한도 끝에 닿아 멈췄다면 다음 구간까지 한도를 늘린다.
    const onIdle = () => {
      const line = root.scrollTop + root.clientHeight * 0.75;
      setOpenSet((prev) => {
        let next = prev;
        slideRefs.current.forEach((el, i) => {
          if (el && el.offsetTop < line && !next.has(i)) {
            if (next === prev) next = new Set(prev);
            (next as Set<number>).add(i);
          }
        });
        return next;
      });
      const lim = limitRef.current;
      if (lim != null && root.scrollTop + root.clientHeight >= lim - 4) extendLimit();
    };

    // 첫 한도 — 표지 다음 섹션의 시작 위치까지만.
    if (gateOn && limitRef.current == null) extendLimit();

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 현재 위치(첫 화면 '아래로' 안내 표시 여부용) — 화면 위쪽 40% 지점을 지난 마지막 슬라이드.
        const line = root.scrollTop + root.clientHeight * 0.4;
        let cur = 0;
        slideRefs.current.forEach((el, i) => {
          if (el && el.offsetTop <= line) cur = i;
        });
        setIndex(cur);
      });
      if (!gateOn) return;
      if (idle) clearTimeout(idle);
      idle = setTimeout(onIdle, 160);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      if (idle) clearTimeout(idle);
    };
  }, [isVertical, gateOn, slidesLen]);

  // 세로 모드의 '아래로' 안내 클릭 — scrollIntoView 는 바깥 페이지(에디터)까지 스크롤할 수 있어
  // 스크롤러 안에서만 이동시킨다.
  const scrollToSlide = (i: number) => {
    const root = scrollerRef.current;
    const el = slideRefs.current[i];
    if (root && el) root.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
  };

  const commitSwipe = (dx: number, dy: number) => {
    if (Math.abs(dy) > Math.abs(dx) * VERTICAL_BIAS) return;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;

    if (dx < 0) {
      setIndex((i) => Math.min(i + 1, slidesLen - 1));
    } else {
      setIndex((i) => Math.max(i - 1, 0));
    }
  };

  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));
  const goNext = () => setIndex((i) => Math.min(i + 1, slidesLen - 1));

  const isInsideNoSwipe = (target: EventTarget | null) =>
    target instanceof Element && !!target.closest('[data-noswipe]');

  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isInsideNoSwipe(e.target)) {
      startRef.current = null;
      return;
    }
    const t = e.touches[0];
    if (!t) return;
    startRef.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    commitSwipe(t.clientX - start.x, t.clientY - start.y);
  };

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isInsideNoSwipe(e.target)) return;
    startRef.current = { x: e.clientX, y: e.clientY };
    const onUp = (evt: MouseEvent) => {
      const start = startRef.current;
      startRef.current = null;
      window.removeEventListener('mouseup', onUp);
      if (!start) return;
      commitSwipe(evt.clientX - start.x, evt.clientY - start.y);
    };
    window.addEventListener('mouseup', onUp);
  };

  // CSS variables expose the active palette to nested slides — so they can
  // pick theme-aware colors via `text-[var(--mw-accent)]` etc instead of
  // hard-coding cream-only hexes.
  const themeVars = {
    ['--mw-bg' as string]: palette.bg,
    ['--mw-fg' as string]: palette.fg,
    ['--mw-accent' as string]: palette.accent,
    ['--mw-dot' as string]: palette.dot,
    // 일러스트형 메인 슬라이드의 PNG 라인아트가 다크 테마에서도 잘 보이도록
    // 테마별 CSS filter 체인(크로마키 + 글로우)을 변수로 흘려 보낸다.
    ['--mw-illust-filter' as string]: palette.illustFilter ?? 'none',
    // 단색 라인 스케치(text-flower.png 등) 전용 filter. 다크 테마에서는 invert
    // 로 검은 라인을 흰 라인으로 뒤집어 가독성을 확보한다.
    ['--mw-sketch-filter' as string]: palette.sketchFilter ?? 'none',
  } as React.CSSProperties;

  return (
    <div
      className={`relative overflow-hidden ${
        scoped ? 'h-full w-full' : 'h-[100dvh] w-screen'
      }${hostMode ? ' wd-host-text' : ''}`}
      style={{
        backgroundColor: palette.bg,
        color: palette.fg,
        fontFamily,
        ...themeVars,
        // bgPattern은 background-image로 베이스 컬러 위에 얹는다.
        ...(palette.bgPattern
          ? {
              backgroundImage: palette.bgPattern,
              backgroundRepeat: 'repeat',
            }
          : {}),
      }}
    >
      {bgmUrl && (!isPreview || forceBgm || manualBgm) && (
        // 실제 화면·전체보기(forceBgm)는 자동재생, 에디터 미리보기(manualBgm)는
        // 버튼만 노출하고 탭해야 재생.
        <BgmPlayer url={bgmUrl} autoStart={!isPreview || forceBgm} />
      )}

      {isVertical ? (
        <>
      {/* ── 세로 모드: 위아래로 이어지는 스크롤 ─────────────────── */}
      {/* containerType size — 슬라이드 안의 cqh 단위가 한 화면 높이를 기준으로 잡히도록. */}
      <div
        ref={scrollerRef}
        // overscroll-y-none — 한도/끝에 닿았을 때 튕겼다 되돌아오는(바운스) 움찔거림 제거.
        className="wd-hide-scroll absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-y-none"
        style={{ containerType: 'size' }}
      >
        {/* 트랙 — 구간 멈춤이 켜지면 높이를 한도(limit)로 잘라 그 아래로 스크롤되지 않게 한다. */}
        <div
          className="relative"
          style={gateOn && limit != null ? { height: limit, overflow: 'hidden' } : undefined}
        >
        {slides.map((slide, i) => {
          const mode = slideReveal?.[i] ?? 'none';
          const modeClass =
            mode === 'together' ? ' wd-together' : mode === 'account' ? ' wd-account' : '';
          const isOpen = openSet.has(i);
          // 전환 효과가 켜진 슬라이드는 처음 열릴 때 한 번, 박스 전체 페이드인(.wd-vfade —
          // 위치 이동 없이 투명도만) + 요소별 순차 떠오르기(.wd-anim) 를 함께 적용. 클래스가
          // 유지되므로 다시 스크롤해도 반복되지 않는다. 효과 off / 표지는 그대로 노출.
          const revealClass =
            !gateOn || mode === 'none'
              ? ''
              : `wd-vfade${isOpen ? ' wd-vfade-in' : ''} wd-anim${modeClass}${
                  isOpen ? ' wd-reveal' : ''
                }`;
          const isCover = i === 0;
          const isLast = i === slidesLen - 1;
          return (
            <div
              key={i}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              data-slide-index={i}
              className={`relative w-full ${
                isCover
                  ? 'h-full overflow-hidden'
                  : isLast
                    ? 'wd-vslide flex min-h-full flex-col'
                    : 'wd-vslide wd-vslide-fit flex flex-col'
              }${revealClass ? ` ${revealClass}` : ''}`}
              style={{
                containerType: isCover ? 'size' : 'inline-size',
                // 트랙 안에서 표지 h-full 이 스크롤러(한 화면) 높이를 따르도록.
                ...(isCover ? { height: '100cqh' } : {}),
                ...(isLast ? { minHeight: '100cqh' } : {}),
              }}
            >
              {slide}
            </div>
          );
        })}
        </div>
      </div>

      {/* 꽃잎 등 배경 효과 — 세로 모드에선 화면 위에 한 겹으로 고정(슬라이드 길이와 무관). */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{ containerType: 'size' }}
      >
        <FallingPetals type={petalType} colors={palette.petals} />
      </div>

      {/* 첫 화면 하단 "아래로" 안내 — 내려가기 시작하면 사라진다. */}
      {slidesLen > 1 && (
        <button
          type="button"
          onClick={() => scrollToSlide(1)}
          aria-label="다음 슬라이드로 내려가기"
          className={`absolute bottom-1 left-1/2 z-20 grid h-6 w-8 -translate-x-1/2 place-items-center text-base leading-none transition-opacity duration-300 ${
            index === 0 ? 'wd-bounce-y opacity-100' : 'pointer-events-none opacity-0'
          }`}
          style={{ color: palette.accent }}
        >
          ⌄
        </button>
      )}
        </>
      ) : (
        <>
      <motion.div
        className="flex h-full"
        animate={{ x: scoped ? `-${index * 100}%` : `-${index * 100}vw` }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        // 트랙 이동(스와이프)이 끝나면 현재 인덱스를 "정착"으로 확정 → 그 슬라이드의
        // 콘텐츠 순차 등장을 시작한다.
        onAnimationComplete={() => setSettledIndex(indexRef.current)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          startRef.current = null;
        }}
        onMouseDown={onMouseDown}
      >
        {slides.map((slide, i) => {
          // 이 슬라이드의 등장 방식. 효과 대상('stagger'/'together')은 기본적으로
          // 콘텐츠가 숨겨져(.wd-anim) 스와이프 도중 다음 슬라이드가 보이지 않고,
          // 스와이프가 끝나 이 슬라이드가 "정착"(settledIndex === i)하면 .wd-reveal 이
          // 붙어 순서대로/한번에 떠오른다(globals.css). 'none'/메인은 즉시 전체 노출.
          const mode = slideReveal?.[i] ?? 'none';
          const modeClass =
            mode === 'together' ? ' wd-together' : mode === 'account' ? ' wd-account' : '';
          const revealClass =
            mode === 'none'
              ? ''
              : `wd-anim${modeClass}${settledIndex === i ? ' wd-reveal' : ''}`;
          return (
            <div
              key={i}
              className={`wd-hide-scroll relative h-full flex-shrink-0 touch-pan-y overflow-y-auto ${
                scoped ? 'w-full' : 'w-screen'
              }${revealClass ? ` ${revealClass}` : ''}`}
              // 모든 cqw/cqh 단위가 슬라이드 박스 자체를 기준으로 잡히도록
              // container-type 을 지정. 모바일 풀스크린에서는 슬라이드 = 뷰포트라
              // cqw≈vw 동일하게 동작하고, 데스크톱 미리보기 패널에서는 폰 프레임
              // 박스를 기준이라 폰트 크기·비율이 모바일과 동일하게 보인다.
              style={{ containerType: 'size' }}
            >
              {slide}
              {/* 배경 효과 — 각 슬라이드 박스 안에 z-10 으로 깔아둔다.
                  슬라이드 콘텐츠(z-auto) 위에 펠탈/별빛이 떨어지지만, VideoSlide 처럼
                  z-20 이상을 설정한 요소(영상 컨테이너)는 효과 위로 올라와 가려짐. */}
              <FallingPetals type={petalType} colors={palette.petals} />
            </div>
          );
        })}
      </motion.div>

      {/* 하단 점 표시 (인디케이터) — 슬라이드가 2장 이상일 때만. 표지 1장짜리
          (쇼케이스 커버 등)에서는 인디케이터·화살표를 아예 렌더하지 않아 다음
          슬라이드로 넘어갈 수 없다. */}
      {slidesLen > 1 && (
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`${i + 1}번 슬라이드로 이동`}
            className="pointer-events-auto h-1.5 rounded-full transition-all"
            style={{
              width: i === index ? 20 : 6,
              backgroundColor: i === index ? palette.accent : palette.dot,
            }}
          />
        ))}
      </div>
      )}

      {/* 좌우 화살표: 끝 위치에선 disabled:opacity-0 으로 자연스레 사라짐 */}
      {slidesLen > 1 && (
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-between px-2 md:px-4">
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          aria-label="이전"
          className="pointer-events-auto grid h-9 w-9 place-items-center bg-transparent text-lg disabled:opacity-0 md:h-10 md:w-10"
          style={{ color: palette.accent, background: 'transparent' }}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={index === slides.length - 1}
          aria-label="다음"
          className="pointer-events-auto grid h-9 w-9 place-items-center bg-transparent text-lg disabled:opacity-0 md:h-10 md:w-10"
          style={{ color: palette.accent, background: 'transparent' }}
        >
          ›
        </button>
      </div>
      )}
        </>
      )}
    </div>
  );
}
