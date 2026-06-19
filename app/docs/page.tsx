/**
 * /docs — Swagger UI 簡易ページ（Next.js Page）。
 * Swagger UI Bundle を unpkg からロードする軽量実装。`swagger-ui-react` は使わない
 * （依存追加を避けるため）。/api/openapi を仕様の取得元にする。
 */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API ドキュメント — スケ調くん',
  description: 'OpenAPI 3.1 仕様書（Swagger UI）',
};

export default function DocsPage() {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            body { background: #fafafa; }
            .topbar { display: none !important; }
          `,
        }}
      />
      <div id="swagger-ui" />
      <script
        src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"
        crossOrigin=""
        async
      />
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              function init() {
                if (typeof SwaggerUIBundle === 'undefined') {
                  return setTimeout(init, 50);
                }
                window.ui = SwaggerUIBundle({
                  url: '/api/openapi',
                  dom_id: '#swagger-ui',
                  deepLinking: true,
                  layout: 'BaseLayout',
                  tryItOutEnabled: true
                });
              }
              if (document.readyState === 'complete') init();
              else window.addEventListener('load', init);
            })();
          `,
        }}
      />
    </>
  );
}
