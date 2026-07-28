'use client';

/**
 * 会員カードページの Pui 獲得アクション。
 *  - ログインボーナス受取 (1日1回)
 *  - SNS シェア (X のみ, 1日1回。Instagram は 2026-07 に廃止)
 *
 * シェアは「シェアボタンを開く (= 意図を記録) → 受取」の 2 段階方式。
 * シェアボタンを一度も押していないと受取ボタンは押せず、サーバー側でも
 * 意図が無い / 待機不足の受取は拒否する (シェアせずに Pui を得る不正を防ぐ)。
 * UI にはカウントダウンは表示しない (待機判定はサーバーに委ねる)。
 * X はインテント URL でその場で共有可能。
 */
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildLoginBonusCalendar } from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoginBonusCalendar } from './login-bonus-calendar';

// シェア対象は X のみ (Instagram は 2026-07 に廃止)。
type Platform = 'X';
type ShareState = { platform: Platform; claimedToday: boolean; sharedToday?: boolean };

export function PointActions({
  shareUrl,
  shareTexts,
  loginClaimedToday,
  loginStreak,
  shares,
  rates,
}: {
  shareUrl: string;
  /** プラットフォーム別のシェア文 (管理画面で編集可能)。URL は自動付与のため含めない。 */
  shareTexts: Record<Platform, string>;
  loginClaimedToday: boolean;
  loginStreak: number;
  shares: ShareState[];
  rates: {
    loginBonusBase: number;
    loginStreakBonus: number;
    loginStreakThreshold: number;
    socialSharePui: number;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const xClaimed = shares.find((s) => s.platform === 'X')?.claimedToday ?? false;

  // 「シェアボタンを押したか」。押すまで受取ボタンは無効。
  // サーバー既存の意図 (sharedToday) があれば初期状態から受取可能とする。
  // (実際の待機時間の検証はサーバー側で行うため、UI にカウントダウンは出さない)
  const [shared, setShared] = useState<Record<Platform, boolean>>(() => ({
    X: shares.find((s) => s.platform === 'X')?.sharedToday ?? false,
  }));

  /** シェア意図をサーバーに記録し、受取ボタンを有効化する。 */
  const markShared = useCallback(async (platform: Platform) => {
    setShared((prev) => ({ ...prev, [platform]: true }));
    try {
      await fetch('/api/me/social-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, action: 'intent' }),
      });
    } catch {
      /* 意図記録の失敗は致命ではない (受取時にサーバーが再判定する) */
    }
  }, []);

  async function claimLogin() {
    setBusy('login');
    setMessage(null);
    try {
      const res = await fetch('/api/me/login-bonus', { method: 'POST' });
      const j = (await res.json()) as {
        granted?: boolean;
        alreadyGranted?: boolean;
        amount?: number;
        streak?: number;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(j.error?.message ?? '受け取りに失敗しました');
      if (j.granted) {
        setMessage({
          tone: 'ok',
          text: `ログインボーナス ${j.amount} Pui を獲得！（連続 ${j.streak} 日）`,
        });
      } else {
        setMessage({ tone: 'err', text: '本日のログインボーナスは受取済みです' });
      }
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'err', text: e instanceof Error ? e.message : 'エラーが発生しました' });
    } finally {
      setBusy(null);
    }
  }

  async function reportShare(platform: Platform) {
    setBusy(platform);
    setMessage(null);
    try {
      const res = await fetch('/api/me/social-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, action: 'claim' }),
      });
      const j = (await res.json()) as {
        granted?: boolean;
        amount?: number;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(j.error?.message ?? '付与に失敗しました');
      if (j.granted) {
        setMessage({ tone: 'ok', text: `シェアありがとう！ ${j.amount} Pui を獲得しました` });
      } else {
        setMessage({ tone: 'err', text: '本日このSNSのシェア Pui は受取済みです' });
      }
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'err', text: e instanceof Error ? e.message : 'エラーが発生しました' });
    } finally {
      setBusy(null);
    }
  }

  function shareToX() {
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      shareTexts.X,
    )}&url=${encodeURIComponent(shareUrl)}`;
    window.open(intent, '_blank', 'noopener,noreferrer,width=600,height=500');
    // シェアウィンドウを開いた = シェア意図。受取ボタンを有効化する。
    void markShared('X');
    setMessage({
      tone: 'ok',
      text: 'X で投稿したら「受取」を押してください',
    });
  }

  return (
    <div className="space-y-5">
      {message && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            message.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-800'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* ログインボーナス (7日サイクルのビジュアルカレンダー) */}
      <div className="rounded-xl border border-slate-200 p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-800">毎日のログインボーナス</p>
            <p className="mt-0.5 text-xs text-slate-500">
              毎日 {rates.loginBonusBase} Pui ／ {rates.loginStreakThreshold}日連続で +
              {rates.loginStreakBonus} Pui
            </p>
            {loginStreak > 0 && (
              <p className="mt-1 text-xs font-semibold text-brand-600">
                🔥 現在 連続 {loginStreak} 日
              </p>
            )}
          </div>
          {loginClaimedToday && <Badge tone="success">本日受取済み</Badge>}
        </div>

        <LoginBonusCalendar
          days={buildLoginBonusCalendar(loginStreak, loginClaimedToday, rates)}
        />

        <div className="mt-3 flex justify-center">
          {loginClaimedToday ? (
            <p className="text-center text-xs text-slate-500">
              また明日ログインしてボーナスを受け取りましょう！
            </p>
          ) : (
            <Button
              loading={busy === 'login'}
              onClick={claimLogin}
              className="w-full sm:w-auto sm:min-w-[240px]"
            >
              本日のログインボーナスを受け取る
            </Button>
          )}
        </div>
      </div>

      {/* SNS シェア */}
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-sm font-semibold text-slate-800">Xでシェアして Pui 獲得</p>
        <p className="mt-0.5 text-xs text-slate-500">
          1日1回まで ／ 1回 {rates.socialSharePui} Pui
        </p>

        <div className="mt-3 space-y-3">
          {/* X */}
          <ShareRow
            label="X (旧Twitter)"
            shareLabel="Xでシェア"
            claimed={xClaimed}
            shared={shared.X}
            busy={busy === 'X'}
            reward={rates.socialSharePui}
            onShare={shareToX}
            onClaim={() => reportShare('X')}
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          ※ まず「シェア」ボタンから投稿してください。投稿後に「受取」を押すと Pui が付与されます。
          シェアせずに受け取ることはできません。
        </p>
      </div>
    </div>
  );
}

/**
 * SNS 1 行ぶんの UI。
 *  - shared === false : まだシェアしていない → 受取ボタンは無効 (シェアを促す)
 *  - shared === true  : シェア済み → 受取可能 (実際の待機検証はサーバー側)
 */
function ShareRow({
  label,
  shareLabel,
  claimed,
  shared,
  busy,
  reward,
  onShare,
  onClaim,
}: {
  label: string;
  shareLabel: string;
  claimed: boolean;
  shared: boolean;
  busy: boolean;
  reward: number;
  onShare: () => void;
  onClaim: () => void;
}) {
  const claimDisabled = !shared || busy;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onShare} disabled={claimed}>
          {shareLabel}
        </Button>
        {claimed ? (
          <Badge tone="success">受取済み</Badge>
        ) : (
          <Button
            size="sm"
            loading={busy}
            disabled={claimDisabled}
            title={!shared ? 'まず「シェア」ボタンから投稿してください' : undefined}
            onClick={onClaim}
          >
            +{reward} Pui 受取
          </Button>
        )}
      </div>
    </div>
  );
}
