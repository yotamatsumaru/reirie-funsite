import {
  toDatetimeLocalJst,
  fromDatetimeLocalJst,
  validateVideoEdit,
  buildVideoEditPatch,
  isEmptyPatch,
  VIDEO_TITLE_MAX,
  VIDEO_DESCRIPTION_MAX,
  type VideoEditFormValues,
} from './video-edit';

function values(over: Partial<VideoEditFormValues> = {}): VideoEditFormValues {
  return {
    title: 'もとのタイトル',
    description: 'もとの説明',
    accessLevel: 'MEMBERS',
    expiresAt: '',
    ...over,
  };
}

describe('toDatetimeLocalJst', () => {
  it('UTC の Date を JST の datetime-local 文字列にする', () => {
    // 2026-08-24T00:00:00Z = 2026-08-24 09:00 JST
    expect(toDatetimeLocalJst(new Date('2026-08-24T00:00:00Z'))).toBe('2026-08-24T09:00');
  });

  it('日付をまたぐ場合も正しくずらす', () => {
    // 2026-08-24T15:30:00Z = 2026-08-25 00:30 JST
    expect(toDatetimeLocalJst(new Date('2026-08-24T15:30:00Z'))).toBe('2026-08-25T00:30');
  });

  it('ISO 文字列でも受け付ける', () => {
    expect(toDatetimeLocalJst('2026-01-01T00:00:00Z')).toBe('2026-01-01T09:00');
  });

  it('null / undefined / 空文字は空文字', () => {
    expect(toDatetimeLocalJst(null)).toBe('');
    expect(toDatetimeLocalJst(undefined)).toBe('');
    expect(toDatetimeLocalJst('')).toBe('');
  });

  it('不正な日付は空文字', () => {
    expect(toDatetimeLocalJst('not-a-date')).toBe('');
    expect(toDatetimeLocalJst(new Date('invalid'))).toBe('');
  });
});

describe('fromDatetimeLocalJst', () => {
  it('JST として解釈して UTC の ISO に戻す', () => {
    expect(fromDatetimeLocalJst('2026-08-24T09:00')).toBe('2026-08-24T00:00:00.000Z');
  });

  it('toDatetimeLocalJst と往復して一致する', () => {
    const src = new Date('2026-08-24T12:34:00Z');
    const round = fromDatetimeLocalJst(toDatetimeLocalJst(src));
    expect(round).toBe(src.toISOString());
  });

  it('空文字は null（= 期限なし）', () => {
    expect(fromDatetimeLocalJst('')).toBeNull();
    expect(fromDatetimeLocalJst('   ')).toBeNull();
  });

  it('不正な値は null', () => {
    expect(fromDatetimeLocalJst('あああ')).toBeNull();
  });

  it('既にオフセット付きならそれを尊重する', () => {
    expect(fromDatetimeLocalJst('2026-08-24T00:00:00Z')).toBe('2026-08-24T00:00:00.000Z');
  });
});

describe('validateVideoEdit', () => {
  it('通常の入力は OK', () => {
    expect(validateVideoEdit(values())).toEqual({ ok: true });
  });

  it('タイトル空はエラー', () => {
    const r = validateVideoEdit(values({ title: '' }));
    expect(r).toEqual({ ok: false, message: 'タイトルを入力してください' });
  });

  it('タイトルが空白のみはエラー', () => {
    expect(validateVideoEdit(values({ title: '　  ' }).valueOf() as VideoEditFormValues).ok).toBe(
      false,
    );
  });

  it('タイトル上限ちょうどは OK', () => {
    expect(validateVideoEdit(values({ title: 'あ'.repeat(VIDEO_TITLE_MAX) })).ok).toBe(true);
  });

  it('タイトル上限超過はエラー', () => {
    const r = validateVideoEdit(values({ title: 'あ'.repeat(VIDEO_TITLE_MAX + 1) }));
    expect(r.ok).toBe(false);
  });

  it('説明文は空でも OK（任意項目）', () => {
    expect(validateVideoEdit(values({ description: '' })).ok).toBe(true);
  });

  it('説明文上限ちょうどは OK / 超過はエラー', () => {
    expect(validateVideoEdit(values({ description: 'あ'.repeat(VIDEO_DESCRIPTION_MAX) })).ok).toBe(
      true,
    );
    expect(
      validateVideoEdit(values({ description: 'あ'.repeat(VIDEO_DESCRIPTION_MAX + 1) })).ok,
    ).toBe(false);
  });

  it('配信期限が不正な文字列だとエラー', () => {
    const r = validateVideoEdit(values({ expiresAt: 'あああ' }));
    expect(r).toEqual({ ok: false, message: '配信期限の日時が不正です' });
  });

  it('配信期限が空なら OK（期限なし）', () => {
    expect(validateVideoEdit(values({ expiresAt: '' })).ok).toBe(true);
  });
});

