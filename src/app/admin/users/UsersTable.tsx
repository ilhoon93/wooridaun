'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adjustCredits, setShowcaseConsentUser } from './actions';
import { formatKstDate } from '@/lib/utils/datetime';

export interface AdminUserRow {
  user_id: string;
  email: string | null;
  created_at: string;
  publish_balance: number;
  archive_balance: number;
  snap_balance: number;
  order_count: number;
  order_amount: number;
  /** 운영자가 쇼케이스 활용 동의로 직접 추가(마이그 079). */
  showcaseAdded?: boolean;
  /** 포토리뷰 이벤트 참여로 동의(계정 단위). */
  showcaseViaEvent?: boolean;
  /** 알림장별 홈 노출 동의(showcase_consent)가 하나 이상. */
  showcaseViaInvitation?: boolean;
}

type CreditKind = 'publish' | 'archive' | 'snap';

const KIND_LABEL: Record<CreditKind, string> = {
  publish: '발행권',
  archive: '영구소장',
  snap: '스냅',
};

function fmtDate(iso: string): string {
  return formatKstDate(iso, { year: '2-digit', month: '2-digit', day: '2-digit' });
}

export function UsersTable({
  rows,
  consentTableReady = true,
}: {
  rows: AdminUserRow[];
  /** showcase_consent_users(079) 조회 가능 여부 — false 면 동의 추가 버튼 비활성. */
  consentTableReady?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
      (r) => (r.email ?? '').toLowerCase().includes(t) || r.user_id.includes(t),
    );
  }, [rows, q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이메일 또는 user_id 검색"
          className="w-full max-w-xs rounded-md border border-[#D4C5B0] bg-white px-3 py-1.5 text-sm placeholder:text-[#B0A088] focus:border-[#8B7355] focus:outline-none"
        />
        <span className="text-[11px] text-[#8B7355]">
          {filtered.length} / {rows.length}명
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-[#E8DCC9]">
        <table className="w-full min-w-[840px] border-collapse text-sm">
          <thead>
            <tr className="bg-[#FAF7F2] text-[11px] text-[#8B7355]">
              <th className="px-3 py-2 text-left font-medium">이메일</th>
              <th className="px-2 py-2 text-right font-medium">발행권</th>
              <th className="px-2 py-2 text-right font-medium">영구소장</th>
              <th className="px-2 py-2 text-right font-medium">스냅</th>
              <th className="px-2 py-2 text-right font-medium">결제</th>
              <th className="px-2 py-2 text-right font-medium">결제액</th>
              <th className="px-2 py-2 text-center font-medium">가입</th>
              <th className="px-2 py-2 text-center font-medium" title="쇼케이스(홈 디자인 갤러리) 활용 동의">
                쇼케이스
              </th>
              <th className="px-2 py-2 text-center font-medium">조정</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <RowGroup
                key={r.user_id}
                row={r}
                consentTableReady={consentTableReady}
                onConsentChanged={() => router.refresh()}
                open={editing === r.user_id}
                onToggle={() => setEditing((cur) => (cur === r.user_id ? null : r.user_id))}
                onDone={() => {
                  setEditing(null);
                  router.refresh();
                }}
              />
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-xs text-[#8B7355]">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowGroup({
  row,
  open,
  onToggle,
  onDone,
  consentTableReady,
  onConsentChanged,
}: {
  row: AdminUserRow;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
  consentTableReady: boolean;
  onConsentChanged: () => void;
}) {
  return (
    <>
      <tr className="border-t border-[#E8DCC9]">
        <td className="max-w-[240px] truncate px-3 py-2 text-[#3D2E1F]">
          {row.email ?? <span className="text-[#B0A088]">(이메일 없음)</span>}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{row.publish_balance}</td>
        <td className="px-2 py-2 text-right tabular-nums">{row.archive_balance}</td>
        <td className="px-2 py-2 text-right tabular-nums">{row.snap_balance}</td>
        <td className="px-2 py-2 text-right tabular-nums text-[#8B7355]">{row.order_count}</td>
        <td className="px-2 py-2 text-right tabular-nums text-[#8B7355]">
          {row.order_amount.toLocaleString()}원
        </td>
        <td className="px-2 py-2 text-center text-[11px] text-[#8B7355]">
          {fmtDate(row.created_at)}
        </td>
        <td className="px-2 py-2 text-center">
          <ShowcaseConsentCell
            row={row}
            ready={consentTableReady}
            onChanged={onConsentChanged}
          />
        </td>
        <td className="px-2 py-2 text-center">
          <button
            type="button"
            onClick={onToggle}
            className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
              open
                ? 'border-[#3D2E1F] bg-[#3D2E1F] text-white'
                : 'border-[#D4C5B0] bg-white text-[#5C4633] hover:border-[#8B7355]'
            }`}
          >
            {open ? '닫기' : '조정'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-[#FAF7F2]">
          <td colSpan={9} className="px-3 py-3">
            <AdjustForm row={row} onDone={onDone} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * 쇼케이스 동의 셀 — 운영자 추가 여부 토글 + 다른 경로(이벤트/알림장)로 동의한 경우 표시.
 */
function ShowcaseConsentCell({
  row,
  ready,
  onChanged,
}: {
  row: AdminUserRow;
  ready: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const other = [row.showcaseViaEvent && '이벤트', row.showcaseViaInvitation && '알림장']
    .filter(Boolean)
    .join('·');

  const toggle = () => {
    const next = !row.showcaseAdded;
    if (
      next &&
      !window.confirm(
        `${row.email ?? row.user_id} 계정을 쇼케이스 활용 동의로 추가할까요?\n이 계정의 발행 알림장이 사진 있는 디자인까지 showcase 후보에 포함됩니다.`,
      )
    )
      return;
    setErr(null);
    startTransition(async () => {
      const res = await setShowcaseConsentUser({ userId: row.user_id, consent: next });
      if (!res.ok) setErr(res.error ?? '실패');
      else onChanged();
    });
  };

  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending || !ready}
        title={ready ? undefined : 'DB 마이그레이션 079 적용 후 사용할 수 있습니다'}
        className={`whitespace-nowrap rounded border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50 ${
          row.showcaseAdded
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : 'border-[#D4C5B0] bg-white text-[#5C4633] hover:border-[#8B7355]'
        }`}
      >
        {pending ? '…' : row.showcaseAdded ? '동의됨 ✓' : '동의 추가'}
      </button>
      {other && <span className="text-[10px] text-[#B0A088]">{other} 동의</span>}
      {err && <span className="max-w-[120px] text-[10px] text-red-600">{err}</span>}
    </div>
  );
}

function AdjustForm({ row, onDone }: { row: AdminUserRow; onDone: () => void }) {
  const [kind, setKind] = useState<CreditKind>('publish');
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = (signMul: 1 | -1) => {
    const n = parseInt(delta, 10);
    if (!Number.isInteger(n) || n <= 0) {
      setMsg({ kind: 'err', text: '1 이상의 정수를 입력하세요' });
      return;
    }
    setMsg(null);
    startTransition(async () => {
      const res = await adjustCredits({
        userId: row.user_id,
        kind,
        delta: n * signMul,
        note: note.trim() || undefined,
      });
      if (res.ok) {
        setMsg({
          kind: 'ok',
          text: `${KIND_LABEL[kind]} ${signMul > 0 ? '지급' : '회수'} 완료 · 잔액 ${res.balance}`,
        });
        setDelta('');
        setNote('');
        // 잠깐 메시지 보여준 뒤 새로고침은 부모에서. 여기선 즉시 refresh 트리거.
        onDone();
      } else {
        setMsg({ kind: 'err', text: res.error ?? '실패' });
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[#8B7355]">종류</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CreditKind)}
            className="rounded-md border border-[#D4C5B0] bg-white px-2 py-1.5 text-xs text-[#3D2E1F] focus:border-[#8B7355] focus:outline-none"
          >
            <option value="publish">발행권 (현재 {row.publish_balance})</option>
            <option value="archive">영구소장 (현재 {row.archive_balance})</option>
            <option value="snap">스냅 (현재 {row.snap_balance})</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-[#8B7355]">수량</span>
          <input
            value={delta}
            onChange={(e) => setDelta(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            placeholder="예: 5"
            className="w-24 rounded-md border border-[#D4C5B0] bg-white px-2 py-1.5 text-xs text-[#3D2E1F] placeholder:text-[#B0A088] focus:border-[#8B7355] focus:outline-none"
          />
        </label>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1">
          <span className="text-[10px] text-[#8B7355]">메모 (선택)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 이벤트 보상 / CS 보전"
            className="w-full rounded-md border border-[#D4C5B0] bg-white px-2 py-1.5 text-xs text-[#3D2E1F] placeholder:text-[#B0A088] focus:border-[#8B7355] focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => apply(1)}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          지급 +
        </button>
        <button
          type="button"
          onClick={() => apply(-1)}
          disabled={pending}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
        >
          회수 −
        </button>
      </div>
      {msg && (
        <p
          className={`text-[11px] ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}
        >
          {msg.text}
        </p>
      )}
      <p className="text-[10px] text-[#8B7355]">
        user_id: <code className="text-[#5C4633]">{row.user_id}</code>
      </p>
    </div>
  );
}
