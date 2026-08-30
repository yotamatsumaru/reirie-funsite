/**
 * 登録メールアドレス変更の業務ロジック
 *
 * 【全体の流れ】
 *   1. requestEmailChange()  … パスワードで本人確認 → 新アドレス宛に確認コード送信
 *                              (この時点では users.email はまだ変わらない)
 *   2. verifyEmailChange()   … 届いたコードを検証 → users.email を書き換え
 *                              → 旧アドレスへ「変更されました」を通知
 *   3. cancelEmailChange()   … 手続き中の申請を取り消す
 *
 * 【なぜ 2 段階なのか】
 * メールアドレスはログイン ID 兼パスワードリセットの送信先。
 * 1 段階で確定させると、打ち間違えた瞬間に本人がログインできなくなり、
 * リセットメールも届かないため自力復旧が不可能になる。
 * 「新アドレスでメールを受け取れること」を確認してから確定する。
 */
import { prisma, Prisma } from '@idol/db';
import {
  EMAIL_CHANGE_CODE_TTL_MINUTES,
  isSameEmail,
  isEmailChangePending,
  isEmailChangeResendCoolingDown,
  hasExceededEmailChangeAttempts,
  maskEmail,
  normalizeEmailForComparison,
} from '@idol/shared';
import { generateVerificationCode } from './verification-code';
import { sendEmailChangeCodeEmail, sendEmailChangedNoticeEmail } from './email';
import { logAudit } from './audit';

/** 申請・確定の結果。呼び出し側 (API ルート) が HTTP ステータスに変換する。 */
export type EmailChangeResult =
  | { ok: true; pendingEmail: string; expiresAt: Date }
  | { ok: false; reason: EmailChangeFailureReason; message: string };

export type EmailChangeFailureReason =
  | 'INVALID_PASSWORD'
  | 'SAME_EMAIL'
  | 'EMAIL_TAKEN'
  | 'COOLING_DOWN'
  | 'NO_PENDING'
  | 'EXPIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'INVALID_CODE'
  | 'SEND_FAILED';

export type EmailChangeStatus = {
  currentEmail: string;
  /** 手続き中の新アドレス (期限切れなら null)。画面に「確認待ち」を出すために使う。 */
  pendingEmail: string | null;
  expiresAt: Date | null;
};

function expiryFromNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + EMAIL_CHANGE_CODE_TTL_MINUTES * 60 * 1000);
}

/**
 * 保留状態をすべてクリアする際の共通データ。
 * 「確定した」「取り消した」「期限切れで無効化した」のいずれでも同じ形に戻す。
 */
const CLEARED_PENDING = {
  pendingEmail: null,
  pendingEmailCode: null,
  pendingEmailExpires: null,
  pendingEmailAttempts: 0,
} as const;

/** 現在の変更手続き状況を取得する (マイページ表示用)。 */
export async function getEmailChangeStatus(userId: string): Promise<EmailChangeStatus | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      pendingEmail: true,
      pendingEmailExpires: true,
    },
  });
  if (!user) return null;

  // 期限切れの申請は「無い」ものとして返す。
  // DB 上には残っていても、画面に「手続き中」と出し続けると
  // 利用者が次の申請をしてよいのか判断できなくなるため。
  const pending = isEmailChangePending({
    pendingEmail: user.pendingEmail,
    expiresAt: user.pendingEmailExpires,
  });

  return {
    currentEmail: user.email,
    pendingEmail: pending ? user.pendingEmail : null,
    expiresAt: pending ? user.pendingEmailExpires : null,
  };
}

/**
 * メールアドレス変更を申請する。
 *
 * @param verifyPasswordFn パスワード照合関数。テスト時に差し替えられるよう引数で受ける
 *                         (本番は verifyPassword をそのまま渡す)。
 *                         デモモードなど検証を省略したい場合は () => true を渡す。
 */
