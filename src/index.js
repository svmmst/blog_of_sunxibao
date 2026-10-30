/**
 * 东篱草堂 · 边缘计算与静态资源服务引擎 (Cloudflare Worker with Assets)
 * 职责：
 * 1. 响应 /api/messages 的茶客题签与留言持久化（对接 Cloudflare D1 数据库）
 * 2. 响应 /api/riddle 随机抽取文人诗词暗号
 * 3. 其它所有访问请求直接由 env.ASSETS 极速分发 ./dist 静态网页
 */

// 动态文人田园诗韵题库（随机抽取，答案严格按题校验）
const POETIC_RIDDLES = [
  { id: 0, q: "采菊东篱下，悠然见______？", answers: ["南山", "南"] },
  { id: 1, q: "结庐在人境，而无______喧？", answers: ["车马", "车马声"] },
  { id: 2, q: "晴耕______读，归去来兮？", answers: ["雨", "雨读"] },
  { id: 3, q: "晨兴理荒秽，带月______归？", answers: ["荷锄", "锄"] },
  { id: 4, q: "独坐幽篁里，弹琴复______？", answers: ["长啸", "啸"] },
  { id: 5, q: "竹喧归浣女，莲动下______？", answers: ["渔舟", "舟"] },
  { id: 6, q: "绿树村边合，青山郭______？", answers: ["外斜", "斜"] },
  { id: 7, q: "开轩面场圃，把酒话______？", answers: ["桑麻", "麻"] },
  { id: 8, q: "明月松间照，清泉______上流？", answers: ["石", "石上"] },
  { id: 9, q: "莫笑农家腊酒浑，丰年留客足______？", answers: ["鸡豚", "豚"] }
];

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
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, nickname TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)"
  ).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. 获取随机诗词暗号题目
    if (url.pathname === '/api/riddle') {
      const randomIndex = Math.floor(Math.random() * POETIC_RIDDLES.length);
      const chosen = POETIC_RIDDLES[randomIndex];
      return new Response(JSON.stringify({
        success: true,
        riddle_id: chosen.id,
        question: chosen.q
      }), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" }
      });
    }

    // 2. 茶客题签接口
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
            headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" }
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

          // 蜜罐检查：如果隐藏陷阱输入框被填入任何内容，判定为自动化机器人爬虫，直接静默拦截
          if (body.honeypot_field && String(body.honeypot_field).trim() !== '') {
            return new Response(JSON.stringify({ success: false, error: "系统检测到异常操作。" }), {
              status: 400,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }

          const nickname = (body.nickname || '').trim();
          const content = (body.content || '').trim();
          const answer = (body.riddle_answer || '').trim();
          const riddleId = parseInt(body.riddle_id, 10);

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

          // 动态诗词暗号校验（严格比对对应题目 ID）
          const riddleObj = POETIC_RIDDLES.find(r => r.id === riddleId);
          if (!riddleObj) {
            return new Response(JSON.stringify({
              success: false,
              error: "暗号题卷已轮转，请点击题面旁边的【换一题】重新核验。"
            }), {
              status: 403,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }

          const isAnswerCorrect = riddleObj.answers.some(ans => answer.includes(ans));
          if (!isAnswerCorrect) {
            return new Response(JSON.stringify({
              success: false,
              error: "诗词暗号未能对上。若一时未忆起该句，可点击题目旁的【换一题】。"
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

    // 3. 其它所有非 API 网页请求，直接极速分发静态网页
    return env.ASSETS.fetch(request);
  }
};
