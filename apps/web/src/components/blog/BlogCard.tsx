/**
 * ブログ一覧のカード。
 *
 * サムネイルの有無で 2 通りの見た目を出し分ける。
 * 判定と説明文の決定は lib/blog-card.ts (純粋関数・テスト済み) に任せ、
 * ここは描画だけを担当する。
 *
 * ## サムネイル無しで見た目を変える理由
 *
 * 従来はサムネイル無しの記事も同じ 16:9 の枠を確保し、そこに
 * 汎用の書類アイコンを 1 つ置いていた。その結果、
 *
 *   - カード上部の 6 割が「意味のない同じ絵」で埋まる
 *   - サムネイル無しの記事が並ぶと全部同じ絵になり見分けがつかない
 *   - タイトル・抜粋が下 4 割に押し込められ、肝心の中身が読めない
 *
 * という状態だった。ブログはタイトルと抜粋こそが情報なので、
 * 画像枠を作らずテキストを主役にする。
 *
 * 動画 (/me/videos, /contents) は変更しない。動画のサムネイルは
 * 「何が映っているか」という本質的な情報で、かつ尺や鍵バッジを
 * 重ねる場所が必要なため、枠を確保する価値がある。
 */
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { accessLevelLabel, formatJstDate } from '@idol/shared';
import { resolveBlogCardVariant, resolveCardDescription } from '@/lib/blog-card';

export type BlogCardPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  accessLevel: string;
  publishedAt: Date | null;
  /**
   * 抜粋が無いときに冒頭テキストを作るための本文。
   * サムネイル無しのカードでのみ使う。
   */
  body?: string | null;
};

export function BlogCard({ post }: { post: BlogCardPost }) {
  const variant = resolveBlogCardVariant(post.coverImageUrl);
  const description = resolveCardDescription({
    variant,
    excerpt: post.excerpt,
    body: post.body,
  });

  const meta = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Badge tone="gray">ブログ</Badge>
      {/* 生の enum 名 (PREMIUM/MEMBERS) をそのまま出していたため、
          公開範囲を増やしても新しい段階のバッジが出なかった。
          PUBLIC 以外は共通ラベルでバッジを出す。 */}
      {post.accessLevel !== 'PUBLIC' && (
        <Badge tone={post.accessLevel === 'PREMIUM' ? 'brand' : 'info'}>
          {accessLevelLabel(post.accessLevel)}
        </Badge>
      )}
    </div>
  );

  const date = post.publishedAt ? (
    <p className="mt-2 text-xs text-slate-400">{formatJstDate(post.publishedAt)}</p>
  ) : null;

  /* ===== サムネイルあり: 従来どおり 16:9 の画像を上に置く ===== */
  if (variant === 'cover') {
    return (
      <Link href={`/contents/${post.slug}`} className="group block h-full">
        <Card className="flex h-full flex-col transition-shadow group-hover:shadow-md">
          <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-slate-100">
            {/* next/image を使わないのは、coverImageUrl が外部URL・S3・
                内部配信パスの 3 形態を取り、images.remotePatterns を
                都度追加しないと 500 になるため (既知の運用事故あり)。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.coverImageUrl!}
              alt={post.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          </div>
          <CardBody className="flex flex-1 flex-col">
            {meta}
            <h2 className="mb-1 line-clamp-2 text-base font-semibold text-slate-800">
              {post.title}
            </h2>
            {description && <p className="line-clamp-2 text-sm text-slate-500">{description}</p>}
            <div className="mt-auto">{date}</div>
          </CardBody>
        </Card>
      </Link>
    );
  }

  /* ===== サムネイルなし: 画像枠を作らず、文字を主役にする ===== */
  return (
    /*
      self-start が重要。
      グリッドの既定 (items-stretch) では、同じ行の «画像あり» カードの
      高さに合わせてこのカードも引き伸ばされ、
      下に画像 1 枚ぶん (約 200px) の空白が生まれる。
      実際に描画して確認したところ、カードの半分以上が空白になっていた。
      テキストカードは内容の高さで収める方が «意図した詰まったカード» に見える。
    */
    <Link href={`/contents/${post.slug}`} className="group block self-start">
      <Card className="relative flex flex-col overflow-hidden transition-shadow group-hover:shadow-md">
        {/*
          上端の細いアクセントバー。
          画像枠を無くすと「カードなのかテキストの塊なのか」が
          分かりにくくなるため、境界を示す最小限の装飾を置く。
          高さ 4px なので情報量を奪わない。
        */}
        <div className="h-1 w-full bg-gradient-to-r from-brand-400 to-brand-200" aria-hidden />

        <CardBody className="flex flex-1 flex-col">
          {meta}

          {/*
            タイトルは画像ありカード (text-base) より大きくする。
            画像が無い分、タイトルが一覧の中で「絵」の役割を担うため。
            行数は 3 行まで許可 (2 行だと長いタイトルが頻繁に切れる)。
          */}
          <h2 className="mb-2 line-clamp-3 text-lg font-bold leading-snug text-slate-800 group-hover:text-brand-700">
            {post.title}
          </h2>

          {description ? (
            /* 抜粋は 3 行まで。画像枠が無い分、文字で情報量を稼ぐ。 */
            <p className="line-clamp-3 text-sm leading-relaxed text-slate-600">{description}</p>
          ) : (
            /*
              抜粋も本文テキストも無い記事 (画像だけの記事など)。
              空白のままだとカードが崩れて見えるので、
              「記事を読む」という行き先を明示する。
            */
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600">
              <FileText className="h-4 w-4" aria-hidden />
              記事を読む
            </p>
          )}

          {/* 引き伸ばさないので mt-auto は使わない。
              使うと «内容の直後» ではなく «カード下端» に飛び、
              テキストと日付の間が不自然に空く。 */}
          {date}
        </CardBody>
      </Card>
    </Link>
  );
}
