/**
 * サイト全体のメンテナンスモード設定。
 *
 * - ON にすると、SUPER_ADMIN 以外のすべての訪問者 (未ログインの一般ユーザー・
 *   USER・ADMIN を含む) はサイトを閲覧できなくなり、メンテナンス案内ページ
 *   (/maintenance) にリダイレクトされる。
 * - SUPER_ADMIN だけは通常どおり全ページを閲覧・操作できるため、メンテナンス中の
 *   動作確認や設定変更が可能。
 * - middleware (Edge) が JWT の role を参照して制御するため、ページ・API ともに
 *   ブロックされる (静的アセット・認証エンドポイント・メンテページ自体は除外)。
 * - AppSetting (site.maintenance) に JSON で永続化する。SUPER_ADMIN が
 *   /super-admin/settings から ON/OFF でき、切り替えは即時反映される。
 */
import { z } from 'zod';

/** AppSetting に保存する設定キー */
export const MAINTENANCE_SETTING_KEY = 'site.maintenance';

/**
 * 【重要 / 部分更新バグ対策】各フィールドに .default() を付けてはならない。
 * PATCH API では `.partial()` したスキーマで「変更されたフィールドだけ」を受け取り
 * サーバー側で保存済みの値にマージするが、Zod の `.partial()` は default を残すため、
 * default があると送られなかったフィールドまで既定値で上書きされてしまう
 * (例: enabled だけ変更したつもりが message も '' に戻る)。
 * 既定値は DEFAULT_MAINTENANCE_SETTING で一元管理する。
 */
export const MaintenanceSettingSchema = z.object({
  /** メンテナンスモードを有効にするか (true = SUPER_ADMIN 以外は閲覧不可) */
  enabled: z.boolean(),
  /** メンテナンス案内ページに表示する任意のメッセージ (空欄なら既定文言) */
  message: z.string().max(500),
});

export type MaintenanceSetting = z.infer<typeof MaintenanceSettingSchema>;

/** 未設定時の既定値 (安全側 = 通常運用) */
export const DEFAULT_MAINTENANCE_SETTING: MaintenanceSetting = {
  enabled: false,
  message: '',
};

/** メンテナンス案内ページの既定メッセージ */
export const DEFAULT_MAINTENANCE_MESSAGE =
  'ただいまシステムメンテナンスを実施しております。ご不便をおかけしますが、しばらく経ってから再度アクセスしてください。';
