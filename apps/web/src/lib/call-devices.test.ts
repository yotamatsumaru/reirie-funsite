import {
  toDeviceOptions,
  pickDeviceId,
  needsPermissionForLabels,
  buildMediaConstraints,
  DEVICE_STORAGE_KEYS,
  type DeviceInfoLike,
} from './call-devices';

function dev(
  deviceId: string,
  kind: string,
  label: string,
  groupId?: string,
): DeviceInfoLike {
  return { deviceId, kind, label, groupId };
}

describe('toDeviceOptions', () => {
  it('kind でフィルタする', () => {
    const devices = [
      dev('cam1', 'videoinput', 'FaceTime HD Camera'),
      dev('mic1', 'audioinput', 'MacBook Pro マイク'),
      dev('spk1', 'audiooutput', 'MacBook Pro スピーカー'),
    ];
    expect(toDeviceOptions(devices, 'videoinput')).toEqual([
      { deviceId: 'cam1', label: 'FaceTime HD Camera', isFallbackLabel: false },
    ]);
    expect(toDeviceOptions(devices, 'audioinput')).toEqual([
      { deviceId: 'mic1', label: 'MacBook Pro マイク', isFallbackLabel: false },
    ]);
    expect(toDeviceOptions(devices, 'audiooutput')).toEqual([
      { deviceId: 'spk1', label: 'MacBook Pro スピーカー', isFallbackLabel: false },
    ]);
  });

  it('deviceId が空のプレースホルダを除外する', () => {
    const devices = [dev('', 'videoinput', ''), dev('cam1', 'videoinput', 'Camera A')];
    const options = toDeviceOptions(devices, 'videoinput');
    expect(options).toHaveLength(1);
    expect(options[0]!.deviceId).toBe('cam1');
  });

  it('label が空ならフォールバック名を付け isFallbackLabel を立てる', () => {
    const devices = [dev('cam1', 'videoinput', ''), dev('cam2', 'videoinput', '')];
    expect(toDeviceOptions(devices, 'videoinput')).toEqual([
      { deviceId: 'cam1', label: 'カメラ 1', isFallbackLabel: true },
      { deviceId: 'cam2', label: 'カメラ 2', isFallbackLabel: true },
    ]);
  });

  it('マイク・スピーカーのフォールバック名も種別ごとに変わる', () => {
    expect(toDeviceOptions([dev('m', 'audioinput', '')], 'audioinput')[0]!.label).toBe(
      'マイク 1',
    );
    expect(toDeviceOptions([dev('s', 'audiooutput', '')], 'audiooutput')[0]!.label).toBe(
      'スピーカー 1',
    );
  });

  it('label の前後の空白は除去する', () => {
    const options = toDeviceOptions([dev('cam1', 'videoinput', '  Camera A  ')], 'videoinput');
    expect(options[0]!.label).toBe('Camera A');
    expect(options[0]!.isFallbackLabel).toBe(false);
  });

  it('空白のみの label はフォールバック扱いにする', () => {
    const options = toDeviceOptions([dev('cam1', 'videoinput', '   ')], 'videoinput');
    expect(options[0]!.label).toBe('カメラ 1');
    expect(options[0]!.isFallbackLabel).toBe(true);
  });

  it('deviceId の重複を除外する', () => {
    const devices = [
      dev('cam1', 'videoinput', 'Camera A'),
      dev('cam1', 'videoinput', 'Camera A (dup)'),
    ];
    expect(toDeviceOptions(devices, 'videoinput')).toHaveLength(1);
  });

  it("Chrome の 'default' / 'communications' は実デバイスの後ろに並べる", () => {
    const devices = [
      dev('default', 'audioinput', 'デフォルト - マイク'),
      dev('communications', 'audioinput', '通信 - マイク'),
      dev('real1', 'audioinput', 'USB Microphone'),
      dev('real2', 'audioinput', '内蔵マイク'),
    ];
    const ids = toDeviceOptions(devices, 'audioinput').map((o) => o.deviceId);
    expect(ids).toEqual(['real1', 'real2', 'default', 'communications']);
  });

  it('空配列なら空配列を返す', () => {
    expect(toDeviceOptions([], 'videoinput')).toEqual([]);
  });
});

