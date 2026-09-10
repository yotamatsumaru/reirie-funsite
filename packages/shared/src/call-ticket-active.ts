/**
 * call-ticket-active — 「まだ有効な 1on1 チケット」の判定ロジック
 *
 * 【なぜ必要か / アプリ側で起きていた問題】
 * シリアルコードを引き換えた後にアプリを閉じると、待機室へ戻る手段が無かった。
 * コードを再入力しても «使用済み» になるため詰んでしまう。
 * 通知タップからは戻れるが、通知を許可していない人は復帰できない。
 *
 * そこで「自分の有効なチケット」を返す API が必要になった。
 * その «有効» の判定をここに集約する
 * (画面・API で別々に判定するとズレて «出るはずのバナーが出ない» 事故になる)。
 */

/** CallTicket.status のリテラル */
export type CallTicketStatusLiteral =
  | 'WAITING'
  | 'IN_WAITING_ROOM'
  | 'IN_MAIN_ROOM'
  | 'DONE'
  | 'NO_SHOW';

/** CallEvent.status のリテラル */
export type CallEventStatusLiteral = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELED';

/**
 * 「これ以上ユーザーが何もできない」チケット状態。
 * 通話が終わった / 呼ばれたのに応答が無かった。
 */
export const FINISHED_TICKET_STATUSES: readonly CallTicketStatusLiteral[] = [
  'DONE',
  'NO_SHOW',
];

/**
 * 「もう参加できない」イベント状態。
 */
export const CLOSED_EVENT_STATUSES: readonly CallEventStatusLiteral[] = [
  'ENDED',
  'CANCELED',
];

/**
 * チケットがまだ有効か (待機室へ戻す導線を出すべきか)。
 *
 * 有効な条件:
 *   - チケットが DONE / NO_SHOW でない
 *   - イベントが ENDED / CANCELED でない
 *
 * 【IN_MAIN_ROOM を含める理由】
 * 通話中に回線が切れてアプリを開き直した場合、まさに «戻りたい» 状態なので
 * 有効として扱う。ここを除外すると、通話中の事故から復帰できない。
 */
export function isActiveCallTicket(params: {
  ticketStatus: CallTicketStatusLiteral;
  eventStatus: CallEventStatusLiteral;
}): boolean {
  if (FINISHED_TICKET_STATUSES.includes(params.ticketStatus)) return false;
  if (CLOSED_EVENT_STATUSES.includes(params.eventStatus)) return false;
  return true;
}

/**
 * アプリのホームバナーが取るべき動作。
 *
 *   'enter_waiting' … 有効なチケットがある → 待機室へ直行
 *   'redeem'        … チケットが無い       → シリアル入力へ
 */
export type CallBannerAction = 'enter_waiting' | 'redeem';

export function callBannerAction(activeTicketCount: number): CallBannerAction {
  return activeTicketCount > 0 ? 'enter_waiting' : 'redeem';
}

/**
 * 複数の有効チケットがある場合の «おすすめ» 並び順。
 *
 * 実運用では 1 イベント 1 チケットだが、複数イベントのチケットを
 * 同時に持つことはあり得る。その場合アプリのバナーには 1 つだけ出すため、
 * 「いま行くべきもの」を先頭にする必要がある。
 *
 * 優先順位:
 *   1. 通話中 (IN_MAIN_ROOM)        … 今まさに戻るべき
 *   2. 開催中のイベント (LIVE)      … 今日始まっている
 *   3. 待機室入室済み               … 参加意思を示している
 *   4. 開始時刻が近いもの
 */
const TICKET_PRIORITY: Record<CallTicketStatusLiteral, number> = {
  IN_MAIN_ROOM: 0,
  IN_WAITING_ROOM: 1,
  WAITING: 2,
  DONE: 9,
  NO_SHOW: 9,
};

export type SortableTicket = {
  ticketStatus: CallTicketStatusLiteral;
  eventStatus: CallEventStatusLiteral;
  /** イベント開始時刻 (ミリ秒)。比較用 */
  startsAtMs: number;
};

export function compareActiveTickets(a: SortableTicket, b: SortableTicket): number {
  // 1. 通話中を最優先
  const pa = TICKET_PRIORITY[a.ticketStatus] ?? 9;
  const pb = TICKET_PRIORITY[b.ticketStatus] ?? 9;
  if (pa !== pb) return pa - pb;

  // 2. 開催中 (LIVE) を優先
  const la = a.eventStatus === 'LIVE' ? 0 : 1;
  const lb = b.eventStatus === 'LIVE' ? 0 : 1;
  if (la !== lb) return la - lb;

  // 3. 開始が早いもの (= 直近) を先に
  return a.startsAtMs - b.startsAtMs;
}

/**
 * 待機室へ入れる状態か。
 *
 * イベントが SCHEDULED の間は «まだ始まっていない» ため、
 * アプリは「開始までお待ちください」を出したい。
 * LIVE なら実際に入室できる。
 */
export function canEnterWaitingRoom(eventStatus: CallEventStatusLiteral): boolean {
  return eventStatus === 'LIVE';
}
