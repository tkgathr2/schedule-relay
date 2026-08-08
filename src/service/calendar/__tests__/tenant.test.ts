/**
 * マルチテナントのカレンダー資格情報組み立てのテスト。
 * 「トークンが無いユーザーで誤って他人のカレンダーを見に行かない」ことと、
 * 「未連携なら null＝degrade-safe」を固定する。
 */
import { describe, it, expect } from 'vitest';
import { buildGoogleConfig } from '../tenant.js';

const ENV = { clientId: 'cid', clientSecret: 'csec' };

describe('buildGoogleConfig', () => {
  it('refresh_token とクライアント資格情報が揃えば設定を返す', () => {
    const cfg = buildGoogleConfig({ refresh_token: 'rt-user-a' }, ENV);
    expect(cfg).not.toBeNull();
    expect(cfg?.refreshToken).toBe('rt-user-a');
    expect(cfg?.clientId).toBe('cid');
    // 既定は 'auto'＝そのユーザーの全カレンダーを自動対象にする
    expect(cfg?.calendarIds).toEqual(['auto']);
  });

  it('Account が無い／refresh_token が無いユーザーは null（連携オフ）', () => {
    expect(buildGoogleConfig(null, ENV)).toBeNull();
    expect(buildGoogleConfig(undefined, ENV)).toBeNull();
    expect(buildGoogleConfig({ refresh_token: null }, ENV)).toBeNull();
  });

  it('アプリの OAuth クライアント設定が欠けていれば null', () => {
    expect(buildGoogleConfig({ refresh_token: 'rt' }, { clientSecret: 'csec' })).toBeNull();
    expect(buildGoogleConfig({ refresh_token: 'rt' }, { clientId: 'cid' })).toBeNull();
  });

  it('GOOGLE_CALENDAR_IDS でカレンダーを明示指定できる', () => {
    const cfg = buildGoogleConfig(
      { refresh_token: 'rt' },
      { ...ENV, calendarIds: 'primary, work@example.com ' },
    );
    expect(cfg?.calendarIds).toEqual(['primary', 'work@example.com']);
  });

  it('空文字の GOOGLE_CALENDAR_IDS は auto にフォールバックする', () => {
    const cfg = buildGoogleConfig({ refresh_token: 'rt' }, { ...ENV, calendarIds: ' , ' });
    expect(cfg?.calendarIds).toEqual(['auto']);
  });

  it('ユーザーごとに別のトークンが選ばれる（テナント分離）', () => {
    const a = buildGoogleConfig({ refresh_token: 'rt-a' }, ENV);
    const b = buildGoogleConfig({ refresh_token: 'rt-b' }, ENV);
    expect(a?.refreshToken).not.toBe(b?.refreshToken);
  });
});
