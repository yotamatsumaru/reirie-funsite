/**
 * MyRoom 家具マスタのバリデーション / 判定ロジックのテスト。
 *
 * 特に守りたいのは以下の 2 点。
 *  1. 家具マスタの PATCH スキーマに `.default()` が混ざっていないこと
 *     （混ざると「1項目だけ更新したら他が既定値に戻る」不具合になる）
 *  2. 画像がない家具を「販売中」にしても会員に出ないこと
 *     （透明な家具を買わせてしまう事故の防止）
 */
import {
  MYROOM_FURNITURE_CATEGORIES,
  MYROOM_FURNITURE_CATEGORY_LABELS,
  MYROOM_FURNITURE_CATEGORY_DESCRIPTIONS,
  MYROOM_FURNITURE_STATUSES,
  MYROOM_FURNITURE_STATUS_LABELS,
  MYROOM_FURNITURE_NAME_MAX,
  MYROOM_FURNITURE_DESCRIPTION_MAX,
  MYROOM_FURNITURE_PUI_COST_MAX,
  MYROOM_FURNITURE_CELLS_MAX,
  MYROOM_GRID_SIZE,
  MAX_MYROOM_FURNITURE_IMAGE_BYTES,
  ALLOWED_MYROOM_FURNITURE_IMAGE_TYPES,
  MyRoomFurnitureInputSchema,
  MyRoomFurniturePatchSchema,
  DEFAULT_MYROOM_FURNITURE_DRAFT,
  isMyRoomFurnitureCategory,
  validateMyRoomFurnitureImage,
  formatMyRoomImageBytes,
  isMyRoomFurniturePurchasable,
  myRoomFurnitureWarning,
} from './myroom-furniture';

describe('家具の分類', () => {
  it('すべての分類にラベルと説明がある', () => {
    for (const c of MYROOM_FURNITURE_CATEGORIES) {
      expect(MYROOM_FURNITURE_CATEGORY_LABELS[c]).toBeTruthy();
      expect(MYROOM_FURNITURE_CATEGORY_DESCRIPTIONS[c]).toBeTruthy();
    }
  });

  it('ラベルが重複していない（管理画面の選択肢が区別できる）', () => {
    const labels = MYROOM_FURNITURE_CATEGORIES.map((c) => MYROOM_FURNITURE_CATEGORY_LABELS[c]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('isMyRoomFurnitureCategory が既知の分類だけ通す', () => {
    expect(isMyRoomFurnitureCategory('FLOOR')).toBe(true);
    expect(isMyRoomFurnitureCategory('WALL')).toBe(true);
    expect(isMyRoomFurnitureCategory('UNKNOWN')).toBe(false);
    expect(isMyRoomFurnitureCategory('')).toBe(false);
    expect(isMyRoomFurnitureCategory(null)).toBe(false);
    expect(isMyRoomFurnitureCategory(123)).toBe(false);
  });
});

describe('家具の状態', () => {
  it('すべての状態にラベルがある', () => {
    for (const s of MYROOM_FURNITURE_STATUSES) {
      expect(MYROOM_FURNITURE_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it('DRAFT / PUBLISHED / ARCHIVED の3状態を持つ', () => {
    expect(MYROOM_FURNITURE_STATUSES).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
  });
});

describe('MyRoomFurnitureInputSchema', () => {
  const valid = {
    name: 'ふわふわソファ',
    description: 'すわると気持ちいい',
    category: 'FLOOR' as const,
    status: 'PUBLISHED' as const,
    puiCost: 1200,
    widthCells: 2,
    heightCells: 1,
    sortOrder: 0,
  };

  it('正しい入力を通す', () => {
    expect(MyRoomFurnitureInputSchema.parse(valid)).toEqual(valid);
  });

  it('名前の前後の空白を取り除く', () => {
    const parsed = MyRoomFurnitureInputSchema.parse({ ...valid, name: '  いす  ' });
    expect(parsed.name).toBe('いす');
  });

  it('名前が空だと弾く', () => {
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    // 空白だけの名前も trim 後に空になるため弾かれる
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('名前の上限文字数を超えると弾く', () => {
    const ok = 'あ'.repeat(MYROOM_FURNITURE_NAME_MAX);
    const ng = 'あ'.repeat(MYROOM_FURNITURE_NAME_MAX + 1);
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, name: ok }).success).toBe(true);
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, name: ng }).success).toBe(false);
  });

  it('説明の上限文字数を超えると弾く', () => {
    const ng = 'あ'.repeat(MYROOM_FURNITURE_DESCRIPTION_MAX + 1);
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, description: ng }).success).toBe(false);
  });

  it('説明は null を許可する（説明なしの家具を作れる）', () => {
    const parsed = MyRoomFurnitureInputSchema.parse({ ...valid, description: null });
    expect(parsed.description).toBeNull();
  });

  it('Pui が 0 なら通す（無料配布の家具）', () => {
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, puiCost: 0 }).success).toBe(true);
  });

  it('Pui が負の数だと弾く', () => {
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, puiCost: -1 }).success).toBe(false);
  });

  it('Pui が小数だと弾く', () => {
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, puiCost: 10.5 }).success).toBe(false);
  });

  it('Pui の上限を超えると弾く（桁の打ち間違い対策）', () => {
    expect(
      MyRoomFurnitureInputSchema.safeParse({ ...valid, puiCost: MYROOM_FURNITURE_PUI_COST_MAX })
        .success,
    ).toBe(true);
    expect(
      MyRoomFurnitureInputSchema.safeParse({
        ...valid,
        puiCost: MYROOM_FURNITURE_PUI_COST_MAX + 1,
      }).success,
    ).toBe(false);
  });

  it('マス数が 0 以下だと弾く', () => {
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, widthCells: 0 }).success).toBe(false);
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, heightCells: 0 }).success).toBe(false);
  });

  it('マス数がグリッドを超えると弾く（どう置いても部屋に収まらない）', () => {
    expect(
      MyRoomFurnitureInputSchema.safeParse({ ...valid, widthCells: MYROOM_FURNITURE_CELLS_MAX })
        .success,
    ).toBe(true);
    expect(
      MyRoomFurnitureInputSchema.safeParse({
        ...valid,
        widthCells: MYROOM_FURNITURE_CELLS_MAX + 1,
      }).success,
    ).toBe(false);
  });

  it('マス数の上限がグリッドサイズと一致している', () => {
    // グリッドだけ広げて上限を直し忘れる、の逆も検知する
    expect(MYROOM_FURNITURE_CELLS_MAX).toBe(MYROOM_GRID_SIZE);
  });

  it('未知の分類・状態を弾く', () => {
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, category: 'SOFA' }).success).toBe(
      false,
    );
    expect(MyRoomFurnitureInputSchema.safeParse({ ...valid, status: 'LIVE' }).success).toBe(false);
  });
});

