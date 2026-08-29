/**
 * TipTap の Image 拡張に「幅」と「配置」を持たせた派生ノード。
 *
 * 標準の @tiptap/extension-image は src / alt / title しか属性を持たないため、
 * 記事に画像を入れても「大きすぎる」「左に寄せたい」を編集者が調整できなかった。
 *
 * 幅・配置は独自属性ではなく `style` に畳んで保存する。理由は
 * sanitizeContentBody() が img に許可する属性が
 * src / alt / title / width / height + 全タグ共通の class / style だけなので、
 * `data-align` のような属性は保存時に消えてしまうため。
 * (詳細は lib/editor-image-style.ts のコメント参照)
 *
 * 幅・配置の変更は独自コマンドを足さず、TipTap 標準の
 * `updateAttributes('image', { width, align })` で行う。
 */
import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import {
  buildImageStyle,
  parseImageAlign,
  parseImageWidth,
  type ImageAlign,
} from '@/lib/editor-image-style';

export const StyledImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),

      /**
       * 幅 (%)。`renderHTML` では単独では何も出さず、
       * style 属性としてまとめて出力する (下の renderHTML を参照)。
       */
      width: {
        default: null as number | null,
        parseHTML: (element) => parseImageWidth(element.getAttribute('style')),
        // style にまとめるのでここでは属性を出さない
        renderHTML: () => ({}),
      },

      align: {
        default: null as ImageAlign | null,
        parseHTML: (element) => parseImageAlign(element.getAttribute('style')),
        renderHTML: () => ({}),
      },
    };
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = node.attrs.width as number | null;
    const align = node.attrs.align as ImageAlign | null;
    const style = buildImageStyle(width, align);

    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, style ? { style } : {}),
    ];
  },
});
