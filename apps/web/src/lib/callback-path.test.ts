import { resolveCallbackPath } from './callback-path';

describe('resolveCallbackPath', () => {
  it('ローカルパスはそのまま (クエリ・ハッシュも保持)', () => {
    expect(resolveCallbackPath('/me/videos')).toBe('/me/videos');
    expect(resolveCallbackPath('/notices/abc?x=1#top')).toBe('/notices/abc?x=1#top');
  });
  it('未指定・トップはマイページ', () => {
    expect(resolveCallbackPath(null)).toBe('/me');
    expect(resolveCallbackPath('')).toBe('/me');
    expect(resolveCallbackPath('/')).toBe('/me');
    expect(resolveCallbackPath('/?a=1')).toBe('/me');
  });
  it('外部サイトへの遷移は拒否 (オープンリダイレクト対策)', () => {
    for (const v of ['//evil.com', 'https://evil.com/me', 'javascript:alert(1)', '/\\evil.com', 'me']) {
      expect(resolveCallbackPath(v, 'https://reirie.com')).toBe('/me');
    }
  });
  it('自サイトの絶対 URL はパス部分だけ使う / origin 指定なしなら拒否', () => {
    expect(resolveCallbackPath('https://reirie.com/me/videos?a=1', 'https://reirie.com')).toBe('/me/videos?a=1');
    expect(resolveCallbackPath('https://reirie.com/me/videos')).toBe('/me');
  });
  it('ログイン画面などへ戻すとループするのでマイページ', () => {
    expect(resolveCallbackPath('/signin')).toBe('/me');
    expect(resolveCallbackPath('/signin?callbackUrl=/me')).toBe('/me');
    expect(resolveCallbackPath('/signup')).toBe('/me');
    expect(resolveCallbackPath('/signinx')).toBe('/signinx');
  });
});
