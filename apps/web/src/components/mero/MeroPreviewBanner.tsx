/**
 * Mero が「非公開中」のときに管理者だけに表示する警告バナー。
 * MyRoomPreviewBanner / GamePreviewBanner と同じ見た目・役割にそろえている
 * (公開したつもりで非公開のまま、あるいはその逆の事故を防ぐ)。
 */
import Link from 'next/link';
import { EyeOff } from 'lucide-react';

export function MeroPreviewBanner() {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    >
      <EyeOff className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <p className="text-sm font-semibold text-amber-900">
        Mero は現在「非公開」です（管理者のみ表示中）
      </p>
      <p className="text-xs text-amber-800">
        一般の会員にはこのページは表示されません（404 になります）。
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
