/**
 * チケット埋め込みタグ (Ticket Dive ルート限定タグ等) のサニタイズのテスト。
 *
 * 重点:
 *  1. Ticket Dive の正規のタグ (リンク / フォーム / iframe) はそのまま動く形で残る
 *  2. script / イベント属性 / javascript: / 許可外ドメイン は必ず除去される
 *  3. Referer が送られる設定 (noreferrer なし) にそろう — ルート限定の判定に必須
 */
import {
  isAllowedTicketUrl,
  sanitizeTicketEmbed,
  TICKET_EMBED_ALLOWED_DOMAINS,
} from './ticket-embed';

describe('isAllowedTicketUrl', () => {
  it.each([
    'https://ticketdive.com/event/abc',
    'https://www.ticketdive.com/event/abc?x=1',
    'https://api.ticketdive.com/route/xyz',
  ])('許可: %s', (u) => expect(isAllowedTicketUrl(u)).toBe(true));

  it.each([
    'http://ticketdive.com/event/abc', // http
    'https://ticketdive.com.evil.example/', // 末尾偽装
    'https://evilticketdive.com/', // 前方一致の偽装
    'https://ticketdive.com@evil.example/', // userinfo 偽装
    'javascript:alert(1)',
    '//ticketdive.com/event/abc', // プロトコル相対
    '/event/abc',
    '',
    undefined,
  ])('拒否: %s', (u) => expect(isAllowedTicketUrl(u as string)).toBe(false));

  it('許可ドメインは ticketdive.com', () => {
    expect(TICKET_EMBED_ALLOWED_DOMAINS).toContain('ticketdive.com');
  });
});

