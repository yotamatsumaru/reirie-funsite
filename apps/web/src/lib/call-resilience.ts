/**
 * call-resilience — 1on1 コールの «繋がらない / 切れる» を減らすための純ロジック
 *
 * ブラウザ API には依存しない純関数のみを置く (テスト可能に保つため)。
 * DOM / WebRTC を触る処理は components/call/CallRoom.tsx 側。
 *
 * ここで扱う 3 つの問題:
 *
 *  1. カメラの無い PC で通話できない
 *     デスクトップ PC はカメラ非搭載が珍しくない。従来は
 *     「exact 指定 → ideal 指定」で再試行していたが、**どちらも映像を要求する**
 *     ため、カメラが無い端末は両方失敗して通話に入れなかった。
 *     さらにエラーメッセージが一律「アクセスが拒否されました」だったため、
 *     利用者は «拒否していないのに» と混乱して原因に辿り着けない。
 *     → 最後に «音声のみ» を試す + エラー種別ごとに文言を出し分ける。
 *
 *  2. スマホの回線切替・画面ロックで通話が即終了する
 *     connectionState の 'disconnected' は **一時的に発生する状態** で、
 *     Wi-Fi ⇄ モバイル回線の切替や画面ロックで日常的に起きる。
 *     即 'ended' にすると復帰できるはずの通話が終わってしまう。
 *     → 猶予時間を置き、戻らなければ ICE 再接続を試みる。
 *
 *  3. (Wake Lock は副作用を伴うので use-wake-lock.ts 側)
 */

// ---------------------------------------------------------------
// 1. getUserMedia のエラー分類とフォールバック
// ---------------------------------------------------------------

/** getUserMedia 失敗の種別 */
export type MediaErrorKind =
  /** ユーザーが «許可しない» を選んだ / ブラウザ設定でブロック */
  | 'denied'
  /** カメラ (やマイク) が端末に存在しない */
  | 'not-found'
  /** 他アプリが使用中で開けない */
  | 'in-use'
  /** 要求した条件を満たすデバイスが無い */
  | 'overconstrained'
  /** http:// など安全でない文脈。getUserMedia 自体が使えない */
  | 'insecure'
  /** ブラウザが WebRTC 非対応 */
  | 'unsupported'
  | 'unknown';

/**
 * DOMException の name から失敗種別を判定する。
 *
 * name はブラウザによって表記ゆれがあるため
 * (Chrome: NotFoundError / 旧 Firefox: DevicesNotFoundError など)、
 * 完全一致ではなく «含む» で判定する。
 */
export function classifyMediaError(err: unknown): MediaErrorKind {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';

  if (name.includes('NotAllowed') || name.includes('PermissionDenied')) return 'denied';
  if (name.includes('NotFound') || name.includes('DevicesNotFound')) return 'not-found';
  if (name.includes('NotReadable') || name.includes('TrackStart')) return 'in-use';
  if (name.includes('Overconstrained') || name.includes('ConstraintNotSatisfied')) {
    return 'overconstrained';
  }
  if (name.includes('Security')) return 'insecure';
  if (name.includes('NotSupported') || name.includes('TypeError')) return 'unsupported';
  return 'unknown';
}

/**
 * 利用者向けのエラー文言。
 *
 * 「何が起きたか」だけでなく **次に何をすればよいか** まで書く。
 * 原因不明の「拒否されました」は利用者が対処できないため避ける。
 */
export function mediaErrorMessage(kind: MediaErrorKind): string {
  switch (kind) {
    case 'denied':
      return 'カメラ・マイクの使用が許可されていません。ブラウザのアドレスバー左側のアイコンから「許可」に変更して、もう一度お試しください。';
    case 'not-found':
      return 'カメラもマイクも見つかりませんでした。マイクを接続してから、もう一度お試しください。';
    case 'in-use':
      return 'カメラまたはマイクを他のアプリが使用中です。Zoom や他のビデオ通話アプリを終了してから、もう一度お試しください。';
    case 'overconstrained':
      return '選択したカメラ・マイクが使用できませんでした。設定から別のデバイスを選んでください。';
    case 'insecure':
      return 'この接続では通話を開始できません (安全な https 接続が必要です)。URL が https:// で始まっているかご確認ください。';
    case 'unsupported':
      return 'お使いのブラウザは通話に対応していません。iPhone は Safari、Android・PC は Chrome の最新版をお使いください。';
    default:
      return 'カメラ・マイクを開始できませんでした。ページを再読み込みして、もう一度お試しください。';
  }
}

