import {
  DISCONNECT_GRACE_MS,
  MAX_ICE_RESTARTS,
  actionAfterGrace,
  actionForConnectionState,
  buildMediaAttempts,
  classifyMediaError,
  iceRestartDelayMs,
  mediaErrorMessage,
  shouldTryAudioOnly,
  type MediaErrorKind,
} from './call-resilience';

/** DOMException 相当のエラーを作る (jsdom 非依存) */
function errWithName(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('classifyMediaError', () => {
  it('ユーザーが拒否した場合は denied', () => {
    expect(classifyMediaError(errWithName('NotAllowedError'))).toBe('denied');
    // 古い仕様の名前
    expect(classifyMediaError(errWithName('PermissionDeniedError'))).toBe('denied');
  });

  it('デバイスが無い場合は not-found', () => {
    expect(classifyMediaError(errWithName('NotFoundError'))).toBe('not-found');
    // 旧 Firefox の表記ゆれ
    expect(classifyMediaError(errWithName('DevicesNotFoundError'))).toBe('not-found');
  });

  it('他アプリが使用中なら in-use', () => {
    expect(classifyMediaError(errWithName('NotReadableError'))).toBe('in-use');
    expect(classifyMediaError(errWithName('TrackStartError'))).toBe('in-use');
  });

  it('条件を満たすデバイスが無ければ overconstrained', () => {
    expect(classifyMediaError(errWithName('OverconstrainedError'))).toBe('overconstrained');
    expect(classifyMediaError(errWithName('ConstraintNotSatisfiedError'))).toBe(
      'overconstrained',
    );
  });

  it('http:// など安全でない文脈は insecure', () => {
    expect(classifyMediaError(errWithName('SecurityError'))).toBe('insecure');
  });

  it('未対応ブラウザは unsupported', () => {
    expect(classifyMediaError(errWithName('NotSupportedError'))).toBe('unsupported');
    expect(classifyMediaError(errWithName('TypeError'))).toBe('unsupported');
  });

  it('判定できないものは unknown', () => {
    expect(classifyMediaError(errWithName('SomethingElseError'))).toBe('unknown');
    expect(classifyMediaError(null)).toBe('unknown');
    expect(classifyMediaError(undefined)).toBe('unknown');
    expect(classifyMediaError('文字列')).toBe('unknown');
    expect(classifyMediaError({})).toBe('unknown');
  });
});

describe('mediaErrorMessage', () => {
  const kinds: MediaErrorKind[] = [
    'denied',
    'not-found',
    'in-use',
    'overconstrained',
    'insecure',
    'unsupported',
    'unknown',
  ];

  it('すべての種別に固有の文言がある', () => {
    const messages = kinds.map(mediaErrorMessage);
    expect(new Set(messages).size).toBe(kinds.length);
  });

  it('どの文言も空でなく、次に取るべき行動が書かれている', () => {
    for (const k of kinds) {
      const m = mediaErrorMessage(k);
      expect(m.length).toBeGreaterThan(10);
      // 「〜してください」等の行動喚起が含まれること
      expect(m).toMatch(/ください/);
    }
  });

  it('カメラが無い場合に「拒否」と誤解させる文言を出さない', () => {
    // 以前はすべて「アクセスが拒否されました」だったため利用者が混乱した
    expect(mediaErrorMessage('not-found')).not.toMatch(/拒否/);
    expect(mediaErrorMessage('in-use')).not.toMatch(/拒否/);
  });

  it('拒否された場合だけは許可の変更方法を案内する', () => {
    expect(mediaErrorMessage('denied')).toMatch(/許可/);
  });
});

describe('buildMediaAttempts', () => {
  const attempts = buildMediaAttempts();

  it('3 段階で試行する', () => {
    expect(attempts).toHaveLength(3);
  });

  it('1 回目は指定デバイスを exact で要求し、注意書きは出さない', () => {
    expect(attempts[0]).toEqual({ video: true, exact: true, note: null });
  });

  it('2 回目は ideal に落とす', () => {
    expect(attempts[1]!.exact).toBe(false);
    expect(attempts[1]!.video).toBe(true);
  });

  it('最後は音声のみになる（カメラ無しPCの救済）', () => {
    const last = attempts[attempts.length - 1]!;
    expect(last.video).toBe(false);
  });

  it('映像を諦めた場合は必ず利用者に知らせる', () => {
    const audioOnly = attempts.find((a) => !a.video)!;
    expect(audioOnly.note).toBeTruthy();
    expect(audioOnly.note).toMatch(/音声のみ/);
  });

  it('【回帰】音声のみの試行が必ず含まれる', () => {
    // これが無かったため、カメラ非搭載 PC は全試行が失敗して通話に入れなかった
    expect(attempts.some((a) => a.video === false)).toBe(true);
  });
});

describe('shouldTryAudioOnly', () => {
  it('デバイスが無い/使用中/条件不一致なら音声のみを試す', () => {
    expect(shouldTryAudioOnly('not-found')).toBe(true);
    expect(shouldTryAudioOnly('overconstrained')).toBe(true);
    expect(shouldTryAudioOnly('in-use')).toBe(true);
  });

  it('権限を拒否された場合は無駄な再試行をしない', () => {
    // 音声のみにしても同じく拒否されるので、権限ダイアログを繰り返さない
    expect(shouldTryAudioOnly('denied')).toBe(false);
  });

  it('http:// や未対応ブラウザでも再試行しない', () => {
    expect(shouldTryAudioOnly('insecure')).toBe(false);
    expect(shouldTryAudioOnly('unsupported')).toBe(false);
  });
});

describe('actionForConnectionState', () => {
  it('connected なら通話中', () => {
    expect(actionForConnectionState('connected')).toBe('in-call');
  });

  it('【最重要】disconnected は即終了せず猶予に入る', () => {
    // スマホの回線切替・画面ロックで日常的に起きるため、
    // ここを 'ended' にすると復帰できる通話まで切れてしまう
    expect(actionForConnectionState('disconnected')).toBe('grace');
    expect(actionForConnectionState('disconnected')).not.toBe('ended');
  });

  it('failed は ICE 再接続を試みる', () => {
    expect(actionForConnectionState('failed')).toBe('recover');
  });

  it('closed は終了', () => {
    expect(actionForConnectionState('closed')).toBe('ended');
  });

  it('new / connecting は何もしない', () => {
    expect(actionForConnectionState('new')).toBe('noop');
    expect(actionForConnectionState('connecting')).toBe('noop');
  });
});

describe('actionAfterGrace', () => {
  it('猶予中に復帰していれば通話継続', () => {
    expect(actionAfterGrace('connected', 0)).toBe('in-call');
  });

  it('復帰しなければ ICE 再接続を試す', () => {
    expect(actionAfterGrace('disconnected', 0)).toBe('recover');
    expect(actionAfterGrace('failed', 1)).toBe('recover');
  });

  it('上限に達したら終了する（無限リトライしない）', () => {
    expect(actionAfterGrace('disconnected', MAX_ICE_RESTARTS)).toBe('ended');
    expect(actionAfterGrace('disconnected', MAX_ICE_RESTARTS + 1)).toBe('ended');
  });

  it('closed なら再接続せず終了', () => {
    expect(actionAfterGrace('closed', 0)).toBe('ended');
  });
});

describe('iceRestartDelayMs', () => {
  it('回数に応じて指数的に伸びる', () => {
    expect(iceRestartDelayMs(1)).toBe(1000);
    expect(iceRestartDelayMs(2)).toBe(2000);
    expect(iceRestartDelayMs(3)).toBe(4000);
  });

  it('上限 8 秒を超えない（待たせすぎない）', () => {
    expect(iceRestartDelayMs(10)).toBe(8000);
  });

  it('0 や負値でも落ちない', () => {
    expect(iceRestartDelayMs(0)).toBe(1000);
    expect(iceRestartDelayMs(-5)).toBe(1000);
  });
});

describe('定数', () => {
  it('猶予は復帰を待てる長さだが、待たせすぎない範囲', () => {
    expect(DISCONNECT_GRACE_MS).toBeGreaterThanOrEqual(3000);
    expect(DISCONNECT_GRACE_MS).toBeLessThanOrEqual(15000);
  });

  it('再接続回数は有限', () => {
    expect(MAX_ICE_RESTARTS).toBeGreaterThan(0);
    expect(MAX_ICE_RESTARTS).toBeLessThanOrEqual(5);
  });
});
