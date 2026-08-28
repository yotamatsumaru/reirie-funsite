import {
  isVideoListable,
  isVideoPlayable,
  isVideoLocked,
  isVideoExpired,
  isVideoScheduled,
  videoPublishState,
  videoLockReason,
  listableVideoWhere,
  type VideoVisibilityInput,
} from './video-visibility';

const NOW = new Date('2026-08-24T12:00:00Z');

function video(overrides: Partial<VideoVisibilityInput> = {}): VideoVisibilityInput {
  return {
    isPublished: true,
    status: 'READY',
    publishedAt: new Date('2026-08-01T00:00:00Z'),
    expiresAt: null,
    accessLevel: 'MEMBERS',
    ...overrides,
  };
}

describe('isVideoListable', () => {
  it('公開中 + READY + 公開日時到来 なら一覧に出る', () => {
    expect(isVideoListable(video(), NOW)).toBe(true);
  });

  it('非公開なら出ない', () => {
    expect(isVideoListable(video({ isPublished: false }), NOW)).toBe(false);
  });

  it.each(['UPLOADING', 'PROCESSING', 'FAILED'])('status=%s なら出ない', (status) => {
    expect(isVideoListable(video({ status }), NOW)).toBe(false);
  });

  it('publishedAt が null なら出ない', () => {
    expect(isVideoListable(video({ publishedAt: null }), NOW)).toBe(false);
  });

  it('公開日時が未来なら出ない（予約公開）', () => {
    expect(
      isVideoListable(video({ publishedAt: new Date('2026-09-01T00:00:00Z') }), NOW),
    ).toBe(false);
  });

  it('配信期限切れなら出ない', () => {
    expect(isVideoListable(video({ expiresAt: new Date('2026-08-20T00:00:00Z') }), NOW)).toBe(
      false,
    );
  });

  it('配信期限が未来なら出る', () => {
    expect(isVideoListable(video({ expiresAt: new Date('2026-09-01T00:00:00Z') }), NOW)).toBe(
      true,
    );
  });

  it('プランに関係なく一覧に出る（無料でもサムネイルを見せるため）', () => {
    // isVideoListable はプランを引数に取らない = プランで絞らない設計
    expect(isVideoListable(video({ accessLevel: 'PREMIUM' }), NOW)).toBe(true);
  });
});

describe('isVideoPlayable', () => {
  it('無料プランは MEMBERS 動画を再生できない', () => {
    expect(isVideoPlayable(video({ accessLevel: 'MEMBERS' }), 'FREE', NOW)).toBe(false);
  });

  it('無料プランは PREMIUM 動画を再生できない', () => {
    expect(isVideoPlayable(video({ accessLevel: 'PREMIUM' }), 'FREE', NOW)).toBe(false);
  });

  it('無料プランでも PUBLIC 動画は再生できる', () => {
    expect(isVideoPlayable(video({ accessLevel: 'PUBLIC' }), 'FREE', NOW)).toBe(true);
  });

  it('STANDARD は MEMBERS を再生できるが PREMIUM は不可', () => {
    expect(isVideoPlayable(video({ accessLevel: 'MEMBERS' }), 'STANDARD', NOW)).toBe(true);
    expect(isVideoPlayable(video({ accessLevel: 'PREMIUM' }), 'STANDARD', NOW)).toBe(false);
  });

  it('PREMIUM はすべて再生できる', () => {
    expect(isVideoPlayable(video({ accessLevel: 'PREMIUM' }), 'PREMIUM', NOW)).toBe(true);
  });

  it('未ログイン(null) は PUBLIC のみ再生できる', () => {
    expect(isVideoPlayable(video({ accessLevel: 'PUBLIC' }), null, NOW)).toBe(true);
    expect(isVideoPlayable(video({ accessLevel: 'MEMBERS' }), null, NOW)).toBe(false);
  });

  it('非公開ならプランが足りていても再生できない', () => {
    expect(
      isVideoPlayable(video({ isPublished: false, accessLevel: 'PUBLIC' }), 'PREMIUM', NOW),
    ).toBe(false);
  });

  it('エンコード未完了ならプランが足りていても再生できない', () => {
    expect(
      isVideoPlayable(video({ status: 'PROCESSING', accessLevel: 'PUBLIC' }), 'PREMIUM', NOW),
    ).toBe(false);
  });

  it('期限切れならプランが足りていても再生できない', () => {
    expect(
      isVideoPlayable(
        video({ expiresAt: new Date('2026-08-20T00:00:00Z') }),
        'PREMIUM',
        NOW,
      ),
    ).toBe(false);
  });
});

