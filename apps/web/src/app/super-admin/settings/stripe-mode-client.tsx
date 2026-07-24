'use client';

/**
 * Stripe 本番/テストモード切り替え UI (SUPER_ADMIN)。
 *
 * - 通常は本番 (LIVE) キー (.env.production) で決済処理を行う。
 * - このトグルを TEST に切り替えると、下のフォームで入力したテストモード用の
 *   Secret Key / Webhook Secret / Price ID を使うようになる。切り替えは即時反映
 *   (サーバ再起動不要)。
 * - 対象は Web アプリの Checkout / Billing Portal / Webhook (/api/game/webhook) のみ。
 *   独立稼働の Stripe Webhook Lambda は対象外で、常に本番キー固定のまま動作する。
 *
 * GET/PATCH /api/super-admin/stripe-mode で永続化
 * (AppSetting: stripe.mode / stripe.testCredentials)。
 */
import { useState } from 'react';
import type { StripeMode, StripeTestCredentials } from '@idol/shared';
import { STRIPE_MODE_LABELS } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/stores/ui-store';

type Props = {
  initialMode: StripeMode;
  initialCredentials: StripeTestCredentials;
  initialUsable: boolean;
};

// 実際にアプリが利用するプランは STANDARD=月額 / PREMIUM=年額 の 2 パターンのみ
// (packages/shared/src/constants.ts の PLAN_BILLING_INTERVAL)。
// 使わない STANDARD/年額・PREMIUM/月額 の Price ID 欄はフォームに表示しない。
// (スキーマ側の priceStandardYearly / pricePremiumMonthly は互換のため残置し、空欄で保存される)
const CRED_FIELDS: { key: keyof StripeTestCredentials; label: string; placeholder: string }[] = [
  { key: 'secretKey', label: 'Secret Key (必須)', placeholder: 'sk_test_...' },
  { key: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_test_...' },
  { key: 'webhookSecret', label: 'Webhook Secret (必須)', placeholder: 'whsec_...' },
  { key: 'priceStandardMonthly', label: 'Price ID: スタンダード (月額)', placeholder: 'price_...' },
  { key: 'pricePremiumYearly', label: 'Price ID: プレミアム (年額)', placeholder: 'price_...' },
];

export function StripeModeClient({ initialMode, initialCredentials, initialUsable }: Props) {
  const [mode, setMode] = useState<StripeMode>(initialMode);
  const [credentials, setCredentials] = useState<StripeTestCredentials>(initialCredentials);
  const [usable, setUsable] = useState(initialUsable);
  const [savingMode, setSavingMode] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);

  function updateField(key: keyof StripeTestCredentials, value: string) {
    setCredentials((c) => ({ ...c, [key]: value }));
  }

  async function patch(body: Record<string, unknown>) {
    const res = await fetch('/api/super-admin/stripe-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.error?.message ?? '保存に失敗しました');
    }
    return json as { mode: StripeMode; testCredentials: StripeTestCredentials; testCredentialsUsable: boolean };
  }

  async function toggleMode() {
    const nextMode: StripeMode = mode === 'LIVE' ? 'TEST' : 'LIVE';
    if (nextMode === 'TEST' && !usable) {
      toast.error(
        'テストモードに切り替える前に、Secret Key と Webhook Secret を入力・保存してください',
        '切り替え不可',
      );
      return;
    }
    setSavingMode(true);
    try {
      const json = await patch({ mode: nextMode });
      setMode(json.mode);
      toast.success(
        `Stripe を ${STRIPE_MODE_LABELS[json.mode]} モードに切り替えました`,
        json.mode === 'TEST' ? '⚠️ テストモード有効' : '本番モードに復帰',
      );
    } catch (e) {
      toast.error((e as Error).message, '切り替えエラー');
    } finally {
      setSavingMode(false);
    }
  }

  async function saveCredentials() {
    setSavingCreds(true);
    try {
      const json = await patch(credentials);
      setCredentials(json.testCredentials);
      setUsable(json.testCredentialsUsable);
      toast.success('テストモード用の Stripe 資格情報を保存しました');
    } catch (e) {
      toast.error((e as Error).message, '保存エラー');
    } finally {
      setSavingCreds(false);
    }
  }

  const isTest = mode === 'TEST';

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Stripe 決済モード</h2>
            <p className="mt-1 text-xs text-slate-500">
              本番 (Live) とテスト (Test) を切り替えられます。切り替えは即時反映されます
              (サーバ再起動不要)。対象は Web アプリの決済 (サブスク / 通販 / ゲーム内購入 /
              特典ポイント購入) と Webhook のみです。
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
              isTest ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {STRIPE_MODE_LABELS[mode]}
          </span>
        </div>
      </CardHeader>
      <CardBody>
        {isTest ? (
          <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
            ⚠️ 現在テストモードです。この状態でユーザーが決済を行っても実際の課金は発生しません。
            テストが終わったら必ず本番モードに戻してください。
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={isTest}
            onClick={toggleMode}
            disabled={savingMode}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              isTest ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                isTest ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span className="text-sm text-slate-700">
            {savingMode
              ? '切り替え中…'
              : isTest
                ? 'テストモード (クリックで本番に戻す)'
                : '本番モード (クリックでテストに切り替え)'}
          </span>
        </div>

        {!usable ? (
          <p className="mt-2 text-xs text-rose-600">
            ※ テスト資格情報 (Secret Key / Webhook Secret) が未設定のため、現在テストモードには
            切り替えられません。下のフォームから設定してください。
          </p>
        ) : null}

        <div className="mt-6 border-t border-slate-100 pt-5">
          <h3 className="text-xs font-semibold text-slate-600">テストモード用 Stripe 資格情報</h3>
          <p className="mt-1 text-[11px] text-slate-400">
            Stripe Dashboard の「テスト環境」から取得した値を入力してください。本番キーとは別物です。
            未入力のまま保存すると、その項目は空欄として保存されます。
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            ※ 会員プランは「スタンダード＝月額」「プレミアム＝年額」の 2 種類のみを使用します。
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {CRED_FIELDS.map((f) => (
              <div key={f.key}>
                <label
                  className="mb-1 block text-xs font-semibold text-slate-600"
                  htmlFor={`stripe-test-${f.key}`}
                >
                  {f.label}
                </label>
                <input
                  id={`stripe-test-${f.key}`}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={credentials[f.key]}
                  onChange={(e) => updateField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs focus:border-twilight-amethyst focus:outline-none"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-end">
            <Button onClick={saveCredentials} loading={savingCreds} variant="primary">
              テスト資格情報を保存
            </Button>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-400">
          ※ 独立稼働の Stripe Webhook Lambda (EC2 障害時のフェイルセーフ用) はこの設定の対象外で、
          常に本番キーで動作します。
        </p>
      </CardBody>
    </Card>
  );
}
