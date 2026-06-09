/**
 * プラン未加入で閲覧不可のコンテンツに被せるロックオーバーレイ。
 *
 * 使い方:
 *   <PlanLockOverlay required="MEMBERS" currentPlan={session?.user?.plan}>
 *     <ProtectedContent />
 *   </PlanLockOverlay>
 *
 * - currentPlan が要件を満たす場合は children をそのまま表示
 * - 満たさない場合は children をぼかし表示 + 中央に CTA を被せる
 */
import Link from 'next/link';
import {
  canAccess,
  requiredPlanLabel,
  type AccessLevelLiteral,
  type PlanTypeLiteral,
} from '@idol/shared';

interface PlanLockOverlayProps {
  required: AccessLevelLiteral;
  currentPlan: PlanTypeLiteral | null | undefined;
  children: React.ReactNode;
  /** カスタムメッセージ (省略時はデフォルトの説明文を使う) */
  message?: string;
  /** プラン紹介ページへのリンクテキスト */
  ctaLabel?: string;
  /** プラン紹介ページの URL (デフォルト: /plans) */
  ctaHref?: string;
  /** ぼかし強度 (px) */
  blurPx?: number;
  /** className を merge */
  className?: string;
}

export function PlanLockOverlay({
  required,
  currentPlan,
  children,
  message,
  ctaLabel = 'プランを見る',
  ctaHref = '/plans',
  blurPx = 8,
  className,
}: PlanLockOverlayProps) {
  const allowed = canAccess(currentPlan, required);
  if (allowed) {
    return <>{children}</>;
  }

  const planLabel = requiredPlanLabel(required);
  const defaultMsg =
    required === 'PREMIUM'
      ? 'このコンテンツはプレミアム会員限定です。'
      : 'このコンテンツは会員限定です。';

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* ぼかした children */}
      <div
        aria-hidden
        className="pointer-events-none select-none"
        style={{ filter: `blur(${blurPx}px)`, opacity: 0.4 }}
      >
        {children}
      </div>

      {/* オーバーレイ CTA */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="max-w-sm rounded-xl bg-white/95 p-6 text-center shadow-xl ring-1 ring-slate-200 backdrop-blur">
          <div className="mb-2 flex justify-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700">
              {/* lock icon */}
              <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="2">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 1 1 8 0v4" />
              </svg>
            </span>
          </div>
          <h3 className="mb-1 text-base font-bold text-slate-900">
            {planLabel}会員限定コンテンツ
          </h3>
          <p className="mb-4 text-sm text-slate-600">{message ?? defaultMsg}</p>
          <Link
            href={ctaHref}
            className="inline-flex w-full items-center justify-center rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {ctaLabel}
          </Link>
          {!currentPlan || currentPlan === 'FREE' ? (
            <p className="mt-3 text-xs text-slate-500">
              <Link href="/signin" className="underline hover:text-slate-700">
                すでにアカウントをお持ちの方はログイン
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * インライン版 (ぼかし無し、CTA バナーのみ)。
 * リスト要素の各項目に並べる用途で使用。
 */
export function PlanLockBanner({
  required,
  currentPlan,
  className,
}: {
  required: AccessLevelLiteral;
  currentPlan: PlanTypeLiteral | null | undefined;
  className?: string;
}) {
  if (canAccess(currentPlan, required)) return null;
  const planLabel = requiredPlanLabel(required);
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 ${className ?? ''}`}
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-100">
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2">
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 1 1 8 0v4" />
        </svg>
      </span>
      <span className="flex-1">{planLabel}会員になると視聴できます</span>
      <Link
        href="/plans"
        className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
      >
        プラン詳細
      </Link>
    </div>
  );
}
