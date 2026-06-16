/**
 * 管理ダッシュボード（admin）サービス層のテスト。
 *  - Basic 認証パーサ／判定
 *  - 一覧／カードの整形
 */
import { describe, it, expect } from 'vitest';
import {
  buildStats,
  buildTimeseries,
  checkAdminAuth,
  formatLinkRows,
  formatRelayRows,
  parseBasicAuth,
} from '../admin.js';

describe('parseBasicAuth', () => {
  it('正常な Basic ヘッダを user/pass に分解する', () => {
    const b64 = Buffer.from('alice:wonderland').toString('base64');
    expect(parseBasicAuth(`Basic ${b64}`)).toEqual({ user: 'alice', pass: 'wonderland' });
  });

  it('パスワードに : を含んでも先頭の : で分割する', () => {
    const b64 = Buffer.from('alice:s3:cret').toString('base64');
    expect(parseBasicAuth(`Basic ${b64}`)).toEqual({ user: 'alice', pass: 's3:cret' });
  });

  it('Bearer など別スキームは null', () => {
    expect(parseBasicAuth('Bearer xxx')).toBeNull();
  });

  it('null/空文字は null', () => {
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth('')).toBeNull();
  });

  it(': を含まないペイロードは null', () => {
    const b64 = Buffer.from('justname').toString('base64');
    expect(parseBasicAuth(`Basic ${b64}`)).toBeNull();
  });
});

describe('checkAdminAuth', () => {
  it('NODE_ENV=test は常に ok（テスト中の配線不要）', () => {
    expect(checkAdminAuth(null, { nodeEnv: 'test' })).toBe('ok');
    expect(checkAdminAuth('Basic xxx', { nodeEnv: 'test' })).toBe('ok');
  });

  it('ADMIN_USER / ADMIN_PASS 未設定は unconfigured（fail-closed）', () => {
    expect(checkAdminAuth(null, { nodeEnv: 'production' })).toBe('unconfigured');
    expect(checkAdminAuth(null, { nodeEnv: 'production', adminUser: 'a' })).toBe('unconfigured');
    expect(checkAdminAuth(null, { nodeEnv: 'production', adminPass: 'b' })).toBe('unconfigured');
  });

  it('ヘッダ無しは unauthorized', () => {
    expect(
      checkAdminAuth(null, { nodeEnv: 'production', adminUser: 'a', adminPass: 'b' }),
    ).toBe('unauthorized');
  });

  it('user/pass 不一致は unauthorized', () => {
    const b64 = Buffer.from('a:wrong').toString('base64');
    expect(
      checkAdminAuth(`Basic ${b64}`, { nodeEnv: 'production', adminUser: 'a', adminPass: 'b' }),
    ).toBe('unauthorized');
  });

  it('user/pass 一致は ok', () => {
    const b64 = Buffer.from('a:b').toString('base64');
    expect(
      checkAdminAuth(`Basic ${b64}`, { nodeEnv: 'production', adminUser: 'a', adminPass: 'b' }),
    ).toBe('ok');
  });
});

describe('formatLinkRows', () => {
  it('settings.title をタイトル、Map から確定件数を補完する', () => {
    const pages = [
      {
        id: 'p1',
        slug: 'biz-30',
        organizerId: 'takagi',
        type: 'T1',
        isActive: true,
        createdAt: new Date('2026-06-15T03:00:00Z'),
        settings: { title: '30分商談' },
      },
      {
        id: 'p2',
        slug: 'no-title',
        organizerId: 'takagi',
        type: 'T2',
        isActive: false,
        createdAt: 1750000000000,
        settings: {},
      },
    ];
    const map = new Map([['p1', 3]]);
    const rows = formatLinkRows(pages, map);
    expect(rows).toEqual([
      {
        slug: 'biz-30',
        title: '30分商談',
        type: 'T1',
        organizerId: 'takagi',
        isActive: true,
        createdAt: '2026-06-15T03:00:00.000Z',
        confirmationCount: 3,
      },
      {
        slug: 'no-title',
        title: 'no-title',
        type: 'T2',
        organizerId: 'takagi',
        isActive: false,
        createdAt: new Date(1750000000000).toISOString(),
        confirmationCount: 0,
      },
    ]);
  });
});

describe('formatRelayRows', () => {
  it('stages 件数を数え、status=open を isActive=true として返す', () => {
    const links = [
      {
        slug: 'relay-aaa11111',
        title: 'A→B→C',
        durationMinutes: 30,
        stages: [{ order: 1 }, { order: 2 }, { order: 3 }],
        status: 'open',
        createdAt: new Date('2026-06-15T00:00:00Z'),
      },
      {
        slug: 'relay-bbb22222',
        title: '閉じたやつ',
        durationMinutes: 45,
        stages: null,
        status: 'closed',
        createdAt: new Date('2026-06-14T00:00:00Z'),
      },
    ];
    const holds = new Map([['relay-aaa11111', 5]]);
    const rows = formatRelayRows(links, holds);
    expect(rows[0]).toMatchObject({
      slug: 'relay-aaa11111',
      stageCount: 3,
      isActive: true,
      holdCount: 5,
    });
    expect(rows[1]).toMatchObject({
      slug: 'relay-bbb22222',
      stageCount: 0,
      isActive: false,
      holdCount: 0,
    });
  });
});

