import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { UpdateProfileSchema } from '@idol/shared';
import { auth, requireSession } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      ticketLinks: true,
    },
  });
  if (!user) throw errors.notFound();
  return NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    fullName: user.fullName,
    furigana: user.furigana,
    phone: user.phone,
    birthDate: user.birthDate,
    postalCode: user.postalCode,
    prefecture: user.prefecture,
    addressLine1: user.addressLine1,
    addressLine2: user.addressLine2,
    avatarUrl: user.avatarUrl,
    plan: session.user.plan,
    role: user.role,
    marketingOptIn: user.marketingOptIn,
    subscription: user.subscriptions[0] ?? null,
    ticketLink: user.ticketLinks[0] ?? null,
    createdAt: user.createdAt,
  });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSession();
  const body = await req.json();
  const input = UpdateProfileSchema.parse(body);
  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...input,
      birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
    },
  });
  await logAudit({ userId: session.user.id, action: 'user.profile.update' });
  return NextResponse.json({ message: '更新しました' });
});

export const DELETE = handle(async () => {
  const session = await requireSession();
  await prisma.user.update({
    where: { id: session.user.id },
    data: { deletedAt: new Date() },
  });
  await logAudit({ userId: session.user.id, action: 'user.delete' });
  return NextResponse.json({ message: '退会処理を受け付けました' });
});

// auth() の利用を保持するため (lint対策)
void auth;
