'use client';

/**
 * 会員カードページの Pui 獲得アクション。
 *  - ログインボーナス受取 (1日1回)
 *  - SNS シェア (X / Instagram, 各1日1回)
 *
 * シェアは「シェアボタンを開く (= 意図を記録) → 数秒後に受取」の 2 段階方式。
 * シェアボタンを一度も押していないと受取ボタンは押せず、サーバー側でも
 * 意図が無い / 待機不足の受取は拒否する (シェアせずに Pui を得る不正を防ぐ)。
 * X はインテント URL でその場で共有可能。Instagram は Web 共有 API か
 * 公式アプリ誘導とする (Instagram には汎用 Web 共有インテントが無いため)。
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildLoginBonusCalendar, SOCIAL_SHARE_MIN_DWELL_SEC } from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoginBonusCalendar } from './login-bonus-calendar';

type Platform = 'X' | 'INSTAGRAM';
type ShareState = { platform: Platform; claimedToday: boolean; sharedToday?: boolean };

export function PointActions({
  shareUrl,
  shareText,
  loginClaimedToday,
  loginStreak,
  shares,
  rates,
}: {
  shareUrl: string;
  shareText: string;
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
  const igClaimed = shares.find((s) => s.platform === 'INSTAGRAM')?.claimedToday ?? false;

  // 各プラットフォームで「シェアボタンを押して受取可能になる時刻(ms)」。
  // サーバー既存の意図 (sharedToday) があれば即受取可能 (readyAt=0)、
  // このセッションでシェアした場合は dwell 経過後に受取可能とする。
  const [readyAt, setReadyAt] = useState<Record<Platform, number | null>>(() => ({
    X: shares.find((s) => s.platform === 'X')?.sharedToday ? 0 : null,
    INSTAGRAM: shares.find((s) => s.platform === 'INSTAGRAM')?.sharedToday ? 0 : null,
  }));
  // 残り待機秒数の再描画用 tick
  const [, setTick] = useState(0);

  useEffect(() => {
    const anyPending = Object.values(readyAt).some(
      (t) => t !== null && t > Date.now(),
    );
    if (!anyPending) return;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [readyAt]);

  const remainingSec = useCallback(
    (platform: Platform): number => {
      const t = readyAt[platform];
      if (t === null) return -1; // まだシェアしていない
      return Math.max(0, Math.ceil((t - Date.now()) / 1000));
    },
    [readyAt],
  );

  /** シェア意図をサーバーに記録し、dwell 後に受取可能にする。 */
  const markShared = useCallback(async (platform: Platform) => {
    // 楽観的に「待機開始」状態へ (シェアウィンドウを開いた直後に呼ばれる)
    setReadyAt((prev) => ({
      ...prev,
      [platform]: Date.now() + SOCIAL_SHARE_MIN_DWELL_SEC * 1000,
    }));
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

  async function reportShare(platform: 'X' | 'INSTAGRAM') {
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
      shareText,
    )}&url=${encodeURIComponent(shareUrl)}`;
    window.open(intent, '_blank', 'noopener,noreferrer,width=600,height=500');
    // シェアウィンドウを開いた = シェア意図。受取を dwell 後に解禁する。
    void markShared('X');
    setMessage({
      tone: 'ok',
      text: `X で投稿したら、${SOCIAL_SHARE_MIN_DWELL_SEC} 秒ほど待って「受取」を押してください`,
    });
  }

  async function shareToInstagram() {
    // Instagram には汎用 Web 共有インテントが無いため、Web 共有 API を試し、
    // 使えなければリンクをコピーしてアプリでの共有を促す。
    const data = { title: 'Reirie', text: shareText, url: shareUrl };
    let shared = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(data);
        shared = true;
      }
    } catch {
      /* ユーザーがキャンセルした場合などは無視 */
    }
    if (!shared) {
      try {
        await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
        setMessage({
          tone: 'ok',
          text: 'シェア用テキストをコピーしました。Instagram に貼り付けて投稿してください',
        });
        shared = true;
      } catch {
        setMessage({ tone: 'err', text: 'コピーに失敗しました。手動でシェアしてください' });
      }
    }
    if (shared) {
      // 共有 API 成功 or コピー完了 = シェア意図。受取を dwell 後に解禁する。
      void markShared('INSTAGRAM');
    }
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
        <p className="text-sm font-semibold text-slate-800">SNSでシェアして Pui 獲得</p>
        <p className="mt-0.5 text-xs text-slate-500">
          各SNS 1日1回まで ／ 1回 {rates.socialSharePui} Pui
        </p>

        <div className="mt-3 space-y-3">
          {/* X */}
          <ShareRow
            label="X (旧Twitter)"
            shareLabel="Xでシェア"
            claimed={xClaimed}
            remaining={remainingSec('X')}
            busy={busy === 'X'}
            reward={rates.socialSharePui}
            onShare={shareToX}
            onClaim={() => reportShare('X')}
          />

          {/* Instagram */}
          <ShareRow
            label="Instagram"
            shareLabel="Instagramでシェア"
            claimed={igClaimed}
            remaining={remainingSec('INSTAGRAM')}
            busy={busy === 'INSTAGRAM'}
            reward={rates.socialSharePui}
            onShare={shareToInstagram}
            onClaim={() => reportShare('INSTAGRAM')}
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
 *  - remaining === -1 : まだシェアしていない → 受取ボタンは無効 (シェアを促す)
 *  - remaining  >  0 : シェア済みだが待機中 → 「あとN秒」表示で無効
 *  - remaining === 0 : 受取可能
 */
function ShareRow({
  label,
  shareLabel,
  claimed,
  remaining,
  busy,
  reward,
  onShare,
  onClaim,
}: {
  label: string;
  shareLabel: string;
  claimed: boolean;
  remaining: number;
  busy: boolean;
  reward: number;
  onShare: () => void;
  onClaim: () => void;
}) {
  const notShared = remaining === -1;
  const waiting = remaining > 0;
  const claimDisabled = notShared || waiting || busy;

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
            title={notShared ? 'まず「シェア」ボタンから投稿してください' : undefined}
            onClick={onClaim}
          >
            {waiting ? `受取まであと ${remaining} 秒` : `+${reward} Pui 受取`}
          </Button>
        )}
      </div>
    </div>
  );
}
