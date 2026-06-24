'use client';

/**
 * 会員カードページのポイント獲得アクション。
 *  - ログインボーナス受取 (1日1回)
 *  - SNS シェア (X / Instagram, 各1日1回)
 *
 * シェアは「共有ウィンドウを開く → 報告して付与」方式。
 * X はインテント URL でその場で共有可能。Instagram は Web 共有 API か
 * 公式アプリ誘導 + 手動報告とする (Instagram には汎用 Web 共有インテントが無いため)。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildLoginBonusCalendar } from '@idol/shared';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { LoginBonusCalendar } from './login-bonus-calendar';

type ShareState = { platform: 'X' | 'INSTAGRAM'; claimedToday: boolean };

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
    socialSharePoints: number;
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const xClaimed = shares.find((s) => s.platform === 'X')?.claimedToday ?? false;
  const igClaimed = shares.find((s) => s.platform === 'INSTAGRAM')?.claimedToday ?? false;

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
          text: `ログインボーナス ${j.amount}pt を獲得！（連続 ${j.streak} 日）`,
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
        body: JSON.stringify({ platform }),
      });
      const j = (await res.json()) as {
        granted?: boolean;
        amount?: number;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(j.error?.message ?? '付与に失敗しました');
      if (j.granted) {
        setMessage({ tone: 'ok', text: `シェアありがとう！ ${j.amount}pt を獲得しました` });
      } else {
        setMessage({ tone: 'err', text: '本日このSNSのシェアポイントは受取済みです' });
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
  }

  async function shareToInstagram() {
    // Instagram には汎用 Web 共有インテントが無いため、Web 共有 API を試し、
    // 使えなければリンクをコピーしてアプリでの共有を促す。
    const data = { title: 'Reirie', text: shareText, url: shareUrl };
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      /* ユーザーがキャンセルした場合などは無視 */
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      setMessage({
        tone: 'ok',
        text: 'シェア用テキストをコピーしました。Instagram に貼り付けて投稿してください',
      });
    } catch {
      setMessage({ tone: 'err', text: 'コピーに失敗しました。手動でシェアしてください' });
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
              毎日 {rates.loginBonusBase}pt ／ {rates.loginStreakThreshold}日連続で +
              {rates.loginStreakBonus}pt
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
        <p className="text-sm font-semibold text-slate-800">SNSでシェアしてポイント獲得</p>
        <p className="mt-0.5 text-xs text-slate-500">
          各SNS 1日1回まで ／ 1回 {rates.socialSharePoints}pt
        </p>

        <div className="mt-3 space-y-3">
          {/* X */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-slate-700">X (旧Twitter)</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={shareToX}>
                Xでシェア
              </Button>
              {xClaimed ? (
                <Badge tone="success">受取済み</Badge>
              ) : (
                <Button
                  size="sm"
                  loading={busy === 'X'}
                  onClick={() => reportShare('X')}
                >
                  +{rates.socialSharePoints}pt 受取
                </Button>
              )}
            </div>
          </div>

          {/* Instagram */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-slate-700">Instagram</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={shareToInstagram}>
                Instagramでシェア
              </Button>
              {igClaimed ? (
                <Badge tone="success">受取済み</Badge>
              ) : (
                <Button
                  size="sm"
                  loading={busy === 'INSTAGRAM'}
                  onClick={() => reportShare('INSTAGRAM')}
                >
                  +{rates.socialSharePoints}pt 受取
                </Button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          ※ シェアボタンで投稿後、「受取」を押すとポイントが付与されます。
        </p>
      </div>
    </div>
  );
}
