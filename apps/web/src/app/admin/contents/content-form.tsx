'use client';

/**
 * コンテンツ (ブログ / ギャラリー) の作成・編集フォーム。
 *
 * バックエンド:
 *   - 作成: POST  /api/admin/contents
 *   - 更新: PATCH /api/admin/contents/[id]
 *   - 削除: DELETE /api/admin/contents/[id]
 *   - 画像: POST  /api/admin/contents/images
 *           (CONTENT 権限。S3 未設定でも DB 保存にフォールバックするので必ず使える)
 *
 * type=BLOG (ブログ記事) / type=GALLERY (画像ギャラリー) を切り替えられる。
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { AccessLevelSelect } from '@/components/admin/AccessLevelSelect';
import { toast } from '@/stores/ui-store';
import type { AccessLevelLiteral } from '@idol/shared';
import { slugifyTitle, suggestSlug, validateSlug } from '@/lib/content-slug';
import { validateContentBodyImage } from '@/lib/content-body-image';

/** 本文画像・カバー画像の共通アップロード先 (CONTENT 権限)。 */
const IMAGE_UPLOAD_URL = '/api/admin/contents/images';

export type ContentType = 'BLOG' | 'GALLERY';
export type ContentStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
// 公開範囲の値は共有定義（Prisma enum と同期済み）をそのまま使う。
// ここで独自に union を定義していたため、段階追加時に取りこぼしが起きやすかった。
export type AccessLevel = AccessLevelLiteral;

export interface ContentInitial {
  id?: string;
  type: ContentType;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImageUrl: string;
  accessLevel: AccessLevel;
  status: ContentStatus;
  authorName: string;
  tags: string[];
}

const EMPTY: ContentInitial = {
  type: 'BLOG',
  slug: '',
  title: '',
  excerpt: '',
  body: '',
  coverImageUrl: '',
  accessLevel: 'PUBLIC',
  status: 'DRAFT',
  authorName: '',
  tags: [],
};