describe('pickDeviceId', () => {
  const options = toDeviceOptions(
    [dev('cam1', 'videoinput', 'A'), dev('cam2', 'videoinput', 'B')],
    'videoinput',
  );

  it('保存済み ID が使えるならそれを返す', () => {
    expect(pickDeviceId(options, 'cam2')).toBe('cam2');
  });

  it('保存済み ID が存在しなければ先頭を返す', () => {
    expect(pickDeviceId(options, 'gone')).toBe('cam1');
  });

  it('保存済み ID が null なら先頭を返す', () => {
    expect(pickDeviceId(options, null)).toBe('cam1');
    expect(pickDeviceId(options)).toBe('cam1');
  });

  it('空文字は無効として扱い先頭を返す', () => {
    expect(pickDeviceId(options, '')).toBe('cam1');
  });

  it('選択肢が無ければ null (= ブラウザ既定に任せる)', () => {
    expect(pickDeviceId([], 'cam1')).toBeNull();
  });
});

describe('needsPermissionForLabels', () => {
  it('全部フォールバック名なら true', () => {
    const options = toDeviceOptions(
      [dev('cam1', 'videoinput', ''), dev('cam2', 'videoinput', '')],
      'videoinput',
    );
    expect(needsPermissionForLabels(options)).toBe(true);
  });

  it('1つでも実名があれば false', () => {
    const options = toDeviceOptions(
      [dev('cam1', 'videoinput', ''), dev('cam2', 'videoinput', 'Real Camera')],
      'videoinput',
    );
    expect(needsPermissionForLabels(options)).toBe(false);
  });

  it('選択肢が空なら true', () => {
    expect(needsPermissionForLabels([])).toBe(true);
  });
});

describe('buildMediaConstraints', () => {
  it('deviceId が指定されていれば exact で要求する', () => {
    const c = buildMediaConstraints({ videoDeviceId: 'cam1', audioDeviceId: 'mic1' });
    expect(c.video).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      deviceId: { exact: 'cam1' },
    });
    expect(c.audio).toEqual({ deviceId: { exact: 'mic1' } });
  });

  it('exact:false なら ideal にフォールバックする', () => {
    const c = buildMediaConstraints(
      { videoDeviceId: 'cam1', audioDeviceId: 'mic1' },
      { exact: false },
    );
    expect(c.video).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      deviceId: { ideal: 'cam1' },
    });
    expect(c.audio).toEqual({ deviceId: { ideal: 'mic1' } });
  });

  it('deviceId が無ければ 720p 希望のみ / audio:true', () => {
    const c = buildMediaConstraints({});
    expect(c.video).toEqual({ width: { ideal: 1280 }, height: { ideal: 720 } });
    expect(c.audio).toBe(true);
  });

  it('deviceId が null でも既定扱いにする', () => {
    const c = buildMediaConstraints({ videoDeviceId: null, audioDeviceId: null });
    expect(c.video).toEqual({ width: { ideal: 1280 }, height: { ideal: 720 } });
    expect(c.audio).toBe(true);
  });

  it('video:false なら映像を要求しない', () => {
    const c = buildMediaConstraints({ audioDeviceId: 'mic1' }, { video: false });
    expect(c.video).toBe(false);
    expect(c.audio).toEqual({ deviceId: { exact: 'mic1' } });
  });

  it('audio:false なら音声を要求しない (カメラ切替時に使う)', () => {
    const c = buildMediaConstraints({ videoDeviceId: 'cam2' }, { audio: false });
    expect(c.audio).toBe(false);
    expect(c.video).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      deviceId: { exact: 'cam2' },
    });
  });
});

describe('DEVICE_STORAGE_KEYS', () => {
  it('種別ごとに別のキーを使う', () => {
    const keys = Object.values(DEVICE_STORAGE_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('キーは名前空間付きで衝突しにくい', () => {
    for (const key of Object.values(DEVICE_STORAGE_KEYS)) {
      expect(key.startsWith('idol.call.deviceId.')).toBe(true);
    }
  });
});
