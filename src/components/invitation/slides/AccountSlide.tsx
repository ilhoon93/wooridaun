'use client';

import { useState } from 'react';
import type {
  InvitationContent,
  BankAccount,
  AccountPartyKey,
  ResolvedSectionHeader,
} from '@/types/invitation';
import { SectionHeader } from './SectionHeader';

interface PartyGroup {
  label: string;
  accounts: BankAccount[];
  /** tel:/sms: 에 쓸 정규화된 번호. 연락처 표시 off 이거나 미입력이면 null. */
  phone: string | null;
}

const isComplete = (a: BankAccount) =>
  a.bank.trim() && a.number.trim() && a.holder.trim();

/** 전화번호 정규화 — 숫자와 맨 앞 + 만 남긴다. 숫자가 너무 짧으면 null. */
export function normalizePhone(raw: string | undefined | null): string | null {
  const t = (raw ?? '').trim();
  const digits = t.replace(/[^0-9]/g, '');
  if (digits.length < 7) return null;
  return t.startsWith('+') ? `+${digits}` : digits;
}

const GROOM_PARTIES: Array<[AccountPartyKey, string]> = [
  ['groom', '신랑'],
  ['groomFather', '신랑 아버지'],
  ['groomMother', '신랑 어머니'],
];
const BRIDE_PARTIES: Array<[AccountPartyKey, string]> = [
  ['bride', '신부'],
  ['brideFather', '신부 아버지'],
  ['brideMother', '신부 어머니'],
];

export function AccountSlide({
  account,
  header,
}: {
  account: InvitationContent['account'];
  header: ResolvedSectionHeader;
}) {
  const [side, setSide] = useState<'groom' | 'bride'>('groom');

  // 연락처 표시(옵션, 기본 off)가 켜져 있으면 계좌가 없어도 연락처가 있는 사람은 노출.
  const showContacts = account.showContacts ?? false;
  const toGroups = (parties: Array<[AccountPartyKey, string]>): PartyGroup[] =>
    parties
      .map(([key, label]) => ({
        label,
        accounts: account[key].filter(isComplete),
        phone: showContacts ? normalizePhone(account.contacts?.[key]) : null,
      }))
      .filter((g) => g.accounts.length > 0 || g.phone);

  const groomGroups = toGroups(GROOM_PARTIES);
  const brideGroups = toGroups(BRIDE_PARTIES);

  const groups = side === 'groom' ? groomGroups : brideGroups;
  // combined=true 면 탭 없이 신랑·신부 계좌를 한 화면에 함께 표시(옵션, 기본 false).
  const combined = account.combined ?? false;
  const showSideTabs = !combined && groomGroups.length > 0 && brideGroups.length > 0;

  // 계좌가 한쪽도 등록되지 않은 케이스 — 안내문구만 있으면 그것만 가운데에 표시한다
  // (예: "축의금은 정중히 사양합니다"). 안내문구도 없으면 기존 fallback.
  if (!showSideTabs && groomGroups.length === 0 && brideGroups.length === 0) {
    const hasGuide = account.guide.trim().length > 0;
    return (
      <section className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-16">
        <SectionHeader header={header} />
        {hasGuide ? (
          <p className="max-w-md whitespace-pre-line text-center text-sm leading-relaxed opacity-90">
            {account.guide}
          </p>
        ) : (
          <p className="text-sm opacity-70">등록된 계좌가 없습니다</p>
        )}
      </section>
    );
  }

  // 표시할 그룹: 탭이면 선택된 측만, combined 면 신랑+신부 전부 함께, 그 외엔 있는 쪽.
  const activeGroups = showSideTabs
    ? groups
    : combined
      ? [...groomGroups, ...brideGroups]
      : groomGroups.length > 0
        ? groomGroups
        : brideGroups;

  return (
    <section className="flex min-h-full flex-col gap-5 px-6 py-16">
      <SectionHeader header={header} />

      {account.guide.trim() && (
        <p className="whitespace-pre-line text-center text-sm leading-relaxed opacity-90">
          {account.guide}
        </p>
      )}

      {showSideTabs && (
        <div className="flex justify-center gap-2">
          <Tab active={side === 'groom'} onClick={() => setSide('groom')}>
            신랑 측
          </Tab>
          <Tab active={side === 'bride'} onClick={() => setSide('bride')}>
            신부 측
          </Tab>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {activeGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-2">
            {/* 사람 이름 + (연락처 표시 시) 전화·문자 버튼. 번호 숫자는 노출하지 않는다. */}
            <div className="flex min-h-[28px] items-center justify-between gap-2">
              <h3 className="text-xs font-medium opacity-70">{group.label}</h3>
              {group.phone && <ContactButtons phone={group.phone} label={group.label} />}
            </div>
            {group.accounts.length > 0 && (
              <ul className="flex flex-col gap-2">
                {group.accounts.map((acct, i) => (
                  <AccountRow key={i} acct={acct} />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-[var(--mw-accent)] text-white'
          // 흰 배경 + 어두운 글자 고정 — 어두운 테마에서도 가독성 보장.
          : 'bg-white text-stone-700 ring-1 ring-stone-200'
      }`}
    >
      {children}
    </button>
  );
}

/** 전화·문자 버튼 — tel:/sms: 링크. 계좌 카드와 같은 흰 배경으로 어두운 테마에서도 보인다. */
function ContactButtons({ phone, label }: { phone: string; label: string }) {
  const cls =
    'inline-flex h-7 items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-medium text-stone-700 ring-1 ring-stone-200 transition-colors hover:bg-stone-50';
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <a href={`tel:${phone}`} aria-label={`${label}에게 전화하기`} className={cls}>
        <PhoneIcon />
        전화
      </a>
      <a href={`sms:${phone}`} aria-label={`${label}에게 문자 보내기`} className={cls}>
        <MessageIcon />
        문자
      </a>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function AccountRow({ acct }: { acct: BankAccount }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(acct.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    // 흰 배경 + 어두운 텍스트(stone-900) 고정 — 어두운 테마에서도 가독성 보장.
    <li className="flex items-center justify-between rounded-md bg-white px-4 py-3 ring-1 ring-stone-200">
      <div className="flex flex-col">
        <span className="text-xs text-stone-500">
          {acct.bank} · {acct.holder}
        </span>
        <span className="text-sm font-medium tracking-wide text-stone-900">
          {acct.number}
        </span>
      </div>
      <button
        type="button"
        onClick={copy}
        className="rounded-md bg-[var(--mw-accent)]/15 px-3 py-1.5 text-xs font-medium text-[var(--mw-accent)] transition-colors hover:bg-[var(--mw-accent)]/25"
      >
        {copied ? '복사됨' : '복사'}
      </button>
    </li>
  );
}
