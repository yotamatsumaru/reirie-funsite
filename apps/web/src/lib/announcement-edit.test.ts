import {
  BODY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  diffAnnouncementFields,
  hasNoChanges,
  mayTriggerEmailOnEdit,
  validateAnnouncementFields,
  type AnnouncementEditableFields,
} from './announcement-edit';

const base: AnnouncementEditableFields = {
  title: 'ライブのお知らせ',
  body: '9月3日(木) Veats Shibuya',
  audience: 'ALL',
  sendEmail: false,
};

describe('validateAnnouncementFields', () => {
  it('正常な入力は null (エラーなし)', () => {
    expect(validateAnnouncementFields(base)).toBeNull();
  });

  it('タイトルが空なら弾く', () => {
    expect(validateAnnouncementFields({ ...base, title: '' })).toBe(
      'タイトルは必須です',
    );
  });

  it('本文が空なら弾く', () => {
    expect(validateAnnouncementFields({ ...base, body: '' })).toBe(
      '本文は必須です',
    );
  });

  // API 側は min(1) なので、空白のみを送ると 422 になる。
  // 「見た目は空なのに保存できてしまう」のを防ぐ回帰テスト。
  it.each(['   ', '\n\n', '\t', '　'])(
    '空白だけのタイトル (%j) も空として扱う',
    (title) => {
      expect(validateAnnouncementFields({ ...base, title })).toBe(
        'タイトルは必須です',
      );
    },
  );

  it('空白だけの本文も空として扱う', () => {
    expect(validateAnnouncementFields({ ...base, body: '  \n ' })).toBe(
      '本文は必須です',
    );
  });

  it('上限ちょうどは通す', () => {
    expect(
      validateAnnouncementFields({
        ...base,
        title: 'あ'.repeat(TITLE_MAX_LENGTH),
        body: 'い'.repeat(BODY_MAX_LENGTH),
      }),
    ).toBeNull();
  });

  it('上限を1文字でも超えたら弾く', () => {
    expect(
      validateAnnouncementFields({
        ...base,
        title: 'あ'.repeat(TITLE_MAX_LENGTH + 1),
      }),
    ).toMatch(/タイトルは 200 文字以内/);
    expect(
      validateAnnouncementFields({
        ...base,
        body: 'い'.repeat(BODY_MAX_LENGTH + 1),
      }),
    ).toMatch(/本文は 4000 文字以内/);
  });
});

describe('diffAnnouncementFields', () => {
  it('変更が無ければ空オブジェクト', () => {
    const patch = diffAnnouncementFields(base, { ...base });
    expect(patch).toEqual({});
    expect(hasNoChanges(patch)).toBe(true);
  });

  it('変更したフィールドだけが含まれる', () => {
    const patch = diffAnnouncementFields(base, {
      ...base,
      title: '【変更】ライブのお知らせ',
    });
    expect(patch).toEqual({ title: '【変更】ライブのお知らせ' });
    expect(hasNoChanges(patch)).toBe(false);
  });

  it('本文だけ変えたときに sendEmail が混入しない (メール再送の防止)', () => {
    const original: AnnouncementEditableFields = { ...base, sendEmail: true };
    const patch = diffAnnouncementFields(original, {
      ...original,
      body: '誤字を直しました',
    });
    // ← ここに sendEmail が入ると emailStatus が PENDING に戻り、
    //   会員全員へメールが二重配信される
    expect(patch).toEqual({ body: '誤字を直しました' });
    expect(patch).not.toHaveProperty('sendEmail');
    expect(patch).not.toHaveProperty('audience');
  });

  it('trim した結果が同じなら変更なしとみなす', () => {
    const patch = diffAnnouncementFields(base, {
      ...base,
      title: `  ${base.title}  `,
      body: `\n${base.body}\n`,
    });
    expect(patch).toEqual({});
  });

  it('送る値は trim 済み', () => {
    const patch = diffAnnouncementFields(base, {
      ...base,
      title: '  新しいタイトル  ',
    });
    expect(patch.title).toBe('新しいタイトル');
  });

  it('audience の変更は拾う', () => {
    expect(
      diffAnnouncementFields(base, { ...base, audience: 'PREMIUM' }),
    ).toEqual({ audience: 'PREMIUM' });
  });

  it('sendEmail を明示的に切り替えたときだけ含まれる', () => {
    expect(diffAnnouncementFields(base, { ...base, sendEmail: true })).toEqual({
      sendEmail: true,
    });
    const on: AnnouncementEditableFields = { ...base, sendEmail: true };
    expect(diffAnnouncementFields(on, { ...on, sendEmail: false })).toEqual({
      sendEmail: false,
    });
  });

  it('複数フィールドの同時変更', () => {
    const patch = diffAnnouncementFields(base, {
      title: 'A',
      body: 'B',
      audience: 'MEMBERS',
      sendEmail: true,
    });
    expect(patch).toEqual({
      title: 'A',
      body: 'B',
      audience: 'MEMBERS',
      sendEmail: true,
    });
  });

  // status は編集フォームでは扱わない (公開/下書き切替は専用ボタン) ため、
  // 差分に status が現れないことを保証する。
  it('status は差分に含まれない', () => {
    const patch = diffAnnouncementFields(base, {
      ...base,
      title: 'X',
    }) as Record<string, unknown>;
    expect(patch).not.toHaveProperty('status');
  });
});

describe('mayTriggerEmailOnEdit', () => {
  it('下書きならメールは飛ばない', () => {
    expect(
      mayTriggerEmailOnEdit({
        status: 'DRAFT',
        sendEmail: true,
        emailStatus: 'NOT_REQUESTED',
      }),
    ).toBe(false);
  });

  it('メール送信オフなら飛ばない', () => {
    expect(
      mayTriggerEmailOnEdit({
        status: 'PUBLISHED',
        sendEmail: false,
        emailStatus: 'NOT_REQUESTED',
      }),
    ).toBe(false);
  });

  it('送信完了済みなら再送されない', () => {
    expect(
      mayTriggerEmailOnEdit({
        status: 'PUBLISHED',
        sendEmail: true,
        emailStatus: 'COMPLETED',
      }),
    ).toBe(false);
  });

  it('送信中なら二重には走らない', () => {
    expect(
      mayTriggerEmailOnEdit({
        status: 'PUBLISHED',
        sendEmail: true,
        emailStatus: 'SENDING',
      }),
    ).toBe(false);
  });

  it.each(['NOT_REQUESTED', 'PENDING', 'FAILED'] as const)(
    '公開済み + メールあり + %s は警告対象',
    (emailStatus) => {
      expect(
        mayTriggerEmailOnEdit({
          status: 'PUBLISHED',
          sendEmail: true,
          emailStatus,
        }),
      ).toBe(true);
    },
  );
});