describe('MyRoomFurniturePatchSchema', () => {
  it('1項目だけ送れる', () => {
    const parsed = MyRoomFurniturePatchSchema.parse({ puiCost: 500 });
    expect(parsed).toEqual({ puiCost: 500 });
  });

  it('送っていないフィールドが既定値で埋まらない', () => {
    // ここが本質。スキーマに .default() を付けると
    // 「Pui だけ変えたら name が '' に戻る」といった不具合になる。
    const parsed = MyRoomFurniturePatchSchema.parse({ puiCost: 500 });
    expect(Object.keys(parsed)).toEqual(['puiCost']);
    expect('name' in parsed).toBe(false);
    expect('status' in parsed).toBe(false);
    expect('category' in parsed).toBe(false);
  });

  it('空オブジェクトも通る（変更なしの PATCH）', () => {
    expect(MyRoomFurniturePatchSchema.parse({})).toEqual({});
  });

  it('部分更新でも値の検証は効く', () => {
    expect(MyRoomFurniturePatchSchema.safeParse({ puiCost: -5 }).success).toBe(false);
    expect(MyRoomFurniturePatchSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('DEFAULT_MYROOM_FURNITURE_DRAFT', () => {
  /**
   * 初期値は「下書き」なので、そのまま保存できてはいけない。
   * 名前が空の家具が登録できると、会員向けショップに名前のない
   * 家具が並んでしまう。
   */
  it('そのままでは保存できない（名前が未入力の下書き状態）', () => {
    expect(MyRoomFurnitureInputSchema.safeParse(DEFAULT_MYROOM_FURNITURE_DRAFT).success).toBe(
      false,
    );
  });

  it('名前を埋めれば保存できる（他の初期値はそれ自体が妥当）', () => {
    const filled = { ...DEFAULT_MYROOM_FURNITURE_DRAFT, name: 'いす' };
    expect(MyRoomFurnitureInputSchema.safeParse(filled).success).toBe(true);
  });

  it('既定は「準備中」（画像を入れ忘れて販売中になる事故を防ぐ）', () => {
    expect(DEFAULT_MYROOM_FURNITURE_DRAFT.status).toBe('DRAFT');
  });

  it('既定のマス数は 1x1（何を選んでいいか分からないときの安全値）', () => {
    expect(DEFAULT_MYROOM_FURNITURE_DRAFT.widthCells).toBe(1);
    expect(DEFAULT_MYROOM_FURNITURE_DRAFT.heightCells).toBe(1);
  });
});

describe('validateMyRoomFurnitureImage', () => {
  it('PNG / WebP / JPEG を許可する', () => {
    for (const [type, ext] of Object.entries(ALLOWED_MYROOM_FURNITURE_IMAGE_TYPES)) {
      const r = validateMyRoomFurnitureImage({ contentType: type, sizeBytes: 1024 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.ext).toBe(ext);
    }
  });

  it('GIF を拒否する（家具が動くと部屋が騒がしくなるため意図的な制限）', () => {
    const r = validateMyRoomFurnitureImage({ contentType: 'image/gif', sizeBytes: 1024 });
    expect(r.ok).toBe(false);
  });

  it('SVG を拒否する（スクリプト埋め込みの危険）', () => {
    const r = validateMyRoomFurnitureImage({ contentType: 'image/svg+xml', sizeBytes: 1024 });
    expect(r.ok).toBe(false);
  });

  it('空ファイルを拒否する', () => {
    const r = validateMyRoomFurnitureImage({ contentType: 'image/png', sizeBytes: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('空');
  });

  it('上限ちょうどは許可し、1バイト超えたら拒否する', () => {
    expect(
      validateMyRoomFurnitureImage({
        contentType: 'image/png',
        sizeBytes: MAX_MYROOM_FURNITURE_IMAGE_BYTES,
      }).ok,
    ).toBe(true);
    expect(
      validateMyRoomFurnitureImage({
        contentType: 'image/png',
        sizeBytes: MAX_MYROOM_FURNITURE_IMAGE_BYTES + 1,
      }).ok,
    ).toBe(false);
  });

  it('形式エラーのメッセージに推奨形式を含める', () => {
    const r = validateMyRoomFurnitureImage({ contentType: 'image/bmp', sizeBytes: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('PNG');
      expect(r.message).toContain('WebP');
    }
  });

  it('contentType が空でもクラッシュしない', () => {
    const r = validateMyRoomFurnitureImage({ contentType: '', sizeBytes: 100 });
    expect(r.ok).toBe(false);
  });
});

describe('formatMyRoomImageBytes', () => {
  it('単位を読みやすく切り替える', () => {
    expect(formatMyRoomImageBytes(512)).toBe('512 B');
    expect(formatMyRoomImageBytes(2048)).toBe('2 KB');
    expect(formatMyRoomImageBytes(4 * 1024 * 1024)).toBe('4.0 MB');
  });
});

describe('isMyRoomFurniturePurchasable', () => {
  it('販売中かつ画像ありなら購入できる', () => {
    expect(
      isMyRoomFurniturePurchasable({ status: 'PUBLISHED', imageUrl: '/api/media/x' }),
    ).toBe(true);
  });

  it('画像がなければ販売中でも購入できない（透明な家具を売らない）', () => {
    expect(isMyRoomFurniturePurchasable({ status: 'PUBLISHED', imageUrl: null })).toBe(false);
  });

  it('準備中・販売終了は購入できない', () => {
    expect(isMyRoomFurniturePurchasable({ status: 'DRAFT', imageUrl: '/x' })).toBe(false);
    expect(isMyRoomFurniturePurchasable({ status: 'ARCHIVED', imageUrl: '/x' })).toBe(false);
  });
});

describe('myRoomFurnitureWarning', () => {
  it('販売中なのに画像がない場合に警告を出す', () => {
    const w = myRoomFurnitureWarning({ status: 'PUBLISHED', imageUrl: null });
    expect(w).toContain('画像');
  });

  it('問題なければ null', () => {
    expect(myRoomFurnitureWarning({ status: 'PUBLISHED', imageUrl: '/x' })).toBeNull();
    // 準備中に画像がないのは正常な途中状態なので警告しない
    expect(myRoomFurnitureWarning({ status: 'DRAFT', imageUrl: null })).toBeNull();
  });
});
