import { z } from 'zod';

// =====================================================================
// Call Event (特典会 1on1) スキーマ
// =====================================================================

// シリアルコード本体: 大文字 + 数字のみ (ハイフン無視)。
// 大小文字混在やハイフン入りで届いても DB ルックアップ前に正規化する。
// 形式は実運用上 12 文字想定 (ABCD-1234-EFGH = 12char ハイフン除去) だが、
// 将来の長さ変更に備えて 8〜32 文字を許可する。
export const SerialCodeRawSchema = z
  .string()
  .min(1, 'シリアルコードを入力してください')
  .max(40, 'シリアルコードが長すぎます');
export type SerialCodeRaw = z.infer<typeof SerialCodeRawSchema>;

/**
 * 入力された生シリアルコードを正規化する。
 * - 前後空白除去 / 全角→半角 / 小文字→大文字 / ハイフン/スペース除去
 * - 結果が英数字以外を含む場合は null を返す (バリデーション失敗扱い)
 */
export function normalizeSerialCode(input: string): string | null {
  const half = input
    .replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, ' ');
  const compact = half.replace(/[\s\-_]+/g, '').toUpperCase();
  if (compact.length === 0) return null;
  if (!/^[A-Z0-9]+$/.test(compact)) return null;
  return compact;
}

// シリアル引換 API 入力
export const RedeemCallSerialSchema = z.object({
  code: SerialCodeRawSchema,
});
export type RedeemCallSerialInput = z.infer<typeof RedeemCallSerialSchema>;

// イベント作成 (管理者)
export const CreateCallEventSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  noticeText: z.string().max(4000).optional().nullable(),
  performerId: z.uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional().nullable(),
  perFanSeconds: z.coerce.number().int().min(15).max(600).default(60),
});
export type CreateCallEventInput = z.infer<typeof CreateCallEventSchema>;

// イベント更新 (管理者)
export const UpdateCallEventSchema = CreateCallEventSchema.partial().extend({
  status: z
    .enum(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELED'])
    .optional(),
});
export type UpdateCallEventInput = z.infer<typeof UpdateCallEventSchema>;

// シリアル発行 (管理者)
export const IssueCallSerialsSchema = z.object({
  count: z.coerce.number().int().min(1).max(2000),
});
export type IssueCallSerialsInput = z.infer<typeof IssueCallSerialsSchema>;

// キュー操作 (管理者): 次の人を本ルームへ
export const CallNextFanSchema = z.object({
  // 明示的に「現在 IN_MAIN_ROOM の人を終了して次へ進める」かどうか。
  // false の場合は最初の WAITING/IN_WAITING_ROOM の人を IN_MAIN_ROOM にするだけ。
  closeCurrent: z.boolean().default(true),
});
export type CallNextFanInput = z.infer<typeof CallNextFanSchema>;

// キュー操作 (管理者): 特定チケットをスキップ (NO_SHOW にする)
export const SkipCallTicketSchema = z.object({
  ticketId: z.uuid(),
});
export type SkipCallTicketInput = z.infer<typeof SkipCallTicketSchema>;

// キュー操作 (管理者): NO_SHOW チケットを WAITING に戻す (救済)
export const RestoreCallTicketSchema = z.object({
  ticketId: z.uuid(),
});
export type RestoreCallTicketInput = z.infer<typeof RestoreCallTicketSchema>;

// 待機室入室 (ファン)
// 入室時にチケット状態を WAITING → IN_WAITING_ROOM に進める。
export const EnterCallWaitingRoomSchema = z.object({
  ticketId: z.uuid(),
});
export type EnterCallWaitingRoomInput = z.infer<typeof EnterCallWaitingRoomSchema>;

// =====================================================================
// SSE イベントペイロード
// =====================================================================

// 待機キューのライブ状態
export interface CallQueueSnapshot {
  eventId: string;
  status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELED';
  // 現在本ルームにいるチケット (居れば)
  current: {
    ticketId: string;
    queuePos: number;
    displayName: string | null;
    enteredMainAt: string | null; // ISO
  } | null;
  // 自分の現在位置 (チケットがあれば)
  me: {
    ticketId: string;
    queuePos: number;
    status: 'WAITING' | 'IN_WAITING_ROOM' | 'IN_MAIN_ROOM' | 'DONE' | 'NO_SHOW';
    aheadCount: number; // 自分より前で未処理の人数
  } | null;
}
