/**
 * 日時表示ユーティリティ (日本時間 = JST 固定)。
 *
 * 【背景 / 修正理由】
 * サーバーコンポーネントで `date.toLocaleString('ja-JP')` を呼ぶと、
 * フォーマットは「サーバーのタイムゾーン」で行われる。本番サーバー (EC2/RDS)
 * や DB は UTC で動いているため、UTC の時刻がそのまま表示され、
 * 実際の日本時間より 9 時間ずれてしまっていた
 * (例: 10:46 JST の購入が「1:46」と表示される)。
 *
 * これを防ぐため、`timeZone: 'Asia/Tokyo'` を明示した Intl.DateTimeFormat で
 * 常に日本時間へ変換して整形する。サーバー/クライアントのどちらで実行しても
 * 同じ (日本時間の) 結果になる。
 *
 * 表示形式は従来の `toLocaleString('ja-JP')` 相当 ("2026/7/26 1:46:26") を
 * 維持しつつ、確実に JST に揃える。
 */

/** Date | string | number を Date に正規化する。無効値は null。 */
function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const JST = 'Asia/Tokyo';

// フォーマッタは生成コストがあるため使い回す。
const dateTimeFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const dateTimeNoSecFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/**
 * 日本時間で "YYYY/M/D H:mm:ss" 相当に整形する。
 * `toLocaleString('ja-JP')` の置き換え用 (秒まで表示)。
 * 無効な値のときは空文字を返す。
 */
export function formatJstDateTime(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : '';
}

/**
 * 日本時間で "YYYY/M/D H:mm" 相当に整形する (秒なし)。
 */
export function formatJstDateTimeShort(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  return d ? dateTimeNoSecFmt.format(d) : '';
}

/**
 * 日本時間で "YYYY/M/D" に整形する (日付のみ)。
 * `toLocaleDateString('ja-JP')` の置き換え用。
 */
export function formatJstDate(value: Date | string | number | null | undefined): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : '';
}
