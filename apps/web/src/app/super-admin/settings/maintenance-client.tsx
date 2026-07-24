'use client';

/**
 * メンテナンスモード設定 UI (SUPER_ADMIN 限定)。
 *
 * - ON にすると、SUPER_ADMIN 以外のすべての訪問者はサイトを閲覧できなくなり、
 *   /maintenance の案内ページにリダイレクトされる (API は 503 を返す)。
 *   SUPER_ADMIN だけは通常どおり全ページを操作できる。
 * - GET/PATCH /api/super-admin/maintenance で永続化 (AppSetting: site.maintenance)。
 * - 切り替えは即時反映 (サーバ再起動不要)。案内文はメンテ画面に表示される。
 */
import { useState } from 'react';
import type { MaintenanceSetting } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

type Props = {
  initialSetting: MaintenanceSetting;
};

export function MaintenanceClient({ initialSetting }: Props) {
  const [setting, setSetting] = useState<MaintenanceSetting>(initialSetting);
  const [message, setMessage] = useState(initialSetting.message);
  const [saving, setSaving] = useState(false);

  async function patch(body: Partial<MaintenanceSetting>) {
    setSaving(true);
    try {
      const res = await fetch('/api/super-admin/maintenance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '保存に失敗しました');
      }
      return json.setting as MaintenanceSetting;
    } finally {
      setSaving(false);
    }
  }

  async function toggle() {
    if (saving) return;
    const next = !setting.enabled;
    try {
      const after = await patch({ enabled: next });
      setSetting(after);
      setMessage(after.message);
      if (next) {
        toast.success(
          'スーパー管理者以外はサイトを閲覧できなくなりました',
          '⚠️ メンテナンスモード ON',
        );
      } else {
        toast.success('通常運用に戻りました', 'メンテナンスモード OFF');
      }
    } catch (e) {
      toast.error((e as Error).message, '切り替えエラー');
    }
  }

  async function saveMessage() {
    if (saving) return;
    try {
      const after = await patch({ message });
      setSetting(after);
      toast.success('案内メッセージを保存しました', '保存完了');
    } catch (e) {
      toast.error((e as Error).message, '保存エラー');
    }
  }

  const enabled = setting.enabled;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              メンテナンスモード
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              ON にすると、<b>スーパー管理者以外のすべての訪問者</b>（未ログイン・一般会員・通常の管理者を含む）は
              サイトを閲覧できなくなり、メンテナンス案内ページが表示されます。
              スーパー管理者は通常どおり全ページを操作できるため、メンテ中の確認が可能です。
              切り替えは即時反映されます（サーバ再起動不要）。
            </p>
          </div>
          {enabled && (
            <span className="shrink-0 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800">
              メンテナンス中
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              メンテナンスモードを有効にする
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              スーパー管理者以外の閲覧を停止します
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span
              className={`text-xs font-semibold ${
                enabled ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {saving ? '切り替え中…' : enabled ? 'メンテ中' : '通常運用'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={toggle}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                enabled ? 'bg-rose-500' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-100 px-4 py-3">
          <label
            htmlFor="maintenance-message"
            className="text-sm font-semibold text-slate-800"
          >
            案内メッセージ（任意）
          </label>
          <p className="mt-0.5 text-xs text-slate-500">
            メンテナンス案内ページに表示する文言。空欄の場合は既定の文言が表示されます。
          </p>
          <textarea
            id="maintenance-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="例）本日 26:00 〜 28:00 までシステムメンテナンスを実施します。"
            className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">{message.length} / 500</span>
            <button
              type="button"
              onClick={saveMessage}
              disabled={saving || message === setting.message}
              className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              メッセージを保存
            </button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
