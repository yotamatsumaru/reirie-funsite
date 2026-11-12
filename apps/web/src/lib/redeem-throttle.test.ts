import { recordRedeemFailure, redeemBlockedSeconds } from './redeem-throttle';

describe('redeem-throttle', () => {
  const t0 = 1_000_000_000_000;

  it('失敗が上限未満ならブロックしない', () => {
    const u = 'user-a';
    for (let i = 0; i < 9; i++) recordRedeemFailure(u, t0 + i);
    expect(redeemBlockedSeconds(u, t0 + 10)).toBeNull();
  });

  it('10 分以内に 10 回失敗するとブロックし、待ち秒数を返す', () => {
    const u = 'user-b';
    for (let i = 0; i < 10; i++) recordRedeemFailure(u, t0 + i * 1000);
    const sec = redeemBlockedSeconds(u, t0 + 10_000);
    expect(sec).not.toBeNull();
    expect(sec!).toBeGreaterThan(0);
    expect(sec!).toBeLessThanOrEqual(600);
  });

  it('時間が経てば自動で解除される', () => {
    const u = 'user-c';
    for (let i = 0; i < 10; i++) recordRedeemFailure(u, t0);
    expect(redeemBlockedSeconds(u, t0 + 10 * 60 * 1000 + 1)).toBeNull();
  });

  it('ユーザーごとに独立している', () => {
    for (let i = 0; i < 10; i++) recordRedeemFailure('user-d', t0);
    expect(redeemBlockedSeconds('user-e', t0)).toBeNull();
  });
});
