/**
 * 会員ランクのバッジ表示。
 * ファン側 (現在ランクのみ表示) でも管理側でも共通で使う純粋な表示コンポーネント。
 * 昇格条件はここには一切含めない (非公開)。
 *
 * デザイン方針:
 *  - 絵文字 (🥉🥈…) は OS/フォント依存で見た目がバラつき、サイトの
 *    マゼンタ/ラベンダー基調のトーンと調和しないため使用しない。
 *  - 全ランク共通の幾何学的な「メダル」SVG を用い、ランクごとに
 *    金属光沢グラデーションで色分けする (統一感のあるアイコン体系)。
 *  - バッジ本体はサイト共通の pill + ring-inset スタイルに合わせる。
 */
import { MEMBER_RANK_LABELS, type MemberRank } from '@idol/shared';

/** バッジ (pill) の配色。サイトの他バッジと同じ ring-inset トーンに揃える。 */
const RANK_STYLE: Record<MemberRank, string> = {
  BRONZE: 'bg-amber-50 text-amber-800 ring-amber-200',
  SILVER: 'bg-slate-100 text-slate-700 ring-slate-300',
  GOLD: 'bg-yellow-50 text-yellow-800 ring-yellow-300',
  PLATINUM: 'bg-cyan-50 text-cyan-800 ring-cyan-200',
  DIAMOND: 'bg-violet-50 text-violet-800 ring-violet-200',
};

/** メダル SVG の金属光沢グラデーション (明→暗)。ランクごとの 2 色。 */
const RANK_METAL: Record<MemberRank, { light: string; base: string; dark: string; edge: string }> =
  {
    BRONZE: { light: '#e9b489', base: '#c47f4a', dark: '#8a5222', edge: '#6d3f18' },
    SILVER: { light: '#f1f5f9', base: '#c3ccd6', dark: '#8b96a3', edge: '#6b7480' },
    GOLD: { light: '#fde68a', base: '#f0b429', dark: '#b7791f', edge: '#8a5a12' },
    PLATINUM: { light: '#d8f3f7', base: '#8fd4de', dark: '#4f9aa6', edge: '#3a7580' },
    DIAMOND: { light: '#ede9fe', base: '#b8a6f0', dark: '#7c5cd6', edge: '#5b3fb0' },
  };

/**
 * ランク共通のメダルアイコン。
 * 円形メダル + 中央のスター (ダイヤのみ宝石カット) を金属グラデで描く。
 */
function RankMedal({ rank, px }: { rank: MemberRank; px: number }) {
  const c = RANK_METAL[rank];
  const gid = `rank-metal-${rank}`;
  const isGem = rank === 'DIAMOND';
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      aria-hidden
      className="flex-shrink-0"
      style={{ filter: 'drop-shadow(0 1px 0.5px rgba(0,0,0,0.15))' }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.light} />
          <stop offset="55%" stopColor={c.base} />
          <stop offset="100%" stopColor={c.dark} />
        </linearGradient>
      </defs>

      {isGem ? (
        // ダイヤ: 宝石カット (ブリリアント風の多面体)
        <g stroke={c.edge} strokeWidth="0.6" strokeLinejoin="round">
          <path d="M6 4h12l3 4-9 12L3 8z" fill={`url(#${gid})`} />
          <path d="M6 4l3 4h6l3-4M3 8h18M9 8l3 12 3-12" fill="none" opacity="0.55" />
          <path d="M9 8l-3 0m9 0l3 0" fill="none" opacity="0.35" />
        </g>
      ) : (
        // ブロンズ〜プラチナ: 円形メダル + 中央スター + リボン風の脚
        <g stroke={c.edge} strokeWidth="0.6" strokeLinejoin="round">
          {/* リボンの脚 */}
          <path d="M9 13l-2.2 6 2.6-1.4L12 20l-3-7zM15 13l2.2 6-2.6-1.4L12 20l3-7z" fill={c.dark} />
          {/* メダル円盤 */}
          <circle cx="12" cy="9" r="6.4" fill={`url(#${gid})`} />
          {/* 内側リング */}
          <circle cx="12" cy="9" r="4.7" fill="none" stroke={c.edge} strokeWidth="0.5" opacity="0.4" />
          {/* 中央スター */}
          <path
            d="M12 5.6l1.15 2.33 2.57.37-1.86 1.82.44 2.56L12 11.4l-2.3 1.21.44-2.56-1.86-1.82 2.57-.37z"
            fill={c.light}
            stroke={c.edge}
            strokeWidth="0.35"
          />
        </g>
      )}
    </svg>
  );
}

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
  const iconPx = size === 'sm' ? 14 : 18;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${RANK_STYLE[rank]} ${pad}`}
    >
      {showIcon ? <RankMedal rank={rank} px={iconPx} /> : null}
      {MEMBER_RANK_LABELS[rank]}
    </span>
  );
}