export function ContentForm({
  mode,
  initial,
}: {
  mode: 'create' | 'edit';
  initial?: ContentInitial;
}) {
  const router = useRouter();
  const base = initial ?? EMPTY;
  const [form, setForm] = useState<ContentInitial>(base);
  const [tagsInput, setTagsInput] = useState(base.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // slug をタイトルから自動生成するか (新規時、ユーザーが slug を手入力するまで自動追従)
  const [autoSlug, setAutoSlug] = useState(mode === 'create');
  // ブログ本文の編集モード: ビジュアル(WYSIWYG) / HTMLソース / プレビュー
  const [bodyMode, setBodyMode] = useState<'visual' | 'html' | 'preview'>('visual');
  // 保存済みの内容。離脱ガード (beforeunload) の比較元に使う。
  const [saved, setSaved] = useState(() => JSON.stringify(base));

  const set = <K extends keyof ContentInitial>(k: K, v: ContentInitial[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const dirty = JSON.stringify(form) !== saved;

  /**
   * 書きかけの記事をタブを閉じて失う事故を防ぐ。
   * 本文を長く書く画面なので、うっかり戻る/閉じるの被害が大きい。
   */
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // 文言はブラウザ側で固定されるが、値の設定自体は必要
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function onTitleChange(v: string) {
    setForm((s) => ({
      ...s,
      title: v,
      // 自動追従中はラテン文字部分だけを slug にする。
      // ここで suggestSlug (日付フォールバック付き) を使わないのは、
      // 日本語タイトルを打つ間ずっとランダム接尾辞が変わり続けて
      // 入力欄がチカチカするため。日本語のみで slug が空のままでも、
      // 保存時 (handleSubmit) に自動で post-YYYYMMDD-xxxx を補うので詰まらない。
      ...(autoSlug ? { slug: slugifyTitle(v) } : {}),
    }));
  }

  /** slug を今のタイトルから作り直す (日本語タイトル用の手動ボタン)。 */
  function regenerateSlug() {
    const next = suggestSlug(form.title);
    set('slug', next);
    setAutoSlug(false);
    toast.success(`slug を「${next}」にしました`);
  }

  async function uploadCover(file: File) {
    // サーバに送る前に同じルールで弾く (8MB を送ってから怒られるのは待ち時間の無駄)
    const check = validateContentBodyImage({ contentType: file.type, sizeBytes: file.size });
    if (!check.ok) {
      setError(
        check.error.kind === 'missing' ? '画像ファイルを選択してください' : check.error.message,
      );
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(IMAGE_UPLOAD_URL, { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: { message?: string };
      };
      if (!res.ok || !json.url) {
        throw new Error(
          json.error?.message ??
            '画像のアップロードに失敗しました。下の欄に画像URLを直接入力することもできます。',
        );
      }
      set('coverImageUrl', json.url);
      toast.success('画像をアップロードしました');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.title.trim()) return setError('タイトルを入力してください');

    // 日本語タイトルだと slugifyTitle が空を返すため、ここで自動補完する。
    // 従来はこの状態で「slug は英小文字…」と怒られ、日本語タイトルだけでは
    // 一度も保存できないという詰みが起きていた。
    let slug = form.slug.trim();
    if (slug === '') {
      slug = suggestSlug(form.title);
      set('slug', slug);
      setAutoSlug(false);
    }
    const slugCheck = validateSlug(slug);
    if (!slugCheck.ok) return setError(slugCheck.message);

    setBusy(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        type: form.type,
        slug,
        title: form.title,
        excerpt: form.excerpt || undefined,
        body: form.body,
        coverImageUrl: form.coverImageUrl || undefined,
        accessLevel: form.accessLevel,
        status: form.status,
        authorName: form.authorName || undefined,
        tags,
      };

      const url =
        mode === 'create' ? '/api/admin/contents' : `/api/admin/contents/${initial?.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? `保存に失敗しました (HTTP ${res.status})`);

      // 保存できたので離脱ガードを解除する (これが無いと遷移時に警告が出る)
      setSaved(JSON.stringify({ ...form, slug }));
      toast.success(mode === 'create' ? 'コンテンツを作成しました' : '変更を保存しました');
      router.push('/admin/contents');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!initial?.id) return;
    if (!confirm('このコンテンツを削除します。よろしいですか？（元に戻せません）')) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/contents/${initial.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? '削除に失敗しました');
      }
      // 削除後の遷移で離脱ガードが発火しないようにする
      setSaved(JSON.stringify(form));
      toast.success('コンテンツを削除しました');
      router.push('/admin/contents');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  const isBlog = form.type === 'BLOG';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* メイン: 本文 */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardBody className="space-y-4">
              <Input
                label="タイトル"
                value={form.title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder={isBlog ? '例: 新曲リリースのお知らせ' : '例: 撮影オフショット集'}
                required
              />
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label="slug (URL)"
                    value={form.slug}
                    onChange={(e) => {
                      setAutoSlug(false);
                      set('slug', e.target.value);
                    }}
                    hint="公開URL: /contents/(slug) ・ 英小文字/数字/ハイフンのみ・空欄なら保存時に自動生成"
                    placeholder="new-single-release"
                  />
                </div>
                {/* 日本語タイトルだと自動追従では slug が空になるため、
                    ワンクリックで有効な slug を入れられる逃げ道を用意する。 */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={regenerateSlug}
                  className="mb-[1px] shrink-0"
                >
                  自動生成
                </Button>
              </div>
              <Textarea
                label="抜粋 (一覧カードに表示。任意)"
                value={form.excerpt}
                onChange={(e) => set('excerpt', e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="一覧やSNSシェアで表示される短い説明文"
                hint={`${form.excerpt.length} / 500 文字`}
              />
              {isBlog ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-sm font-medium text-slate-700">本文</label>
                    {/* ビジュアル / HTML / プレビュー の 3 モード切替 */}
                    <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-xs">
                      {(
                        [
                          ['visual', 'ビジュアル'],
                          ['html', 'HTML'],
                          ['preview', 'プレビュー'],
                        ] as const
                      ).map(([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={bodyMode === m}
                          onClick={() => setBodyMode(m)}
                          className={`px-2.5 py-1 transition ${
                            bodyMode === m
                              ? 'bg-brand-600 font-semibold text-white'
                              : 'bg-white text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {bodyMode === 'html' && (
                    <Textarea
                      value={form.body}
                      onChange={(e) => set('body', e.target.value)}
                      rows={16}
                      className="font-mono text-xs"
                      placeholder={'<p>本文をHTMLで入力できます。</p>\n<h2>見出し</h2>\n<p>段落…</p>'}
                    />
                  )}

                  {bodyMode === 'visual' && (
                    <RichTextEditor
                      value={form.body}
                      onChange={(html) => set('body', html)}
                      uploadUrl={IMAGE_UPLOAD_URL}
                      placeholder="ここに記事本文を入力してください。ツールバーで見出し・太字・リスト・画像などを挿入できます。画像はドラッグ&ドロップや貼り付けでも入ります。"
                    />
                  )}

                  {bodyMode === 'preview' && (
                    /* 公開ページと同じ prose クラスで描画して、
                       保存前に読者からの見え方を確認できるようにする。
                       ここに出る HTML はエディタ由来 (= 管理者が自分で書いたもの) で、
                       保存時に sanitizeContentBody() が改めて無害化する。 */
                    <div className="min-h-[320px] rounded-md border border-slate-300 bg-white px-4 py-3">
                      {form.body.trim() === '' ? (
                        <p className="text-sm text-slate-400">
                          本文がまだ空です。「ビジュアル」タブで入力してください。
                        </p>
                      ) : (
                        <div
                          className="prose prose-slate max-w-none prose-headings:font-bold prose-a:text-brand-600 prose-img:rounded-lg"
                          dangerouslySetInnerHTML={{ __html: form.body }}
                        />
                      )}
                    </div>
                  )}

                  <p className="text-xs text-slate-500">
                    見出し・強調・リスト・リンク・画像を挿入できます。画像は
                    <span className="font-medium">ツールバーの画像ボタン</span>、
                    <span className="font-medium">ドラッグ&amp;ドロップ</span>、
                    <span className="font-medium">貼り付け (Ctrl/Cmd+V)</span>
                    のいずれでも入り、挿入後にクリックすると幅と配置を変更できます。保存時に安全なHTMLのみに整形されます。
                  </p>
                </div>
              ) : (
                <Textarea
                  label="説明文 (HTML可)"
                  value={form.body}
                  onChange={(e) => set('body', e.target.value)}
                  rows={6}
                  placeholder="ギャラリーの説明文"
                  hint="安全なHTMLタグのみ許可されます（危険なタグ/属性は自動除去）。"
                />
              )}
            </CardBody>
          </Card>
        </div>

        {/* サイド: 公開設定・種別・カバー画像 */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-800">公開設定</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <Select
                label="種別"
                value={form.type}
                onChange={(e) => set('type', e.target.value as ContentType)}
              >
                <option value="BLOG">ブログ記事</option>
                <option value="GALLERY">ギャラリー</option>
              </Select>
              <Select
                label="公開状態"
                value={form.status}
                onChange={(e) => set('status', e.target.value as ContentStatus)}
              >
                <option value="DRAFT">下書き (非公開)</option>
                <option value="PUBLISHED">公開</option>
                <option value="ARCHIVED">アーカイブ</option>
              </Select>
              <AccessLevelSelect
                value={form.accessLevel}
                onChange={(v) => set('accessLevel', v)}
              />
              <Input
                label="著者名 (任意)"
                value={form.authorName}
                onChange={(e) => set('authorName', e.target.value)}
                placeholder="REIRIE 運営"
              />
              <Input
                label="タグ (カンマ区切り・任意)"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="お知らせ, ライブ, 新曲"
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-800">カバー画像</h2>
            </CardHeader>
            <CardBody className="space-y-3">
              {form.coverImageUrl ? (
                <div className="overflow-hidden rounded-md border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={form.coverImageUrl}
                    alt="カバー"
                    className="aspect-video w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-slate-300 text-xs text-slate-400">
                  未設定
                </div>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  画像をアップロード
                </span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadCover(f);
                  }}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
                />
                {uploading && (
                  <span className="mt-1 block text-xs text-slate-500">アップロード中…</span>
                )}
              </label>
              <Input
                label="または画像URLを直接入力"
                value={form.coverImageUrl}
                onChange={(e) => set('coverImageUrl', e.target.value)}
                placeholder="https://…"
              />
            </CardBody>
          </Card>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button type="submit" loading={busy}>
            {mode === 'create' ? '作成する' : '変更を保存'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              // 書きかけを捨てる操作なので、変更がある時だけ確認する
              if (dirty && !confirm('保存していない変更があります。破棄してよろしいですか？')) {
                return;
              }
              setSaved(JSON.stringify(form)); // beforeunload を黙らせてから遷移
              router.push('/admin/contents');
            }}
            disabled={busy || deleting}
          >
            キャンセル
          </Button>
          {/* 保存漏れに気付けるようにする。長い記事ほど「保存したつもり」が起きやすい。 */}
          {dirty && (
            <span className="self-center text-xs text-amber-600">● 未保存の変更があります</span>
          )}
        </div>
        {mode === 'edit' && (
          <div className="flex items-center gap-2">
            {form.slug && form.status === 'PUBLISHED' && (
              <a
                href={`/contents/${form.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-brand-600 hover:underline"
              >
                公開ページを見る ↗
              </a>
            )}
            <Button type="button" variant="danger" onClick={handleDelete} loading={deleting}>
              削除
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