describe('sanitizeTicketEmbed: 正規のタグを残す', () => {
  it('リンク型のタグ: href を残し、Referer を送る設定にそろえる', () => {
    const { html, removed } = sanitizeTicketEmbed(
      '<a href="https://ticketdive.com/event/fc-limited?route=abc" rel="noreferrer" target="_self">FC先行はこちら</a>',
    );
    expect(removed).toEqual([]);
    expect(html).toContain('href="https://ticketdive.com/event/fc-limited?route=abc"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
    expect(html).not.toContain('noreferrer');
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(html).toContain('FC先行はこちら');
  });

  it('フォーム型のタグ: action / hidden / submit を残す', () => {
    const { html, removed } = sanitizeTicketEmbed(
      '<form action="https://ticketdive.com/route/xyz" method="POST">' +
        '<input type="hidden" name="token" value="t-123">' +
        '<button type="submit">申し込む</button></form>',
    );
    expect(removed).toEqual([]);
    expect(html).toContain('action="https://ticketdive.com/route/xyz"');
    expect(html).toContain('method="post"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('type="hidden"');
    expect(html).toContain('value="t-123"');
    expect(html).toContain('申し込む');
  });

  it('iframe 型のタグ: sandbox を固定値で付与する', () => {
    const { html, removed } = sanitizeTicketEmbed(
      '<iframe src="https://ticketdive.com/embed/abc" width="100%" height="600" sandbox="allow-top-navigation"></iframe>',
    );
    expect(removed).toEqual([]);
    expect(html).toContain('src="https://ticketdive.com/embed/abc"');
    expect(html).toContain('sandbox="allow-scripts');
    // 元の危険な sandbox 値 (無条件のトップ遷移) は上書きされる
    expect(html).not.toMatch(/sandbox="allow-top-navigation"/);
    expect(html).toContain('loading="lazy"');
  });

  it('安全な装飾 style は残す', () => {
    const { html } = sanitizeTicketEmbed(
      '<a href="https://ticketdive.com/e" style="background-color:#ff6600;color:#fff;padding:12px 24px;border-radius:8px">申込</a>',
    );
    expect(html).toContain('background-color:#ff6600');
    expect(html).toContain('border-radius:8px');
  });

  it('空入力は空', () => {
    expect(sanitizeTicketEmbed('')).toEqual({ html: '', removed: [] });
    expect(sanitizeTicketEmbed(null)).toEqual({ html: '', removed: [] });
    expect(sanitizeTicketEmbed('   ')).toEqual({ html: '', removed: [] });
  });
});

describe('sanitizeTicketEmbed: 危険なものを除去する', () => {
  it('<script> は中身ごと除去', () => {
    const { html, removed } = sanitizeTicketEmbed(
      '<a href="https://ticketdive.com/e">申込</a><script>alert(document.cookie)</script>',
    );
    expect(html).not.toContain('script');
    expect(html).not.toContain('alert');
    expect(removed.join()).toContain('script');
  });

  it('onclick などのイベント属性は除去', () => {
    const { html, removed } = sanitizeTicketEmbed(
      '<a href="https://ticketdive.com/e" onclick="steal()">申込</a><img src="https://ticketdive.com/x.png" onerror="steal()">',
    );
    expect(html).not.toMatch(/on(click|error)/i);
    expect(removed.join()).toContain('イベント属性');
  });

  it('javascript: リンクは href ごと除去', () => {
    const { html } = sanitizeTicketEmbed('<a href="javascript:alert(1)">申込</a>');
    expect(html).not.toContain('javascript');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('<a');
  });

  it('許可外ドメインのリンクは href を除去して報告', () => {
    const { html, removed } = sanitizeTicketEmbed('<a href="https://evil.example/phish">申込</a>');
    expect(html).not.toContain('evil.example');
    // ボタンに見えないよう、ただの文字 (span) になる
    expect(html).toBe('<span>申込</span>');
    expect(removed.join()).toContain('evil.example');
  });

  it('許可外ドメインのフォームは中身ごと除去', () => {
    const { html, removed } = sanitizeTicketEmbed(
      '<form action="https://evil.example/collect"><button>送信</button></form>',
    );
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<button');
    expect(removed.join()).toContain('フォーム送信先');
  });

  it('テキスト入力欄 (個人情報の収集) は除去', () => {
    const { html, removed } = sanitizeTicketEmbed(
      '<form action="https://ticketdive.com/r"><input type="password" name="pw"><input name="card"><button>送信</button></form>',
    );
    expect(html).not.toContain('password');
    expect(html).not.toContain('name="card"');
    expect(html).toContain('<button');
    expect(removed.join()).toContain('入力欄');
  });

  it('許可外ドメインの iframe は除去', () => {
    const { html, removed } = sanitizeTicketEmbed('<iframe src="https://evil.example/"></iframe>');
    expect(html).toBe('');
    expect(removed.join()).toContain('埋め込み先');
  });

  it('画面を覆う偽装に使える style (position 等) は除去', () => {
    const { html } = sanitizeTicketEmbed(
      '<div style="position:fixed;top:0;left:0;z-index:9999;width:100%;height:100%">偽画面</div>',
    );
    expect(html).not.toContain('position');
    expect(html).not.toContain('z-index');
  });

  it('style 内の url() / expression() は除去', () => {
    const { html } = sanitizeTicketEmbed(
      '<div style="background:url(https://evil.example/x.png);width:expression(alert(1))">x</div>',
    );
    expect(html).not.toContain('url(');
    expect(html).not.toContain('expression');
  });

  it('<style> / <meta> / <object> は除去', () => {
    const { html } = sanitizeTicketEmbed(
      '<style>body{display:none}</style><meta http-equiv="refresh" content="0;url=https://evil.example"><object data="x"></object>OK',
    );
    expect(html).toBe('OK');
  });

  it('使えないタグは removed で知らせる (管理画面の警告用)', () => {
    const { removed } = sanitizeTicketEmbed('<object data="x"></object><a href="https://ticketdive.com/e">申込</a>');
    expect(removed).toContain('<object> は使えません');
  });

  it('印 (内部用 class) を入力に含めても、正規の要素は消えず危険要素も復活しない', () => {
    const { html } = sanitizeTicketEmbed(
      '<a class="__ticket_embed_drop__" href="https://ticketdive.com/e">申込</a>',
    );
    expect(html).toContain('href="https://ticketdive.com/e"');
  });

  it('大文字・エンティティでの偽装も除去', () => {
    const { html } = sanitizeTicketEmbed(
      '<A HREF="JaVaScRiPt:alert(1)">x</A><a href="&#106;avascript:alert(1)">y</a><SCRIPT>bad()</SCRIPT>',
    );
    expect(html.toLowerCase()).not.toContain('javascript');
    expect(html).not.toContain('bad()');
  });

  it('svg / math 経由の XSS は除去', () => {
    const { html } = sanitizeTicketEmbed(
      '<svg><script>bad()</script></svg><math><mtext><img src=x onerror=bad()></mtext></math>',
    );
    expect(html).not.toContain('bad()');
    expect(html).not.toContain('<svg');
  });

  it('srcdoc の iframe は除去 (任意 HTML を埋め込めるため)', () => {
    const { html } = sanitizeTicketEmbed(
      '<iframe srcdoc="<script>bad()</script>" src="https://ticketdive.com/e"></iframe>',
    );
    expect(html).not.toContain('srcdoc');
    expect(html).not.toContain('bad()');
  });
});
