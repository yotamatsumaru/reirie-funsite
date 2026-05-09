import { effectiveUnitPrice, calculateOrderTotals, generateOrderNumber, formatJpy } from './pricing';

describe('pricing', () => {
  describe('effectiveUnitPrice', () => {
    const product = { basePrice: 1000, memberPrice: 900, premiumPrice: 800 };

    it('FREE プランは basePrice + variantDelta', () => {
      expect(effectiveUnitPrice(product, 0, 'FREE')).toBe(1000);
      expect(effectiveUnitPrice(product, 200, 'FREE')).toBe(1200);
    });
    it('STANDARD プランは memberPrice', () => {
      expect(effectiveUnitPrice(product, 0, 'STANDARD')).toBe(900);
    });
    it('PREMIUM プランは premiumPrice 優先', () => {
      expect(effectiveUnitPrice(product, 0, 'PREMIUM')).toBe(800);
    });
    it('memberPrice が null なら basePrice にフォールバック', () => {
      expect(effectiveUnitPrice({ ...product, memberPrice: null }, 0, 'STANDARD')).toBe(1000);
    });
    it('premiumPrice が null なら memberPrice にフォールバック', () => {
      expect(effectiveUnitPrice({ ...product, premiumPrice: null }, 0, 'PREMIUM')).toBe(900);
    });
  });

  describe('calculateOrderTotals', () => {
    it('税は10%、送料は8000円未満で600円', () => {
      const t = calculateOrderTotals(5000);
      expect(t.subtotal).toBe(5000);
      expect(t.taxAmount).toBe(500);
      expect(t.shippingFee).toBe(600);
      expect(t.totalAmount).toBe(6100);
    });
    it('小計 8000 以上で送料無料', () => {
      const t = calculateOrderTotals(8000);
      expect(t.shippingFee).toBe(0);
      expect(t.totalAmount).toBe(8800);
    });
    it('小数税は切り捨て', () => {
      const t = calculateOrderTotals(999);
      expect(t.taxAmount).toBe(99); // floor(99.9)
    });
  });

  describe('generateOrderNumber', () => {
    it('ORD- プレフィックスで一意性が高い', () => {
      const a = generateOrderNumber();
      const b = generateOrderNumber();
      expect(a).toMatch(/^ORD-/);
      expect(a).not.toBe(b);
    });
  });

  describe('formatJpy', () => {
    it('カンマ区切り + 円記号', () => {
      expect(formatJpy(1000)).toBe('¥1,000');
      expect(formatJpy(1234567)).toBe('¥1,234,567');
      expect(formatJpy(0)).toBe('¥0');
    });
  });
});
