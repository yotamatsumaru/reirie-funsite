/**
 * サイト全体のセクション公開設定 (コンテンツ / グッズ / DM / ゲーム)。
 *
 * - Content / Product は個別レコード単位の status / isActive を持つが、
 *   「セクションそのもの」を一時的に非公開にする (オープン前の準備中など) ための
 *   サイト全体トグル。SUPER_ADMIN が /super-admin/settings から ON/OFF できる。
 * - AppSetting (site.sectionVisibility) に JSON で永続化する。
 * - 非公開時は一覧/詳細ページとも 404 相当のメッセージを表示し、対応する公開 API
 *   (/api/contents*, /api/products*, /api/me/dm, /api/game*) も 404 を返す。
 *   管理画面 (/admin/*, /super-admin/*) は対象外。
 * - ゲーム (gamesVisible) だけは「開発中も運営が動作確認できる」必要があるため、
 *   非公開でも管理者 (ADMIN 以上) は引き続き閲覧・プレイできる (下記 canViewGameSection)。
 */
import { z } from 'zod';
import { isAdmin, type UserRoleLiteral } from './constants';

/** AppSetting に保存する設定キー */
export const SITE_SECTION_VISIBILITY_KEY = 'site.sectionVisibility';

/**
 * 【重要 / 部分更新バグ対策】各フィールドに .default(true) を付けてはならない。
 * PATCH API では `.partial()` したスキーマで「変更されたフィールドだけ」を受け取り、
 * サーバー側で保存済みの値 (before) にマージする設計だが、Zod の `.partial()` は
 * フィールドを optional にするだけで `.default()` は残るため、default があると
 * 「送られなかったフィールド」も既定値 (true) で埋められてしまう。その結果
 * 「1つを非公開にすると他が公開に戻る」不具合が発生する。
 * 既定値は下の DEFAULT_SITE_SECTION_VISIBILITY で一元管理する。
 */
export const SiteSectionVisibilitySchema = z.object({
  /** コンテンツ (ブログ/ギャラリー) セクションを公開するか */
  contentsVisible: z.boolean(),
  /** グッズ ( EC) セクションを公開するか */
  productsVisible: z.boolean(),
  /** REIRIE への DM セクションを公開するか */
  dmVisible: z.boolean(),
  /**
   * ゲーム (/game, /me/games) セクションを一般公開するか。
   *
   * 今後もゲームを開発していく想定のため、開発中は OFF にして一般会員から隠し、
   * 完成したら ON にする運用を想定している。OFF の間も管理者はプレイできる
   * (canViewGameSection 参照)。
   */
  gamesVisible: z.boolean(),
  /**
   * MyRoom (家具の部屋) セクションを一般公開するか。
   *
   * 【既定は false = 非公開】ゲームと違い、MyRoom は既定で非公開にしている。
   * MyRoom は 3 段階に分けて開発中で、まだ会員に見せられる状態ではないため。
   * 「まだ公開しないでほしい・管理者だけ」という運営方針に合わせ、運営が
   * 明示的に ON にするまで一般会員からは完全に隠れる。
   *
   * OFF の間もゲームと同じく管理者 (ADMIN 以上) はプレビューできる
   * (canViewMyRoomSection 参照)。開発中の動作確認のため。
   */
  myRoomVisible: z.boolean(),
});

export type SiteSectionVisibility = z.infer<typeof SiteSectionVisibilitySchema>;

/** 未設定時の既定値 (安全側 = 通常運用と同じ「すべて公開」) */
export const DEFAULT_SITE_SECTION_VISIBILITY: SiteSectionVisibility = {
  contentsVisible: true,
  productsVisible: true,
  dmVisible: true,
  // 既存サイトではゲームは既に公開済みのため、既定は true。
  // (未設定の本番 DB に対して「勝手に非公開になる」事故を防ぐ)
  gamesVisible: true,
  // MyRoom は開発中の新機能。他セクションと違い既定を false にしている。
  // 未完成の機能が本番デプロイと同時に会員へ露出するのを防ぐためで、
  // 公開は運営が管理画面で明示的に ON にしたときだけとする。
  myRoomVisible: false,
};

/**
 * ゲームセクションを閲覧できるか。
 *
 * 【なぜゲームだけ管理者プレビューを許すのか】
 * コンテンツ / グッズ / DM は「非公開 = 全員に 404」でよいが、ゲームは今後も
 * 開発を続ける前提であり、非公開の間こそ運営が実際に触って動作確認する必要がある。
 * 管理者まで 404 にしてしまうと、公開するまで一切テストできなくなる。
 *
 * そのため OFF の間は「一般会員には 404 / 管理者にはプレビュー表示」とする。
 *
 * @param gamesVisible 公開設定 (AppSetting の値)
 * @param role 閲覧者のロール (未ログインは undefined / null)
 */
export function canViewGameSection(
  gamesVisible: boolean,
  role: UserRoleLiteral | undefined | null,
): boolean {
  return gamesVisible || isAdmin(role);
}

/**
 * ゲームセクションを「管理者プレビューとして」表示しているか。
 * true のときは画面上に「非公開中」の警告バナーを出す。
 * (運営が公開したつもりで非公開のまま放置する事故を防ぐ)
 */
export function isGameSectionPreview(
  gamesVisible: boolean,
  role: UserRoleLiteral | undefined | null,
): boolean {
  return !gamesVisible && isAdmin(role);
}

/**
 * MyRoom セクションを閲覧できるか。
 *
 * ゲームと同じ「非公開でも管理者は見られる」方式にしている。MyRoom は
 * 3 段階に分けて開発するため、非公開の期間が長く続く。その間ずっと
 * 運営自身も触れないと、公開直前まで一度も動作確認できないことになる。
 *
 * 一般会員 / 未ログイン … 404
 * 管理者 (ADMIN 以上)  … プレビュー表示
 *
 * @param myRoomVisible 公開設定 (AppSetting の値)
 * @param role 閲覧者のロール (未ログインは undefined / null)
 */
export function canViewMyRoomSection(
  myRoomVisible: boolean,
  role: UserRoleLiteral | undefined | null,
): boolean {
  return myRoomVisible || isAdmin(role);
}

/**
 * MyRoom セクションを「管理者プレビューとして」表示しているか。
 * true のときは画面上に「非公開中」バナーを出し、運営が
 * 「公開したつもりで非公開のまま」になる事故を防ぐ。
 */
export function isMyRoomSectionPreview(
  myRoomVisible: boolean,
  role: UserRoleLiteral | undefined | null,
): boolean {
  return !myRoomVisible && isAdmin(role);
}
