'use client';

/**
 * コンテンツ (ブログ / ギャラリー) の作成・編集フォーム。
 *
 * バックエンド:
 *   - 作成: POST  /api/admin/contents
 *   - 更新: PATCH /api/admin/contents/[id]
 *   - 削除: DELETE /api/admin/contents/[id]
 *   - 画像: POST  /api/admin/uploads/image (S3 設定時のみ。未設定なら URL 直接入力にフォールバック)
 *
 * type=BLOG (ブログ記事) / type=GALLERY (画像ギャラリー) を切り替えられる。
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { AccessLevelSelect } from '@/components/admin/AccessLevelSelect';
import { toast } from '@/stores/ui-store';
import type { AccessLevelLiteral } from '@idol/shared';

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

/** タイトルから slug の候補を生成する (英数字・ハイフンのみ)。日本語は除去される。 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

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
  // ブログ本文を「ビジュアル編集(WYSIWYG)」か「HTMLソース編集」で切り替える
  const [sourceMode, setSourceMode] = useState(false);

  const set = <K extends keyof ContentInitial>(k: K, v: ContentInitial[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  function onTitleChange(v: string) {
    set('title', v);
    if (autoSlug) set('slug', slugify(v));
  }

  async function uploadCover(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/uploads/image', { method: 'POST', body: fd });
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
    if (!/^[a-z0-9-]+$/.test(form.slug))
      return setError('slug は英小文字・数字・ハイフンのみで入力してください');

    setBusy(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const payload = {
        type: form.type,
        slug: form.slug,
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
              <Input
                label="slug (URL)"
                value={form.slug}
                onChange={(e) => {
                  setAutoSlug(false);
                  set('slug', e.target.value);
                }}
                hint="公開URL: /contents/(slug) ・ 英小文字/数字/ハイフンのみ"
                placeholder="new-single-release"
                required
              />
              <Textarea
                label="抜粋 (一覧カードに表示。任意)"
                value={form.excerpt}
                onChange={(e) => set('excerpt', e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="一覧やSNSシェアで表示される短い説明文"
              />
              {isBlog ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-slate-700">本文</label>
                    <button
                      type="button"
                      onClick={() => setSourceMode((v) => !v)}
                      className="text-xs text-slate-500 hover:text-brand-600 hover:underline"
                    >
                      {sourceMode ? '← ビジュアル編集に戻す' : 'HTMLソースを編集'}
                    </button>
                  </div>
                  {sourceMode ? (
                    <Textarea
                      value={form.body}
                      onChange={(e) => set('body', e.target.value)}
                      rows={16}
                      className="font-mono text-xs"
                      placeholder={'<p>本文をHTMLで入力できます。</p>\n<h2>見出し</h2>\n<p>段落…</p>'}
                    />
                  ) : (
                    <RichTextEditor
                      value={form.body}
                      onChange={(html) => set('body', html)}
                      placeholder="ここに記事本文を入力してください。ツールバーで見出し・太字・リスト・画像などを挿入できます。"
                    />
                  )}
                  <p className="text-xs text-slate-500">
                    ツールバーで見出し・強調・リスト・リンク・画像などを挿入できます。保存時に安全なHTMLのみに整形されます。
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
            onClick={() => router.push('/admin/contents')}
            disabled={busy || deleting}
          >
            キャンセル
          </Button>
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
