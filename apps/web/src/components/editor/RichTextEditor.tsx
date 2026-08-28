'use client';

/**
 * RichTextEditor — WordPress 風のビジュアル (WYSIWYG) 本文エディタ。
 *
 * TipTap (ProseMirror) ベース。出力は HTML 文字列で、既存の Content.body と互換。
 * 保存時は admin API 側で sanitizeContentBody() により再サニタイズされるため、
 * ここで出力しうるタグ/属性は sanitize-html.ts の許可リストと一致させている。
 *
 * ツールバー機能:
 *   - 見出し (H2/H3) / 本文
 *   - 太字 / 斜体 / 下線 / 打消し / インラインコード
 *   - 箇条書き / 番号付きリスト / 引用 / 区切り線
 *   - 左揃え / 中央揃え / 右揃え
 *   - リンク挿入・解除 (インラインパネル)
 *   - 画像挿入 (アップロード / URL / ドラッグ&ドロップ / 貼り付け)
 *   - 元に戻す / やり直し
 *
 * 画像の入れ方は 4 通り用意している。編集者がどれか 1 つでも
 * 手に馴染む方法を持てるようにするため:
 *   1. ツールバーの画像ボタン → ファイル選択
 *   2. 本文へファイルをドラッグ&ドロップ
 *   3. スクリーンショットなどをそのまま貼り付け (Ctrl/Cmd+V)
 *   4. 画像 URL を直接入力 (外部画像を貼りたいとき)
 *
 * 画像を選択すると、幅 (25/50/75/100%) と配置 (左/中央/右) を
 * 変更するバーが出る。指定は style 属性に畳まれ、サニタイズ後も残る。
 *
 * 使い方:
 *   <RichTextEditor value={html} onChange={setHtml} />
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code as CodeIcon,
  List,
  ListOrdered,
  Quote,
  Minus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link as LinkIcon,
  Unlink,
  Image as ImageIcon,
  Link2,
  Undo2,
  Redo2,
  Heading2,
  Heading3,
  Pilcrow,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from '@/stores/ui-store';
import { StyledImage } from './StyledImage';
import { EditorPopover } from './EditorPopover';
import {
  IMAGE_ALIGN_LABELS,
  IMAGE_WIDTH_PRESETS,
  type ImageAlign,
} from '@/lib/editor-image-style';
import {
  MAX_CONTENT_BODY_IMAGE_BYTES,
  ALLOWED_CONTENT_BODY_IMAGE_TYPES,
  formatBytes,
  validateContentBodyImage,
} from '@/lib/content-body-image';

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** 画像アップロード先 API。未指定時は記事本文用エンドポイント。 */
  uploadUrl?: string;
}

/** 開いているインラインパネル。null は閉じている状態。 */
type Panel = 'link' | 'imageUrl' | null;

