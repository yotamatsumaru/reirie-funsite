import {
  B2_EXPORT_HEADER,
  buildB2ExportCsv,
  normalizePostal,
  normalizePhone,
  truncateItemName,
  parseB2TrackingCsv,
  type B2ExportOrder,
} from './yamato-b2';

const baseOrder: B2ExportOrder = {
  orderNumber: 'RR-0001',
  shippingPostalCode: '1500001',
  shippingPrefecture: '東京都',
  shippingAddress1: '渋谷区神南1-2-3',
  shippingAddress2: 'サンプルビル101',
  shippingName: '山田 太郎',
  shippingPhone: '03-1234-5678',
  itemName: 'ReiRie フォトブック',
  totalQuantity: 2,
};

describe('yamato-b2', () => {
  describe('normalizePostal', () => {
    it('7桁数字はハイフンを挿入する', () => {
      expect(normalizePostal('1500001')).toBe('150-0001');
    });
    it('既にハイフンありでも数字7桁なら整形する', () => {
      expect(normalizePostal('150-0001')).toBe('150-0001');
    });
    it('7桁でない場合はそのまま返す', () => {
      expect(normalizePostal('12345')).toBe('12345');
    });
    it('空文字は空文字', () => {
      expect(normalizePostal('')).toBe('');
    });
  });

  describe('normalizePhone', () => {
    it('全角数字を半角に変換する', () => {
      expect(normalizePhone('０３－１２３４－５６７８')).toBe('03-1234-5678');
    });
    it('余分な文字(空白・記号)を除去し数字とハイフンのみ残す', () => {
      expect(normalizePhone('TEL: 03 (1234) 5678')).toBe('0312345678');
    });
  });

  describe('truncateItemName', () => {
    it('25文字以内はそのまま', () => {
      expect(truncateItemName('フォトブック')).toBe('フォトブック');
    });
    it('25文字超は24文字+…に丸める', () => {
      const long = 'あ'.repeat(30);
      const out = truncateItemName(long);
      expect(out.length).toBe(25);
      expect(out.endsWith('…')).toBe(true);
    });
    it('前後の空白をトリムする', () => {
      expect(truncateItemName('  グッズ  ')).toBe('グッズ');
    });
  });

  describe('buildB2ExportCsv', () => {
    it('BOM付き・ヘッダ行を含む', () => {
      const csv = buildB2ExportCsv([baseOrder]);
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      const lines = csv.replace(/^\uFEFF/, '').split('\n');
      expect(lines[0]).toBe(B2_EXPORT_HEADER.join(','));
    });

    it('送り状種類=0 / クール区分=0 を固定で付与する', () => {
      const csv = buildB2ExportCsv([baseOrder]).replace(/^\uFEFF/, '');
      const dataLine = csv.split('\n')[1];
      const cols = dataLine.split(',');
      expect(cols[0]).toBe('RR-0001'); // お客様管理番号
      expect(cols[1]).toBe('0'); // 送り状種類=発払い
      expect(cols[2]).toBe('0'); // クール区分=通常
      expect(cols[3]).toBe('150-0001'); // 郵便番号
    });

    it('都道府県+住所1を結合し、建物名は別列に出す', () => {
      const csv = buildB2ExportCsv([baseOrder]).replace(/^\uFEFF/, '');
      const cols = csv.split('\n')[1].split(',');
      expect(cols[4]).toBe('東京都渋谷区神南1-2-3');
      expect(cols[5]).toBe('サンプルビル101');
    });

    it('個数は最低1に補正する', () => {
      const csv = buildB2ExportCsv([{ ...baseOrder, totalQuantity: 0 }]).replace(/^\uFEFF/, '');
      const cols = csv.split('\n')[1].split(',');
      expect(cols[10]).toBe('1');
    });

    it('建物名がnullなら空欄', () => {
      const csv = buildB2ExportCsv([{ ...baseOrder, shippingAddress2: null }]).replace(
        /^\uFEFF/,
        '',
      );
      const cols = csv.split('\n')[1].split(',');
      expect(cols[5]).toBe('');
    });
  });

  describe('parseB2TrackingCsv', () => {
    it('お客様管理番号と送り状番号を名前で検出する', () => {
      const text =
        'お客様管理番号,送り状番号,お届け先名\nRR-0001,1234-5678-9012,山田太郎\nRR-0002,2222-3333-4444,佐藤花子\n';
      const res = parseB2TrackingCsv(text);
      expect(res.error).toBeUndefined();
      expect(res.rows).toEqual([
        { orderNumber: 'RR-0001', trackingNumber: '1234-5678-9012' },
        { orderNumber: 'RR-0002', trackingNumber: '2222-3333-4444' },
      ]);
      expect(res.skipped).toEqual([]);
    });

    it('列順が違っても検出する', () => {
      const text = '送り状番号,お届け先名,お客様管理番号\n1111,山田,RR-0001\n';
      const res = parseB2TrackingCsv(text);
      expect(res.rows).toEqual([{ orderNumber: 'RR-0001', trackingNumber: '1111' }]);
    });

    it('BOMを除去する', () => {
      const text = '\uFEFFお客様管理番号,送り状番号\nRR-0001,1111\n';
      const res = parseB2TrackingCsv(text);
      expect(res.rows).toEqual([{ orderNumber: 'RR-0001', trackingNumber: '1111' }]);
    });

    it('管理番号または送り状番号が欠けた行はスキップする', () => {
      const text = 'お客様管理番号,送り状番号\nRR-0001,1111\n,2222\nRR-0003,\n';
      const res = parseB2TrackingCsv(text);
      expect(res.rows).toEqual([{ orderNumber: 'RR-0001', trackingNumber: '1111' }]);
      expect(res.skipped).toEqual([2, 3]);
    });

    it('ダブルクォート内のカンマを保持する', () => {
      const text = 'お客様管理番号,送り状番号,備考\nRR-0001,1111,"a,b,c"\n';
      const res = parseB2TrackingCsv(text);
      expect(res.rows).toEqual([{ orderNumber: 'RR-0001', trackingNumber: '1111' }]);
    });

    it('CRLF 改行に対応する', () => {
      const text = 'お客様管理番号,送り状番号\r\nRR-0001,1111\r\n';
      const res = parseB2TrackingCsv(text);
      expect(res.rows).toEqual([{ orderNumber: 'RR-0001', trackingNumber: '1111' }]);
    });

    it('ヘッダが見つからなければエラーを返す', () => {
      const text = 'foo,bar\n1,2\n';
      const res = parseB2TrackingCsv(text);
      expect(res.error).toBeDefined();
      expect(res.rows).toEqual([]);
    });

    it('空CSVはエラー', () => {
      expect(parseB2TrackingCsv('').error).toBeDefined();
    });

    it('部分一致で送り状番号列を検出する', () => {
      const text = 'お客様管理番号,お問い合わせ送り状No.\nRR-0001,9999\n';
      const res = parseB2TrackingCsv(text);
      expect(res.rows).toEqual([{ orderNumber: 'RR-0001', trackingNumber: '9999' }]);
    });
  });
});
