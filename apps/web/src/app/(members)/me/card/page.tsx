import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { prisma } from '@idol/db';
import {
  PLAN_LABELS,
  SOCIAL_PLATFORMS,
  CARD_BG_SLOT_BY_PLAN,
  jstDateKey,
  previousJstDateKey,
  formatJstDate,
  type PlanTypeLiteral,
} from '@idol/shared';
import { auth } from '@/auth';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { RankBadge } from '@/components/membership/RankBadge';
import { ensureMemberNumber } from '@/lib/points';
import { getLivePlan } from '@/lib/plan';
import { getSiteImageUrl } from '@/lib/site-image';
import { getPuiRates } from '@/lib/app-setting';
import { getMemberRank } from '@/lib/membership-rank';
import { env } from '@/lib/env';
import { PointActions } from './point-actions';

export const metadata: Metadata = { title: '会員カード' };
export const dynamic = 'force-dynamic';

// プランごとのカードデザイン。
// 背景はデザイン画像 (public/card/*.webp) を使用し、その上に会員情報を重ねる。
// 各カードの背景色に合わせて文字色 (text / accent) を調整する。
//  - FREE     : 水色背景 → 濃色文字
//  - STANDARD : マゼンタ背景 → 白文字
//  - PREMIUM  : ラベンダー背景 → 濃色 (深い紫) 文字
type CardTheme = {
  image: string;
  rank: string;
  text: string;
  accent: string;
  qrDark: string;
  // スクリムを敷かない代わりに、文字自体へ控えめな影を付けて可読性を確保する。
  // 濃色文字 (FREE/PREMIUM) は白系の影、白文字 (STANDARD) は黒系の影。
  textShadow: string;
};

const CARD_THEME: Record<PlanTypeLiteral, CardTheme> = {
  FREE: {
    image: '/card/free.webp',
    rank: 'REGULAR',
    text: 'text-slate-800',
    accent: 'text-slate-600',
    qrDark: '#1e293b',
    textShadow: '[text-shadow:0_1px_2px_rgba(255,255,255,0.55)]',
  },
  STANDARD: {
    image: '/card/standard.webp',
    rank: 'STANDARD',
    text: 'text-white',
    accent: 'text-white/80',
    qrDark: '#7a1d5a',
    textShadow: '[text-shadow:0_1px_3px_rgba(0,0,0,0.45)]',
  },
  PREMIUM: {
    image: '/card/premium.webp',
    rank: 'PREMIUM',
    text: 'text-slate-900',
    accent: 'text-slate-700/90',
    qrDark: '#3a2b4d',
    textShadow: '[text-shadow:0_1px_2px_rgba(255,255,255,0.55)]',
  },
};

