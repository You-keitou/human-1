// CORS・認証・JSON レスポンスの共通ヘルパ。

// codex は Authorization: Bearer、Claude Code は x-api-key を送る。anthropic-beta も許可する。
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })
}

// Bearer / x-api-key(API)からトークンを取り出す。
// ?token=(クエリ)は URL がログに残りシークレットが漏れるため WS ハンドシェイクに限り許容する。
export function extractToken(request: Request, url: URL, allowQueryToken: boolean): string | null {
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim()
  const apiKey = request.headers.get('x-api-key')
  if (apiKey) return apiKey.trim()
  if (allowQueryToken) return url.searchParams.get('token')
  return null
}

export function isAuthorized(
  request: Request,
  url: URL,
  token: string,
  allowQueryToken: boolean,
): boolean {
  const provided = extractToken(request, url, allowQueryToken)
  return provided !== null && provided === token
}
