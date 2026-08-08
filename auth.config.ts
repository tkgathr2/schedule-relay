/**
 * Auth.js (NextAuth v5) の **Edge セーフ**な共通設定。
 *
 * なぜ auth.ts と分けるのか：
 *   middleware.ts は Edge ランタイムで動くため Prisma Client を import できない。
 *   Auth.js 公式の "split config" パターンに従い、
 *     - ここ（auth.config.ts）＝ Provider / callbacks / pages（Edge で動く純粋な設定）
 *     - auth.ts             ＝ ここに PrismaAdapter を足した Node 用の本体
 *   と分離し、middleware は本ファイルだけを使う。
 *
 * セッション戦略が "jwt" である理由：
 *   Prisma アダプタは Edge で動かないため、strategy:"database" だと middleware で
 *   セッションを検証できない（＝タスク4のゲートが成立しない）。
 *   一方 Adapter を渡してさえいれば Auth.js は戦略に関わらず User / Account を DB に
 *   永続化する（@auth/core の handleLoginOrRegister は jwt 分岐より前に実行される）ので、
 *   「middleware で検証できる」かつ「refresh_token が DB に残る」の両立ができる。
 */
import Google from 'next-auth/providers/google';
import type { NextAuthConfig } from 'next-auth';
import { isAllowedEmail } from './src/service/auth/allowlist';

/** セッション有効期間：1年（社長指示「1年間は再ログイン不要」）。 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * 要求する Google OAuth スコープ。
 *  - calendar.readonly : freebusy.query / calendarList.list / events.list（空き枠算出・候補抽出）
 *  - calendar.events   : events.insert（確定時の Google Meet 付き予定作成）
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export const authConfig = {
  // Railway など Vercel 以外のホストでは trustHost が無いと UntrustedHost で落ちる。
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          // refresh_token を確実に受け取るための必須2点。
          //   access_type=offline : refresh_token を発行させる
          //   prompt=consent      : 2回目以降のログインでも refresh_token を再発行させる
          //                         （これが無いと初回しか返らず、DB 再構築時に詰む）
          access_type: 'offline',
          prompt: 'consent',
        },
      },
      // Google は既定で email_verified を要求する。許可リストで絞るのでプロフィールは素通し。
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  callbacks: {
    /**
     * 認可ゲート：許可リストに無いメールアドレスはログインさせない。
     * false を返すと Auth.js が pages.error へ `?error=AccessDenied` 付きでリダイレクトする。
     */
    signIn({ user }) {
      return isAllowedEmail(user.email, process.env.ALLOWED_EMAILS);
    },
    /** JWT に user.id（＝ DB の User.id）を載せる。organizerId として全画面で使う。 */
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    /** セッションに user.id を露出する（クライアントの useSession から参照する）。 */
    session({ session, token }) {
      if (token.sub && session.user) session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
