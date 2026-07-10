/**
 * 管理者用 シリアル発行 API
 *  - POST: 指定枚数のシリアルコードを一括発行 (重複しないようリトライ)
 *  - GET : このイベントの全シリアルを CSV でダウンロード
 *
 * CSV 形式 (UTF-8 BOM 付き):
 *   code_display,code_canonical,used,used_by,used_at,created_at
 *   ABCD-1234-EFGH,ABCD1234EFGH,no,,,2026-06-22T...
 */
import { NextResponse } from 'next/server';
import { Prisma, prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { IssueCallSerialsSchema } from '@idol/shared';
import { generateSerialCodeDisplay, toCanonicalSerialCode } from '@/lib/call-serial';
import { toCsv } from '@/lib/csv';

export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

// 既存シリアルとぶつかった場合のリトライ上限
const MAX_RETRY_PER_CODE = 5;

export const POST = handle(async (req, ctx: Ctx) => {
  await requireCapability('CALL');
  const { id: eventId } = await ctx.params;
  const body = await req.json();
  const input = IssueCallSerialsSchema.parse(body);

  // イベント存在確認
  const event = await prisma.callEvent.findUnique({ where: { id: eventId } });
  if (!event) throw errors.notFound('イベントが見つかりません');

  // CANCELED / ENDED イベントには追加発行不可
  if (event.status === 'CANCELED' || event.status === 'ENDED') {
    throw errors.badRequest('終了またはキャンセル済みのイベントには発行できません');
  }

  const createdDisplay: { id: string; display: string; canonical: string }[] = [];

  for (let i = 0; i < input.count; i++) {
    let inserted = false;
    let lastErr: unknown;
    for (let r = 0; r < MAX_RETRY_PER_CODE; r++) {
      const display = generateSerialCodeDisplay();
      const canonical = toCanonicalSerialCode(display);
      try {
        const row = await prisma.callSerial.create({
          data: { eventId, code: canonical },
          select: { id: true },
        });
        createdDisplay.push({ id: row.id, display, canonical });
        inserted = true;
        break;
      } catch (err) {
        // P2002 = unique violation。ハッシュ衝突なのでリトライ
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    if (!inserted) {
      // 規模的にここに来ることは事実上ないが念のため
      throw errors.internal(`シリアル生成リトライ上限超過: ${String(lastErr)}`);
    }
  }

  return NextResponse.json(
    {
      issued: createdDisplay.length,
      serials: createdDisplay,
    },
    { status: 201 },
  );
});

export const GET = handle(async (_req, ctx: Ctx) => {
  await requireCapability('CALL');
  const { id: eventId } = await ctx.params;

  const event = await prisma.callEvent.findUnique({
    where: { id: eventId },
    select: { id: true, title: true },
  });
  if (!event) throw errors.notFound('イベントが見つかりません');

  const serials = await prisma.callSerial.findMany({
    where: { eventId },
    orderBy: { createdAt: 'asc' },
    include: { usedBy: { select: { email: true, displayName: true } } },
  });

  const rows: string[][] = [
    ['code_canonical', 'used', 'used_by_email', 'used_by_name', 'used_at', 'created_at'],
  ];
  for (const s of serials) {
    rows.push([
      s.code,
      s.usedById ? 'yes' : 'no',
      s.usedBy?.email ?? '',
      s.usedBy?.displayName ?? '',
      s.usedAt ? s.usedAt.toISOString() : '',
      s.createdAt.toISOString(),
    ]);
  }

  // UTF-8 BOM 付きで Excel での文字化けを回避
  const body = toCsv(rows);
  const filename = `call-serials-${event.id}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});
