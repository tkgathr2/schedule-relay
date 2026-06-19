/**
 * GET /api/docs — Swagger UI を返す（依存追加なしで CDN ロード）。
 * 軽量のため `<script>` を unpkg から読み込む。
 *
 * /docs（Reactページ）と二系統で用意：
 *  - /docs       … Next.js のページ（SSRレイアウト適用）
 *  - /api/docs   … 単一HTML（ヘッダ最小・iframe埋め込みや旧ブラウザ向け）
 *
 * middleware の admin gate 対象外。
 */
import { NextResponse } from 'next/server';

const HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>スケ調くん API ドキュメント</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.addEventListener('load', function () {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi',
        dom_id: '#swagger-ui',
        deepLinking: true,
        layout: 'BaseLayout',
        tryItOutEnabled: true
      });
    });
  </script>
</body>
</html>
`;

export function GET(): NextResponse {
  return new NextResponse(HTML, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
