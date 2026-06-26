/**
 * 会員ランクのバッジ表示。
 * ファン側 (現在ランクのみ表示) でも管理側でも共通で使う純粋な表示コンポーネント。
 * 昇格条件はここには一切含めない (非公開)。
 */
import { MEMBER_RANK_LABELS, type MemberRank } from '@idol/shared';

const RANK_STYLE: Record<MemberRank, string> = {
  BRONZE: 'bg-amber-100 text-amber-800 ring-amber-300',
  SILVER: 'bg-slate-100 text-slate-700 ring-slate-300',
  GOLD: 'bg-yellow-100 text-yellow-800 ring-yellow-400',
  PLATINUM: 'bg-cyan-100 text-cyan-800 ring-cyan-300',
  DIAMOND: 'bg-violet-100 text-violet-800 ring-violet-300',
};

const RANK_ICON: Record<MemberRank, string> = {
  BRONZE: '🥉',
  SILVER: '🥈',
  GOLD: '🥇',
  PLATINUM: '💠',
  DIAMOND: '💎',
};

export function RankBadge({
  rank,
  size = 'md',
  showIcon = true,
}: {
  rank: MemberRank;
  size?: 'sm' | 'md';
  showIcon?: boolean;
}) {
  const pad = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset ${RANK_STYLE[rank]} ${pad}`}
    >
      {showIcon ? <span aria-hidden>{RANK_ICON[rank]}</span> : null}
      {MEMBER_RANK_LABELS[rank]}
    </span>
  );
}
