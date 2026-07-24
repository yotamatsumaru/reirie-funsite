/**
 * サイト全体のセクション公開設定 (コンテンツ / グッズ)。
 *
 * - Content / Product は個別レコード単位の status / isActive を持つが、
 *   「セクションそのもの」を一時的に非公開にする (オープン前の準備中など) ための
 *   サイト全体トグル。SUPER_ADMIN が /super-admin/settings から ON/OFF できる。
 * - AppSetting (site.sectionVisibility) に JSON で永続化する。
 * - 非公開時は一覧/詳細ページとも 404 相当のメッセージを表示し、対応する公開 API
 *   (/api/contents*, /api/products*) も 404 を返す。管理画面 (/admin/*) は対象外。
 */
import { z } from 'zod';

/** AppSetting に保存する設定キー */
export const SITE_SECTION_VISIBILITY_KEY = 'site.sectionVisibility';

export const SiteSectionVisibilitySchema = z.object({
  /** コンテンツ (ブログ/ギャラリー) セクションを公開するか */
  contentsVisible: z.boolean().default(true),
  /** グッズ ( EC) セクションを公開するか */
  productsVisible: z.boolean().default(true),
});

export type SiteSectionVisibility = z.infer<typeof SiteSectionVisibilitySchema>;

/** 未設定時の既定値 (安全側 = 通常運用と同じ「両方公開」) */
export const DEFAULT_SITE_SECTION_VISIBILITY: SiteSectionVisibility = {
  contentsVisible: true,
  productsVisible: true,
};