describe('buildVideoEditPatch', () => {
  it('何も変えなければ空の差分', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, { ...init });
    expect(patch).toEqual({});
    expect(isEmptyPatch(patch)).toBe(true);
  });

  it('タイトルだけ変えたらタイトルだけ含む', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, { ...init, title: '新しいタイトル' });
    expect(patch).toEqual({ title: '新しいタイトル' });
  });

  it('タイトルの前後空白だけの違いは差分にしない', () => {
    const init = values({ title: 'タイトル' });
    const patch = buildVideoEditPatch(init, { ...init, title: '  タイトル  ' });
    expect(patch).toEqual({});
  });

  it('タイトルは trim して送る', () => {
    const init = values({ title: '旧' });
    const patch = buildVideoEditPatch(init, { ...init, title: '  新  ' });
    expect(patch).toEqual({ title: '新' });
  });

  it('説明文を空にしたら null を送る（説明なしにできる）', () => {
    const init = values({ description: 'なにか' });
    const patch = buildVideoEditPatch(init, { ...init, description: '' });
    expect(patch).toEqual({ description: null });
  });

  it('説明文を空から埋めたら文字列を送る', () => {
    const init = values({ description: '' });
    const patch = buildVideoEditPatch(init, { ...init, description: '追記' });
    expect(patch).toEqual({ description: '追記' });
  });

  it('説明文の改行は保持する', () => {
    const init = values({ description: '' });
    const patch = buildVideoEditPatch(init, { ...init, description: '1行目\n2行目' });
    expect(patch).toEqual({ description: '1行目\n2行目' });
  });

  it('公開範囲の変更を拾う', () => {
    const init = values({ accessLevel: 'MEMBERS' });
    const patch = buildVideoEditPatch(init, { ...init, accessLevel: 'PREMIUM' });
    expect(patch).toEqual({ accessLevel: 'PREMIUM' });
  });

  it('配信期限を設定したら ISO を送る', () => {
    const init = values({ expiresAt: '' });
    const patch = buildVideoEditPatch(init, { ...init, expiresAt: '2026-08-24T09:00' });
    expect(patch).toEqual({ expiresAt: '2026-08-24T00:00:00.000Z' });
  });

  it('配信期限を消したら null を送る（期限なしに戻せる）', () => {
    const init = values({ expiresAt: '2026-08-24T09:00' });
    const patch = buildVideoEditPatch(init, { ...init, expiresAt: '' });
    expect(patch).toEqual({ expiresAt: null });
  });

  it('同じ日時なら差分にしない', () => {
    const init = values({ expiresAt: '2026-08-24T09:00' });
    const patch = buildVideoEditPatch(init, { ...init, expiresAt: '2026-08-24T09:00' });
    expect(patch).toEqual({});
  });

  it('複数項目を同時に変えたら全部含む', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, {
      title: '新タイトル',
      description: '新説明',
      accessLevel: 'PUBLIC',
      expiresAt: '2026-12-31T23:59',
    });
    expect(patch.title).toBe('新タイトル');
    expect(patch.description).toBe('新説明');
    expect(patch.accessLevel).toBe('PUBLIC');
    expect(typeof patch.expiresAt).toBe('string');
  });

  it('差分に isPublished は絶対に含まれない（公開制御は別 API）', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, { ...init, title: 'x' });
    expect(patch).not.toHaveProperty('isPublished');
  });

  it('差分に status / s3 キーは含まれない（実体と乖離させない）', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, { ...init, title: 'x' });
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('s3SourceKey');
    expect(patch).not.toHaveProperty('s3HlsKey');
  });
});

describe('isEmptyPatch', () => {
  it('空オブジェクトは true', () => {
    expect(isEmptyPatch({})).toBe(true);
  });

  it('1 項目でもあれば false', () => {
    expect(isEmptyPatch({ title: 'a' })).toBe(false);
  });

  it('null を明示的に入れている場合も差分として扱う', () => {
    expect(isEmptyPatch({ description: null })).toBe(false);
    expect(isEmptyPatch({ expiresAt: null })).toBe(false);
  });
});
