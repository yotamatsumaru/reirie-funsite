'use client';

/**
 * TOTP (Google Authenticator) 2段階認証セットアップ UI (SUPER_ADMIN 専用)。
 *
 * - 一般ユーザー/ADMIN には影響しない。SUPER_ADMIN が自分自身の TOTP を
 *   有効化/無効化するための画面。
 * - フロー:
 *   1. 未セットアップ → 「有効化する」→ POST /totp/setup でシークレット+QR発行
 *   2. QRコードを認証アプリで読み取り → 6桁コードを入力 → POST /totp/verify
 *   3. 確認成功 → バックアップコード (8件) を一度だけ表示 (要保存)
 *   4. 有効化済み → 「無効化する」で現在のパスワードを入力して解除
 *
 * GET  /api/super-admin/totp/status  — 現在の状態取得
 * POST /api/super-admin/totp/setup   — シークレット/QR発行 (再実行すると前のシークレットは失効)
 * POST /api/super-admin/totp/verify  — 初回コード確認 → 有効化 + バックアップコード発行
 * POST /api/super-admin/totp/disable — 無効化 (パスワード再入力必須)
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/stores/ui-store';
import { formatJstDateTime } from '@idol/shared';

type Status = {
  enabled: boolean;
  pendingSetup: boolean;
  verifiedAt: string | null;
  backupCodesRemaining: number;
};

type SetupResponse = {
  secret: string;
  qrCodeDataUrl: string;
  accountEmail: string;
};

type Props = {
  initialStatus: Status;
};

async function postJson<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

export function TotpSetupClient({ initialStatus }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  // セットアップ中に発行された QR / シークレット (verify 完了 or キャンセルで消す)
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [busy, setBusy] = useState<'setup' | 'verify' | 'disable' | null>(null);

  async function startSetup() {
    setBusy('setup');
    try {
      const json = await postJson<SetupResponse>('/api/super-admin/totp/setup');
      setSetup(json);
      setCode('');
      setBackupCodes(null);
      setStatus((s) => ({ ...s, enabled: false, pendingSetup: true }));
    } catch (e) {
      toast.error((e as Error).message, 'セットアップ開始エラー');
    } finally {
      setBusy(null);
    }
  }

  async function confirmCode() {
    if (!/^\d{6}$/.test(code)) {
      toast.error('6桁の数字コードを入力してください');
      return;
    }
    setBusy('verify');
    try {
      const json = await postJson<{ ok: true; backupCodes: string[] }>(
        '/api/super-admin/totp/verify',
        { code },
      );
      setBackupCodes(json.backupCodes);
      setSetup(null);
      setCode('');
      setStatus((s) => ({
        ...s,
        enabled: true,
        pendingSetup: false,
        verifiedAt: new Date().toISOString(),
        backupCodesRemaining: json.backupCodes.length,
      }));
      toast.success('TOTP (2段階認証) を有効化しました');
    } catch (e) {
      toast.error((e as Error).message, '確認コードエラー');
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    if (!disablePassword) {
      toast.error('パスワードを入力してください');
      return;
    }
    setBusy('disable');
    try {
      await postJson('/api/super-admin/totp/disable', { password: disablePassword });
      setStatus({ enabled: false, pendingSetup: false, verifiedAt: null, backupCodesRemaining: 0 });
      setShowDisableForm(false);
      setDisablePassword('');
      setBackupCodes(null);
      setSetup(null);
      toast.success('TOTP (2段階認証) を無効化しました');
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message, '無効化エラー');
    } finally {
      setBusy(null);
    }
  }

  function finishAndClose() {
    setBackupCodes(null);
    router.refresh();
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              TOTP 2段階認証 (Google Authenticator)
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              SUPER_ADMIN 限定の追加セキュリティ機能です。有効化すると、ログイン時にパスワードに加えて
              認証アプリの6桁コード (またはバックアップコード) の入力が必要になります。
              一般ユーザー・ADMIN には影響しません。
            </p>
          </div>
          {status.enabled ? (
            <Badge tone="success">有効</Badge>
          ) : status.pendingSetup ? (
            <Badge tone="warning">セットアップ中</Badge>
          ) : (
            <Badge tone="gray">無効</Badge>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {/* バックアップコード表示 (verify 成功直後、一度だけ) */}
        {backupCodes ? (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-900">
              ⚠️ バックアップコード (今だけ表示されます。必ず保存してください)
            </p>
            <p className="mt-1 text-xs text-amber-800">
              認証アプリの端末を紛失した場合に、この中の1件を6桁コードの代わりに1回だけ使用できます。
              安全な場所に保管してください (このコードは二度と表示されません)。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
              {backupCodes.map((c) => (
                <code
                  key={c}
                  className="rounded bg-white px-2 py-1 text-center text-amber-900 shadow-sm"
                >
                  {c}
                </code>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={finishAndClose}>
                保存しました。閉じる
              </Button>
            </div>
          </div>
        ) : null}

        {/* 有効化済み: ステータス表示 + 無効化フォーム */}
        {status.enabled && !backupCodes ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              TOTP は有効です。
              {status.verifiedAt
                ? ` (有効化日時: ${formatJstDateTime(status.verifiedAt)})`
                : null}
              <br />
              残りバックアップコード: {status.backupCodesRemaining} 件
            </div>
            {!showDisableForm ? (
              <Button variant="outline" onClick={() => setShowDisableForm(true)}>
                無効化する
              </Button>
            ) : (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm font-semibold text-rose-800">
                  無効化するには、現在のパスワードを入力してください
                </p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Input
                      type="password"
                      label="現在のパスワード"
                      autoComplete="current-password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      loading={busy === 'disable'}
                      onClick={disable}
                    >
                      無効化を実行
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy === 'disable'}
                      onClick={() => {
                        setShowDisableForm(false);
                        setDisablePassword('');
                      }}
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* 未有効化 / セットアップ中: QR発行前 */}
        {!status.enabled && !setup && !backupCodes ? (
          <div className="space-y-3">
            {status.pendingSetup ? (
              <p className="text-xs text-amber-700">
                以前セットアップを開始しましたが、確認コードの入力が完了していません。
                下のボタンから新しいQRコードを発行してやり直してください
                (前のQRコード/シークレットは無効になります)。
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                まだ有効化されていません。「セットアップを開始する」を押すとQRコードが発行されます。
              </p>
            )}
            <Button variant="primary" loading={busy === 'setup'} onClick={startSetup}>
              {status.pendingSetup ? 'セットアップをやり直す' : 'セットアップを開始する'}
            </Button>
          </div>
        ) : null}

        {/* QR発行済み: スキャン + コード確認 */}
        {setup && !backupCodes ? (
          <div className="space-y-4">
            <div className="flex flex-col items-start gap-4 sm:flex-row">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={setup.qrCodeDataUrl}
                alt="TOTP QRコード"
                width={200}
                height={200}
                className="rounded-lg border border-slate-200 bg-white p-2"
              />
              <div className="flex-1 space-y-2">
                <p className="text-xs text-slate-600">
                  1. Google Authenticator 等の認証アプリでこのQRコードを読み取ってください。
                </p>
                <p className="text-xs text-slate-500">
                  QRコードを読み取れない場合は、以下のキーを手動で入力してください:
                </p>
                <code className="block break-all rounded bg-slate-100 px-2 py-1.5 text-xs">
                  {setup.secret}
                </code>
                <p className="text-xs text-slate-600">
                  2. 認証アプリに表示された6桁のコードを入力して確認してください。
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="w-40">
                    <Input
                      label="確認コード (6桁)"
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="primary" loading={busy === 'verify'} onClick={confirmCode}>
                      確認して有効化
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy === 'verify'}
                      onClick={() => {
                        setSetup(null);
                        setCode('');
                      }}
                    >
                      キャンセル
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
