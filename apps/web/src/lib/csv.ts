/**
 * CSV エクスポート用の共通ヘルパー
 */

/**
 * CSV/Excel 数式インジェクション対策:
 * 先頭が =, +, -, @, タブ, CR の場合、Excel/Sheets で数式として実行される恐れがあるため
 * シングルクォートを前置して無害化する (OWASP CSV Injection 対策)。
 */
export function csvEscape(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 行配列 (ヘッダ含む) を UTF-8 BOM 付き CSV 文字列に変換する (Excel での文字化け回避) */
export function toCsv(rows: string[][]): string {
  const lines = rows.map((cols) => cols.map(csvEscape).join(','));
  return '\uFEFF' + lines.join('\n');
}
