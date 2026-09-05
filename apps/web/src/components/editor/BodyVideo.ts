/**
 * TipTap 用の `<video>` ブロックノード。
 *
 * 本文に短いクリップを差し込むための最小構成。
 * TipTap には公式の video 拡張が無いので自作する。
 *
 * ## 出力する HTML を sanitizeContentBody の許可リストに合わせている
 *
 * 保存時に admin API が sanitizeContentBody() を通すため、
 * ここで許可外の属性を出しても消えるだけで意味がない。
 * lib/sanitize-html.ts の video 許可属性と対応させること。
 *
 *   controls    … 無いと再生も停止もできない矩形になる (必須)
 *   preload     … "metadata" 固定。記事に複数貼られたとき全部を
 *                 先読みすると通信量が跳ね上がるため、尺とポスターだけ読む
 *   playsinline … iOS Safari が勝手に全画面へ遷移するのを防ぐ
 *   poster      … 再生前のサムネイル。無いと真っ黒な矩形が並ぶ
 *
 * autoplay は意図的に出力しない。記事を開いた瞬間に音が鳴る事故を防ぐため
 * (サニタイザ側でも autoplay は許可していない)。
 *
 * ## 幅・配置を画像と同じ方式で持つ
 *
 * StyledImage と同じく、独自属性ではなく `style` に畳んで保存する。
 * sanitizeContentBody が video に許可する属性は限られており、
 * `data-align` のような属性は保存時に消えてしまうため。
 * これにより「画像と同じ操作感で動画も寄せたり縮めたりできる」状態になる。
 */
import { Node, mergeAttributes } from '@tiptap/core';
import {
  buildImageStyle,
  parseImageAlign,
  parseImageWidth,
  type ImageAlign,
} from '@/lib/editor-image-style';

export interface BodyVideoAttributes {
  src: string;
  poster?: string | null;
  title?: string | null;
  width?: number | null;
  align?: ImageAlign | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bodyVideo: {
      /** 本文に動画を挿入する。 */
      setBodyVideo: (attrs: BodyVideoAttributes) => ReturnType;
    };
  }
}

export const BodyVideo = Node.create({
  name: 'bodyVideo',

  // 段落の中ではなくブロックとして置く (画像と同じ扱い)。
  group: 'block',
  // 子を持たない単独ノード。source 要素は使わない。
  atom: true,
  draggable: true,
  // 選択したときに枠が出るように (幅・配置バーの表示条件になる)。
  selectable: true,

  addOptions() {
    return {
      HTMLAttributes: {} as Record<string, unknown>,
    };
  },

  addAttributes() {
    return {
      src: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('src'),
        renderHTML: (attrs) => (attrs.src ? { src: attrs.src as string } : {}),
      },
      poster: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('poster'),
        renderHTML: (attrs) => (attrs.poster ? { poster: attrs.poster as string } : {}),
      },
      title: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('title'),
        renderHTML: (attrs) => (attrs.title ? { title: attrs.title as string } : {}),
      },

      // 幅・配置は style に畳むので、ここでは属性を出さない (StyledImage と同じ)。
      width: {
        default: null as number | null,
        parseHTML: (element) => parseImageWidth(element.getAttribute('style')),
        renderHTML: () => ({}),
      },
      align: {
        default: null as ImageAlign | null,
        parseHTML: (element) => parseImageAlign(element.getAttribute('style')),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    // 既存記事を編集で開いたときに <video> を復元できるようにする。
    return [{ tag: 'video[src]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const width = node.attrs.width as number | null;
    const align = node.attrs.align as ImageAlign | null;
    const style = buildImageStyle(width, align);

    return [
      'video',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          controls: 'true',
          // 記事に複数貼られたときに全部を先読みしないよう metadata に固定。
          preload: 'metadata',
          // iOS Safari で勝手に全画面へ遷移させない。
          playsinline: 'true',
        },
        style ? { style } : {},
      ),
    ];
  },

  addCommands() {
    return {
      setBodyVideo:
        (attrs: BodyVideoAttributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
