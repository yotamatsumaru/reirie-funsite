/**
 * 管理画面のコンテンツ一覧（ブログ / ギャラリー共通）。
 *
 * ## なぜ共通化するのか
 *
 * ブログとギャラリーは同じ `contents` テーブルの `type` 違いで、
 * 一覧に出す列（タイトル・公開範囲・状態・閲覧数・更新日）も同じ。
 * それぞれのページに同じテーブルを書くと、
 * 「片方だけ列を足した」「片方だけ予約バッジが出ない」というズレが起きる。
 *
 * 種別の違いは
 *   - ギャラリーは「写真の枚数」を出したい
 *   - 空のときの文言（記事 / ギャラリー）
 * だけなので、引数で切り替える。
 *
 * ## 状態表示に status をそのまま出さない理由
 *
 * 以前は `PUBLISHED` のような enum 名を直接出していた。
 * 公開日時（予約公開）に対応した今は、
 * 「PUBLISHED だが publishedAt が未来」= まだ会員に見えていない、
 * という状態が存在する。これを「公開」と表示すると
 * 運営が「もう出ているはず」と誤解するため、
 * contentStatusLabel() で判定して「公開予約」を出す。
 */
import Link from 'next/link';
import { Images } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { accessLevelLabel, formatJstDateTime } from '@idol/shared';
import { contentStatusLabel, isContentScheduled } from '@/lib/content-visibility';

export type AdminContentRow = {
  id: string;
  title: string;
  status: string;
  accessLevel: string;
  publishedAt: Date | null;
  updatedAt: Date;
  viewCount: number;
  /** ギャラリーのときだけ渡す写真枚数。 */
  imageCount?: number;
  /** ギャラリーのときだけ渡すアルバム名 (未設定なら null)。 */
  album?: string | null;
};

/** 状態バッジの色。予約中は「まだ出ていない」ことが分かる色にする。 */
function statusTone(row: AdminContentRow): 'success' | 'warning' | 'gray' {
  if (row.status !== 'PUBLISHED') return 'gray';
  return isContentScheduled(row) ? 'warning' : 'success';
}

export function AdminContentList({
  items,
  kind,
}: {
  items: AdminContentRow[];
  /** 表示の文言と、写真枚数列を出すかの切り替え。 */
  kind: 'BLOG' | 'GALLERY';
}) {
  const isGallery = kind === 'GALLERY';
  const emptyText = isGallery ? 'ギャラリーはありません' : '記事はありません';

  return (
    <>
      {/* モバイル: カードリスト */}
      <div className="space-y-3 md:hidden">
        {items.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">{emptyText}</CardBody>
          </Card>
        ) : (
          items.map((c) => (
            <Card key={c.id}>
              <CardBody className="space-y-2">
                <Link
                  href={`/admin/contents/${c.id}`}
                  className="block font-semibold text-brand-600 hover:underline"
                >
                  {c.title}
                </Link>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {isGallery && (
                    <Badge tone="gray">
                      <span className="inline-flex items-center gap-1">
                        <Images className="h-3 w-3" aria-hidden />
                        {c.imageCount ?? 0} 枚
                      </span>
                    </Badge>
                  )}
                  {isGallery && c.album && <Badge tone="gray">{c.album}</Badge>}
                  <Badge
                    tone={
                      c.accessLevel === 'PREMIUM'
                        ? 'brand'
                        : c.accessLevel === 'MEMBERS'
                          ? 'info'
                          : 'gray'
                    }
                  >
                    {accessLevelLabel(c.accessLevel)}
                  </Badge>
                  <Badge tone={statusTone(c)}>{contentStatusLabel(c)}</Badge>
                </div>
                {/* 予約中は「いつ公開されるか」まで出す。
                    バッジだけだと時刻を確認するのに編集画面を開く必要がある。 */}
                {isContentScheduled(c) && c.publishedAt && (
                  <p className="text-xs text-amber-700">
                    {formatJstDateTime(c.publishedAt)} に公開
                  </p>
                )}
                <div className="flex justify-between text-xs text-slate-500">
                  <span>閲覧 {c.viewCount}</span>
                  <span>{formatJstDateTime(c.updatedAt)}</span>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>

      {/* デスクトップ: テーブル */}
      <Card className="hidden md:block">
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">タイトル</th>
                {isGallery && <th className="px-4 py-3">写真</th>}
                {isGallery && <th className="px-4 py-3">アルバム</th>}
                <th className="px-4 py-3">アクセス</th>
                <th className="px-4 py-3">状態</th>
                <th className="px-4 py-3">公開日時</th>
                <th className="px-4 py-3">閲覧数</th>
                <th className="px-4 py-3">更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/contents/${c.id}`}
                      className="text-brand-600 hover:underline"
                    >
                      {c.title}
                    </Link>
                  </td>
                  {isGallery && (
                    <td className="px-4 py-3 tabular-nums">{c.imageCount ?? 0} 枚</td>
                  )}
                  {isGallery && (
                    <td className="px-4 py-3 text-slate-500">
                      {/* 未設定を空欄にすると «取得失敗» と見分けがつかないので
                          明示的にダッシを出す。 */}
                      {c.album ?? '—'}
                    </td>
                  )}
                  <td className="px-4 py-3">{accessLevelLabel(c.accessLevel)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(c)}>{contentStatusLabel(c)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {c.publishedAt ? formatJstDateTime(c.publishedAt) : '—'}
                  </td>
                  <td className="px-4 py-3">{c.viewCount}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatJstDateTime(c.updatedAt)}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={isGallery ? 8 : 6}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    {emptyText}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
