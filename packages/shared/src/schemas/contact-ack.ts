import { z } from 'zod';

/**
 * お問い合わせの「控えメール」機能に関する純粋ロジック・スキーマ。
 *
 * 【この機能が必要になった経緯】
 * 会員様から次のご要望をいただいた:
 *   「お問い合わせした際に送った内容のコピーをメールアドレス宛に送る機能を
 *     つけてくださると届いているのか届いていないのかわかる」
 * 実際に POST /api/contact はレコードを保存するだけで、送信者へメールを一切
 * 送っていなかった。そのため送信者は「本当に届いたのか」を確認できなかった。
 *
 * 【あわせて運営側の通知も入れる理由】
 * ある問い合わせが 2 週間気づかれないまま放置された事例があった。原因は
 * 「新規問い合わせが届いても運営に通知が飛ばない」ことで、管理画面を
 * 自発的に開かないと気づけない設計だったため。控えメール (会員向け) だけ
 * 入れても運営側の見落としは解決しないので、受信通知もセットで扱う。
 *
 * このファイルには DB / メール送信に依存しない純粋関数のみを置く
 * (単体テストで挙動を固定できるようにするため)。
 */

// ---------------------------------------------------------------------------
// 受付番号 (お問い合わせ番号)
// ---------------------------------------------------------------------------

/**
 * 受付番号の接頭辞。CT = ConTact。
 * 会員・運営の双方が口頭/メールで参照できる短い ID にする。
 */
export const CONTACT_TICKET_PREFIX = 'CT';

/**
 * 受付番号のランダム部の文字集合。
 *
 * 【なぜ全英数字を使わないか】
 * 受付番号は「メールに書かれた番号を会員が読み上げる / 手で打ち直す」
 * 前提のため、見間違いやすい文字を意図的に除外している:
 *   - O (オー) と 0 (ゼロ)
 *   - I (アイ) と 1 (イチ) と L (エル)
 * 除外の結果、1 文字あたり 32 通り (= 2^5) になり計算しやすい。
 */
export const CONTACT_TICKET_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 受付番号のランダム部の長さ。32^5 = 約 3355 万通り。 */
export const CONTACT_TICKET_RANDOM_LENGTH = 5;

/**
 * 受付番号の書式。
 *   CT-20260902-7K3QF
 *   ^^ ^^^^^^^^ ^^^^^
 *   |  |        └ ランダム部 (CONTACT_TICKET_ALPHABET から 5 文字)
 *   |  └ 受付日 (JST の YYYYMMDD)
 *   └ 接頭辞
 *
 * 日付を含めるのは、運営が番号を見た時点で「いつの問い合わせか」が
 * 分かるようにするため (古い問い合わせの取り違え防止)。
 */
export const CONTACT_TICKET_PATTERN = new RegExp(
  `^${CONTACT_TICKET_PREFIX}-\\d{8}-[${CONTACT_TICKET_ALPHABET}]{${CONTACT_TICKET_RANDOM_LENGTH}}$`,
);

/**
 * Date を JST の YYYYMMDD 文字列にする。
 *
 * 【なぜ UTC でなく JST か】
 * 会員・運営ともに日本時間で運用しているため、受付番号に含まれる日付が
 * 「メールに書かれた受信時刻の日付」と食い違わないようにする。
 * 例: 2026-09-02 08:00 JST は UTC では 09-01 なので、UTC 基準だと
 *     前日の番号が振られてしまい問い合わせの照合時に混乱する。
 */
export function toJstDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

/**
 * 受付番号を生成する。
 *
 * @param now      受付日時 (既定: 現在時刻)。JST に変換して日付部に使う。
 * @param randomFn 0 以上 1 未満の乱数を返す関数 (既定: Math.random)。
 *                 テストから決定的に生成できるよう注入可能にしている。
 *
 * 【衝突について】
 * ランダム部は 32^5 ≈ 3355 万通りだが、DB 側で @unique を張り、
 * 生成側 (サーバー) は一意制約違反 (P2002) で数回リトライする。
 * 「番号が重複したまま保存される」ことは起こらない設計。
 */
export function generateContactTicketNumber(
  now: Date = new Date(),
  randomFn: () => number = Math.random,
): string {
  let random = '';
  for (let i = 0; i < CONTACT_TICKET_RANDOM_LENGTH; i += 1) {
    // randomFn が 1 を返す実装でも範囲外アクセスにならないよう clamp する。
    const raw = randomFn();
    const ratio = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
    const index = Math.floor(ratio * CONTACT_TICKET_ALPHABET.length);
    random += CONTACT_TICKET_ALPHABET.charAt(index);
  }
  return `${CONTACT_TICKET_PREFIX}-${toJstDateKey(now)}-${random}`;
}

/** 受付番号として妥当な書式かどうか。 */
export function isValidContactTicketNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  return CONTACT_TICKET_PATTERN.test(value);
}

/**
 * 受付番号の表示用ラベル。
 * 未採番 (機能追加前の既存レコード) の場合はハイフンを返し、
 * 管理画面で「null」や空欄が出ないようにする。
 */
export function formatContactTicketNumber(value: string | null | undefined): string {
  return isValidContactTicketNumber(value) ? (value as string) : '—';
}

