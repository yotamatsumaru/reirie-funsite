/**
 * 景品交換の「重複交換の禁止」と「再ダウンロードの許可」に関するテスト。
 *
 * 【背景 / このテストが守っている仕様】
 * デジタル特典 (壁紙など) は、一度交換すれば以後いつでも何度でもダウンロードできる。
 * にもかかわらず 2 回目の交換ができてしまうと、会員は Pui を払って
 * 「すでに持っているもの」を買うことになり、実質的に Pui を失うだけになる。
 * これが「Pui の重複使用」の実害なので、DIGITAL だけは 1 会員 1 回に限定する。
 *
 * 一方で、
 *  - GOODS を 2 個ほしい
 *  - 次回の特典会でも CALL_PRIORITY を取りたい
 * は正当な要求なので、これらは制限してはいけない。
 *
 * さらに「重複交換を防ぐ」ことと「再ダウンロードを禁じる」ことを
 * 混同しないよう、再ダウンロードは常に許可されることも併せて固定する。
 */
import {
  REWARD_CATALOG_ITEM_KINDS,
  isOncePerUserKind,
  isDuplicateRedemption,
  canRedownloadDigitalAsset,
  isDigitalDelivery,
  requiresShipping,
  type RewardCatalogItemKindLiteral,
} from './reward';

describe('isOncePerUserKind (1 会員 1 回に限定する種別)', () => {
  it('デジタル特典は 1 回だけに限定する', () => {
    expect(isOncePerUserKind('DIGITAL')).toBe(true);
  });

  it('グッズは複数回交換できる（同じものを 2 個ほしい要求は正当）', () => {
    expect(isOncePerUserKind('GOODS')).toBe(false);
  });

  it('特典会優先枠は複数回交換できる（次回もほしい要求は正当）', () => {
    expect(isOncePerUserKind('CALL_PRIORITY')).toBe(false);
  });

  it('種別が増えたときに判定漏れが起きないよう、全種別を網羅的に確認する', () => {
    // 「知らない種別が来たら安全側 (制限しない) に倒れる」ことを保証する。
    // 新しい種別を 1 回だけに限定したい場合は、ここを意図的に赤くしてから直す。
    const onceOnly = REWARD_CATALOG_ITEM_KINDS.filter(isOncePerUserKind);
    expect(onceOnly).toEqual(['DIGITAL']);
  });

  it('「1 回だけの種別」と「デジタル配布の種別」は現状一致している', () => {
    for (const kind of REWARD_CATALOG_ITEM_KINDS) {
      expect(isOncePerUserKind(kind)).toBe(isDigitalDelivery(kind));
    }
  });

  it('「1 回だけの種別」は発送不要な種別である（住所入力を求めない）', () => {
    for (const kind of REWARD_CATALOG_ITEM_KINDS) {
      if (isOncePerUserKind(kind)) expect(requiresShipping(kind)).toBe(false);
    }
  });
});

describe('isDuplicateRedemption (2 回目の交換を拒否するか)', () => {
  it('デジタル特典を未交換なら交換できる', () => {
    expect(isDuplicateRedemption('DIGITAL', 0)).toBe(false);
  });

  it('デジタル特典をすでに 1 件持っていたら 2 回目は拒否する（Pui の重複使用を防ぐ）', () => {
    expect(isDuplicateRedemption('DIGITAL', 1)).toBe(true);
  });

  it('過去のデータ不整合で 2 件以上あっても拒否し続ける', () => {
    // 修正前に作られてしまった重複データが残っていても、
    // 3 件目・4 件目を作らせないことを保証する。
    expect(isDuplicateRedemption('DIGITAL', 2)).toBe(true);
    expect(isDuplicateRedemption('DIGITAL', 99)).toBe(true);
  });

  it('グッズは何件持っていても追加で交換できる', () => {
    expect(isDuplicateRedemption('GOODS', 0)).toBe(false);
    expect(isDuplicateRedemption('GOODS', 1)).toBe(false);
    expect(isDuplicateRedemption('GOODS', 10)).toBe(false);
  });

  it('特典会優先枠は何件持っていても追加で交換できる', () => {
    expect(isDuplicateRedemption('CALL_PRIORITY', 0)).toBe(false);
    expect(isDuplicateRedemption('CALL_PRIORITY', 3)).toBe(false);
  });

  it('キャンセル済みを数に含めない運用なら、返還後は再交換できる', () => {
    // 呼び出し側は CANCELED を除いた件数を渡す契約になっている。
    // 運営がキャンセルして Pui を返した後に「もう交換できない」と
    // 詰んでしまわないことを、仕様として固定する。
    const activeAfterCancel = 0; // 1 件あったが CANCELED になったので 0 件
    expect(isDuplicateRedemption('DIGITAL', activeAfterCancel)).toBe(false);
  });
});

describe('canRedownloadDigitalAsset (再ダウンロードの許可)', () => {
  it('交換済みなら再ダウンロードできる', () => {
    expect(canRedownloadDigitalAsset(true)).toBe(true);
  });

  it('未交換ならダウンロードできない', () => {
    expect(canRedownloadDigitalAsset(false)).toBe(false);
  });

  it('何度ダウンロードしても許可され続ける（回数上限は設けない）', () => {
    // 機種変更・PC 買い替え・保存ミスでも Pui を再度払わせない、という方針。
    // 「重複交換の禁止」が「再ダウンロードの禁止」に転じていないことの確認。
    for (let nthDownload = 1; nthDownload <= 50; nthDownload += 1) {
      expect(canRedownloadDigitalAsset(true)).toBe(true);
    }
  });

  it('2 回目の交換は拒否されるが、再ダウンロードは許可される（両立すること）', () => {
    const kind: RewardCatalogItemKindLiteral = 'DIGITAL';
    const activeRedemptions = 1; // すでに交換済み

    // 交換は拒否
    expect(isDuplicateRedemption(kind, activeRedemptions)).toBe(true);
    // でもダウンロードはできる
    expect(canRedownloadDigitalAsset(activeRedemptions > 0)).toBe(true);
  });
});