describe('isVideoLocked（サムネイルのみ表示する状態）', () => {
  it('無料プラン + 会員限定 は「一覧に出るが再生不可」', () => {
    const v = video({ accessLevel: 'MEMBERS' });
    expect(isVideoListable(v, NOW)).toBe(true);
    expect(isVideoLocked(v, 'FREE', NOW)).toBe(true);
  });

  it('再生できるならロックではない', () => {
    expect(isVideoLocked(video({ accessLevel: 'MEMBERS' }), 'STANDARD', NOW)).toBe(false);
  });

  it('一覧にすら出ないものはロック扱いにしない（404 になるため）', () => {
    expect(isVideoLocked(video({ isPublished: false }), 'FREE', NOW)).toBe(false);
  });
});

describe('isVideoExpired', () => {
  it('expiresAt が null なら期限なし', () => {
    expect(isVideoExpired(video({ expiresAt: null }), NOW)).toBe(false);
  });

  it('過去なら期限切れ', () => {
    expect(isVideoExpired(video({ expiresAt: new Date('2026-08-01T00:00:00Z') }), NOW)).toBe(true);
  });

  it('ちょうど同時刻は期限切れ扱い', () => {
    expect(isVideoExpired(video({ expiresAt: NOW }), NOW)).toBe(true);
  });
});

describe('videoLockReason', () => {
  it('再生できるなら null', () => {
    expect(videoLockReason(video({ accessLevel: 'PUBLIC' }), 'FREE', NOW)).toBeNull();
  });

  it('期限切れが最優先で案内される', () => {
    expect(
      videoLockReason(video({ expiresAt: new Date('2026-08-01T00:00:00Z') }), 'PREMIUM', NOW),
    ).toBe('この動画の配信期間は終了しました。');
  });

  it('PREMIUM 限定の案内', () => {
    expect(videoLockReason(video({ accessLevel: 'PREMIUM' }), 'FREE', NOW)).toBe(
      'この動画はプレミアムプラン限定です。',
    );
  });

  it('会員限定（スタンダード以上）の案内', () => {
    expect(videoLockReason(video({ accessLevel: 'MEMBERS' }), 'FREE', NOW)).toBe(
      'この動画は会員限定（スタンダード以上）です。',
    );
  });

  it('無料会員以上は「ログインすれば見られる」と案内する', () => {
    // 有料プランへの加入を促す文言を出すと、実際はログインだけで足りるのに
    // 課金が必要だと誤解させてしまうので、文言を分けている。
    expect(videoLockReason(video({ accessLevel: 'FREE_MEMBERS' }), undefined, NOW)).toBe(
      'この動画は会員限定です。無料会員登録（ログイン）すると視聴できます。',
    );
  });

  it('無料会員以上はログイン済みなら無料プランでも再生できる', () => {
    expect(videoLockReason(video({ accessLevel: 'FREE_MEMBERS' }), 'FREE', NOW)).toBeNull();
  });
});

