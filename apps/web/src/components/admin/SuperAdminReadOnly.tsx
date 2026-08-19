/**
 * スーパー管理画面の「閲覧のみ (read-only)」モードを配下の Client Component に伝えるコンテキスト。
 *
 * 背景:
 *   STAFF (スタッフ管理者) は SUPER_ADMIN と同じ画面を *閲覧* できるが、
 *   返金 / サブスク変更 / BAN などの *書き込み* 操作は行えない。
 *   サーバー側は各 API の requireSuperAdmin() で必ず 403 になるが、
 *   それだけだと STAFF には「押せるのに必ず失敗するボタン」が見えてしまう。
 *   そこで UI 側でも書き込み操作を隠す/無効化するために、
 *   /super-admin/layout.tsx でこのプロバイダを被せて配下から参照できるようにする。
 *
 * 使い方 (Client Component 内):
 *   const readOnly = useSuperAdminReadOnly();
 *   if (readOnly) return <ReadOnlyHint />;
 *
 * 注意:
 *   これはあくまで UX のための表示制御であり、権限の防壁ではない。
 *   権限の実体は必ず API 側の requireSuperAdmin() で担保すること。
 */
'use client';

import { createContext, useContext, type ReactNode } from 'react';

const SuperAdminReadOnlyContext = createContext(false);

export function SuperAdminReadOnlyProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: ReactNode;
}) {
  return (
    <SuperAdminReadOnlyContext.Provider value={readOnly}>
      {children}
    </SuperAdminReadOnlyContext.Provider>
  );
}

/** 現在のユーザーが閲覧のみ (STAFF) かどうか。プロバイダ外では false。 */
export function useSuperAdminReadOnly(): boolean {
  return useContext(SuperAdminReadOnlyContext);
}

/**
 * 書き込み UI を囲むゲート。閲覧のみ (STAFF) のときは children を描画せず、
 * 代わりに注記 (または fallback) を出す。
 *
 *   <SuperAdminWriteGate label="返金はスーパー管理者のみ実行できます">
 *     <RefundButton />
 *   </SuperAdminWriteGate>
 *
 * children は「描画されない」ため、その中の Client Component の
 * hooks も実行されない (React は要素を作るだけで評価しない)。
 */
export function SuperAdminWriteGate({
  children,
  label,
  /** true の場合、閲覧のみのときに何も表示しない (注記も出さない) */
  silent = false,
}: {
  children: ReactNode;
  label?: string;
  silent?: boolean;
}) {
  const readOnly = useSuperAdminReadOnly();
  if (!readOnly) return <>{children}</>;
  if (silent) return null;
  return <ReadOnlyHint label={label} />;
}

/**
 * 書き込み操作の代わりに表示する小さな注記。
 * ボタン群をまるごと置き換える用途を想定。
 */
export function ReadOnlyHint({
  label = 'この操作はスーパー管理者のみ実行できます',
  className = '',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <p
      className={`inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500 ${className}`}
    >
      <svg
        className="h-3.5 w-3.5 flex-shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      {label}
    </p>
  );
}
