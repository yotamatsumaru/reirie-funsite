/**
 * DM (REIRIE への DM) サービス層。
 *
 *  - NG ワード一覧は AppSetting (key: dm.ngWords) に JSON 配列で永続化する。
 *    未設定 / 破損時はデフォルト (DEFAULT_DM_NG_WORDS) を返す (安全側)。
 *  - 送信は checkDirectMessage でサーバー側でも最終チェックし、
 *    NG ワードを含むメッセージは保存しない (クライアントの判定は信用しない)。
 */
import { prisma } from '@idol/db';
import {
  DM_NG_WORDS_SETTING_KEY,
  DEFAULT_DM_NG_WORDS,
  normalizeNgWords,
  checkDirectMessage,
  resolvePreferredName,
} from '@idol/shared';

export class DmNgWordError extends Error {
  constructor(
    message: string,
    public ngWords: string[],
  ) {
    super(message);
    this.name = 'DmNgWordError';
  }
}

export class DmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DmValidationError';
  }
}

/** NG ワード一覧を取得する。未設定 / 破損時はデフォルトを返す。 */
export async function getNgWords(): Promise<string[]> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: DM_NG_WORDS_SETTING_KEY },
    });
    if (!row) return normalizeNgWords(DEFAULT_DM_NG_WORDS);
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return normalizeNgWords(DEFAULT_DM_NG_WORDS);
    return normalizeNgWords(parsed.map((v) => String(v)));
  } catch {
    return normalizeNgWords(DEFAULT_DM_NG_WORDS);
  }
}

/** NG ワード一覧を保存する (正規化してから保存)。 */
export async function setNgWords(words: readonly string[]): Promise<string[]> {
  const normalized = normalizeNgWords(words);
  const value = JSON.stringify(normalized);
  await prisma.appSetting.upsert({
    where: { key: DM_NG_WORDS_SETTING_KEY },
    create: { key: DM_NG_WORDS_SETTING_KEY, value },
    update: { value },
  });
  return normalized;
}

export interface SendDmResult {
  id: string;
  body: string;
  senderName: string | null;
  createdAt: Date;
}

/**
 * ファンから REIRIE へ DM を送信する。
 *  1. ユーザーの preferredName / displayName を取得して @ メンションを展開
 *  2. サーバー側で NG ワード・長さを最終チェック
 *  3. 問題なければ DirectMessage を作成
 *
 * @throws DmNgWordError NG ワードを含む場合
 * @throws DmValidationError 空 / 長すぎる場合
 */
export async function sendDirectMessage(
  userId: string,
  rawBody: string,
): Promise<SendDmResult> {
  const [user, ngWords] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { preferredName: true, displayName: true },
    }),
    getNgWords(),
  ]);

  const name = resolvePreferredName(user?.preferredName, user?.displayName);
  const check = checkDirectMessage(rawBody, name, ngWords);

  if (!check.ok) {
    if (check.reason === 'NG_WORD') {
      throw new DmNgWordError(
        '使用できない言葉が含まれています。表現を見直してください。',
        check.ngWords ?? [],
      );
    }
    throw new DmValidationError(
      check.reason === 'TOO_LONG'
        ? 'メッセージが長すぎます。'
        : 'メッセージを入力してください。',
    );
  }

  const created = await prisma.directMessage.create({
    data: {
      userId,
      senderName: name,
      body: check.body,
      status: 'SENT',
    },
    select: { id: true, body: true, senderName: true, createdAt: true },
  });
  return created;
}

/** 自分が送った DM 一覧を新しい順に取得する。 */
export async function listMyDirectMessages(userId: string, limit = 50) {
  return prisma.directMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      body: true,
      senderName: true,
      status: true,
      createdAt: true,
    },
  });
}

/** ユーザーの「呼んでほしい名前」を更新する (空文字 = 解除して null に)。 */
export async function updatePreferredName(
  userId: string,
  preferredName: string,
): Promise<string | null> {
  const value = preferredName.trim().length === 0 ? null : preferredName.trim();
  await prisma.user.update({
    where: { id: userId },
    data: { preferredName: value },
  });
  return value;
}