export default async function MemberCardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/card');

  const userId = session.user.id;
  // プランは JWT (session.user.plan) が最大5分キャッシュされ古い値になり得るため、
  // DB の有効なサブスクリプションから直接取得して会員カードへ即時反映させる。
  const plan = await getLivePlan(userId);

  // 会員番号を採番 (未付与なら)
  const memberNumber = await ensureMemberNumber(userId);

  const today = jstDateKey();
  // 会員ランク (ブロンズ〜ダイヤ)。昇格条件は非公開のため、現在ランクのみ取得する。
  const { rank: memberRank } = await getMemberRank(userId);
  // 会員カード背景: スーパー管理者がアップロードした画像 (プランごと・16:10) を優先し、
  // 未設定ならコード同梱の初期デザイン (public/card/*.webp) にフォールバックする。
  const uploadedCardBg = await getSiteImageUrl(CARD_BG_SLOT_BY_PLAN[plan]);
  const [user, rates, loginGrant, todayGrant, shareGrants] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, email: true, pui: true, createdAt: true },
    }),
    getPuiRates(),
    // 連続日数算出のため前日の付与を見る
    prisma.loginBonusGrant.findUnique({
      where: { userId_date: { userId, date: previousJstDateKey(today) } },
      select: { streak: true },
    }),
    prisma.loginBonusGrant.findUnique({
      where: { userId_date: { userId, date: today } },
      select: { streak: true },
    }),
    prisma.socialShareGrant.findMany({
      where: { userId, date: today },
      select: { platform: true },
    }),
  ]);

  const theme = CARD_THEME[plan] ?? CARD_THEME.FREE;
  // アップロード画像があればそれを、無ければ初期デザインを背景に使う。
  const cardBgImage = uploadedCardBg ?? theme.image;
  const points = user?.pui ?? 0;
  const joinedAt = user?.createdAt ?? new Date();

  // 連続ログイン日数: 今日受取済みなら今日の streak、
  // 未受取なら「受け取れば到達する見込み」= 前日の streak + 1。
  const loginClaimedToday = Boolean(todayGrant);
  const displayStreak = todayGrant?.streak ?? (loginGrant?.streak ?? 0) + 1;

  // QR コードに会員番号を符号化 (受付などでの本人確認用)
  const qrPayload = `REIRIE-MEMBER:${memberNumber}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    margin: 1,
    width: 240,
    color: { dark: theme.qrDark, light: '#ffffff' },
  });

  const claimedSet = new Set(shareGrants.map((g) => g.platform));
  const shares = SOCIAL_PLATFORMS.map((p) => ({
    platform: p,
    claimedToday: claimedSet.has(p),
  }));

  const shareUrl = env.appBaseUrl;
  const shareText = '推しを応援しよう！Reirie ファンサイトはこちら';

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">会員カード</h1>
          <p className="mt-1 text-sm text-slate-500">あなたのデジタル会員証</p>
        </div>
        <Link href="/me" className="text-sm text-brand-600 hover:underline">
          マイページへ戻る
        </Link>
      </header>

      {/* デジタル会員カード (背景はデザイン画像) */}
      <div
        className={`relative aspect-[16/10] w-full overflow-hidden rounded-2xl shadow-xl ${theme.text}`}
      >
        {/* 背景画像 (管理画面アップロード優先 → 初期デザイン)。
            画像の色をそのまま見せるため、上に敷くスクリム (暗さ/明るさ加工) は無し。 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cardBgImage}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* 情報レイヤー。スクリムを外した分、文字自体に控えめな影を付けて可読性を確保する。 */}
        <div className={`relative flex h-full flex-col justify-between p-5 sm:p-6 ${theme.textShadow}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-widest sm:text-xs ${theme.accent}`}>
                Reirie Fan Club
              </p>
              <p className="mt-1 text-base font-bold sm:text-lg">{theme.rank} MEMBER</p>
              {/* 会員プラン (日本語) を明示。英語表記だけだとプランか会員ランクか分かりにくいため。 */}
              <p className={`mt-0.5 text-[11px] font-medium sm:text-sm ${theme.accent}`}>
                {PLAN_LABELS[plan]}プラン
              </p>
              <div className="mt-2">
                <RankBadge rank={memberRank} size="sm" />
              </div>
            </div>
            <div className="shrink-0 rounded-lg bg-white p-1.5 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="会員QRコード" className="h-16 w-16 sm:h-20 sm:w-20" />
            </div>
          </div>

          <div className="mt-2">
            <p className={`text-[10px] sm:text-xs ${theme.accent}`}>会員番号</p>
            <p className="font-mono text-xl font-bold tracking-wider sm:text-2xl">{memberNumber}</p>
          </div>

          <div className="mt-2 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-[10px] sm:text-xs ${theme.accent}`}>お名前</p>
              <p className="truncate text-sm font-semibold sm:text-base">
                {user?.displayName ?? 'ファン'} 様
              </p>
              <p className={`mt-1.5 text-[10px] sm:text-xs ${theme.accent}`}>
                加入日 {formatJstDate(joinedAt)}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-[10px] sm:text-xs ${theme.accent}`}>保有ポイント</p>
              <p className="text-xl font-bold sm:text-2xl">
                {points.toLocaleString()}
                <span className="ml-1 text-xs font-normal sm:text-sm">pt</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Pui 獲得アクション */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pui を貯める</h2>
            <Link href="/me/points" className="text-sm text-brand-600 hover:underline">
              Pui 履歴 →
            </Link>
          </div>
        </CardHeader>
        <CardBody>
          <PointActions
            shareUrl={shareUrl}
            shareText={shareText}
            loginClaimedToday={loginClaimedToday}
            loginStreak={displayStreak}
            shares={shares}
            rates={rates}
          />
        </CardBody>
      </Card>

      {/* 会員ランク */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">会員ランク</h2>
        </CardHeader>
        <CardBody className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-600">
              現在のランク: <RankBadge rank={memberRank} size="sm" />
            </p>
            <p className="mt-2 text-xs text-slate-500">
              ランクはログイン日数やお買い物のご利用状況に応じて自動で変わります。
              <br />
              さらにご利用いただくと、より上位のランクへアップグレードされます。
            </p>
          </div>
        </CardBody>
      </Card>

      {/* プラン案内 */}
      <Card>
        <CardBody className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-slate-600">
              ご利用プラン: <span className="font-semibold">{PLAN_LABELS[plan]}</span>
            </p>
            {plan !== 'PREMIUM' && (
              <p className="mt-1 text-xs text-slate-500">
                上位プランでカードデザインがアップグレードされます
              </p>
            )}
          </div>
          <Link
            href="/plans"
            className="shrink-0 rounded-md border border-brand-500 px-4 py-2 text-sm font-semibold text-brand-600 hover:bg-brand-50"
          >
            プランを見る
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
