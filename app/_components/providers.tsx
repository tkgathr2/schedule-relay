'use client';
/**
 * クライアント側のセッション供給。useSession() を使う画面（/links, /confirmed, /calendar,
 * /create, /propose）が、ログイン中ユーザーの id を organizerId として使えるようにする。
 */
import { SessionProvider } from 'next-auth/react';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
