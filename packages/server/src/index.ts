// human-1 server(Cloudflare Workers + Durable Object)。
// ルーティングは pathname 比較(Claude Code は POST /v1/messages?beta=true とクエリ付きで来る)。
// /v1/responses(codex)・/v1/messages(Claude Code)・/ws・/api/* を単一 DO(idFromName('main'))へ委譲する。
// 認証は Worker 層で行い、通過したものだけを DO へ渡す。静的アセットは run_worker_first の対象外なので
// Worker を経由せずに配信され、未知パスは SPA として index.html にフォールバックする。
import { HumanLlmDO } from './do'
import { CORS_HEADERS, isAuthorized, json } from './http'

export { HumanLlmDO }

// Worker を先に通す経路(wrangler.jsonc の run_worker_first と一致)。
function isWorkerPath(path: string): boolean {
  return path.startsWith('/v1/') || path.startsWith('/api/') || path === '/ws'
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // API/WS 以外(保険): 静的アセットへ委譲。
    if (!isWorkerPath(path)) return env.ASSETS.fetch(request)

    // CORS プリフライトは認証前に返す。
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // 単一シークレットトークン認証(Bearer / x-api-key。?token= は /ws のみ)。
    if (!isAuthorized(request, url, env.AUTH_TOKEN, path === '/ws')) {
      return json({ error: { message: 'unauthorized' } }, 401)
    }

    // すべて単一 DO インスタンスへ委譲する。
    return env.HUMAN_LLM.getByName('main').fetch(request)
  },
} satisfies ExportedHandler<Env>
