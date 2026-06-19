/**
 * POST /api/title/suggest
 * コンテキストヒント＋過去タイトル履歴から Claude でタイトル候補を生成する。
 * Body: { context?: string, count?: number }
 * Response: { titles: string[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
// Client is initialized inside POST only when ANTHROPIC_API_KEY is available
import { PrismaClient } from '@prisma/client';

let _prisma: PrismaClient | null = null;
function getClient() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRESET_TITLES = [
  '打ち合わせのご案内',
  '面談のご案内',
  'ご挨拶・情報交換',
  'オンライン商談',
  '採用面接のご案内',
  'ご提案・デモのご案内',
  'プロジェクト定例MTG',
  'キックオフミーティング',
  'フォローアップ面談',
  '業務委託打ち合わせ',
];

export async function POST(req: NextRequest) {
  try {
    const { context = '', count = 5 } = (await req.json()) as { context?: string; count?: number };

    if (!process.env.ANTHROPIC_API_KEY) {
      const titles = PRESET_TITLES.slice(0, count);
      return NextResponse.json({ titles });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // 直近50件の使用済みタイトルを学習データとして渡す
    let history: string[] = [];
    try {
      const rows = await getClient().titleHistory.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { title: true, context: true },
      });
      history = rows.map((r: { title: string; context: string | null }) => (r.context ? `[${r.context}] ${r.title}` : r.title));
    } catch {
      // DB未接続でも動く（degrade-safe）
    }

    const historyText = history.length > 0
      ? `\n\n【過去に使われたタイトル（学習データ）】\n${history.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : '';

    const contextHint = context.trim()
      ? `\n\n【コンテキストヒント】「${context.trim()}」`
      : '';

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `日本語のビジネス日程調整リンクのタイトルを${count}個提案してください。

条件：
- 簡潔（15文字以内推奨）
- 日本語ビジネス敬語
- 「〇〇さんとの打ち合わせ」「ご挨拶」「採用面接」など具体的な場面をイメージ
- Eightや名刺交換などのきっかけを活かす場合はそれを入れる
- 過去のタイトルのパターンを参考に、それより良いものを提案する${contextHint}${historyText}

提案は箇条書きで、タイトルのみ（説明不要）：`,
        },
      ],
    });

    const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
    const titles = text
      .split('\n')
      .map((l: string) => l.replace(/^[\d\-\*・•]+\.?\s*/, '').trim())
      .filter((l: string) => l.length > 0 && l.length <= 40)
      .slice(0, count);

    return NextResponse.json({ titles });
  } catch (err) {
    console.error('title/suggest error', err);
    return NextResponse.json({ titles: [] }, { status: 500 });
  }
}
