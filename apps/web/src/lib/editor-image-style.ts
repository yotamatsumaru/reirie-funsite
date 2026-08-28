/**
 * 本文中の画像の「幅」と「配置」を inline style として表現するためのヘルパー。
 *
 * なぜ style 属性なのか:
 *   保存時の sanitizeContentBody() が img に許可している属性は
 *   src / alt / title / width / height と、全タグ共通の class / style だけ。
 *   `data-align` のような独自属性は保存時に落ちてしまうため、
 *   エディタで指定した配置・幅を記事に残すには style に載せるしかない。
 *   逆に言うと style で表現しておけば、公開ページ側は
 *   dangerouslySetInnerHTML でそのまま出すだけで見た目が再現される。
 *
 * 幅を % で持つ理由:
 *   px 固定だとスマホで画面からはみ出す。% なら prose の
 *   `max-width: 100%` と組み合わせてレスポンシブに縮む。
 */

export type ImageAlign = 'left' | 'center' | 'right';

/** ツールバーに出す幅プリセット (%)。100 = 元のカラム幅いっぱい。 */
export const IMAGE_WIDTH_PRESETS = [25, 50, 75, 100] as const;

export const IMAGE_ALIGN_LABELS: Record<ImageAlign, string> = {
  left: '左寄せ',
  center: '中央',
  right: '右寄せ',
};

/**
 * 幅 (%) と配置から img の style 文字列を組み立てる。
 * どちらも未指定なら null (= style 属性を出力しない)。
 *
 * 配置は margin auto で表現する。float を使わないのは、
 * float だと後続の段落が回り込んで記事レイアウトが崩れやすく、
 * サニタイズ後の静的 HTML では制御しづらいため。
 */
export function buildImageStyle(
  width: number | null | undefined,
  align: ImageAlign | null | undefined,
): string | null {
  const parts: string[] = [];

  if (typeof width === 'number' && Number.isFinite(width) && width > 0 && width <= 100) {
    parts.push(`width: ${width}%`);
  }

  if (align) {
    // display:block にしないと margin:auto が効かない (img は inline 要素のため)
    parts.push('display: block');
    if (align === 'center') {
      parts.push('margin-left: auto', 'margin-right: auto');
    } else if (align === 'right') {
      parts.push('margin-left: auto', 'margin-right: 0');
    } else {
      parts.push('margin-left: 0', 'margin-right: auto');
    }
  }

  return parts.length > 0 ? parts.join('; ') : null;
}

/**
 * style 文字列から幅 (%) を読み取る。
 * 既存記事が `width="600"` のような属性で書かれている場合もあるため、
 * style に無ければ width 属性を見る (px 指定は % に変換できないので null)。
 */
export function parseImageWidth(style: string | null | undefined): number | null {
  if (!style) return null;
  const m = /width\s*:\s*(\d+(?:\.\d+)?)\s*%/i.exec(style);
  if (!m || m[1] === undefined) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return n;
}

/** style 文字列から配置を読み取る。margin-left / margin-right の組み合わせで判定する。 */
export function parseImageAlign(style: string | null | undefined): ImageAlign | null {
  if (!style) return null;
  const left = /margin-left\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();
  const right = /margin-right\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim().toLowerCase();
  if (!left && !right) return null;

  const leftAuto = left === 'auto';
  const rightAuto = right === 'auto';

  if (leftAuto && rightAuto) return 'center';
  if (leftAuto && !rightAuto) return 'right';
  if (!leftAuto && rightAuto) return 'left';
  return null;
}
