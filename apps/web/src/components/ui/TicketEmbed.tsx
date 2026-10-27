/**
 * お知らせに埋め込んだチケットサイトの申込タグ (Ticket Dive のルート限定タグ等) を表示する。
 *
 * 保存時にもサニタイズ済みだが、表示直前にもう一度サニタイズしてから
 * dangerouslySetInnerHTML で描画する (多層防御: DB を直接書き換えられても安全側に倒す)。
 * 許可されるのは ticketdive.com 宛てのリンク / フォーム / iframe と簡単な装飾だけ
 * (lib/ticket-embed.ts)。
 *
 * サーバーコンポーネントでもクライアントコンポーネントでも使える (状態を持たない)。
 */
import { sanitizeTicketEmbed } from '@/lib/ticket-embed';

export function TicketEmbed({
  html,
  className = '',
}: {
  html: string | null | undefined;
  className?: string;
}) {
  const safe = sanitizeTicketEmbed(html).html;
  if (!safe) return null;

  return (
    <div
      className={[
        // 埋め込みタグの見た目を最低限整える (ボタン・iframe がはみ出さないように)
        'ticket-embed max-w-full overflow-hidden',
        '[&_iframe]:w-full [&_iframe]:max-w-full [&_iframe]:rounded-lg [&_iframe]:border-0',
        '[&_img]:inline-block [&_img]:h-auto [&_img]:max-w-full',
        '[&_form]:inline-block',
        className,
      ].join(' ')}
      // eslint-disable-next-line react/no-danger -- sanitizeTicketEmbed で許可リスト方式のサニタイズ済み
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
