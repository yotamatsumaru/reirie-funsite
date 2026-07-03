import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { PackForm } from '../pack-form';
import { requireSuperAdmin } from '@/auth';

export const dynamic = 'force-dynamic';

export default async function EditRewardPointPackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;
  const pack = await prisma.rewardPointPack.findUnique({ where: { id } });
  if (!pack) notFound();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/super-admin/rewards/packs" className="text-xs text-slate-500 hover:underline">
          ← 特典ポイントパック一覧
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">{pack.name}</h1>
      </div>
      <PackForm
        mode="edit"
        id={pack.id}
        initial={{
          name: pack.name,
          points: pack.points,
          priceJpy: pack.priceJpy,
          isActive: pack.isActive,
          sortOrder: pack.sortOrder,
        }}
      />
    </div>
  );
}