// ---------------------------------------------------------------------------
// 控えメールの本文組み立て (プレーンテキスト部分の純粋ロジック)
// ---------------------------------------------------------------------------

/**
 * メール本文に差し込む「送信内容」ブロック。
 * 会員が「自分が何を送ったか」を後から確認できることが要望の本質なので、
 * 入力値をそのまま (改変せず) 引用する。
 */
export function buildContactEchoBlock(params: {
  ticketNumber: string;
  categoryLabel: string;
  subject: string;
  message: string;
  name: string;
  email: string;
  receivedAtLabel: string;
}): string {
  return (
    `受付番号: ${params.ticketNumber}\n` +
    `受付日時: ${params.receivedAtLabel}\n` +
    `お名前  : ${params.name}\n` +
    `メール  : ${params.email}\n` +
    `種別    : ${params.categoryLabel}\n` +
    `件名    : ${params.subject}\n` +
    `\n` +
    `【お問い合わせ内容】\n` +
    `${params.message}`
  );
}

/** 受付日時の表示ラベル (JST)。控えメール・通知メールで共用する。 */
export function formatContactReceivedAt(at: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

// ---------------------------------------------------------------------------
// 通知設定 (AppSetting)
// ---------------------------------------------------------------------------

/**
 * お問い合わせ通知設定を保存する AppSetting のキー。
 * value は ContactNotificationSettingsSchema に沿った JSON。
 */
export const CONTACT_NOTIFICATION_SETTING_KEY = 'contact.notification';

/** 運営通知の宛先に登録できる上限件数 (誤設定による大量送信の抑止)。 */
export const CONTACT_ADMIN_EMAIL_MAX = 10;

/**
 * 既定の通知設定。
 *
 * 【なぜ ackMailEnabled の既定を true にするか】
 * 会員からのご要望そのものであり、送信者本人への控え送信は
 * 情報漏洩のリスクがない (本人が入力したアドレスへ本人の入力内容を返すだけ)。
 * 導入直後から効いていないと要望に応えられないため既定で有効。
 *
 * 【なぜ adminEmails の既定が空か】
 * 宛先を勝手に決めると誤送信になる。運営が管理画面で明示的に登録する。
 * 空の場合は運営通知はスキップされる (エラーにはしない)。
 */
export const DEFAULT_CONTACT_NOTIFICATION_SETTINGS = {
  ackMailEnabled: true,
  adminNotifyEnabled: true,
  adminEmails: [] as string[],
};

export const ContactNotificationSettingsSchema = z.object({
  /** 送信者本人へ控えメールを送るか。 */
  ackMailEnabled: z.boolean().default(DEFAULT_CONTACT_NOTIFICATION_SETTINGS.ackMailEnabled),
  /** 運営へ新規受信通知メールを送るか。 */
  adminNotifyEnabled: z
    .boolean()
    .default(DEFAULT_CONTACT_NOTIFICATION_SETTINGS.adminNotifyEnabled),
  /** 運営通知の宛先。空配列なら通知は送られない。 */
  adminEmails: z
    .array(z.email('メールアドレスの形式が正しくありません').max(254))
    .max(CONTACT_ADMIN_EMAIL_MAX, `宛先は${CONTACT_ADMIN_EMAIL_MAX}件までです`)
    .default(DEFAULT_CONTACT_NOTIFICATION_SETTINGS.adminEmails),
});
export type ContactNotificationSettings = z.infer<typeof ContactNotificationSettingsSchema>;

/**
 * 宛先リストを正規化する (小文字化・トリム・重複除去・空要素除去)。
 * 管理画面はテキストエリアに 1 行 1 件で入力させるため、
 * 「同じアドレスを 2 回書いてしまい 2 通届く」事故を防ぐ。
 */
export function normalizeAdminEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * 改行 / カンマ区切りのテキストを宛先配列にパースする (管理画面の入力用)。
 * 正規化まで行うので、そのまま ContactNotificationSettingsSchema に渡せる。
 */
export function parseAdminEmailsText(text: string): string[] {
  return normalizeAdminEmails(text.split(/[\n,;]/));
}

/** 宛先配列を管理画面のテキストエリア表示用の文字列に戻す。 */
export function stringifyAdminEmails(emails: readonly string[]): string {
  return emails.join('\n');
}

/**
 * 実際に運営通知を送るべきか (設定 + 宛先の両方が揃っているか)。
 * 「ON にしたのに宛先が空」というありがちな設定ミスをここで一箇所に閉じ込める。
 */
export function shouldNotifyAdmins(settings: ContactNotificationSettings): boolean {
  return settings.adminNotifyEnabled && settings.adminEmails.length > 0;
}

/**
 * 送信者本人のアドレスが運営通知の宛先に含まれている場合、そのアドレスを
 * 運営通知の宛先から除外する。
 *
 * 【なぜ必要か】
 * 運営スタッフ自身がテストで問い合わせを送ったときに、控えメールと
 * 運営通知メールが同じ受信箱に 2 通届き「二重送信のバグでは?」と
 * 誤解される。通知の意味も薄いので、重複する宛先は落とす。
 */
export function adminRecipientsExcludingSender(
  settings: ContactNotificationSettings,
  senderEmail: string,
): string[] {
  const sender = senderEmail.trim().toLowerCase();
  return settings.adminEmails.filter((e) => e !== sender);
}
