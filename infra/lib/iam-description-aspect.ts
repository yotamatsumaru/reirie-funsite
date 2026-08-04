/**
 * IAM の description に ASCII 以外の文字が入っていないか synth 時に検査する Aspect
 *
 * 背景:
 *   IAM API は description に以下の文字しか許可しない。
 *     [\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF]*
 *     = タブ / LF / CR + ASCII 印字可能文字 + Latin-1 補助
 *   日本語 (U+3000 以降) を入れると CDK の synth は通るのに
 *   CloudFormation の実行時に HTTP 400 で失敗し、
 *     "1 validation error detected: Value at 'description'
 *      failed to satisfy constraint: Member must satisfy
 *      regular expression pattern: [\u0009...]"
 *   となってスタック全体がロールバックされる。
 *   (同じスタックで先に作成成功していたリソースまで削除される)
 *
 *   一方 SSM Parameter / CfnOutput の description には同じ制約が無いため、
 *   「日本語 description が動く場所と落ちる場所が混在する」という
 *   非常に気づきにくい罠になっている。
 *
 *   そこで IAM 系リソースだけを対象に synth 時点で弾く。
 *
 * 使い方 (bin/app.ts):
 *   cdk.Aspects.of(app).add(new IamDescriptionAsciiAspect());
 */
import type { IAspect } from 'aws-cdk-lib';
import { Annotations, CfnResource, Token } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

/** IAM API が description に許可する文字 */
const IAM_DESCRIPTION_ALLOWED = /^[\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF]*$/;

/** description に文字種制約がある IAM リソースタイプ */
const CHECKED_TYPES = new Set([
  'AWS::IAM::Role',
  'AWS::IAM::ManagedPolicy',
  'AWS::IAM::OIDCProvider',
  'AWS::IAM::SAMLProvider',
]);

export class IamDescriptionAsciiAspect implements IAspect {
  public visit(node: IConstruct): void {
    if (!CfnResource.isCfnResource(node)) return;
    if (!CHECKED_TYPES.has(node.cfnResourceType)) return;

    // L1 プロパティは cfnOptions 経由では取れないため、
    // L1 コンストラクト自身の description プロパティを読む。
    const description = (node as unknown as { description?: unknown }).description;
    if (typeof description !== 'string') return;
    // デプロイ時に解決されるトークンは検査できない (そもそも稀)
    if (Token.isUnresolved(description)) return;
    if (IAM_DESCRIPTION_ALLOWED.test(description)) return;

    const bad = [...description]
      .filter((ch) => !IAM_DESCRIPTION_ALLOWED.test(ch))
      .filter((ch, i, arr) => arr.indexOf(ch) === i)
      .map((ch) => `'${ch}' (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`)
      .join(', ');

    Annotations.of(node).addError(
      `${node.cfnResourceType} の description に IAM が許可しない文字が含まれています: ${bad}\n` +
        `  description: ${description}\n` +
        '  IAM は [\\u0009\\u000A\\u000D\\u0020-\\u007E\\u00A1-\\u00FF] のみ許可します (日本語は不可)。\n' +
        '  ASCII で書き直してください。日本語の説明が必要ならコード上のコメントに書いてください。',
    );
  }
}
