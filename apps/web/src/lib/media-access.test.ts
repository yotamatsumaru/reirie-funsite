import {
  canDeliverMedia,
  mediaCacheControl,
  requiredLevelForMedia,
  type MediaReferrer,
} from './media-access';

const ref = (accessLevel: MediaReferrer['accessLevel']): MediaReferrer => ({ accessLevel });

describe('requiredLevelForMedia', () => {
  it('参照元が無い画像は PUBLIC 扱い（アップロード直後・記事から外した画像）', () => {
    // これを PREMIUM などにすると、記事を書き始める前にアップロードした
    // 画像が管理画面のプレビューに出なくなる。
    expect(requiredLevelForMedia([])).toBe('PUBLIC');
  });

  it('参照元が 1 つならその公開範囲をそのまま返す', () => {
    expect(requiredLevelForMedia([ref('PREMIUM')])).toBe('PREMIUM');
    expect(requiredLevelForMedia([ref('MEMBERS')])).toBe('MEMBERS');
    expect(requiredLevelForMedia([ref('FREE_MEMBERS')])).toBe('FREE_MEMBERS');
    expect(requiredLevelForMedia([ref('PUBLIC')])).toBe('PUBLIC');
  });

  it('複数から参照されているときは «最もゆるい» 方に合わせる', () => {
    // 厳しい側に合わせると、公開記事に貼った画像が
    // 「別の限定ギャラリーでも使われている」だけで公開記事から消える。
    expect(requiredLevelForMedia([ref('PREMIUM'), ref('PUBLIC')])).toBe('PUBLIC');
    expect(requiredLevelForMedia([ref('PREMIUM'), ref('MEMBERS')])).toBe('MEMBERS');
    expect(requiredLevelForMedia([ref('MEMBERS'), ref('FREE_MEMBERS')])).toBe('FREE_MEMBERS');
  });

  it('順序が変わっても結果が変わらない（reduce の初期値に依存しない）', () => {
    expect(requiredLevelForMedia([ref('PUBLIC'), ref('PREMIUM')])).toBe('PUBLIC');
    expect(requiredLevelForMedia([ref('PREMIUM'), ref('PUBLIC')])).toBe('PUBLIC');
    expect(requiredLevelForMedia([ref('MEMBERS'), ref('PREMIUM'), ref('FREE_MEMBERS')])).toBe(
      'FREE_MEMBERS',
    );
  });

  it('同じ公開範囲が並んでもその値を返す', () => {
    expect(requiredLevelForMedia([ref('PREMIUM'), ref('PREMIUM')])).toBe('PREMIUM');
  });
});

describe('canDeliverMedia — 今回塞いだ穴の再現', () => {
  it('未ログインは PREMIUM 限定ギャラリーの写真を取得できない', () => {
    // 修正前はこのケースが 200 で画像を返していた（実機の curl で確認済み）。
    expect(canDeliverMedia({ referrers: [ref('PREMIUM')], plan: undefined })).toBe(false);
  });

  it('無料プランでは PREMIUM 限定の写真を取得できない', () => {
    expect(canDeliverMedia({ referrers: [ref('PREMIUM')], plan: 'FREE' })).toBe(false);
  });

  it('スタンダードでも PREMIUM 限定の写真は取得できない', () => {
    expect(canDeliverMedia({ referrers: [ref('PREMIUM')], plan: 'STANDARD' })).toBe(false);
  });

  it('プレミアム会員は取得できる', () => {
    expect(canDeliverMedia({ referrers: [ref('PREMIUM')], plan: 'PREMIUM' })).toBe(true);
  });

  it('公開ブログの本文画像は未ログインでも取得できる（既存挙動を壊さない）', () => {
    // ここが false になると、公開記事の画像が未ログインで表示されなくなる。
    // 元の無認証実装が守っていた性質であり、必ず維持する必要がある。
    expect(canDeliverMedia({ referrers: [ref('PUBLIC')], plan: undefined })).toBe(true);
  });

  it('アップロード直後（未参照）の画像は取得できる = 管理画面のプレビューが壊れない', () => {
    expect(canDeliverMedia({ referrers: [], plan: undefined })).toBe(true);
  });

  it('FREE_MEMBERS 限定は未ログインを弾き、無料プランには出す', () => {
    expect(canDeliverMedia({ referrers: [ref('FREE_MEMBERS')], plan: undefined })).toBe(false);
    expect(canDeliverMedia({ referrers: [ref('FREE_MEMBERS')], plan: 'FREE' })).toBe(true);
  });

  it('管理者は公開範囲に関係なく取得できる（下書き・予約公開の確認用）', () => {
    expect(
      canDeliverMedia({ referrers: [ref('PREMIUM')], plan: undefined, isStaff: true }),
    ).toBe(true);
    expect(canDeliverMedia({ referrers: [ref('PREMIUM')], plan: 'FREE', isStaff: true })).toBe(
      true,
    );
  });

  it('isStaff が false のときはバイパスしない', () => {
    expect(
      canDeliverMedia({ referrers: [ref('PREMIUM')], plan: 'FREE', isStaff: false }),
    ).toBe(false);
  });

  it('公開記事にも貼られている画像は未ログインでも取得できる（ゆるい側に合わせる方針）', () => {
    expect(
      canDeliverMedia({ referrers: [ref('PREMIUM'), ref('PUBLIC')], plan: undefined }),
    ).toBe(true);
  });
});

describe('mediaCacheControl', () => {
  it('PUBLIC は長期 immutable のまま（既存の配信効率を落とさない）', () => {
    expect(mediaCacheControl('PUBLIC')).toBe('public, max-age=31536000, immutable');
  });

  it('限定公開は共有キャッシュに残さない', () => {
    // CDN に public で載ると、サーバー側の判定を通らずに
    // 第三者へ配信され得るため。
    for (const level of ['FREE_MEMBERS', 'MEMBERS', 'PREMIUM'] as const) {
      const value = mediaCacheControl(level);
      expect(value).toContain('private');
      expect(value).toContain('no-store');
      expect(value).not.toContain('public');
      expect(value).not.toContain('immutable');
    }
  });
});
