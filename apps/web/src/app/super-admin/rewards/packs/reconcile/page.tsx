/**
 * /super-admin/rewards/packs/reconcile — Pui パック購入の未付与是正 (再照合)
 *
 * 決済は成功したが Pui が付与されていない購入を Stripe で照合し、
 * 支払い済みのものだけ Pui を付与する救済ツール。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperAdminView } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { ReconcileClient } from './reconcile-client';
import { SuperAdminWriteGate } from '@/components/admin/SuperAdminReadOnly';

export const metadata: Metadata = { title: 'Pui 付与の再照合' };
export const dynamic = 'force-dynamic';

export default async function ReconcilePage() {
  await requireSuperAdminView();

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/super-admin/rewards/packs"
          className="text-xs text-slate-500 hover:underline"
        >
          ← Pui パック管理へ戻る
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">
          Pui 付与の再照合（未付与の救済）
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          決済は成功したのに Pui が付与されていない購入を Stripe と照合し、
          「支払い済み」のものだけに Pui を付与します。
          冪等処理のため、既に付与済みのものが二重付与されることはありません。
        </p>
      </div>

      <Card>
        <CardBody className="space-y-2 text-sm text-slate-600">
          <p className="font-semibold text-slate-700">使い方</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>「未付与を検出する」を押すと、未確定の購入を Stripe で照合して一覧表示します（この時点では付与しません）。</li>
            <li>「支払い済み」と表示された行が付与対象です。</li>
            <li>「支払い済み ◯件に Pui を付与する」を押すと、実際に Pui を付与します。</li>
          </ol>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <SuperAdminWriteGate label="再照合はスーパー管理者のみ実行できます">
            <ReconcileClient />
          </SuperAdminWriteGate>
        </CardBody>
      </Card>
    </div>
  );
}
