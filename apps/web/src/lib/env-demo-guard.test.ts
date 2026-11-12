import { assertNoDemoModeInProduction } from './env';

describe('assertNoDemoModeInProduction', () => {
  it('本番 + デモモードなら起動を止める', () => {
    expect(() => assertNoDemoModeInProduction({ production: true, demo: true, phase: undefined })).toThrow(
      /デモモード/,
    );
  });
  it('本番でもデモモードでなければ通る', () => {
    expect(() => assertNoDemoModeInProduction({ production: true, demo: false, phase: undefined })).not.toThrow();
  });
  it('開発環境のデモモードは通る (ローカル確認用)', () => {
    expect(() => assertNoDemoModeInProduction({ production: false, demo: true, phase: undefined })).not.toThrow();
  });
  it('next build 中は止めない (起動時に改めて確認される)', () => {
    expect(() =>
      assertNoDemoModeInProduction({ production: true, demo: true, phase: 'phase-production-build' }),
    ).not.toThrow();
  });
});
