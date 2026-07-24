/**
 * サブスクリプション反映の診断スクリプト
 *
 * 目的: Stripe Webhook は 200 で成功しているのに マイページ が FREE のままの原因を切り分ける。
 *   1) Subscription 行が実際に DB に書かれているか
 *   2) その行が正しい User に紐付いているか (userId / email)
 *   3) status が ACTIVE 系か (auth.ts は ACTIVE/TRIALING/PAST_DUE のみ拾う)
 *   4) planType が STANDARD/PREMIUM になっているか
 *
 * 使い方 (プロジェクトルート, PowerShell):
 *   # 本番 RDS を見るには DATABASE_URL を Lambda と同じ値にする
 *   $env:DATABASE_URL = "postgresql://idol_admin:...@idol-fansite-dev-rds...:5432/idol_fansite?schema=public&sslmode=require"
 *   node functions/stripe-webhook/scripts/check-subscription.cjs [email]
 *
 *   email を省略すると直近のサブスクを新しい順に表示。
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const emailArg = process.argv[2];
  const prisma = new PrismaClient();
  try {
    console.log('=== 直近の Subscription (新しい順, 最大10件) ===');
    const subs = await prisma.subscription.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: { select: { id: true, email: true, displayName: true } } },
    });
    if (subs.length === 0) {
      console.log('  (Subscription 行が 1 件もありません → Webhook が user_not_found 等で書けていない)');
    }
    for (const s of subs) {
      console.log(
        `  - ${s.createdAt.toISOString()} plan=${s.planType} status=${s.status} ` +
          `interval=${s.billingInterval} price=${s.stripePriceId}\n` +
          `    user=${s.user?.email ?? '(未紐付け?)'} userId=${s.userId} ` +
          `subId=${s.stripeSubscriptionId} customer=${s.stripeCustomerId}`,
      );
    }

    if (emailArg) {
      console.log(`\n=== ユーザー ${emailArg} の状態 ===`);
      const u = await prisma.user.findUnique({
        where: { email: emailArg },
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      if (!u) {
        console.log('  ユーザーが見つかりません (email 不一致)');
      } else {
        console.log(`  id=${u.id} displayName=${u.displayName} stripeCustomerId=${u.stripeCustomerId ?? '(なし)'}`);
        console.log(`  subscriptions: ${u.subscriptions.length} 件`);
        const active = u.subscriptions.filter((s) =>
          ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(s.status),
        );
        console.log(`  うち auth.ts が拾う (ACTIVE/TRIALING/PAST_DUE): ${active.length} 件`);
        const derivedPlan = active[0]?.planType ?? 'FREE';
        console.log(`  → auth.ts が導出する plan = ${derivedPlan}`);
        if (derivedPlan !== 'FREE') {
          console.log(
            '  ✅ DB 上は正しく反映済み。マイページが FREE のままなら JWT キャッシュ (最大5分) が原因。' +
              ' 再ログイン or session.update() で反映される。',
          );
        } else if (u.subscriptions.length > 0) {
          console.log(
            '  ⚠️ Subscription はあるが status が非 ACTIVE。Stripe 側の状態を確認 (incomplete 等)。',
          );
        } else {
          console.log(
            '  ❌ このユーザーに Subscription が無い。Webhook が別ユーザー/customer に紐付けた可能性。' +
              ' 上の一覧で該当 customer の user を確認。',
          );
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
