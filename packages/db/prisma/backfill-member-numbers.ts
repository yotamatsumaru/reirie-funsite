/**
 * 既存ユーザーへ会員番号 (RR-000123) を登録順に付与するバックフィルスクリプト。
 *
 * - 会員番号未付与のユーザーを createdAt 昇順で採番する。
 * - MemberCounter (id=1) を「最後に払い出した番号の次」へ更新し、
 *   以後アプリ側の ensureMemberNumber が続きから採番できるようにする。
 * - 冪等: 既に番号を持つユーザーはスキップする。再実行しても安全。
 *
 * 実行: pnpm --filter @idol/db backfill:member-numbers
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PREFIX = 'RR-';
const DIGITS = 6;

function formatMemberNumber(seq: number): string {
  return `${PREFIX}${String(seq).padStart(DIGITS, '0')}`;
}

async function main() {
  // 既存の最大採番値を把握 (member_counter 優先、無ければ既存番号から推定)
  const counter = await prisma.memberCounter.findUnique({ where: { id: 1 } });
  let nextSeq = counter?.next ?? 1;

  // 既存の会員番号から最大値を求め、counter とズレていれば大きい方を採用
  const existing = await prisma.user.findMany({
    where: { memberNumber: { not: null } },
    select: { memberNumber: true },
  });
  for (const u of existing) {
    const m = u.memberNumber?.match(/^RR-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10) + 1;
      if (n > nextSeq) nextSeq = n;
    }
  }

  const targets = await prisma.user.findMany({
    where: { memberNumber: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  });

  console.log(`[backfill] 未付与ユーザー: ${targets.length} 件 / 次の番号: ${nextSeq}`);

  let assigned = 0;
  for (const u of targets) {
    const number = formatMemberNumber(nextSeq);
    try {
      await prisma.user.update({
        where: { id: u.id },
        data: { memberNumber: number },
      });
      nextSeq += 1;
      assigned += 1;
    } catch (e) {
      // 一意制約衝突など (既に手動付与されていた場合) はスキップして次へ
      console.warn(`[backfill] スキップ ${u.email}:`, (e as Error).message);
    }
  }

  // カウンターを最新の next に更新 (upsert)
  await prisma.memberCounter.upsert({
    where: { id: 1 },
    create: { id: 1, next: nextSeq },
    update: { next: nextSeq },
  });

  console.log(`[backfill] 完了: ${assigned} 件付与 / counter.next = ${nextSeq}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
