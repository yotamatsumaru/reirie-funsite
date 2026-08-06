/**
 * プレーンテキスト中の URL / メールアドレスを自動でリンクにして描画する。
 *
 * 用途:
 *   お知らせ (Announcement.body) やお問い合わせ返信など、
 *   「改行込みのプレーンテキスト」として保存している本文の表示。
 *
 * 安全性:
 *   `dangerouslySetInnerHTML` を使わず、React 要素として組み立てる。
 *   そのため本文に HTML タグが含まれていても**そのまま文字として表示**され、
 *   XSS は原理的に発生しない。
 *   許可スキームは http / https / mailto のみ (lib/linkify.ts 側で判定)。
 *
 * 遷移:
 *   - 外部リンク → `target="_blank"` + `rel="noopener"`
 *   - 自サイト内リンク → Next.js の <Link> でクライアント遷移
 *     (`selfOrigin` を渡した場合のみ判定される)
 *
 * ⚠️ `rel` に `noreferrer` を付けないこと。
 *    LivePocket の「アクセス元制限」は Referer ヘッダーで遷移元を
 *    判定するため、noreferrer を付けると会員が先行抽選ページに
 *    アクセスできなくなる (詳細は lib/linkify.ts の
 *    EXTERNAL_LINK_REFERRER_POLICY のコメント)。
 */
import Link from 'next/link';
import {
  EXTERNAL_LINK_REFERRER_POLICY,
  isInternalHref,
  linkify,
} from '@/lib/linkify';

export function LinkifiedText({
  text,
  className = '',
  /** 自サイトの origin。渡すと同一オリジンのリンクを内部遷移にする */
  selfOrigin,
}: {
  text: string;
  className?: string;
  selfOrigin?: string;
}) {
  const tokens = linkify(text);

  return (
    <span className={className}>
      {tokens.map((t, i) => {
        if (t.type === 'text') {
          // key は index で十分 (トークン列は text から決定的に生成される)
          return <span key={i}>{t.value}</span>;
        }

        // 内部リンクは Next.js の <Link> でクライアント遷移させる
        if (!t.isEmail && isInternalHref(t.href, selfOrigin)) {
          const path = new URL(t.href).pathname + new URL(t.href).search + new URL(t.href).hash;
          return (
            <Link
              key={i}
              href={path}
              className="break-all text-brand-600 underline decoration-brand-300 underline-offset-2 transition hover:text-brand-700 hover:decoration-brand-500"
            >
              {t.value}
            </Link>
          );
        }

        return (
          <a
            key={i}
            href={t.href}
            {...(t.isEmail
              ? {}
              : {
                  target: '_blank',
                  // noreferrer は付けない (アクセス元制限が通らなくなる)
                  rel: 'noopener',
                  referrerPolicy: EXTERNAL_LINK_REFERRER_POLICY,
                })}
            className="break-all text-brand-600 underline decoration-brand-300 underline-offset-2 transition hover:text-brand-700 hover:decoration-brand-500"
          >
            {t.value}
            {!t.isEmail && (
              <>
                {/* 外部リンクであることを視覚的に示す */}
                <span aria-hidden="true" className="ml-0.5 text-[0.85em]">
                  ↗
                </span>
                <span className="sr-only">（新しいタブで開きます）</span>
              </>
            )}
          </a>
        );
      })}
    </span>
  );
}
