/**
 * /super-admin/settings — システム設定画面
 *
 * メンテナンスモード、機能ON/OFF、価格設定などをカテゴリ別に表示・編集。
 * デモモードでは demo-store にメモリ保存。
 */
import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { listSettings } from '@/lib/demo-store';
import { requireSuperAdmin } from '@/auth';
import { listSiteImages } from '@/lib/site-image';
import {
  getStripeMode,
  getStripeTestCredentials,
  getSiteSectionVisibility,
  getMaintenanceSetting,
} from '@/lib/app-setting';
import { isStripeTestCredentialsUsable } from '@idol/shared';
import { SettingRow } from './setting-row';
import { SiteImageClient, type SiteImageItem } from './site-image-client';
import { StripeModeClient } from './stripe-mode-client';
import { TotpSetupClient } from './totp-setup-client';
import { SiteVisibilityClient } from './site-visibility-client';
import { MaintenanceClient } from './maintenance-client';

export const metadata: Metadata = { title: 'システム設定 | Super Admin' };
export const dynamic = 'force-dynamic';

const CATEGORY_META: Record<
  'system' | 'features' | 'pricing',
  { label: string; description: string; icon: string }
> = {
  system: {
    label: 'システム',
    description: 'サイト全体の挙動を制御する基幹設定',
    icon: '⚙️',
  },
  features: {
    label: '機能フラグ',
    description: '個別機能の有効/無効を切り替え',
    icon: '🚦',
  },
  pricing: {
    label: '価格・送料・特典',
    description: '料金や月次プレゼント数などの数値設定',
    icon: '💴',
  },
};

export default async function SuperAdminSettingsPage() {
  const session = await requireSuperAdmin();

  const settings = listSettings();
  const siteImages = await listSiteImages();
  const stripeMode = await getStripeMode();
  const stripeTestCredentials = await getStripeTestCredentials();
  const stripeTestCredentialsUsable = isStripeTestCredentialsUsable(stripeTestCredentials);
  const siteSectionVisibility = await getSiteSectionVisibility();
  const maintenanceSetting = await getMaintenanceSetting();

  // TOTP (2段階認証) 現在の状態 — SUPER_ADMIN 自身の設定なので session.user.id で取得
  const currentUser = await prisma.user.findUnique({ where: { id: session.user.id } });
  const totpStatus = {
    enabled: !!currentUser?.totpEnabled,
    pendingSetup: !currentUser?.totpEnabled && !!currentUser?.totpSecret,
    verifiedAt: currentUser?.totpVerifiedAt?.toISOString() ?? null,
    backupCodesRemaining: Array.isArray(currentUser?.totpBackupCodes)
      ? currentUser.totpBackupCodes.length
      : 0,
  };
  const siteImageItems: SiteImageItem[] = siteImages.map((img) => ({
    slot: img.slot,
    url: img.url,
    fileName: img.fileName,
    sizeBytes: img.sizeBytes,
    updatedAt: img.updatedAt.toISOString(),
  }));
  const grouped = {
    system: settings.filter((s) => s.category === 'system'),
    features: settings.filter((s) => s.category === 'features'),
    pricing: settings.filter((s) => s.category === 'pricing'),
  };

  const disabledFeatures = settings.filter(
    (s) => s.category === 'features' && s.value === false,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">システム設定</h1>
        <p className="mt-1 text-sm text-slate-600">
          サイト全体の挙動を制御します。変更は即時反映されます。
        </p>
      </div>

      {/* サマリー */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">運用ステータス</p>
            <p className="mt-2 text-lg font-bold">
              {maintenanceSetting.enabled ? (
                <Badge tone="danger">メンテナンス中</Badge>
              ) : (
                <Badge tone="success">通常運用</Badge>
              )}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">設定項目数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {settings.length}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">無効中の機能</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {disabledFeatures.length}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
      </div>

      {/* メンテナンスモード (スーパー管理者以外の閲覧を一時停止する) */}
      <MaintenanceClient initialSetting={maintenanceSetting} />

      {/* コンテンツ / グッズ の公開設定 (オープン日調整などで一時的に非公開にする) */}
      <SiteVisibilityClient initialVisibility={siteSectionVisibility} />

      {/* サイト画像 (トップページのヒーロー画像等) */}
      <SiteImageClient initial={siteImageItems} />

      {/* Stripe 本番/テストモード切り替え */}
      <StripeModeClient
        initialMode={stripeMode}
        initialCredentials={stripeTestCredentials}
        initialUsable={stripeTestCredentialsUsable}
      />

      {/* TOTP (Google Authenticator) 2段階認証 — SUPER_ADMIN 限定 */}
      <TotpSetupClient initialStatus={totpStatus} />

      {/* カテゴリ別 */}
      {(['system', 'features', 'pricing'] as const).map((category) => {
        const meta = CATEGORY_META[category];
        const items = grouped[category];
        if (items.length === 0) return null;
        return (
          <Card key={category}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="text-xl">{meta.icon}</span>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {meta.label}
                  </h2>
                  <p className="text-xs text-slate-500">{meta.description}</p>
                </div>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              <ul className="divide-y divide-slate-200">
                {items.map((s) => (
                  <li
                    key={s.key}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          {s.label}
                        </p>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                          {s.key}
                        </code>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {s.description}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <SettingRow
                        settingKey={s.key}
                        value={s.value}
                        valueType={typeof s.value as 'boolean' | 'number' | 'string'}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        );
      })}

      <p className="text-xs text-slate-400">
        ※ デモモードではサーバ再起動で初期値にリセットされます。本番環境では永続化されます。
      </p>
    </div>
  );
}
