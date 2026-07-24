'use client';

/**
 * コンテンツ / グッズ セクションの公開設定 UI (SUPER_ADMIN)。
 *
 * - OFF にすると /contents, /products (一覧・詳細ページ、および公開API) が
 *   一般ユーザーには 404 相当で非表示になる。管理画面 (/admin/*) は対象外。
 * - GET/PATCH /api/super-admin/site-visibility で永続化 (AppSetting: site.sectionVisibility)。
 * - 切り替えは即時反映 (サーバ再起動不要)。
 */
import { useState } from 'react';
import type { SiteSectionVisibility } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

type Props = {
  initialVisibility: SiteSectionVisibility;
};

const ITEMS: { key: keyof SiteSectionVisibility; label: string; description: string }[] = [
  {
    key: 'contentsVisible',
    label: 'コンテンツ',
    description: 'ブログ・ギャラリーなどの /contents セクションを一般公開するか',
  },
  {
    key: 'productsVisible',
    label: 'グッズ',
    description: 'ECショップ (商品一覧・詳細・カート) の /products セクションを一般公開するか',
  },
  {
    key: 'dmVisible',
    label: 'REIRIE への DM',
    description: '会員向け DM 送信機能 (/me/dm) を利用可能にするか',
  },
];

export function SiteVisibilityClient({ initialVisibility }: Props) {
  const [visibility, setVisibility] = useState<SiteSectionVisibility>(initialVisibility);
  const [saving, setSaving] = useState<string | null>(null);

  async function toggle(key: keyof SiteSectionVisibility) {
    const nextValue = !visibility[key];
    setSaving(key);
    try {
      const res = await fetch('/api/super-admin/site-visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: nextValue }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '保存に失敗しました');
      }
      setVisibility(json.visibility as SiteSectionVisibility);
      const label = ITEMS.find((i) => i.key === key)?.label ?? key;
      toast.success(
        `${label} セクションを${nextValue ? '公開' : '非公開'}にしました`,
        nextValue ? '公開に切り替え' : '⚠️ 非公開に切り替え',
      );
    } catch (e) {
      toast.error((e as Error).message, '切り替えエラー');
    } finally {
      setSaving(null);
    }
  }

  const anyHidden = ITEMS.some((i) => !visibility[i.key]);

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              コンテンツ / グッズ / DM の公開設定
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              OFF にすると該当セクションのページ・APIが一般ユーザーから見えなくなります
              (ナビゲーションからも非表示)。管理画面 (/admin) からの編集は引き続き可能です。
              切り替えは即時反映されます (サーバ再起動不要)。
            </p>
          </div>
          {anyHidden && (
            <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              一部非公開中
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {ITEMS.map((item) => {
          const isVisible = visibility[item.key];
          const isSaving = saving === item.key;
          return (
            <div
              key={item.key}
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`text-xs font-semibold ${
                    isVisible ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {isSaving ? '切り替え中…' : isVisible ? '公開中' : '非公開'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isVisible}
                  onClick={() => toggle(item.key)}
                  disabled={isSaving}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    isVisible ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isVisible ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