/** getUserMedia に渡す 1 回分の試行 */
export type MediaAttempt = {
  /** この試行で映像を要求するか */
  video: boolean;
  /** deviceId を exact で指定するか (false なら ideal) */
  exact: boolean;
  /**
   * この試行で成功したときに利用者へ知らせる注意書き。
   * null なら «期待どおり» なので何も出さない。
   */
  note: string | null;
};

/**
 * getUserMedia の試行順を組み立てる。
 *
 * 1. 選択されたデバイスを exact で要求 (期待どおりの状態)
 * 2. ideal に落として再試行     … 指定デバイスが無い/使えない場合
 * 3. **音声のみ** で再試行        … カメラが無い PC の救済
 *
 * 3 を入れるまでは、カメラ非搭載 PC が通話に入れなかった。
 */
export function buildMediaAttempts(): MediaAttempt[] {
  return [
    { video: true, exact: true, note: null },
    {
      video: true,
      exact: false,
      note: '選択したカメラ／マイクが使用できなかったため、既定のデバイスで接続しました。',
    },
    {
      video: false,
      exact: false,
      note: 'カメラが見つからなかったため、音声のみで参加しています。相手の映像と音声は届きます。',
    },
  ];
}

/**
 * 「映像なしで再試行する価値があるか」。
 *
 * 権限そのものを拒否されている場合は、音声のみにしても同じく拒否されるため
 * 無駄な再試行 (と余計な権限ダイアログ) を避ける。
 */
export function shouldTryAudioOnly(kind: MediaErrorKind): boolean {
  return kind === 'not-found' || kind === 'overconstrained' || kind === 'in-use';
}

// ---------------------------------------------------------------
// 2. 切断の猶予と ICE 再接続
// ---------------------------------------------------------------

/**
 * 'disconnected' になってから «本当に切れた» と判断するまでの猶予 (ms)。
 *
 * スマホの Wi-Fi ⇄ モバイル回線の切替は数秒で復帰することが多い。
 * 短すぎると復帰できる通話を切ってしまい、長すぎると
 * 本当に切れたときに利用者を待たせる。
 */
export const DISCONNECT_GRACE_MS = 8000;

/** ICE 再接続を試みる最大回数 (無限リトライで電池を消費しないように) */
export const MAX_ICE_RESTARTS = 3;

/**
 * n 回目の ICE 再接続までの待ち時間 (ms)。
 * 立て続けに繰り返しても無駄なので指数的に伸ばす。
 */
export function iceRestartDelayMs(attempt: number): number {
  const n = Math.max(1, attempt);
  return Math.min(1000 * 2 ** (n - 1), 8000); // 1s, 2s, 4s, ... 上限 8s
}

/** connectionState に対して UI/制御が取るべき動作 */
export type ConnectionAction =
  /** 通話中として扱う */
  | 'in-call'
  /** 一時的な不通。猶予タイマーを開始し «再接続中» を表示 */
  | 'grace'
  /** 復旧不能。ICE 再接続を試みる (回数上限まで) */
  | 'recover'
  /** 通話終了 */
  | 'ended'
  /** 何もしない (new / connecting など) */
  | 'noop';

/**
 * connectionState から取るべき動作を決める。
 *
 * 【重要】'disconnected' を即 'ended' にしない。
 * これがスマホで «通話がすぐ切れる» 原因だった。
 */
export function actionForConnectionState(state: RTCPeerConnectionState): ConnectionAction {
  switch (state) {
    case 'connected':
      return 'in-call';
    case 'disconnected':
      return 'grace';
    case 'failed':
      return 'recover';
    case 'closed':
      return 'ended';
    default:
      return 'noop';
  }
}

/**
 * 猶予時間が過ぎた時点での判断。
 *
 * @param state    猶予後の connectionState
 * @param restarts これまでに ICE 再接続を試みた回数
 */
export function actionAfterGrace(
  state: RTCPeerConnectionState,
  restarts: number,
): ConnectionAction {
  if (state === 'connected') return 'in-call';
  if (state === 'closed') return 'ended';
  // まだ復帰していない → 上限まで ICE 再接続を試す
  return restarts < MAX_ICE_RESTARTS ? 'recover' : 'ended';
}
