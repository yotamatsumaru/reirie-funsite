'use client';

/**
 * ゲーム個別の公開 / 非公開トグル (SUPER_ADMIN)。
 *
 * - ゲーム 1 本ごとに OFF にでき、そのゲームのページと API だけが
 *   一般ユーザーから 404 相当で見えなくなる (他のゲームは影響を受けない)。
 * - OFF の間も管理者 (ADMIN 以上) はプレイして動作確認できる
 *   (「非公開中」バナー付きで表示される)。
 * - GET/PATCH /api/super-admin/game-visibility で永続化
 *   (AppSetting: game.visibility)。切り替えは即時反映 (サーバ再起動不要)。
 * - ゲーム機能そのものを一括で止めるマスタースイッチ (gamesVisible) は
 *   /super-admin/settings 側にある。マスターが OFF の間は個別 ON でも
 *   公開されないため、その旨をこの画面にも表示する。
 */
import { useState } from 'react';
import { GAME_VISIBILITY_ITEMS, type GameKey, type GameVisibilityMap } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { toast } from '@/stores/ui-store';

type Props = {
  initialVisibility: GameVisibilityMap;
  /** マスタースイッチ (site.sectionVisibility.gamesVisible) の現在値 */
  gamesVisible: boolean;
};

export function GameVisibilityClient({ initialVisibility, gamesVisible }: Props) {
  const [visibility, setVisibility] = useState<GameVisibilityMap>(initialVisibility);
  const [saving, setSaving] = useState<GameKey | null>(null);

  async function toggle(key: GameKey) {
    // 保存中は他のトグルも含めて操作をブロックする。
    // サーバー側は advisory lock で排他しているため lost update は起きないが、
    // 連打時に「押した順で画面に反映されない」体感を避けるための UX 上の保険。
    if (saving !== null) return;
    const nextValue = !visibility[key];
    setSaving(key);
    try {
      const res = await fetch('/api/super-admin/game-visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: nextValue }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message ?? '保存に失敗しました');
      }
      setVisibility(json.visibility as GameVisibilityMap);
      const label = GAME_VISIBILITY_ITEMS.find((i) => i.key === key)?.label ?? key;
      toast.success(
        `${label} を${nextValue ? '公開' : '非公開'}にしました`,
        nextValue ? '公開に切り替え' : '⚠️ 非公開に切り替え',
      );
    } catch (e) {
      toast.error((e as Error).message, '切り替えエラー');
    } finally {
      setSaving(null);
    }
  }

  const hiddenCount = GAME_VISIBILITY_ITEMS.filter((i) => !visibility[i.key]).length;

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              ゲームごとの公開設定
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              ゲーム 1 本ごとに公開 / 非公開を切り替えられます。非公開にしたゲームは
              一般会員のゲーム一覧から消え、直接 URL を開いても 404 になります
              (他のゲームは影響を受けません)。
              <span className="font-semibold text-slate-700">
                {' '}
                非公開の間も管理者はプレイして動作確認できます。
              </span>
              切り替えは即時反映されます (サーバ再起動不要)。
            </p>
          </div>
          {hiddenCount > 0 && (
            <span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
              {hiddenCount} 本 非公開中
            </span>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* マスタースイッチが OFF なら、個別 ON でも公開されないことを明示する。
            (「個別を ON にしたのに公開されない」という混乱を防ぐ) */}
        {!gamesVisible && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <p className="font-bold">
              ⚠️ ゲーム機能全体が非公開になっています
            </p>
            <p className="mt-1">
              サイト設定の「ゲーム」トグルが OFF のため、下記で公開にしても一般会員には
              表示されません。公開するには
              <span className="font-semibold">「設定 → コンテンツ / グッズ / DM / ゲーム の公開設定」</span>
              でゲームを ON にしてください。
            </p>
          </div>
        )}

        {GAME_VISIBILITY_ITEMS.map((item) => {
          const isVisible = visibility[item.key];
          const isSaving = saving === item.key;
          // 他のトグルが保存中でもこのボタンを無効化する (連打による表示ズレ防止)。
          const isDisabled = saving !== null;
          return (
            <div
              key={item.key}
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  <span className="mr-1.5">{item.emoji}</span>
                  {item.label}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                {!isVisible && (
                  <p className="mt-1 text-xs font-semibold text-amber-700">
                    管理者にはプレビュー表示されています（一般会員には非表示）
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`text-xs font-semibold ${
                    isVisible ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {isSaving ? '切り替え中…' : isVisible ? '公開中' : '非公開'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isVisible}
                  aria-label={`${item.label} の公開設定`}
                  onClick={() => toggle(item.key)}
                  disabled={isDisabled}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    isVisible ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isVisible ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