export function RichTextEditor({
  value,
  onChange,
  placeholder = '本文を入力してください…',
  // 既定は CONTENT 権限で使える本文画像エンドポイント。
  // 旧既定の /api/admin/uploads/image は MERCH (物販) 権限必須かつ
  // S3 未設定だと失敗するため、記事担当者が画像を入れられなかった。
  uploadUrl = '/api/admin/contents/images',
}: RichTextEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [imageUrlDraft, setImageUrlDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ドラッグは子要素に入るたび leave が飛ぶので、深さを数えて枠の点滅を防ぐ
  const dragDepth = useRef(0);
  /**
   * editorProps (handlePaste / handleDrop) から画像アップロードを呼ぶための穴。
   * useEditor の設定オブジェクトは uploadFiles の宣言より前に評価されるため、
   * 直接参照すると TDZ で ReferenceError になる。ref 経由なら
   * 実際に呼ばれるのはユーザー操作時なので安全。
   */
  const uploadFilesRef = useRef<(files: File[]) => void>(() => {});

  const editor = useEditor({
    // Next.js SSR ハイドレーション不一致を防ぐ (v3 推奨)
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // link は StarterKit v3 に含まれる。target/rel はサニタイザ側で補正。
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      StyledImage.configure({
        inline: false,
        HTMLAttributes: { class: 'rounded-lg' },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
      // 文字数の目安表示用。SNS シェアや一覧の見え方を意識して書けるように。
      CharacterCount.configure(),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class:
          'prose prose-slate max-w-none min-h-[320px] px-4 py-3 focus:outline-none prose-headings:font-bold prose-a:text-brand-600 prose-img:rounded-lg',
      },
      // スクリーンショットをそのまま Ctrl/Cmd+V で貼れるようにする。
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        uploadFilesRef.current(images);
        return true;
      },
      // 本文へのファイルドロップ。ProseMirror 側で拾って既定動作
      // (ブラウザが画像単体のページへ遷移する) を止める。
      handleDrop: (_view, event) => {
        const dt = (event as DragEvent).dataTransfer;
        const files = Array.from(dt?.files ?? []);
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        uploadFilesRef.current(images);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // TipTap が空のとき "<p></p>" を返すので、空文字に正規化
      onChange(html === '<p></p>' ? '' : html);
    },
  });

  // 外部から value が差し替わった場合 (edit ロード時など) にエディタへ反映
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || '';
    if (next !== current && next !== '') {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  /**
   * 画像を 1 枚アップロードして本文に差し込む。
   * サーバ側でも検証するが、8MB のファイルを送ってから弾かれるのは
   * 待ち時間が無駄なので、送信前に同じルールで先に弾く。
   */
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!editor || files.length === 0) return;
      setUploading(true);
      try {
        for (const file of files) {
          const check = validateContentBodyImage({
            contentType: file.type,
            sizeBytes: file.size,
          });
          if (!check.ok) {
            toast.error(
              check.error.kind === 'missing'
                ? '画像ファイルを選択してください'
                : check.error.message,
            );
            continue;
          }

          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch(uploadUrl, { method: 'POST', body: fd });
          const json = (await res.json().catch(() => ({}))) as {
            url?: string;
            error?: { message?: string };
          };
          if (!res.ok || !json.url) {
            throw new Error(
              json.error?.message ??
                '画像のアップロードに失敗しました。「URLで挿入」から画像URLを直接指定することもできます。',
            );
          }
          // alt はファイル名を初期値にしておく (未入力よりはマシで、後から直せる)
          const alt = file.name.replace(/\.[^.]+$/, '');
          editor.chain().focus().setImage({ src: json.url, alt }).run();
        }
        toast.success(files.length > 1 ? `画像を ${files.length} 枚挿入しました` : '画像を挿入しました');
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [editor, uploadUrl],
  );

  // editorProps から呼べるように最新版を ref に載せ替える
  useEffect(() => {
    uploadFilesRef.current = (files: File[]) => {
      void uploadFiles(files);
    };
  }, [uploadFiles]);

  /* ===== リンクパネル ===== */
  const openLinkPanel = useCallback(() => {
    if (!editor) return;
    setLinkDraft((editor.getAttributes('link').href as string | undefined) ?? '');
    setPanel((p) => (p === 'link' ? null : 'link'));
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkDraft.trim();
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setPanel(null);
  }, [editor, linkDraft]);

  /* ===== 画像 URL パネル ===== */
  const openImageUrlPanel = useCallback(() => {
    setImageUrlDraft('');
    setPanel((p) => (p === 'imageUrl' ? null : 'imageUrl'));
  }, []);

  const applyImageUrl = useCallback(() => {
    if (!editor) return;
    const url = imageUrlDraft.trim();
    if (url !== '') {
      editor.chain().focus().setImage({ src: url }).run();
    }
    setPanel(null);
  }, [editor, imageUrlDraft]);

  if (!editor) {
    return (
      <div className="min-h-[380px] rounded-md border border-slate-300 bg-slate-50" aria-busy>
        <div className="border-b border-slate-200 px-3 py-2 text-xs text-slate-400">
          エディタを読み込み中…
        </div>
      </div>
    );
  }

  const imageSelected = editor.isActive('image');
  const characters = editor.storage.characterCount?.characters?.() ?? 0;
  const words = editor.storage.characterCount?.words?.() ?? 0;
  const acceptTypes = Object.keys(ALLOWED_CONTENT_BODY_IMAGE_TYPES).join(',');

  return (
    <div
      className={`overflow-hidden rounded-md border bg-white transition ${
        dragging
          ? 'border-brand-400 ring-2 ring-brand-200'
          : 'border-slate-300 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-200'
      }`}
      // ドロップ枠のハイライト。実際の挿入は ProseMirror の handleDrop が担当。
      onDragEnter={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={() => {
        dragDepth.current = 0;
        setDragging(false);
      }}
    >
      {/* ===== ツールバー =====
          スクロールしても届くように sticky。長い記事で本文の下の方を
          書いているときに、いちいち上まで戻らずに装飾できるようにする。 */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        {/* ブロック種別 */}
        <ToolButton
          icon={Pilcrow}
          label="本文"
          shortcut="Ctrl+Alt+0"
          active={editor.isActive('paragraph') && !editor.isActive('heading')}
          onClick={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolButton
          icon={Heading2}
          label="見出し (大)"
          shortcut="Ctrl+Alt+2"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolButton
          icon={Heading3}
          label="見出し (小)"
          shortcut="Ctrl+Alt+3"
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />

        <Divider />

        {/* インライン装飾 */}
        <ToolButton
          icon={Bold}
          label="太字"
          shortcut="Ctrl+B"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolButton
          icon={Italic}
          label="斜体"
          shortcut="Ctrl+I"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolButton
          icon={UnderlineIcon}
          label="下線"
          shortcut="Ctrl+U"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolButton
          icon={Strikethrough}
          label="打消し線"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolButton
          icon={CodeIcon}
          label="インラインコード"
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />

        <Divider />

        {/* リスト・ブロック */}
        <ToolButton
          icon={List}
          label="箇条書き"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolButton
          icon={ListOrdered}
          label="番号付きリスト"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolButton
          icon={Quote}
          label="引用"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolButton
          icon={Minus}
          label="区切り線"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />

        <Divider />

        {/* 揃え */}
        <ToolButton
          icon={AlignLeft}
          label="左揃え"
          active={editor.isActive({ textAlign: 'left' })}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        />
        <ToolButton
          icon={AlignCenter}
          label="中央揃え"
          active={editor.isActive({ textAlign: 'center' })}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        />
        <ToolButton
          icon={AlignRight}
          label="右揃え"
          active={editor.isActive({ textAlign: 'right' })}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        />

        <Divider />

        {/* リンク・画像 */}
        <ToolButton
          icon={LinkIcon}
          label="リンク"
          shortcut="Ctrl+K"
          active={editor.isActive('link') || panel === 'link'}
          onClick={openLinkPanel}
        />
        <ToolButton
          icon={Unlink}
          label="リンク解除"
          disabled={!editor.isActive('link')}
          onClick={() => editor.chain().focus().unsetLink().run()}
        />
        <ToolButton
          icon={ImageIcon}
          label={uploading ? 'アップロード中…' : '画像をアップロード'}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        />
        <ToolButton
          icon={Link2}
          label="画像をURLで挿入"
          active={panel === 'imageUrl'}
          onClick={openImageUrlPanel}
        />

        <Divider />

        {/* 履歴 */}
        <ToolButton
          icon={Undo2}
          label="元に戻す"
          shortcut="Ctrl+Z"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolButton
          icon={Redo2}
          label="やり直し"
          shortcut="Ctrl+Shift+Z"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>

      {/* ===== リンク入力パネル (window.prompt の置き換え) ===== */}
      {panel === 'link' && (
        <EditorPopover title="リンク先の URL" onClose={() => setPanel(null)}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              autoFocus
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                }
              }}
              placeholder="https://example.com"
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
            />
            <PanelButton onClick={applyLink}>適用</PanelButton>
            <PanelButton
              variant="ghost"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setPanel(null);
              }}
            >
              解除
            </PanelButton>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            空欄のまま「適用」でもリンクを解除できます。Enter キーでも適用されます。
          </p>
        </EditorPopover>
      )}

      {/* ===== 画像 URL 入力パネル ===== */}
      {panel === 'imageUrl' && (
        <EditorPopover title="画像の URL" onClose={() => setPanel(null)}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              autoFocus
              value={imageUrlDraft}
              onChange={(e) => setImageUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyImageUrl();
                }
              }}
              placeholder="https://example.com/photo.jpg"
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
            />
            <PanelButton onClick={applyImageUrl}>挿入</PanelButton>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            外部サイトの画像を貼りたいときに使います。自分の画像は
            ツールバーの画像ボタン・ドラッグ&amp;ドロップ・貼り付けでアップロードできます。
          </p>
        </EditorPopover>
      )}

      {/* ===== 画像選択時のサイズ・配置バー =====
          画像をクリックすると出る。編集者が本文を書きながら
          「この写真は半分の幅で中央」みたいな調整を即できるようにする。 */}
      {imageSelected && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-amber-50/70 px-3 py-2">
          <span className="text-[11px] font-semibold text-slate-600">選択中の画像</span>

          <span className="ml-1 text-[11px] text-slate-500">幅</span>
          {IMAGE_WIDTH_PRESETS.map((w) => (
            <ChipButton
              key={w}
              active={editor.getAttributes('image').width === w}
              onClick={() => editor.chain().focus().updateAttributes('image', { width: w }).run()}
            >
              {w}%
            </ChipButton>
          ))}
          <ChipButton
            active={editor.getAttributes('image').width == null}
            onClick={() => editor.chain().focus().updateAttributes('image', { width: null }).run()}
          >
            自動
          </ChipButton>

          <span className="ml-2 text-[11px] text-slate-500">配置</span>
          {(['left', 'center', 'right'] as ImageAlign[]).map((a) => (
            <ChipButton
              key={a}
              active={editor.getAttributes('image').align === a}
              onClick={() => editor.chain().focus().updateAttributes('image', { align: a }).run()}
            >
              {IMAGE_ALIGN_LABELS[a]}
            </ChipButton>
          ))}

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteSelection().run()}
            className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-100"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            画像を削除
          </button>
        </div>
      )}

      {/* ===== 本文編集エリア ===== */}
      <div className="relative">
        <EditorContent editor={editor} />

        {/* ドラッグ中のオーバーレイ。どこに落とせば良いか分かるように。 */}
        {dragging && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand-50/80">
            <p className="rounded-md border-2 border-dashed border-brand-400 bg-white px-4 py-3 text-sm font-semibold text-brand-700">
              ここにドロップして画像を挿入
            </p>
          </div>
        )}

        {/* アップロード中の目隠し。二重送信と誤操作を防ぐ。 */}
        {uploading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70">
            <p className="rounded-md bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-white">
              画像をアップロード中…
            </p>
          </div>
        )}
      </div>

      {/* 画像ファイル入力 (非表示)。複数選択して一括挿入もできる。 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptTypes}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) void uploadFiles(files);
        }}
      />

      {/* ===== ステータスバー ===== */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
        <span>
          画像はドラッグ&amp;ドロップ / 貼り付け (Ctrl+V) でも挿入できます・1枚
          {formatBytes(MAX_CONTENT_BODY_IMAGE_BYTES)} まで
        </span>
        <span className="tabular-nums" aria-live="polite">
          {characters.toLocaleString()} 文字 / {words.toLocaleString()} 語
        </span>
      </div>
    </div>
  );
}

/* ===== ツールバーボタン ===== */
function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  /** ツールチップに併記するキーボードショートカット (任意) */
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // onMouseDown で preventDefault し、エディタの選択が外れないようにする
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded transition ${
        active
          ? 'bg-brand-100 text-brand-700'
          : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />;
}

/** インラインパネル内の小さなボタン */
function PanelButton({
  children,
  onClick,
  variant = 'solid',
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'solid' | 'ghost';
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        variant === 'solid'
          ? 'rounded bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700'
          : 'rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200'
      }
    >
      {children}
    </button>
  );
}

/** 画像バーの選択チップ */
function ChipButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded border px-2 py-0.5 text-[11px] transition ${
        active
          ? 'border-brand-400 bg-brand-100 font-semibold text-brand-700'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}
