/**
 * parseMultipartForm のテスト。
 *
 * 目的は「失敗時に本当の原因 (message/stack) と診断用メタ情報を
 * console.error に残しつつ null を返す」という契約を保証すること。
 * これがないと、本番の "multipart/form-data で送信してください" が
 * 再発したときに `pm2 logs` を見ても本当の原因が分からず、
 * 毎回コードを読み直して切り分けるところからやり直すことになる。
 */
import { parseMultipartForm } from './errors';

describe('parseMultipartForm', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('正常な multipart/form-data リクエストは FormData を返す', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'hello.txt');
    const req = new Request('http://localhost/api/test', { method: 'POST', body: fd });

    const form = await parseMultipartForm(req);

    expect(form).not.toBeNull();
    expect(form?.get('file')).toBeInstanceOf(Blob);
    // 正常系ではログを汚さない
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('req.formData() が reject した場合、null を返し、エラー内容をログに残す', async () => {
    const req = new Request('http://localhost/api/admin/contents/images', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=----broken',
        'content-length': '123',
      },
      // boundary と実際のボディが食い違っている壊れたリクエストを模す。
      // 実装は new Request の内部パーサに依存するため、環境によって
      // reject の詳細メッセージは変わり得るが、null を返すこと自体は
      // 安定して再現できる。
      body: 'not-a-valid-multipart-body-at-all',
    });

    const form = await parseMultipartForm(req);

    expect(form).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [message, meta] = consoleErrorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('[upload] failed to parse multipart/form-data body');
    // 診断に必要なメタ情報が入っていること (原因の切り分けに使う)
    expect(meta).toMatchObject({
      url: 'http://localhost/api/admin/contents/images',
      contentType: 'multipart/form-data; boundary=----broken',
      contentLength: '123',
    });
    expect(meta.error).toBeDefined();
  });

  it('Content-Type が multipart/form-data でない場合も reject 理由をログに残して null を返す', async () => {
    const req = new Request('http://localhost/api/admin/uploads/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    });

    const form = await parseMultipartForm(req);

    expect(form).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [, meta] = consoleErrorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(meta.contentType).toBe('application/json');
  });
});
