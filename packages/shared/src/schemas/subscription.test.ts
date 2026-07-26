import { AdminUserSubscriptionActionSchema } from './subscription';

describe('AdminUserSubscriptionActionSchema', () => {
  it('accepts action=sync', () => {
    const r = AdminUserSubscriptionActionSchema.safeParse({ action: 'sync' });
    expect(r.success).toBe(true);
  });

  it('accepts action=grant with plan/interval', () => {
    const r = AdminUserSubscriptionActionSchema.safeParse({
      action: 'grant',
      plan: 'PREMIUM',
      interval: 'YEAR',
    });
    expect(r.success).toBe(true);
  });

  it('accepts action=grant with optional months', () => {
    const r = AdminUserSubscriptionActionSchema.safeParse({
      action: 'grant',
      plan: 'STANDARD',
      interval: 'MONTH',
      months: 3,
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.action === 'grant') {
      expect(r.data.months).toBe(3);
    }
  });

  it('rejects grant with invalid plan', () => {
    const r = AdminUserSubscriptionActionSchema.safeParse({
      action: 'grant',
      plan: 'GOLD',
      interval: 'YEAR',
    });
    expect(r.success).toBe(false);
  });

  it('rejects grant missing interval', () => {
    const r = AdminUserSubscriptionActionSchema.safeParse({
      action: 'grant',
      plan: 'PREMIUM',
    });
    expect(r.success).toBe(false);
  });

  it('rejects months out of range', () => {
    const r = AdminUserSubscriptionActionSchema.safeParse({
      action: 'grant',
      plan: 'PREMIUM',
      interval: 'YEAR',
      months: 120,
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown action', () => {
    const r = AdminUserSubscriptionActionSchema.safeParse({ action: 'delete' });
    expect(r.success).toBe(false);
  });
});
