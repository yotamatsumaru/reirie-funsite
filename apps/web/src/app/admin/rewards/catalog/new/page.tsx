import type { Metadata } from 'next';
import { CatalogForm } from '../catalog-form';
import { requireCapabilityPage } from '@/auth';

export const metadata: Metadata = { title: '景品新規作成' };
export const dynamic = 'force-dynamic';

export default async function NewCatalogItemPage() {
  await requireCapabilityPage('MERCH');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">景品新規作成</h1>
      <CatalogForm mode="create" />
    </div>
  );
}