export async function requestEmailChange(params: {
  userId: string;
  newEmail: string;
  password: string;
  verifyPasswordFn: (password: string, hash: string | null) => boolean;
}): Promise<EmailChangeResult> {
  const newEmail = normalizeEmailForComparison(params.newEmail);

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      passwordHash: true,
      pendingEmail: true,
      pendingEmailExpires: true,
    },
  });
  if (!user) {
    return { ok: false, reason: 'INVALID_PASSWORD', message: 'ユーザーが見つかりません' };
  }

  // --- 1. 本人確認 ---
  // セッションを盗まれただけでアカウントを乗っ取られないようにする最重要ガード。
  if (!params.verifyPasswordFn(params.password, user.passwordHash)) {
    return {
      ok: false,
      reason: 'INVALID_PASSWORD',
      message: 'パスワードが正しくありません',
    };
  }

  // --- 2. 現在と同じアドレスなら何もしない ---
  // citext と揃えた比較 (isSameEmail) を使う。大文字小文字違いを
  // 「変更」と誤認すると、無意味なメールを送ってしまう。
  if (isSameEmail(user.email, newEmail)) {
    return {
      ok: false,
      reason: 'SAME_EMAIL',
      message: '現在ご登録のメールアドレスと同じです',
    };
  }

  // --- 3. 既に他の会員が使っていないか ---
  // ここで弾いても確定時に再チェックする (申請〜確定の間に他人が
  // そのアドレスで新規登録する可能性があるため)。
  const taken = await prisma.user.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });
  if (taken && taken.id !== user.id) {
    return {
      ok: false,
      reason: 'EMAIL_TAKEN',
      message: 'このメールアドレスは既に使用されています',
    };
  }

  // --- 4. 連打によるメール大量送信を防ぐ ---
  // 同じ宛先へ申請を繰り返している場合のみクールダウンを適用する。
  // 宛先を変えた場合 (打ち間違いに気づいて直した場合) は
  // 待たせると体験が悪いので、すぐ送り直せるようにする。
  if (
    user.pendingEmail &&
    isSameEmail(user.pendingEmail, newEmail) &&
    isEmailChangeResendCoolingDown({ expiresAt: user.pendingEmailExpires })
  ) {
    return {
      ok: false,
      reason: 'COOLING_DOWN',
      message: 'しばらく待ってから再度お試しください',
    };
  }

  const code = generateVerificationCode();
  const expiresAt = expiryFromNow();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      pendingEmail: newEmail,
      pendingEmailCode: code,
      pendingEmailExpires: expiresAt,
      // 宛先が変わったら試行回数はリセットする (前の申請の失敗を引きずらない)。
      pendingEmailAttempts: 0,
    },
  });

  // --- 5. 新アドレス宛に確認コードを送る ---
  // 送信に失敗した場合は保留を残さない。残すと利用者の画面には
  // 「確認コードを送信しました」と出ているのにメールが来ない、という
  // 手詰まりの状態になるため、申請自体を無かったことにして再試行を促す。
  try {
    await sendEmailChangeCodeEmail({
      to: newEmail,
      displayName: user.displayName ?? '',
      code,
      expiresInMinutes: EMAIL_CHANGE_CODE_TTL_MINUTES,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[email-change] failed to send verification code', err);
    await prisma.user.update({ where: { id: user.id }, data: { ...CLEARED_PENDING } });
    await logAudit({
      userId: user.id,
      action: 'user.email_change.send_failed',
      metadata: { reason: err instanceof Error ? err.message : 'unknown' },
    });
    return {
      ok: false,
      reason: 'SEND_FAILED',
      message: '確認コードの送信に失敗しました。時間をおいて再度お試しください',
    };
  }

  await logAudit({
    userId: user.id,
    action: 'user.email_change.requested',
    // 監査ログに新アドレスを平文で残さない (ログ閲覧者に個人情報を広げないため)。
    metadata: { to: maskEmail(newEmail) },
  });

  return { ok: true, pendingEmail: newEmail, expiresAt };
}

function isUniqueViolation(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * 確認コードを検証してメールアドレスを確定する。
 *
 * 成功すると users.email が新アドレスに変わり、保留状態はクリアされる。
 */
export async function verifyEmailChange(params: {
  userId: string;
  code: string;
}): Promise<EmailChangeResult> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      pendingEmail: true,
      pendingEmailCode: true,
      pendingEmailExpires: true,
      pendingEmailAttempts: true,
    },
  });
  if (!user || !user.pendingEmail || !user.pendingEmailCode) {
    return {
      ok: false,
      reason: 'NO_PENDING',
      message: '変更手続きが見つかりません。最初からお試しください',
    };
  }

  // --- 期限切れ ---
  if (!isEmailChangePending({
    pendingEmail: user.pendingEmail,
    expiresAt: user.pendingEmailExpires,
  })) {
    // 期限切れの保留はここで掃除しておく (残しても使えないため)。
    await prisma.user.update({ where: { id: user.id }, data: { ...CLEARED_PENDING } });
    return {
      ok: false,
      reason: 'EXPIRED',
      message: '確認コードの有効期限が切れています。最初からお試しください',
    };
  }

  // --- 総当たり対策 ---
  if (hasExceededEmailChangeAttempts(user.pendingEmailAttempts)) {
    return {
      ok: false,
      reason: 'TOO_MANY_ATTEMPTS',
      message: '入力回数の上限に達しました。最初からお試しください',
    };
  }

  // --- コード不一致 ---
  if (user.pendingEmailCode !== params.code) {
    await prisma.user.update({
      where: { id: user.id },
      data: { pendingEmailAttempts: { increment: 1 } },
    });
    return { ok: false, reason: 'INVALID_CODE', message: '確認コードが正しくありません' };
  }

  // --- 確定直前にもう一度重複チェック ---
  // 申請してから確定するまでの間に、他の人がそのアドレスで
  // 新規登録している可能性がある。
  const taken = await prisma.user.findUnique({
    where: { email: user.pendingEmail },
    select: { id: true },
  });
  if (taken && taken.id !== user.id) {
    await prisma.user.update({ where: { id: user.id }, data: { ...CLEARED_PENDING } });
    return {
      ok: false,
      reason: 'EMAIL_TAKEN',
      message: 'このメールアドレスは既に使用されています',
    };
  }

  const previousEmail = user.email;
  const newEmail = user.pendingEmail;

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: newEmail,
        // 新アドレスは「コードを受信できた」ことで所有を確認済みなので、
        // 認証済みのまま維持する。ここを null にすると
        // 変更した瞬間にログインできなくなってしまう
        // (credentials.ts が !emailVerified を弾くため)。
        emailVerified: new Date(),
        ...CLEARED_PENDING,
      },
    });
  } catch (e) {
    // DB の一意制約 (citext) による最終防衛線。
    // 上の重複チェックとの間に割り込まれた場合はここで捕まえる。
    if (isUniqueViolation(e)) {
      await prisma.user.update({ where: { id: user.id }, data: { ...CLEARED_PENDING } });
      return {
        ok: false,
        reason: 'EMAIL_TAKEN',
        message: 'このメールアドレスは既に使用されています',
      };
    }
    throw e;
  }

  await logAudit({
    userId: user.id,
    action: 'user.email_change.completed',
    metadata: { from: maskEmail(previousEmail), to: maskEmail(newEmail) },
  });

  // --- 旧アドレスへの通知 (セキュリティ通知) ---
  // 乗っ取り時に本人が気づける最後の手段。ただしここで失敗しても
  // 変更自体は既に成功しているため、処理は止めない。
  try {
    await sendEmailChangedNoticeEmail({
      to: previousEmail,
      displayName: user.displayName ?? '',
      maskedNewEmail: maskEmail(newEmail),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[email-change] failed to notify previous address', err);
    await logAudit({
      userId: user.id,
      action: 'user.email_change.notice_failed',
      metadata: { reason: err instanceof Error ? err.message : 'unknown' },
    });
  }

  return { ok: true, pendingEmail: newEmail, expiresAt: new Date() };
}

/** 手続き中の変更申請を取り消す。 */
export async function cancelEmailChange(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { ...CLEARED_PENDING },
  });
  await logAudit({ userId, action: 'user.email_change.canceled' });
}