describe('buildStats', () => {
  it('総数・アクティブ・累計・直近24時間を集計する', () => {
    const stats = buildStats({
      linkPages: [{ isActive: true }, { isActive: true }, { isActive: false }],
      linkConfirmationsTotal: 42,
      relayLinks: [{ status: 'open' }, { status: 'closed' }],
      relayHoldsTotal: 7,
      confirmationsLast24h: 3,
    });
    expect(stats).toEqual({
      link: { total: 3, active: 2, confirmations: 42 },
      relay: { total: 2, active: 1, holds: 7 },
      confirmationsLast24h: 3,
    });
  });
});

describe('buildTimeseries', () => {
  // 固定の「今」: 2026-06-15T12:00:00Z（UTC基準で today=2026-06-15）
  const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;

  it('欠落日は count=0 で埋め、長さ=days・date 昇順を保つ', () => {
    // 確定が「2026-06-15」「2026-06-13」の2日のみ → 残り日付は0埋め
    const result = buildTimeseries({
      confirmations: [
        { confirmedAt: NOW }, // 06-15
        { confirmedAt: NOW - 2 * DAY }, // 06-13
      ],
      holds: [],
      days: 7,
      nowMs: NOW,
    });
    expect(result.confirmations).toHaveLength(7);
    expect(result.holds).toHaveLength(7);
    // 昇順
    for (let i = 1; i < result.confirmations.length; i++) {
      expect(
        result.confirmations[i]!.date >= result.confirmations[i - 1]!.date,
      ).toBe(true);
    }
    // 末尾は今日
    expect(result.confirmations.at(-1)!.date).toBe('2026-06-15');
    // 0埋めされ全合計=2
    const sum = result.confirmations.reduce((a, p) => a + p.count, 0);
    expect(sum).toBe(2);
    // holds は全て0
    expect(result.holds.every((p) => p.count === 0)).toBe(true);
    // days/from/to が返る
    expect(result.days).toBe(7);
    expect(typeof result.from).toBe('string');
    expect(typeof result.to).toBe('string');
  });

  it('期間外（過去すぎ・未来）はフィルタで除外する', () => {
    const result = buildTimeseries({
      confirmations: [
        { confirmedAt: NOW - 100 * DAY }, // 期間外（過去）
        { confirmedAt: NOW + 5 * DAY }, // 期間外（未来）
        { confirmedAt: NOW - 3 * DAY }, // 期間内
      ],
      holds: [],
      days: 7,
      nowMs: NOW,
    });
    const sum = result.confirmations.reduce((a, p) => a + p.count, 0);
    expect(sum).toBe(1);
  });

  it('空入力でも長さ=days・全 count=0 を返す', () => {
    const result = buildTimeseries({
      confirmations: [],
      holds: [],
      days: 30,
      nowMs: NOW,
    });
    expect(result.confirmations).toHaveLength(30);
    expect(result.holds).toHaveLength(30);
    expect(result.confirmations.every((p) => p.count === 0)).toBe(true);
    expect(result.holds.every((p) => p.count === 0)).toBe(true);
  });

  it('days=1 は今日1日分のみ集計する', () => {
    const result = buildTimeseries({
      confirmations: [
        { confirmedAt: NOW }, // 今日
        { confirmedAt: NOW - 1 * DAY }, // 昨日（期間外）
      ],
      holds: [{ createdAt: NOW }],
      days: 1,
      nowMs: NOW,
    });
    expect(result.confirmations).toHaveLength(1);
    expect(result.confirmations[0]!.count).toBe(1);
    expect(result.holds[0]!.count).toBe(1);
    expect(result.confirmations[0]!.date).toBe('2026-06-15');
  });

  it('日付ソート：同日複数件はその日の count としてまとまる', () => {
    const result = buildTimeseries({
      confirmations: [
        { confirmedAt: NOW - 1 * DAY + 1000 },
        { confirmedAt: NOW - 1 * DAY + 2000 },
        { confirmedAt: NOW - 1 * DAY + 3000 },
        { confirmedAt: NOW },
      ],
      holds: [{ createdAt: NOW }, { createdAt: NOW }],
      days: 3,
      nowMs: NOW,
    });
    expect(result.confirmations).toHaveLength(3);
    // 末尾(今日)=1、その1つ前(昨日)=3
    expect(result.confirmations.at(-1)!.count).toBe(1);
    expect(result.confirmations.at(-2)!.count).toBe(3);
    expect(result.holds.at(-1)!.count).toBe(2);
  });

  it('上限/下限：days=0以下は1にクランプ、Date 入力も受け付ける', () => {
    const result = buildTimeseries({
      confirmations: [{ confirmedAt: new Date(NOW) }],
      holds: [{ createdAt: new Date(NOW) }],
      days: 0,
      nowMs: NOW,
    });
    expect(result.days).toBe(1);
    expect(result.confirmations).toHaveLength(1);
    expect(result.confirmations[0]!.count).toBe(1);
    expect(result.holds[0]!.count).toBe(1);
  });
});
