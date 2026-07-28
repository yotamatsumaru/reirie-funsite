/**
 * 会員ランクのバッジ表示。
 * ファン側 (現在ランクのみ表示) でも管理側でも共通で使う純粋な表示コンポーネント。
 * 昇格条件はここには一切含めない (非公開)。
 *
 * デザイン方針:
 *  - 絵文字 (🥉🥈…) は OS/フォント依存で見た目がバラつき、サイトの
 *    マゼンタ/ラベンダー基調のトーンと調和しないため使用しない。
 *  - 全ランク共通の上品な「宝石クレスト」SVG を用い、ランクごとに
 *    二層グラデーション + ハイライトで色分けする (統一感のあるアイコン体系)。
 *    ベースは八角形のジェムカット、上部にきらめき (sparkle) を重ねる。
 *  - バッジ本体はサイト共通の pill + ring-inset スタイルに合わせ、
 *    上位ランクほど彩度・深みが増すよう配色する (ブロンズは主張しすぎない上品な色)。
 */
import { MEMBER_RANK_LABELS, type MemberRank } from '@idol/shared';

/** バッジ (pill) の配色。サイトの他バッジと同じ ring-inset トーンに揃える。 */
const RANK_STYLE: Record<MemberRank, string> = {
  BRONZE: 'bg-orange-50/80 text-amber-900 ring-amber-200/70',
  SILVER: 'bg-slate-50 text-slate-700 ring-slate-300/80',
  GOLD: 'bg-amber-50 text-amber-900 ring-amber-300/70',
  PLATINUM: 'bg-sky-50 text-sky-900 ring-sky-200/80',
  DIAMOND: 'bg-brand-50 text-brand-800 ring-brand-200',
};

/**
 * ジェムクレストの配色。
 *  - light : 上面のハイライト
 *  - base  : 主面
 *  - dark  : 下面 / 陰影
 *  - edge  : 縁取り (輪郭線)
 *  - spark : きらめきの色
 * サイトのマゼンタ/ラベンダー基調に馴染むよう、彩度は控えめの上品なトーンにする。
 */
const RANK_GEM: Record<
  MemberRank,
  { light: string; base: string; dark: string; edge: string; spark: string }
> = {
  // ブロンズ: くすんだローズブロンズ (オレンジすぎず、マゼンタ寄りの温かみ)
  BRONZE: { light: '#e7bfa3', base: '#c58a6a', dark: '#9a6045', edge: '#7c4b34', spark: '#fbeade' },
  SILVER: { light: '#f4f7fa', base: '#cdd5de', dark: '#9aa4b1', edge: '#78828f', spark: '#ffffff' },
  GOLD: { light: '#fbe6a0', base: '#eabd4e', dark: '#bd8a24', edge: '#946a18', spark: '#fff7db' },
  PLATINUM: { light: '#dff1f5', base: '#a7d3dd', dark: '#5f9aa6', edge: '#477580', spark: '#f4fdff' },
  // ダイヤ: サイトのポイントカラー (ラベンダー〜マゼンタ) に寄せた宝石トーン
  DIAMOND: { light: '#efe7fb', base: '#c3a9ec', dark: '#8a63c9', edge: '#6a45a6', spark: '#fbf7ff' },
};

/**
 * ランク共通の「ジェムクレスト」アイコン。
 * 八角形カットの宝石 + 上面ファセット + きらめきで、
 * 上品で統一感のあるエンブレムを金属/宝石グラデで描く。
 */
function RankGem({ rank, px }: { rank: MemberRank; px: number }) {
  const c = RANK_GEM[rank];
  const gid = `rank-gem-${rank}`;
  const fid = `rank-face-${rank}`;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      aria-hidden
      className="flex-shrink-0"
      style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.18))' }}
    >
      <defs>
        {/* 宝石全体の縦グラデ (上=明るい / 下=陰) */}
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.light} />
          <stop offset="48%" stopColor={c.base} />
          <stop offset="100%" stopColor={c.dark} />
        </linearGradient>
        {/* 上面ファセットのハイライト */}
        <linearGradient id={fid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.light} stopOpacity="0.95" />
          <stop offset="100%" stopColor={c.base} stopOpacity="0.15" />
        </linearGradient>
      </defs>

      <g stroke={c.edge} strokeWidth="0.8" strokeLinejoin="round" strokeLinecap="round">
        {/* 八角形カットのジェム本体 */}
        <path
          d="M8 3.2h8l4.8 4.8v8L16 20.8H8L3.2 16v-8z"
          fill={`url(#${gid})`}
        />
        {/* 上面ファセット (テーブル面) */}
        <path
          d="M8 3.2h8l2.6 4.4H5.4z"
          fill={`url(#${fid})`}
          stroke={c.edge}
          strokeWidth="0.55"
          strokeOpacity="0.7"
        />
        {/* 中央の縦ファセット線 (光の反射) */}
        <path
          d="M12 7.6v11M5.4 7.6h13.2"
          fill="none"
          stroke={c.edge}
          strokeWidth="0.55"
          strokeOpacity="0.6"
        />
        {/* 斜めファセット (下部の絞り) */}
        <path
          d="M5.4 7.6L12 20.8 18.6 7.6"
          fill="none"
          stroke={c.edge}
          strokeWidth="0.55"
          strokeOpacity="0.55"
        />
      </g>

      {/* きらめき (上面ファセット上の小さな四芒星)。
          縁に被らないよう内側 (テーブル面上) に配置し、宝石の輝きとして自然に見せる。 */}
      <path
        d="M15.4 5.1c.3.9.48 1.08 1.32 1.4-.84.32-1.02.5-1.32 1.4-.3-.9-.48-1.08-1.32-1.4.84-.32 1.02-.5 1.32-1.4z"
        fill={c.spark}
        opacity="0.98"
      />
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
  const pad = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm';
  const iconPx = size === 'sm' ? 15 : 18;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${RANK_STYLE[rank]} ${pad}`}
    >
      {showIcon ? <RankGem rank={rank} px={iconPx} /> : null}
      {MEMBER_RANK_LABELS[rank]}
    </span>
  );
}
