import {
  buildVideoDeletionPlan,
  hlsPrefixFor,
  thumbnailPrefixFor,
  isDeleteConfirmationValid,
} from './video-delete';

const ID = '11111111-2222-3333-4444-555555555555';

describe('hlsPrefixFor', () => {
  it('hls/<videoId>/ を返す', () => {
    expect(hlsPrefixFor(ID)).toBe(`hls/${ID}/`);
  });

  // 末尾スラッシュが無いと hls/abc が hls/abcdef/... に前方一致し、
  // 別動画のセグメントを巻き込んで削除する。最も危険な回帰なので独立して守る。
  it('必ず末尾がスラッシュになる', () => {
    expect(hlsPrefixFor(ID).endsWith('/')).toBe(true);
    expect(hlsPrefixFor('abc').endsWith('/')).toBe(true);
  });

  it('別IDのプレフィックスに前方一致しない', () => {
    const shorter = hlsPrefixFor('abc');
    const longer = hlsPrefixFor('abcdef');
    expect(longer.startsWith(shorter)).toBe(false);
  });
});

describe('thumbnailPrefixFor', () => {
  // video-thumbnail-store.ts の putAsset キー
  // `video-thumbnails/${videoId}/${uuid}.${ext}` と一致していること。
  it('video-thumbnails/<videoId>/ を返す', () => {
    expect(thumbnailPrefixFor(ID)).toBe(`video-thumbnails/${ID}/`);
  });

  it('必ず末尾がスラッシュになる', () => {
    expect(thumbnailPrefixFor(ID).endsWith('/')).toBe(true);
  });

  it('別IDのプレフィックスに前方一致しない', () => {
    expect(thumbnailPrefixFor('abcdef').startsWith(thumbnailPrefixFor('abc'))).toBe(false);
  });
});

describe('buildVideoDeletionPlan', () => {
  it('ソースキーとプレフィックス2種を返す', () => {
    const plan = buildVideoDeletionPlan({ id: ID, s3SourceKey: 'uploads/foo.mp4' });
    expect(plan).toEqual({
      sourceKey: 'uploads/foo.mp4',
      hlsPrefix: `hls/${ID}/`,
      thumbnailPrefix: `video-thumbnails/${ID}/`,
    });
  });

  // アップロード途中で中断した動画は s3SourceKey が空になり得る。
  // 空文字のまま DeleteObject に渡すと Key 必須エラーで削除全体が落ちる。
  it('s3SourceKey が空文字なら null に正規化する', () => {
    expect(buildVideoDeletionPlan({ id: ID, s3SourceKey: '' }).sourceKey).toBeNull();
  });

  it('s3SourceKey が空白のみでも null に正規化する', () => {
    expect(buildVideoDeletionPlan({ id: ID, s3SourceKey: '   ' }).sourceKey).toBeNull();
  });

  it('s3SourceKey が null でも落ちない', () => {
    expect(buildVideoDeletionPlan({ id: ID, s3SourceKey: null }).sourceKey).toBeNull();
  });

  it('前後の空白を取り除く', () => {
    expect(buildVideoDeletionPlan({ id: ID, s3SourceKey: ' uploads/a.mp4 ' }).sourceKey).toBe(
      'uploads/a.mp4',
    );
  });

  // 削除対象は動画IDで名前空間が切られている必要がある。
  // 別動画のIDを含んでしまう実装になっていないことを確認する。
  it('プレフィックスは動画IDを含む', () => {
    const plan = buildVideoDeletionPlan({ id: ID, s3SourceKey: 'x' });
    expect(plan.hlsPrefix).toContain(ID);
    expect(plan.thumbnailPrefix).toContain(ID);
  });

  it('動画IDが違えばプレフィックスも変わる', () => {
    const a = buildVideoDeletionPlan({ id: 'aaa', s3SourceKey: 'x' });
    const b = buildVideoDeletionPlan({ id: 'bbb', s3SourceKey: 'x' });
    expect(a.hlsPrefix).not.toBe(b.hlsPrefix);
    expect(a.thumbnailPrefix).not.toBe(b.thumbnailPrefix);
  });
});

describe('isDeleteConfirmationValid', () => {
  it('タイトルと一致すれば true', () => {
    expect(isDeleteConfirmationValid('りえ宅でお茶会', 'りえ宅でお茶会')).toBe(true);
  });

  it('一致しなければ false', () => {
    expect(isDeleteConfirmationValid('りえ宅でお茶', 'りえ宅でお茶会')).toBe(false);
  });

  // 反射的に確定させないための仕組みなので、空入力は必ず拒否する。
  it('空入力は false', () => {
    expect(isDeleteConfirmationValid('', 'りえ宅でお茶会')).toBe(false);
    expect(isDeleteConfirmationValid('   ', 'りえ宅でお茶会')).toBe(false);
  });

  // タイトルが空の動画は理論上存在しないが、
  // 万一空でも「空入力で削除できる」状態にはしない。
  it('タイトルが空なら何を入れても false', () => {
    expect(isDeleteConfirmationValid('', '')).toBe(false);
    expect(isDeleteConfirmationValid('anything', '   ')).toBe(false);
  });

  it('前後の空白は無視する（コピペ対策）', () => {
    expect(isDeleteConfirmationValid('  りえ宅でお茶会  ', 'りえ宅でお茶会')).toBe(true);
    expect(isDeleteConfirmationValid('りえ宅でお茶会', '  りえ宅でお茶会  ')).toBe(true);
  });

  it('大文字小文字は区別する', () => {
    expect(isDeleteConfirmationValid('abc', 'ABC')).toBe(false);
  });

  it('中間の空白は無視しない', () => {
    expect(isDeleteConfirmationValid('a  b', 'a b')).toBe(false);
  });
});
