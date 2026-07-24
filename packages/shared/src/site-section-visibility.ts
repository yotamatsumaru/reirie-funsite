/**
 * サイト全体のセクション公開設定 (コンテンツ / グッズ / DM)。
 *
 * - Content / Product は個別レコード単位の status / isActive を持つが、
 *   「セクションそのもの」を一時的に非公開にする (オープン前の準備中など) ための
 *   サイト全体トグル。SUPER_ADMIN が /super-admin/settings から ON/OFF できる。
 * - AppSetting (site.sectionVisibility) に JSON で永続化する。
 * - 非公開時は一覧/詳細ページとも 404 相当のメッセージを表示し、対応する公開 API
 *   (/api/contents*, /api/products*, /api/me/dm) も 404 を返す。管理画面 (/admin/*, /super-admin/*) は対象外。
 */
import { z } from 'zod';

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
});

export type SiteSectionVisibility = z.infer<typeof SiteSectionVisibilitySchema>;

/** 未設定時の既定値 (安全側 = 通常運用と同じ「すべて公開」) */
export const DEFAULT_SITE_SECTION_VISIBILITY: SiteSectionVisibility = {
  contentsVisible: true,
  productsVisible: true,
  dmVisible: true,
};
