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
    publishedAt: '',
    expiresAt: '',
    thumbnailUrl: '',
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
      publishedAt: '',
      expiresAt: '2026-12-31T23:59',
      thumbnailUrl: '',
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

describe('サムネイル (thumbnailUrl)', () => {
  it('触っていなければ差分に含めない', () => {
    // エンコードが自動設定した S3 キーが初期値に入っていることがあるため、
    // これを毎回送ると URL 検証で弾かれ「タイトルを直しただけで保存失敗」になる。
    const init = values({ thumbnailUrl: 'hls/abc/thumbnail.0000000.jpg' });
    const patch = buildVideoEditPatch(init, { ...init, title: '新タイトル' });
    expect(patch).not.toHaveProperty('thumbnailUrl');
    expect(patch.title).toBe('新タイトル');
  });

  it('自動設定された S3 キーが初期値でも検証を通る', () => {
    // 初期値 (エンコードが入れた S3 キー) をそのまま持ったまま「保存」を押しても
    // 通らないと、説明文の修正すらできなくなる。
    // フォームは initial を渡すので「触っていない」と判定される。
    const init = values({ thumbnailUrl: 'hls/abc/thumbnail.0000000.jpg' });
    const current = { ...init, description: '説明を直した' };
    expect(validateVideoEdit(current, init).ok).toBe(true);
  });

  it('initial を渡さない場合は値をそのまま検証する（後方互換）', () => {
    // 「触ったかどうか」が分からないので安全側 (検証する) に倒す。
    expect(validateVideoEdit(values({ thumbnailUrl: 'javascript:alert(1)' })).ok).toBe(false);
    expect(validateVideoEdit(values({ thumbnailUrl: '' })).ok).toBe(true);
  });

  it('URL を入力したら差分に含める', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, {
      ...init,
      thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
    });
    expect(patch.thumbnailUrl).toBe('https://cdn.example.com/thumb.jpg');
  });

  it('空にしたら null（=未設定にする）を送る', () => {
    const init = values({ thumbnailUrl: 'https://cdn.example.com/a.jpg' });
    const patch = buildVideoEditPatch(init, { ...init, thumbnailUrl: '' });
    expect(patch.thumbnailUrl).toBeNull();
  });

  it('前後の空白だけの変化は差分にしない', () => {
    const init = values({ thumbnailUrl: 'https://cdn.example.com/a.jpg' });
    const patch = buildVideoEditPatch(init, {
      ...init,
      thumbnailUrl: '  https://cdn.example.com/a.jpg  ',
    });
    expect(patch).toEqual({});
  });

  it('不正なURLに書き換えたら保存前に弾く（サーバーと同じ判定）', () => {
    const init = values();
    const r = validateVideoEdit({ ...init, thumbnailUrl: 'javascript:alert(1)' }, init);
    expect(r.ok).toBe(false);
  });

  it('アップロードAPIが返した内部パスは検証を通り、差分にも乗る', () => {
    const url = '/api/media/video-thumbnail/abc?v=1';
    const init = values();
    expect(validateVideoEdit({ ...init, thumbnailUrl: url }, init).ok).toBe(true);
    expect(buildVideoEditPatch(init, { ...init, thumbnailUrl: url }).thumbnailUrl).toBe(url);
  });

  it('サムネイルだけ変えた場合も差分は空にならない', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, {
      ...init,
      thumbnailUrl: 'https://cdn.example.com/a.jpg',
    });
    expect(isEmptyPatch(patch)).toBe(false);
  });
});

/**
 * 公開開始日時（publishedAt）まわり。
 *
 * 一覧クエリ（listableVideoWhere）が `publishedAt <= now` を条件にしているため、
 * 未来の日時を入れるだけで「公開予約」になる。バッチ処理は無い。
 * その代わり、入力を誤ると「いつまでも出ない動画」ができるので、
 * 矛盾する入力をフォーム側で止められることをここで担保する。
 */
describe('公開開始日時 (publishedAt)', () => {
  it('未来の日時を入れると差分に乗る（公開予約になる）', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, { ...init, publishedAt: '2099-01-01T10:00' });
    // JST で解釈されるので UTC では前日 01:00
    expect(patch.publishedAt).toBe('2099-01-01T01:00:00.000Z');
  });

  it('空にすると null を送る（公開開始日時を外す）', () => {
    const init = values({ publishedAt: '2026-08-24T09:00' });
    const patch = buildVideoEditPatch(init, { ...init, publishedAt: '' });
    expect(patch.publishedAt).toBeNull();
  });

  it('同じ日時なら差分にしない', () => {
    const init = values({ publishedAt: '2026-08-24T09:00' });
    const patch = buildVideoEditPatch(init, { ...init, publishedAt: '2026-08-24T09:00' });
    expect(patch).toEqual({});
  });

  it('公開開始だけ変えても差分は空にならない', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, { ...init, publishedAt: '2026-09-01T00:00' });
    expect(isEmptyPatch(patch)).toBe(false);
  });

  it('JST として解釈する（実行環境の TZ に依存しない）', () => {
    const init = values();
    const patch = buildVideoEditPatch(init, { ...init, publishedAt: '2026-08-24T09:00' });
    // 2026-08-24 09:00 JST = 2026-08-24T00:00:00Z
    expect(patch.publishedAt).toBe('2026-08-24T00:00:00.000Z');
  });

  it('不正な日時は保存前に弾く', () => {
    const r = validateVideoEdit(values({ publishedAt: 'あああ' }));
    expect(r.ok).toBe(false);
  });

  it('公開開始が配信期限より後だと弾く（一度も表示されない動画を防ぐ）', () => {
    const r = validateVideoEdit(
      values({ publishedAt: '2026-12-31T23:59', expiresAt: '2026-01-01T00:00' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('公開開始日時は配信期限より前');
  });

  it('公開開始と配信期限が同時刻でも弾く（表示される瞬間が無いため）', () => {
    const r = validateVideoEdit(
      values({ publishedAt: '2026-06-01T12:00', expiresAt: '2026-06-01T12:00' }),
    );
    expect(r.ok).toBe(false);
  });

  it('公開開始 < 配信期限なら通す', () => {
    const r = validateVideoEdit(
      values({ publishedAt: '2026-06-01T12:00', expiresAt: '2026-06-30T23:59' }),
    );
    expect(r.ok).toBe(true);
  });

  it('期限だけ設定されている場合は開始との比較をしない', () => {
    expect(validateVideoEdit(values({ expiresAt: '2026-06-30T23:59' })).ok).toBe(true);
  });

  it('開始だけ設定されている場合も通す（期限なしの予約公開）', () => {
    expect(validateVideoEdit(values({ publishedAt: '2099-01-01T00:00' })).ok).toBe(true);
  });
});
