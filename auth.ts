/**
 * Auth.js (NextAuth v5) 本体。Node ランタイム専用（PrismaAdapter を含むため）。
 * Edge で動く middleware.ts は auth.config.ts の方だけを使う。
 *
 * Adapter を渡すことで、セッションが JWT でも User / Account が DB に永続化される。
 * Google の refresh_token は Account.refresh_token に入り、
 * src/service/calendar/tenant.ts がユーザーごとのカレンダーアクセスに使う。
 */
import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { authConfig } from './auth.config';
import { getDb } from './src/service/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(getDb()),
});
