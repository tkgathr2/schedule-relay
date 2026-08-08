'use client';
/**
 * ログイン中ユーザーの id を「主催者ID」として返すフック。
 *
 * マルチテナント化前は各画面に `const ORGANIZER_ID = 'takagi'` がハードコードされており、
 * 誰がアクセスしても社長のデータを読んでいた。ここを session.user.id（= DB の User.id）に
 * 置き換えることで、ログインした本人のリンク／確定予定だけが見えるようになる。
 *
 * 戻り値：
 *   organizerId … 未ログイン or 取得中は null
 *   loading     … セッション取得中（この間はデータ取得を待つ）
 */
import { useSession } from 'next-auth/react';

export function useOrganizerId(): { organizerId: string | null; loading: boolean } {
  const { data: session, status } = useSession();
  return {
    organizerId: session?.user?.id ?? null,
    loading: status === 'loading',
  };
}