describe('listableVideoWhere', () => {
  it('isPublished / status / publishedAt / expiresAt を条件に含む', () => {
    const where = listableVideoWhere(NOW);
    expect(where.isPublished).toBe(true);
    expect(where.status).toBe('READY');
    expect(where.publishedAt).toEqual({ not: null, lte: NOW });
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: NOW } }]);
  });

  it('isVideoListable と条件が一致している（プランで絞らない）', () => {
    const where = listableVideoWhere(NOW);
    // where 句にプラン/accessLevel の条件が入っていないこと
    expect(Object.keys(where)).not.toContain('accessLevel');
  });
});

/**
 * 公開予約の判定。
 *
 * 管理画面のバッジ表示に使う。ここがずれると
 * 「予約したつもりが公開されていた」「公開したのに出ない」の取り違えが起きる。
 */
describe('isVideoScheduled', () => {
  it('公開開始日時が未来なら予約中', () => {
    expect(
      isVideoScheduled(video({ publishedAt: new Date('2026-09-01T00:00:00Z') }), NOW),
    ).toBe(true);
  });

  it('公開開始日時が過去なら予約中ではない（もう公開済み）', () => {
    expect(isVideoScheduled(video(), NOW)).toBe(false);
  });

  it('公開スイッチが OFF なら予約ではなく単なる非公開', () => {
    expect(
      isVideoScheduled(
        video({ isPublished: false, publishedAt: new Date('2026-09-01T00:00:00Z') }),
        NOW,
      ),
    ).toBe(false);
  });

  it('エンコード未完了なら予約中と表示しない（日時が来ても公開されないため）', () => {
    expect(
      isVideoScheduled(
        video({ status: 'PROCESSING', publishedAt: new Date('2026-09-01T00:00:00Z') }),
        NOW,
      ),
    ).toBe(false);
  });

  it('公開開始日時が未設定なら予約中ではない', () => {
    expect(isVideoScheduled(video({ publishedAt: null }), NOW)).toBe(false);
  });

  it('期限切れなら予約中にしない', () => {
    expect(
      isVideoScheduled(
        video({
          publishedAt: new Date('2026-09-01T00:00:00Z'),
          expiresAt: new Date('2026-08-01T00:00:00Z'),
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe('videoPublishState', () => {
  it('公開中', () => {
    expect(videoPublishState(video(), NOW)).toBe('live');
  });

  it('非公開スイッチが最優先', () => {
    expect(videoPublishState(video({ isPublished: false }), NOW)).toBe('unpublished');
  });

  it('エンコード中', () => {
    expect(videoPublishState(video({ status: 'PROCESSING' }), NOW)).toBe('encoding');
  });

  it('公開予約中', () => {
    expect(
      videoPublishState(video({ publishedAt: new Date('2026-09-01T00:00:00Z') }), NOW),
    ).toBe('scheduled');
  });

  it('配信終了', () => {
    expect(
      videoPublishState(video({ expiresAt: new Date('2026-08-01T00:00:00Z') }), NOW),
    ).toBe('expired');
  });

  it('公開スイッチ ON でも公開日時が無ければ一覧に出ないので専用の状態にする', () => {
    expect(videoPublishState(video({ publishedAt: null }), NOW)).toBe('no_date');
  });

  it('期限切れは予約より優先される（過去の期限が入っていれば結果は終了）', () => {
    expect(
      videoPublishState(
        video({
          publishedAt: new Date('2026-09-01T00:00:00Z'),
          expiresAt: new Date('2026-08-01T00:00:00Z'),
        }),
        NOW,
      ),
    ).toBe('expired');
  });

  it('live と判定される状態は isVideoListable と一致する', () => {
    const cases = [
      video(),
      video({ publishedAt: new Date('2026-09-01T00:00:00Z') }),
      video({ isPublished: false }),
      video({ status: 'PROCESSING' }),
      video({ publishedAt: null }),
      video({ expiresAt: new Date('2026-08-01T00:00:00Z') }),
    ];
    for (const v of cases) {
      expect(videoPublishState(v, NOW) === 'live').toBe(isVideoListable(v, NOW));
    }
  });
});
