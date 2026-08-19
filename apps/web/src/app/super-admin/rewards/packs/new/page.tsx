import type { Metadata } from 'next';
import { PackForm } from '../pack-form';
import { requireSuperAdminView } from '@/auth';
import { SuperAdminWriteGate } from '@/components/admin/SuperAdminReadOnly';

export const metadata: Metadata = { title: '特典ポイントパック新規作成' };
export const dynamic = 'force-dynamic';

export default async function NewRewardPointPackPage() {
  await requireSuperAdminView();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">特典ポイントパック新規作成</h1>
      <SuperAdminWriteGate label="パックの作成はスーパー管理者のみ実行できます">
        <PackForm mode="create" />
      </SuperAdminWriteGate>
    </div>
  );
}
