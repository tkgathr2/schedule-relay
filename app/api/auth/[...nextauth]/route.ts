/**
 * Auth.js のエンドポイント一式（/api/auth/signin, /callback/google, /session, /csrf, /signout …）。
 * PrismaAdapter を使うので Node ランタイム固定。
 */
import { handlers } from '../../../../auth';

export const runtime = 'nodejs';

export const { GET, POST } = handlers;
