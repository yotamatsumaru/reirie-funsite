import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { prisma } from '@idol/db';
import {
  PLAN_LABELS,
  SOCIAL_PLATFORMS,
  jstDateKey,
  previousJstDateKey,
  type PlanTypeLiteral,
} from '@idol/shared';
import { auth } from '@/auth';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { RankBadge } from '@/components/membership/RankBadge';
import { ensureMemberNumber } from '@/lib/points';
import { getPuiRates } from '@/lib/app-setting';
import { getMemberRank } from '@/lib/membership-rank';
import { env } from '@/lib/env';
import { PointActions } from './point-actions';

export const metadata: Metadata = { title: '会員カード' };
export const dynamic = 'force-dynamic';

// プランごとのカードデザイン (グラデーション)
const CARD_THEME: Record<PlanTypeLiteral, { gradient: string; rank: string; accent: string }> = {
  FREE: {
    gradient: 'from-slate-600 via-slate-700 to-slate-800',
    rank: 'REGULAR',
    accent: 'text-slate-300',
  },
  STANDARD: {
    gradient: 'from-sky-500 via-blue-600 to-indigo-700',
    rank: 'STANDARD',
    accent: 'text-sky-100',
  },
  PREMIUM: {
    gradient: 'from-amber-400 via-pink-500 to-fuchsia-600',
    rank: 'PREMIUM',
    accent: 'text-amber-50',
  },
};

export default async function MemberCardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/card');

  const userId = session.user.id;
  const plan = session.user.plan as PlanTypeLiteral;

  // 会員番号を採番 (未付与なら)
  const memberNumber = await ensureMemberNumber(userId);

  const today = jstDateKey();
  // 会員ランク (ブロンズ〜ダイヤ)。昇格条件は非公開のため、現在ランクのみ取得する。
  const { rank: memberRank } = await getMemberRank(userId);
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

  const theme = CARD_THEME[plan];
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
    color: { dark: '#0f172a', light: '#ffffff' },
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

      {/* デジタル会員カード */}
      <div
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${theme.gradient} p-6 text-white shadow-xl`}
      >
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-12 -left-6 h-32 w-32 rounded-full bg-white/10" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-widest ${theme.accent}`}>
              Reirie Fan Club
            </p>
            <p className="mt-1 text-lg font-bold">{theme.rank} MEMBER</p>
            <div className="mt-2">
              <RankBadge rank={memberRank} size="sm" />
            </div>
          </div>
          <div className="shrink-0 rounded-lg bg-white p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="会員QRコード" className="h-20 w-20" />
          </div>
        </div>

        <div className="relative mt-8">
          <p className={`text-xs ${theme.accent}`}>会員番号</p>
          <p className="font-mono text-2xl font-bold tracking-wider">{memberNumber}</p>
        </div>

        <div className="relative mt-4 flex items-end justify-between">
          <div className="min-w-0">
            <p className={`text-xs ${theme.accent}`}>お名前</p>
            <p className="truncate text-base font-semibold">
              {user?.displayName ?? 'ファン'} 様
            </p>
            <p className={`mt-2 text-xs ${theme.accent}`}>
              加入日 {new Date(joinedAt).toLocaleDateString('ja-JP')}
            </p>
          </div>
          <div className="text-right">
            <p className={`text-xs ${theme.accent}`}>保有ポイント</p>
            <p className="text-2xl font-bold">
              {points.toLocaleString()}
              <span className="ml-1 text-sm font-normal">pt</span>
            </p>
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
