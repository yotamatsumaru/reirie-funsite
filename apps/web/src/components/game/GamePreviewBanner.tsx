/**
 * ゲームが「非公開中」のときに管理者だけに表示する警告バナー。
 *
 * 非公開でも管理者はゲームを閲覧・プレイできる (開発中の動作確認のため) が、
 * その状態だと管理者からは公開時とまったく同じ画面に見えてしまい、
 * 「公開したつもりで実は非公開のままだった」という事故が起きうる。
 * それを防ぐため、非公開中は全ゲーム画面の先頭にこのバナーを出す。
 */
import Link from 'next/link';
import { EyeOff } from 'lucide-react';

export function GamePreviewBanner() {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <EyeOff className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <p className="text-sm font-semibold text-amber-900">
        ゲームは現在「非公開」です（管理者のみ表示中）
      </p>
      <p className="text-xs text-amber-800">
        一般の会員にはこのページは表示されません。
      </p>
      <Link
        href="/super-admin/settings"
        className="text-xs font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
      >
        公開設定を変更する
      </Link>
    </div>
  );
}
