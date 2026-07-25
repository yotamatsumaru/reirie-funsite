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
 *   - リンク挿入・解除
 *   - 画像挿入 (S3 設定時はアップロード、未設定時は URL 入力)
 *   - 元に戻す / やり直し
 *
 * 使い方:
 *   <RichTextEditor value={html} onChange={setHtml} />
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions';
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
  Undo2,
  Redo2,
  Heading2,
  Heading3,
  Pilcrow,
  type LucideIcon,
} from 'lucide-react';
import { toast } from '@/stores/ui-store';

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** 画像アップロード先 API。未指定時は /api/admin/uploads/image */
  uploadUrl?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = '本文を入力してください…',
  uploadUrl = '/api/admin/uploads/image',
}: RichTextEditorProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      Image.configure({
        inline: false,
        HTMLAttributes: { class: 'rounded-lg' },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class:
          'prose prose-slate max-w-none min-h-[320px] px-4 py-3 focus:outline-none prose-headings:font-bold prose-a:text-brand-600 prose-img:rounded-lg',
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
    if (next !== current && next !== '' ) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  const handleUploadImage = useCallback(
    async (file: File) => {
      if (!editor) return;
      setUploading(true);
      try {
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
              '画像のアップロードに失敗しました。ツールバーの画像ボタンから URL を直接入力することもできます。',
          );
        }
        editor.chain().focus().setImage({ src: json.url }).run();
        toast.success('画像を挿入しました');
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [editor, uploadUrl],
  );

  const promptImageUrl = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('画像の URL を入力してください', 'https://');
    if (url && url.trim()) {
      editor.chain().focus().setImage({ src: url.trim() }).run();
    }
  }, [editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
    const url = window.prompt('リンク先の URL を入力してください（空欄で解除）', prev || 'https://');
    if (url === null) return; // キャンセル
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url.trim() })
      .run();
  }, [editor]);

  if (!editor) {
    return (
      <div className="min-h-[380px] rounded-md border border-slate-300 bg-slate-50" aria-busy>
        <div className="border-b border-slate-200 px-3 py-2 text-xs text-slate-400">
          エディタを読み込み中…
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-300 bg-white focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-200">
      {/* ===== ツールバー ===== */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        {/* ブロック種別 */}
        <ToolButton
          icon={Pilcrow}
          label="本文"
          active={editor.isActive('paragraph') && !editor.isActive('heading')}
          onClick={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolButton
          icon={Heading2}
          label="見出し (大)"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolButton
          icon={Heading3}
          label="見出し (小)"
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />

        <Divider />

        {/* インライン装飾 */}
        <ToolButton
          icon={Bold}
          label="太字"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolButton
          icon={Italic}
          label="斜体"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolButton
          icon={UnderlineIcon}
          label="下線"
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
          active={editor.isActive('link')}
          onClick={setLink}
        />
        <ToolButton
          icon={Unlink}
          label="リンク解除"
          disabled={!editor.isActive('link')}
          onClick={() => editor.chain().focus().unsetLink().run()}
        />
        <ToolButton
          icon={ImageIcon}
          label={uploading ? 'アップロード中…' : '画像を挿入'}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        />

        <Divider />

        {/* 履歴 */}
        <ToolButton
          icon={Undo2}
          label="元に戻す"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolButton
          icon={Redo2}
          label="やり直し"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>

      {/* ===== 本文編集エリア ===== */}
      <EditorContent editor={editor} />

      {/* 画像ファイル入力 (非表示) */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleUploadImage(f);
        }}
      />

      {/* URL 直接入力 (S3 未設定でも画像を差し込めるよう補助リンク) */}
      <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-right">
        <button
          type="button"
          onClick={promptImageUrl}
          className="text-[11px] text-slate-500 hover:text-brand-600 hover:underline"
        >
          画像を URL で挿入
        </button>
      </div>
    </div>
  );
}

/* ===== ツールバーボタン ===== */
function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
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
