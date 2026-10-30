/**
 * 东篱草堂 · 边缘计算与静态资源服务引擎 (Cloudflare Worker with Assets)
 * 职责：
 * 1. 响应 /api/messages 的茶客题签与留言持久化（对接 Cloudflare D1 数据库）
 * 2. 其它所有访问请求直接由 env.ASSETS 极速分发 ./dist 静态网页
 */

function sanitizeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function containsSpam(text) {
  const spamPatterns = [
    /https?:\/\//i,
    /www\./i,
    /\.(com|cn|net|org|xyz|top|cc|vip|icu|ru|info|app)/i,
    /t\.me\//i,
    /telegram/i,
    /微信|加v|vx|威信|扣扣|qq/i,
    /代开|发票|包养|兼职|菠菜|博彩|老虎机|六合彩|威尼斯人/i
  ];
  return spamPatterns.some(pattern => pattern.test(text));
}

async function ensureTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 拦截茶客留言 API 路由
    if (url.pathname === '/api/messages') {
      if (!env.DB) {
        return new Response(JSON.stringify({
          success: true,
          data: [
            {
              id: 1,
              nickname: "东篱居士",
              content: "瓦壶初沸，山泉清甘。候四海同道云游至此，落座题字。",
              created_at: "岁在甲辰 · 霜降"
            }
          ],
          notice: "D1 待绑定"
        }), {
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }

      if (request.method === 'GET') {
        try {
          await ensureTable(env.DB);
          const { results } = await env.DB.prepare(
            "SELECT id, nickname, content, created_at FROM messages ORDER BY id DESC LIMIT 30"
          ).all();
          return new Response(JSON.stringify({ success: true, data: results || [] }), {
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }
      }

      if (request.method === 'POST') {
        try {
          const body = await request.json();
          const nickname = (body.nickname || '').trim();
          const content = (body.content || '').trim();
          const answer = (body.riddle_answer || '').trim();

          if (!nickname || !content) {
            return new Response(JSON.stringify({ success: false, error: "请留下雅号与随笔题词" }), {
              status: 400,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }

          if (nickname.length > 12) {
            return new Response(JSON.stringify({ success: false, error: "雅号请在 10 字以内" }), {
              status: 400,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }

          if (content.length > 160) {
            return new Response(JSON.stringify({ success: false, error: "随笔题词请在 150 字以内" }), {
              status: 400,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }

          const validAnswers = ["南山", "南", "雨", "雨读", "车马", "车马声"];
          if (!validAnswers.some(ans => answer.includes(ans))) {
            return new Response(JSON.stringify({
              success: false,
              error: "暗号未能对上，请检查东篱诗句（如：采菊东篱下，悠然见南山）。"
            }), {
              status: 403,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }

          if (containsSpam(nickname) || containsSpam(content)) {
            return new Response(JSON.stringify({
              success: false,
              error: "草堂清静之地，请勿留下外部网址链接或广告信息。"
            }), {
              status: 400,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }

          await ensureTable(env.DB);
          const safeNickname = sanitizeHtml(nickname);
          const safeContent = sanitizeHtml(content);
          const now = new Date();
          const dateFormatted = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;

          await env.DB.prepare(
            "INSERT INTO messages (nickname, content, created_at) VALUES (?, ?, ?)"
          ).bind(safeNickname, safeContent, dateFormatted).run();

          return new Response(JSON.stringify({
            success: true,
            message: "题签已奉入草堂文存，感谢同道留墨！"
          }), {
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: err.message }), {
            status: 500,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }
      }
    }

    // 2. 所有非 API 网页请求，直接极速分发静态网页
    return env.ASSETS.fetch(request);
  }
};
