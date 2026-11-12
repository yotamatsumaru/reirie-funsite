import { buildEnforcedCsp, buildReportOnlyCsp, stripUrlSecrets, summarizeCspReports } from './csp';

describe('CSP', () => {
  it('実際に効かせている方針は従来どおり (Ticket Dive / Stripe を許可)', () => {
    const csp = buildEnforcedCsp();
    expect(csp).toContain("frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://ticketdive.com https://*.ticketdive.com");
    expect(csp).toContain("form-action 'self' https://ticketdive.com https://*.ticketdive.com");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('report-uri');
  });

  it('Report-Only 側は eval と「https なら何処でも」を外し、報告先を持つ', () => {
    const csp = buildReportOnlyCsp({ videoDomain: 'dvideo.cloudfront.net', assetDomain: 'https://dasset.cloudfront.net/' });
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/connect-src[^;]* https:(;|\s|$)/);
    expect(csp).not.toMatch(/connect-src[^;]*wss:/);
    expect(csp).toContain('https://dvideo.cloudfront.net');
    expect(csp).toContain('https://dasset.cloudfront.net');
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('https://ticketdive.com');
  });

  it('報告内の URL からクエリ (access_token 等) を落とす', () => {
    expect(stripUrlSecrets('https://reirie.com/api/x?access_token=abc#f')).toBe('https://reirie.com/api/x');
    expect(stripUrlSecrets(123)).toBe('');
  });

  it('旧形式・新形式の報告から要点を抜き出す', () => {
    const legacy = summarizeCspReports({
      'csp-report': {
        'document-uri': 'https://reirie.com/notices/1?access_token=x',
        'effective-directive': 'connect-src',
        'blocked-uri': 'https://evil.example/collect?d=1',
      },
    });
    expect(legacy).toEqual([
      { directive: 'connect-src', blocked: 'https://evil.example/collect', document: 'https://reirie.com/notices/1', source: '', line: null },
    ]);
    const modern = summarizeCspReports([
      { type: 'csp-violation', body: { documentURL: 'https://reirie.com/', effectiveDirective: 'script-src-elem', blockedURL: 'inline', sourceFile: 'https://reirie.com/a.js', lineNumber: 3 } },
      { type: 'deprecation', body: {} },
    ]);
    expect(modern).toHaveLength(1);
    expect(modern[0]).toMatchObject({ directive: 'script-src-elem', line: 3 });
    expect(summarizeCspReports('garbage')).toEqual([]);
  });
});
