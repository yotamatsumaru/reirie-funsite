/**
 * ギャラリーの «アルバム» 分けに関する純粋関数。
 *
 * ## アルバムを専用テーブルにしなかった理由
 *
 * `Content.album` という 1 列の文字列で表現している。
 *
 *   - アルバムの括り方は運用で変わる (ライブ単位 / 月単位 / 衣装単位)。
 *     テーブルにすると名前の変更や並び替えのたびに管理画面が必要になる。
 *   - 表紙画像や説明文といった «アルバム自身の属性» は今回の要望に無いので、
 *     先に作っても使われないカラムを抱えることになる。
 *
 * 将来アルバム自身に情報を持たせたくなったら、この列の値を初期データとして
 * albums テーブルへ移行できる。後戻りできない選択ではない。
 *
 * ## 「未設定」の扱い
 *
 * NULL・空文字・空白のみ をすべて「未設定」とみなし、
 * 一覧では末尾の「その他」にまとめる。
 * 空文字と NULL を別扱いにすると、管理画面で入力欄を空にして保存した
 * ギャラリーと、一度も入力していないギャラリーが別のグループに分かれ、
 * 運営から見て理由の分からない挙動になる。
 */

/** アルバム未設定のギャラリーをまとめるグループ名 */
export const UNGROUPED_ALBUM_LABEL = 'その他';

/** アルバム名の最大長 (管理画面の入力欄と API 検証で共有する) */
export const ALBUM_NAME_MAX = 60;

/**
 * 入力されたアルバム名を保存用に正規化する。
 *
 * 前後の空白を落とし、空になったら null (未設定) を返す。
 * 「 」だけ入力された状態を保存すると、一覧に空白のタブが並んでしまう。
 */
export function normalizeAlbumName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, ALBUM_NAME_MAX);
}

/** そのギャラリーがアルバム未設定か */
export function isUngrouped(album: string | null | undefined): boolean {
  return normalizeAlbumName(album) === null;
}

/** 表示用のアルバム名 (未設定なら「その他」) */
export function albumDisplayName(album: string | null | undefined): string {
  return normalizeAlbumName(album) ?? UNGROUPED_ALBUM_LABEL;
}

export type AlbumGroupInput = {
  album: string | null;
};

export type AlbumGroup<T extends AlbumGroupInput> = {
  /** グループ名 (未設定は「その他」) */
  name: string;
  /**
   * 絞り込みリンクに使う値。
   * 未設定グループは album カラムが NULL なので、クエリ文字列では
   * 空文字ではなく専用の値が必要になる (空文字だと «絞り込み無し» と区別できない)。
   */
  key: string;
  items: T[];
};

/**
 * 未設定グループを URL で表すための値。
 *
 * `?album=` (空) は「絞り込みなし」と区別できないため、
 * 予約語を 1 つ決めておく。運営がアルバム名として同じ文字列を
 * 入力する可能性は事実上ないが、万一入力されても
 * 「その他と同じグループに出る」だけで壊れない。
 */
export const UNGROUPED_ALBUM_KEY = '__none__';

/**
 * ギャラリーをアルバムごとにまとめる。
 *
 * 並び順:
 *   1. 名前付きアルバム … 渡された配列で最初に現れた順
 *      (呼び出し側が publishedAt 降順で渡すので、新しいアルバムが上に来る)
 *   2. 「その他」        … 必ず末尾
 *
 * アルバム名の五十音/アルファベット順にしない理由は、
 * 「2026 春ツアー」より古い「2024…」が先頭に来てしまい、
 * 最新の写真が下に埋もれるため。
 */
export function groupByAlbum<T extends AlbumGroupInput>(items: T[]): AlbumGroup<T>[] {
  const named = new Map<string, T[]>();
  const ungrouped: T[] = [];

  for (const item of items) {
    const name = normalizeAlbumName(item.album);
    if (name === null) {
      ungrouped.push(item);
      continue;
    }
    const bucket = named.get(name);
    if (bucket) bucket.push(item);
    else named.set(name, [item]);
  }

  // Map は挿入順を保つので、最初に現れた順がそのまま並び順になる。
  const groups: AlbumGroup<T>[] = [...named.entries()].map(([name, groupItems]) => ({
    name,
    key: name,
    items: groupItems,
  }));

  if (ungrouped.length > 0) {
    groups.push({
      name: UNGROUPED_ALBUM_LABEL,
      key: UNGROUPED_ALBUM_KEY,
      items: ungrouped,
    });
  }

  return groups;
}

/**
 * URL の `?album=` の値を prisma の where 条件に変換する。
 *
 * 戻り値が undefined なら「絞り込みなし」。
 * 存在しないアルバム名が来た場合は、その条件で 0 件になるだけで
 * エラーにはしない (URL を直接編集された場合に 500 にしたくない)。
 */
export function albumFilterWhere(
  raw: string | null | undefined,
): { album: null } | { album: string } | undefined {
  if (raw == null) return undefined;
  const value = raw.trim();
  if (value === '') return undefined;
  if (value === UNGROUPED_ALBUM_KEY) return { album: null };
  return { album: value };
}

/**
 * 選択中のアルバムかどうか (タブのハイライト用)。
 *
 * 未選択 (絞り込みなし) のときはどのタブも選択中にしない。
 */
export function isSelectedAlbum(
  selected: string | null | undefined,
  groupKey: string,
): boolean {
  if (selected == null) return false;
  const value = selected.trim();
  if (value === '') return false;
  return value === groupKey;
}
