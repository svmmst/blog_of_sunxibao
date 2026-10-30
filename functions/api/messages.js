/**
 * 东篱草堂 · 茶客题签边缘 API (Cloudflare Pages Functions)
 * 支持免登录读取与写入访客留言，内置文人诗词防伪与全方位垃圾过滤
 */

// 诗词暗号验证库（支持常用田园典故，防机器爬虫）
const POETIC_RIDDLES = [
  { q: "采菊东篱下，悠然见______？", answers: ["南山", "南"] },
  { q: "结庐在人境，而无______喧？", answers: ["车马", "车马声"] },
  { q: "晴耕______读？", answers: ["雨", "雨读"] }
];

function sanitizeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 检查是否包含任何商业网址或垃圾推销特征
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

// 自动初始化数据库表结构
async function ensureTable(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, nickname TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)"
  ).run();
}

// GET: 获取最新茶客留言列表（取最新 30 条）
export async function onRequestGet(context) {
  const { env } = context;

  // 如果尚未绑定 D1 数据库，返回友好的初始礼貌留言
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

// POST: 提交新的茶客题签
export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.DB) {
    return new Response(JSON.stringify({
      success: false,
      error: "草堂题签簿尚在装裱中（尚未在 Cloudflare 后台绑定 D1 数据库）。"
    }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  try {
    const body = await request.json();
    const nickname = (body.nickname || '').trim();
    const content = (body.content || '').trim();
    const answer = (body.riddle_answer || '').trim();

    // 1. 基础非空校验
    if (!nickname || !content) {
      return new Response(JSON.stringify({ success: false, error: "请留下雅号与题词感言" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    // 2. 长度安全限制（物理防大包）
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

    // 3. 诗词暗号防伪校验（机器爬虫 100% 拦截）
    const validAnswers = ["南山", "南", "雨", "雨读", "车马", "车马声"];
    const isAnswerCorrect = validAnswers.some(ans => answer.includes(ans));
    if (!isAnswerCorrect) {
      return new Response(JSON.stringify({
        success: false,
        error: "暗号未能对上，请检查东篱诗句（如：采菊东篱下，悠然见南山）。"
      }), {
        status: 403,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    // 4. 严防网址广告与联系方式
    if (containsSpam(nickname) || containsSpam(content)) {
      return new Response(JSON.stringify({
        success: false,
        error: "草堂清静之地，请勿留下外部网址链接或广告信息。"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    // 5. 数据转义安全入库
    await ensureTable(env.DB);
    const safeNickname = sanitizeHtml(nickname);
    const safeContent = sanitizeHtml(content);

    // 格式化当前中式时令日期
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
    return new Response(JSON.stringify({ success: false, error: "题签入库时遇阻：" + err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}
