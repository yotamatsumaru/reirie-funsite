/**
 * ゲーム設定の対象ゲーム一覧 (インデックス表示 + 将来のゲーム追加用)。
 *
 * 今後ゲームが増えたら、この配列に 1 エントリ追加し、
 * /super-admin/game-settings/<slug>/page.tsx を用意すれば、
 * 設定ページがゲームごとに分離される。
 */
export type GameSettingsEntry = {
  /** ゲーム識別子 (URL / スロットに使用: game-settings/<slug>) */
  slug: string;
  /** 表示名 */
  title: string;
  /** カードに出す絵文字アイコン */
  emoji: string;
  /** 一覧に出す説明 */
  description: string;
};

export const GAME_SETTINGS_GAMES: GameSettingsEntry[] = [
  {
    slug: 'acchi',
    title: 'あっちむいてPUI',
    emoji: '👉',
    description:
      '勝率・特典ポイントボーナス・キャラボイス・キャラクター画像・サムネイルの設定。',
  },
  {
    slug: 'slot',
    title: 'スロット',
    emoji: '🎰',
    description: '出玉設定 (当選確率 1〜6)・サムネイルの設定。',
  },
];
