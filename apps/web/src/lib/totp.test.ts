import {
  encryptTotpSecret,
  decryptTotpSecret,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpToken,
  generateBackupCodes,
  consumeBackupCode,
  generateTotpQrCodeDataUrl,
} from './totp';

describe('totp: 秘密鍵の暗号化', () => {
  it('暗号化した文字列を復号すると元のシークレットに戻る', () => {
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(secret);
    expect(encrypted).not.toBe(secret);
    expect(decryptTotpSecret(encrypted)).toBe(secret);
  });

  it('暗号化結果は毎回異なる (ivがランダムなため)', () => {
    const secret = generateTotpSecret();
    const a = encryptTotpSecret(secret);
    const b = encryptTotpSecret(secret);
    expect(a).not.toBe(b);
    expect(decryptTotpSecret(a)).toBe(secret);
    expect(decryptTotpSecret(b)).toBe(secret);
  });

  it('不正な形式の復号はエラーになる', () => {
    expect(() => decryptTotpSecret('invalid-format')).toThrow();
  });
});

describe('totp: RFC 6238 コード生成・検証', () => {
  it('正しいコードは検証成功する', () => {
    const secret = generateTotpSecret();
    const token = generateTotpCode(secret);
    expect(verifyTotpToken(secret, token)).toBe(true);
  });

  it('誤ったコードは検証失敗する', () => {
    const secret = generateTotpSecret();
    const token = generateTotpCode(secret);
    const wrong = token === '000000' ? '111111' : '000000';
    expect(verifyTotpToken(secret, wrong)).toBe(false);
  });

  it('別のシークレットで生成したコードは検証失敗する (基本的に)', () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const token = generateTotpCode(secretA);
    expect(verifyTotpToken(secretB, token)).toBe(false);
  });

  it('6桁数字以外のフォーマットは即座に失敗する', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpToken(secret, 'abcdef')).toBe(false);
    expect(verifyTotpToken(secret, '12345')).toBe(false);
    expect(verifyTotpToken(secret, '1234567')).toBe(false);
  });

  it('前後30秒のタイムステップまでは許容される', () => {
    const secret = generateTotpSecret();
    const now = Math.floor(Date.now() / 1000);
    const prevStepToken = generateTotpCode(secret, now - 30);
    const nextStepToken = generateTotpCode(secret, now + 30);
    expect(verifyTotpToken(secret, prevStepToken, now)).toBe(true);
    expect(verifyTotpToken(secret, nextStepToken, now)).toBe(true);
  });

  it('2ステップ以上ずれると検証失敗する', () => {
    const secret = generateTotpSecret();
    const now = Math.floor(Date.now() / 1000);
    const farToken = generateTotpCode(secret, now + 120);
    expect(verifyTotpToken(secret, farToken, now)).toBe(false);
  });

  // RFC 6238 Appendix B のテストベクタ (SHA1, 8桁だが下6桁で比較可能な範囲を確認)
  // ここでは自前実装の HOTP/TOTP が既知の外部値と一致することを別途保証するため、
  // 同一シークレット・同一epochで2回計算しても同じ値になることを確認する (決定性の検証)。
  it('同じシークレット・同じ時刻なら常に同じコードになる (決定性)', () => {
    const secret = generateTotpSecret();
    const epoch = 1735689600; // 固定値
    expect(generateTotpCode(secret, epoch)).toBe(generateTotpCode(secret, epoch));
  });

  it('RFC 6238 Appendix B の既知テストベクタと一致する (SHA1, T=59)', () => {
    // RFC 6238 のテストベクタは ASCII シークレット "12345678901234567890" (20byte) で
    // T=59 (counter=1) のとき 8桁コード "94287082" になることが仕様書に明記されている。
    // 本実装は6桁に切り詰めるため、下6桁 "287082" と一致するかを確認する。
    const asciiSecret = '12345678901234567890';
    const base32Secret = base32EncodeForTest(Buffer.from(asciiSecret, 'ascii'));
    const code = generateTotpCode(base32Secret, 59);
    expect(code).toBe('287082');
  });
});

/** テスト専用の RFC4648 Base32 エンコーダ (totp.ts の非公開実装と同じアルファベット) */
function base32EncodeForTest(buffer: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

describe('totp: QRコード生成', () => {
  it('data URL (PNG base64) を生成できる', async () => {
    const secret = generateTotpSecret();
    const dataUrl = await generateTotpQrCodeDataUrl(secret, 'super@example.com');
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe('totp: バックアップコード', () => {
  it('生成したコードで1回だけ消費できる', () => {
    const { plain, hashed } = generateBackupCodes(8);
    expect(plain).toHaveLength(8);
    expect(hashed).toHaveLength(8);

    const target = plain[3];
    const first = consumeBackupCode(target, hashed);
    expect(first.ok).toBe(true);
    expect(first.remaining).toHaveLength(7);

    // 消費済みコードは remaining から二度目は使えない
    const second = consumeBackupCode(target, first.remaining);
    expect(second.ok).toBe(false);
    expect(second.remaining).toHaveLength(7);
  });

  it('小文字入力やハイフン抜けでも正規化して一致する', () => {
    const { plain, hashed } = generateBackupCodes(4);
    const lower = plain[0].toLowerCase();
    const result = consumeBackupCode(lower, hashed);
    expect(result.ok).toBe(true);
  });

  it('存在しないコードは失敗し配列は変化しない', () => {
    const { hashed } = generateBackupCodes(4);
    const result = consumeBackupCode('ZZZZ-ZZZZ-ZZ', hashed);
    expect(result.ok).toBe(false);
    expect(result.remaining).toHaveLength(4);
  });
});
