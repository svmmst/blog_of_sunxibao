#!/usr/bin/env node

/**
 * 东篱草堂 · 静态文存编纂引擎
 * 作用：读取 posts/*.md 中的文章，自动编译组装进 template.html 生成 index.html
 * 特点：零第三方依赖，纯 Node.js 原生 API，秒级极速构建
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = __dirname;
const POSTS_DIR = path.join(ROOT_DIR, 'posts');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'template.html');
const OUTPUT_FILE = path.join(ROOT_DIR, 'index.html');

function parseMarkdownFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    console.warn(`[跳过] 文件未包含标准 Frontmatter 标头: ${filePath}`);
    return null;
  }

  const frontmatterRaw = match[1];
  const bodyRaw = match[2].trim();

  const meta = {};
  frontmatterRaw.split(/\r?\n/).forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      meta[key] = val;
    }
  });

  // 按空行切分段落
  const paragraphs = bodyRaw
    .split(/\r?\n\s*\r?\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return { meta, paragraphs, bodyRaw, filename: path.basename(filePath) };
}

function build() {
  console.log('🍵 正在汇纂【东篱草堂】文章存卷……');

  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }

  if (!fs.existsSync(TEMPLATE_FILE)) {
    console.error('❌ 未找到 template.html 模板文件');
    process.exit(1);
  }

  const files = fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(POSTS_DIR, f));

  const posts = files
    .map(parseMarkdownFile)
    .filter(Boolean);

  // 排序：优先按 order 升序，次按文件名排序
  posts.sort((a, b) => {
    const orderA = a.meta.order !== undefined ? parseInt(a.meta.order, 10) : 99;
    const orderB = b.meta.order !== undefined ? parseInt(b.meta.order, 10) : 99;
    return orderA - orderB;
  });

  console.log(`📖 共读取 ${posts.length} 篇草堂随笔:`);
  posts.forEach((p, idx) => {
    console.log(`   ${idx + 1}. [${p.meta.category || '随笔'}] ${p.meta.title} (${p.meta.date || '无日期'})`);
  });

  // 1. 生成文章卡片 HTML
  const cardsHtml = posts.map((post, idx) => {
    const m = post.meta;
    const termTag = m.solar_term || '时令';
    const monthTag = m.month_tag || '岁次甲辰';
    const category = m.category || '闲读偶得';
    const wordCount = m.word_count || post.bodyRaw.replace(/\s+/g, '').length;
    const readTime = m.read_time || Math.max(3, Math.ceil(wordCount / 280));
    const excerpt = m.excerpt || (post.paragraphs[0] ? post.paragraphs[0].slice(0, 110) + '……' : '');

    return `      <!-- 文章卡片 ${idx + 1} -->
      <article class="essay-card" onclick="openArticle(${idx})">
        <div class="essay-meta-row">
          <span class="essay-term-tag">${termTag}</span>
          <span>${monthTag}</span>
          <span>·</span>
          <span>${category}</span>
        </div>
        <h3 class="essay-title">${m.title}</h3>
        <p class="essay-excerpt">
          ${excerpt}
        </p>
        <div class="essay-footer">
          <span>阅读全文约 ${readTime} 分钟 · 字数 ${wordCount}</span>
          <span class="read-action-link">展卷细读 →</span>
        </div>
      </article>`;
  }).join('\n\n');

  // 2. 生成弹窗数据 JSON
  const essaysData = posts.map(post => ({
    title: post.meta.title,
    date: post.meta.date,
    category: `${post.meta.category} · 约 ${post.meta.word_count || post.bodyRaw.replace(/\s+/g, '').length} 字`,
    content: post.paragraphs
  }));

  // 3. 读取模板并替换占位符
  let template = fs.readFileSync(TEMPLATE_FILE, 'utf-8');
  template = template.replace('{{ESSAY_COUNT}}', posts.length);
  template = template.replace('{{ESSAYS_CARDS}}', cardsHtml);
  template = template.replace('{{ESSAYS_DATA}}', JSON.stringify(essaysData, null, 2));

  // 4. 写出 index.html
  fs.writeFileSync(OUTPUT_FILE, template, 'utf-8');

  console.log(`✨ 编纂完成！已生成 ${OUTPUT_FILE}`);
}

build();
