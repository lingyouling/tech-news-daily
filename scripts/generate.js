const RssParser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const parser = new RssParser({
  timeout: 15000,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; TechNewsBot/1.0; +https://github.com)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

// ========== 新闻源配置 ==========
const RSS_SOURCES = [
  // --- 综合科技资讯 ---
  { url: 'https://36kr.com/feed',          category: 'tech', label: '36氪' },
  { url: 'https://www.ifanr.com/feed',     category: 'tech', label: '爱范儿' },
  { url: 'https://www.sspai.com/feed',     category: 'tech', label: '少数派' },
  { url: 'https://www.landiannews.com/feed', category: 'tech', label: '蓝点网' },

  // 备用源（以下若失效可替换）:
  // { url: 'https://rsshub.app/jiqizhixin/home', category: 'ai', label: '机器之心' },
  // { url: 'https://www.pingwest.com/feed',      category: 'tech', label: '品玩' },
];

// ========== 分类关键词（用于自动归类） ==========
const CATEGORY_RULES = [
  {
    category: 'ai',
    keywords: [
      'AI', '人工智能', '大模型', 'GPT', 'ChatGPT', 'LLM', '深度学习',
      '机器学习', 'OpenAI', 'Gemini', 'Claude', 'Copilot', '神经网络',
      '自然语言', 'transformer', 'GPU', 'NVIDIA', '英伟达', '算力',
      '智能体', 'Agent', 'AIGC', '生成式', 'Foundation', '模型',
      '大语言', 'token', '训练', '推理', '开源模型', '对齐',
    ],
  },
  {
    category: 'tech',
    keywords: [
      '手机', '芯片', '苹果', '华为', '小米', '特斯拉', '汽车',
      'App', '软件', '硬件', '产品', '发布', '上线', '更新',
      '操作系统', 'Android', 'iOS', 'Windows', 'Mac',
      '云计算', 'SaaS', '数据', '安全', '开源', 'GitHub',
      '机器人', '自动驾驶', 'VR', 'AR', 'Apple', 'Vision',
    ],
  },
  {
    category: 'finance',
    keywords: [
      '融资', 'IPO', '上市', '股价', '市值', '投资', '收购',
      '美元', '亿元', 'B轮', 'A轮', 'C轮', '融资额', '估值',
      '股票', '基金', '财报', '营收', '利润', '净利', '增长',
      '经济', '独角兽', '创业', '风投', 'VC', 'PE',
    ],
  },
];

// ========== 工具函数 ==========
function getTodayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getDateCN(dateStr) {
  const d = new Date(dateStr);
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week[d.getDay()]}`;
}

function detectCategory(title, description) {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  const scores = { ai: 0, tech: 0, finance: 0 };

  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw.toLowerCase())) {
        scores[rule.category] += 1;
      }
    }
  }

  const maxScore = Math.max(scores.ai, scores.tech, scores.finance);
  if (maxScore === 0) return 'tech'; // 默认归为科技
  if (scores.ai === maxScore) return 'ai';
  if (scores.tech === maxScore) return 'tech';
  return 'finance';
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

// ========== 新闻抓取 ==========
async function fetchSource(source) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || []).map(item => ({
      title: stripHtml(item.title || ''),
      link: item.link || '',
      description: stripHtml(item.contentSnippet || item.content || item.description || ''),
      pubDate: item.pubDate || item.isoDate || '',
      sourceLabel: source.label,
      sourceUrl: source.url,
      guid: item.guid || item.link || item.title,
    }));
    console.log(`  ✓ ${source.label}: ${items.length} 条`);
    return items;
  } catch (err) {
    console.log(`  ✗ ${source.label}: 抓取失败 (${err.message.slice(0, 60)})`);
    return [];
  }
}

async function fetchAllNews() {
  console.log('\n📡 开始抓取新闻...\n');
  const promises = RSS_SOURCES.map(fetchSource);
  const results = await Promise.all(promises);
  const allItems = results.flat();

  // 去重（按 link 或 title 相似度）
  const seen = new Set();
  const deduped = [];
  for (const item of allItems) {
    const key = item.link || item.title.slice(0, 40);
    if (!seen.has(key) && item.title.length > 6) {
      seen.add(key);
      deduped.push(item);
    }
  }

  // 智能分类
  for (const item of deduped) {
    item.category = detectCategory(item.title, item.description);
  }

  console.log(`\n📊 共获取 ${deduped.length} 条去重新闻\n`);
  return deduped;
}

// ========== HTML 生成 ==========
function renderNewsItem(item) {
  const catColors = {
    ai: '#7c3aed',
    tech: '#3b82f6',
    finance: '#0d9488',
  };
  const catLabels = {
    ai: '🤖 AI',
    tech: '💻 科技',
    finance: '📈 财经',
  };
  const color = catColors[item.category] || catColors.tech;
  const label = catLabels[item.category] || catLabels.tech;
  const desc = item.description ? item.description.slice(0, 120) : '';
  const time = item.pubDate ? getDateCN(item.pubDate) : '';

  return `
    <article class="news-card" data-category="${item.category}">
      <div class="card-content">
        <div class="card-meta">
          <span class="category-tag" style="background:${color}18;color:${color}">${label}</span>
          <span class="source-tag">${item.sourceLabel}</span>
        </div>
        <h3 class="card-title">
          <a href="${item.link}" target="_blank" rel="noopener">${item.title}</a>
        </h3>
        ${desc ? `<p class="card-desc">${desc}...</p>` : ''}
        ${time ? `<time class="card-time">${time}</time>` : ''}
      </div>
    </article>
  `;
}

function renderCategoriesNav(activeCategory, counts) {
  const cats = [
    { key: 'all', label: '全部', emoji: '📋' },
    { key: 'ai', label: 'AI', emoji: '🤖' },
    { key: 'tech', label: '科技', emoji: '💻' },
    { key: 'finance', label: '财经', emoji: '📈' },
  ];

  return cats.map(c => {
    const count = c.key === 'all'
      ? Object.values(counts).reduce((a, b) => a + b, 0)
      : (counts[c.key] || 0);
    const isActive = activeCategory === c.key;
    return `
      <button class="cat-nav-btn ${isActive ? 'active' : ''}"
              data-category="${c.key}"
              onclick="filterCategory('${c.key}')">
        <span class="cat-emoji">${c.emoji}</span>
        <span>${c.label}</span>
        <span class="cat-count">${count}</span>
      </button>
    `;
  }).join('');
}

function renderFullPage({ dateStr, dateCN, news, counts, archiveHtml, prefix = '../' }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>科技新闻日报 - ${dateCN}</title>
  <link rel="stylesheet" href="${prefix}assets/style.css?v=${dateStr}">
</head>
<body>
  <div class="app-layout">
    <!-- 左侧边栏 -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <a href="${prefix}index.html" class="logo">
          <span class="logo-icon">📰</span>
          <span class="logo-text">科技日报</span>
        </a>
        <p class="logo-sub">AI · 科技 · 财经</p>
      </div>

      <nav class="sidebar-nav">
        <a href="${prefix}index.html" class="nav-item ${dateStr === getTodayStr() ? 'active' : ''}">
          <span>📅</span> 今日新闻
        </a>
        <a href="${prefix}archive.html" class="nav-item">
          <span>📁</span> 往期归档
        </a>
      </nav>

      <div class="sidebar-archive">
        <h4>最近七天</h4>
        ${archiveHtml}
      </div>

      <footer class="sidebar-footer">
        <p>每日 8:00 自动更新</p>
      </footer>
    </aside>

    <!-- 主内容区 -->
    <main class="main-content">
      <header class="page-header">
        <h1>科技新闻日报</h1>
        <p class="page-date">${dateCN}</p>
      </header>

      <!-- 搜索栏 -->
      <div class="search-bar-wrapper">
        <div class="search-bar">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            id="searchInput"
            class="search-input"
            placeholder="搜索新闻标题或关键词..."
            autocomplete="off"
          />
          <button id="searchClear" class="search-clear" style="display:none">✕</button>
        </div>
        <div id="searchResults" class="search-results" style="display:none"></div>
      </div>

      <!-- 分类导航 -->
      <div class="category-nav" id="categoryNav">
        ${renderCategoriesNav('all', counts)}
      </div>

      <!-- 统计条 -->
      <div class="stats-bar" id="statsBar">
        <span>共 <strong>${news.length}</strong> 条新闻</span>
        <span class="stats-sources">来源: ${[...new Set(news.map(n => n.sourceLabel))].join(' · ')}</span>
      </div>

      <!-- 新闻列表 -->
      <div class="news-list" id="newsList">
        ${news.map(renderNewsItem).join('\n')}
      </div>

      <!-- 搜索无结果 -->
      <div class="empty-state" id="searchEmpty" style="display:none">
        <div class="empty-icon">🔍</div>
        <h3>未找到相关新闻</h3>
        <p>试试其他关键词</p>
      </div>

      ${news.length === 0 ? `
        <div class="empty-state" id="noNewsEmpty">
          <div class="empty-icon">📭</div>
          <h3>暂无新闻</h3>
          <p>今天的新闻还在路上，请稍后再来看看</p>
        </div>
      ` : ''}
    </main>
  </div>

  <!-- 搜索浮层 -->
  <div id="searchOverlay" class="search-overlay" style="display:none"></div>

  <script>
    // ===== 分类筛选 =====
    function filterCategory(cat) {
      document.querySelectorAll('.cat-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-category="' + cat + '"]').classList.add('active');
      document.querySelectorAll('.news-card').forEach(card => {
        if (cat === 'all' || card.dataset.category === cat) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    }

    // ===== 搜索功能 =====
    (function() {
      var searchInput = document.getElementById('searchInput');
      var searchClear = document.getElementById('searchClear');
      var searchResults = document.getElementById('searchResults');
      var searchOverlay = document.getElementById('searchOverlay');
      var newsList = document.getElementById('newsList');
      var categoryNav = document.getElementById('categoryNav');
      var statsBar = document.getElementById('statsBar');
      var searchEmpty = document.getElementById('searchEmpty');
      var noNewsEmpty = document.getElementById('noNewsEmpty');

      var allArticles = [];
      var searchIndexLoaded = false;

      // 加载搜索索引
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '${prefix}assets/search-index.json', true);
      xhr.onload = function() {
        if (xhr.status === 200) {
          try {
            allArticles = JSON.parse(xhr.responseText);
            searchIndexLoaded = true;
          } catch(e) {}
        }
      };
      xhr.send();

      // 输入事件
      var debounceTimer;
      searchInput.addEventListener('input', function() {
        var val = this.value.trim();
        searchClear.style.display = val ? 'block' : 'none';

        if (!val) {
          hideSearchResults();
          return;
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() { doSearch(val); }, 200);
      });

      // 清空按钮
      searchClear.addEventListener('click', function() {
        searchInput.value = '';
        searchClear.style.display = 'none';
        searchInput.focus();
        hideSearchResults();
      });

      // 点击遮罩关闭
      searchOverlay.addEventListener('click', hideSearchResults);

      // ESC 关闭
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') hideSearchResults();
      });

      function doSearch(query) {
        if (!searchIndexLoaded) return;

        var kw = query.toLowerCase();
        var results = [];

        for (var i = 0; i < allArticles.length; i++) {
          var a = allArticles[i];
          if (a.title.toLowerCase().indexOf(kw) !== -1 ||
              (a.description && a.description.toLowerCase().indexOf(kw) !== -1)) {
            results.push(a);
            if (results.length >= 30) break; // 最多显示30条
          }
        }

        if (results.length === 0) {
          searchResults.style.display = 'none';
          searchOverlay.style.display = 'block';
          newsList.style.display = 'none';
          categoryNav.style.display = 'none';
          statsBar.style.display = 'none';
          searchEmpty.style.display = '';
          if (noNewsEmpty) noNewsEmpty.style.display = 'none';
          return;
        }

        searchEmpty.style.display = 'none';
        if (noNewsEmpty) noNewsEmpty.style.display = 'none';
        newsList.style.display = 'none';
        categoryNav.style.display = 'none';
        statsBar.style.display = 'none';

        var html = '';
        var catColors = { ai: '#7c3aed', tech: '#3b82f6', finance: '#0d9488' };
        var catLabels = { ai: '🤖 AI', tech: '💻 科技', finance: '📈 财经' };

        for (var j = 0; j < results.length; j++) {
          var r = results[j];
          var color = catColors[r.category] || catColors.tech;
          var label = catLabels[r.category] || catLabels.tech;
          var desc = r.description ? r.description.slice(0, 100) : '';

          html += '<div class="search-result-item" data-category="' + r.category + '">' +
            '<div class="sr-meta">' +
              '<span class="category-tag" style="background:' + color + '18;color:' + color + '">' + label + '</span>' +
              '<span class="source-tag">' + r.sourceLabel + '</span>' +
              '<span class="sr-date">' + r.date + '</span>' +
            '</div>' +
            '<h3 class="sr-title"><a href="' + r.link + '" target="_blank" rel="noopener">' + highlightMatch(r.title, query) + '</a></h3>' +
            (desc ? '<p class="sr-desc">' + highlightMatch(desc, query) + '</p>' : '') +
          '</div>';
        }

        searchResults.innerHTML = html;
        searchResults.style.display = '';
        searchOverlay.style.display = 'block';
      }

      function highlightMatch(text, query) {
        var i = text.toLowerCase().indexOf(query.toLowerCase());
        if (i === -1) return text;
        return text.slice(0, i) +
          '<mark class="search-highlight">' + text.slice(i, i + query.length) + '</mark>' +
          text.slice(i + query.length);
      }

      function hideSearchResults() {
        searchResults.style.display = 'none';
        searchOverlay.style.display = 'none';
        newsList.style.display = '';
        categoryNav.style.display = '';
        statsBar.style.display = '';
        searchEmpty.style.display = 'none';
        if (noNewsEmpty) noNewsEmpty.style.display = '';
      }
    })();
  </script>
</body>
</html>`;
}

function renderArchivePage(allDates) {
  const items = allDates.map(d => `
    <li class="archive-item">
      <span class="archive-date-icon">📄</span>
      <a href="news/${d.date}.html">${d.dateCN} <span class="archive-count">(${d.count}条)</span></a>
    </li>
  `).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>往期归档 - 科技新闻日报</title>
  <link rel="stylesheet" href="assets/style.css?v=${getTodayStr()}">
</head>
<body>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <a href="index.html" class="logo">
          <span class="logo-icon">📰</span>
          <span class="logo-text">科技日报</span>
        </a>
        <p class="logo-sub">AI · 科技 · 财经</p>
      </div>
      <nav class="sidebar-nav">
        <a href="index.html" class="nav-item">
          <span>📅</span> 今日新闻
        </a>
        <a href="archive.html" class="nav-item active">
          <span>📁</span> 往期归档
        </a>
      </nav>
      <footer class="sidebar-footer">
        <p>每日 8:00 自动更新</p>
      </footer>
    </aside>

    <main class="main-content">
      <header class="page-header">
        <h1>📁 往期归档</h1>
        <p class="page-date">所有历史新闻，点击日期查看</p>
      </header>
      <div class="archive-list-wrapper">
        <ul class="archive-list">
          ${items}
        </ul>
        ${allDates.length === 0 ? '<div class="empty-state"><p>还没有历史记录</p></div>' : ''}
      </div>
    </main>
  </div>
</body>
</html>`;
}

// ========== 归档管理 ==========
function generateArchiveHtml(newsDir, prefix) {
  if (!fs.existsSync(newsDir)) return '<p class="no-archive">暂无历史</p>';

  const files = fs.readdirSync(newsDir)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .map(f => f.replace('.html', ''))
    .sort()
    .reverse()
    .slice(0, 7);

  if (files.length === 0) return '<p class="no-archive">暂无历史</p>';

  return '<ul class="sidebar-date-list">' + files.map(f => {
    const cn = getDateCN(f);
    const href = prefix === './' ? `news/${f}.html` : `${f}.html`;
    return `<li><a href="${href}">${cn.slice(5)}</a></li>`;
  }).join('') + '</ul>';
}

function getArchiveDates(newsDir) {
  if (!fs.existsSync(newsDir)) return [];
  return fs.readdirSync(newsDir)
    .filter(f => f.endsWith('.html'))
    .map(f => f.replace('.html', ''))
    .sort()
    .reverse()
    .map(date => ({
      date,
      dateCN: getDateCN(date),
      count: '?',
    }));
}

// ========== 主流程 ==========
async function main() {
  const dateStr = getTodayStr();
  const dateCN = getDateCN(new Date().toISOString());

  console.log(`\n🚀 正在生成 ${dateCN} 科技新闻日报...\n`);

  // 1. 抓取新闻
  const allNews = await fetchAllNews();

  // 2. 统计分类数量
  const counts = { ai: 0, tech: 0, finance: 0 };
  for (const item of allNews) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }

  // 3. 确保目录存在
  const rootDir = path.join(__dirname, '..');
  const newsDir = path.join(rootDir, 'news');
  const assetsDir = path.join(rootDir, 'assets');
  [newsDir, assetsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // 4. 生成归档 HTML（侧边栏用）—— 区分根目录和 news 子目录
  const archiveHtmlRoot = generateArchiveHtml(newsDir, './');   // 根目录用
  const archiveHtmlNews = generateArchiveHtml(newsDir, '../');  // news/ 子目录用

  // 5. 生成今日新闻页 — news/ 子目录
  const todayHtmlNews = renderFullPage({ dateStr, dateCN, news: allNews, counts, archiveHtml: archiveHtmlNews, prefix: '../' });
  fs.writeFileSync(path.join(newsDir, `${dateStr}.html`), todayHtmlNews, 'utf-8');
  console.log(`✓ 生成 news/${dateStr}.html`);

  // 6. 生成首页（根目录）
  const todayHtmlRoot = renderFullPage({ dateStr, dateCN, news: allNews, counts, archiveHtml: archiveHtmlRoot, prefix: './' });
  fs.writeFileSync(path.join(rootDir, 'index.html'), todayHtmlRoot, 'utf-8');
  console.log('✓ 生成 index.html');

  // 7. 生成归档页
  const archiveDates = getArchiveDates(newsDir);
  const archiveHtml2 = renderArchivePage(archiveDates);
  fs.writeFileSync(path.join(rootDir, 'archive.html'), archiveHtml2, 'utf-8');
  console.log('✓ 生成 archive.html');

  // 8. 更新搜索索引
  updateSearchIndex(allNews, dateStr, dateCN, rootDir);
  console.log('✓ 更新搜索索引');

  // 9. 生成 CSS
  const cssContent = generateCSS();
  fs.writeFileSync(path.join(assetsDir, 'style.css'), cssContent, 'utf-8');
  console.log('✓ 生成 assets/style.css');

  console.log(`\n✅ 完成！今日共收录 ${allNews.length} 条新闻\n`);
  return { count: allNews.length, counts };
}

// ========== 搜索索引管理 ==========
function updateSearchIndex(todayNews, dateStr, dateCN, rootDir) {
  const dataDir = path.join(rootDir, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const indexPath = path.join(dataDir, 'articles.json');
  let allArticles = [];

  // 读取已有索引
  if (fs.existsSync(indexPath)) {
    try {
      allArticles = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch (e) {
      allArticles = [];
    }
  }

  // 去除当天已有的旧记录
  allArticles = allArticles.filter(a => a.date !== dateStr);

  // 添加今天的新文章
  const newArticles = todayNews.map(item => ({
    title: item.title,
    link: item.link,
    description: item.description ? item.description.slice(0, 200) : '',
    sourceLabel: item.sourceLabel,
    category: item.category,
    date: dateStr,
    dateCN: dateCN,
  }));
  allArticles = allArticles.concat(newArticles);

  // 只保留最近60天的文章（控制文件大小）
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  allArticles = allArticles.filter(a => new Date(a.date) >= cutoff);

  // 写回主索引
  fs.writeFileSync(indexPath, JSON.stringify(allArticles, null, 2), 'utf-8');

  // 同时生成前端用的搜索索引（放 assets 目录）
  const assetsDir = path.join(rootDir, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(
    path.join(assetsDir, 'search-index.json'),
    JSON.stringify(allArticles),
    'utf-8'
  );
}

// ========== CSS 生成 ==========
function generateCSS() {
  return `
/* ===== 基础变量 ===== */
:root {
  --bg: #faf9f6;
  --surface: #ffffff;
  --surface-hover: #f8f7f4;
  --text: #1e1e2e;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --border: #e8e6e1;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 2px 8px rgba(0,0,0,0.06);
  --shadow-lg: 0 4px 16px rgba(0,0,0,0.08);
  --radius: 12px;
  --radius-sm: 8px;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
               "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  --ai: #7c3aed;
  --ai-light: #f5f3ff;
  --tech: #3b82f6;
  --tech-light: #eff6ff;
  --finance: #0d9488;
  --finance-light: #f0fdfa;
  --sidebar-width: 260px;
}

/* ===== 全局重置 ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

a { color: inherit; text-decoration: none; }

/* ===== 应用布局 ===== */
.app-layout {
  display: flex;
  min-height: 100vh;
}

/* ===== 侧边栏 ===== */
.sidebar {
  width: var(--sidebar-width);
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 28px 20px;
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; left: 0; bottom: 0;
  z-index: 10;
  overflow-y: auto;
}

.sidebar-header { margin-bottom: 28px; }

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.02em;
}
.logo-icon { font-size: 26px; }
.logo-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 6px;
  padding-left: 36px;
  letter-spacing: 0.08em;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 28px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  font-size: 15px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
  text-decoration: none;
}
.nav-item:hover { background: var(--bg); color: var(--text); }
.nav-item.active {
  background: var(--finance-light);
  color: var(--finance);
  font-weight: 600;
}

.sidebar-archive { flex: 1; }
.sidebar-archive h4 {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 10px;
  padding-left: 14px;
}

.sidebar-date-list { list-style: none; }
.sidebar-date-list li { }
.sidebar-date-list a {
  display: block;
  padding: 7px 14px;
  font-size: 13px;
  color: var(--text-secondary);
  border-radius: 6px;
  transition: all 0.15s ease;
  text-decoration: none;
}
.sidebar-date-list a:hover {
  background: var(--bg);
  color: var(--text);
}

.no-archive {
  font-size: 13px;
  color: var(--text-muted);
  padding-left: 14px;
}

.sidebar-footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.sidebar-footer p {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

/* ===== 主内容区 ===== */
.main-content {
  flex: 1;
  margin-left: var(--sidebar-width);
  padding: 40px 48px;
  max-width: 900px;
}

.page-header {
  margin-bottom: 28px;
}
.page-header h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}
.page-date {
  font-size: 15px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* ===== 分类导航按钮 ===== */
.category-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.cat-nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--font-sans);
}
.cat-nav-btn:hover {
  border-color: #c4b5fd;
  color: var(--text);
}
.cat-nav-btn.active {
  background: var(--ai-light);
  border-color: var(--ai);
  color: var(--ai);
  font-weight: 600;
}
.cat-nav-btn .cat-emoji { font-size: 16px; }
.cat-nav-btn .cat-count {
  font-size: 11px;
  background: var(--bg);
  padding: 1px 7px;
  border-radius: 10px;
  color: var(--text-muted);
}
.cat-nav-btn.active .cat-count {
  background: var(--ai);
  color: white;
}

/* ===== 统计条 ===== */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 0;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.stats-bar strong { color: var(--text); }
.stats-sources { font-size: 12px; }

/* ===== 新闻卡片 ===== */
.news-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.news-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 24px;
  transition: all 0.2s ease;
  cursor: default;
}
.news-card:hover {
  border-color: #d1d5db;
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}

.card-content { }

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.category-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 4px;
  letter-spacing: 0.03em;
}

.source-tag {
  font-size: 12px;
  color: var(--text-muted);
  padding: 2px 8px;
  background: var(--bg);
  border-radius: 4px;
}

.card-title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
  margin-bottom: 4px;
}
.card-title a {
  color: var(--text);
  text-decoration: none;
  transition: color 0.15s ease;
}
.card-title a:hover { color: var(--ai); }

.card-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 6px;
}

.card-time {
  font-size: 12px;
  color: var(--text-muted);
}

/* ===== 空状态 ===== */
.empty-state {
  text-align: center;
  padding: 80px 40px;
  color: var(--text-muted);
}
.empty-icon { font-size: 56px; margin-bottom: 16px; }
.empty-state h3 { font-size: 20px; color: var(--text-secondary); margin-bottom: 8px; }

/* ===== 归档页 ===== */
.archive-list-wrapper {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 0;
}
.archive-list { list-style: none; }
.archive-item { }
.archive-item a {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  font-size: 15px;
  color: var(--text);
  transition: background 0.15s ease;
  text-decoration: none;
}
.archive-item a:hover { background: var(--bg); }
.archive-date-icon { font-size: 18px; }
.archive-count {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 8px;
}

/* ===== 搜索栏 ===== */
.search-bar-wrapper {
  position: relative;
  margin-bottom: 20px;
}

.search-bar {
  display: flex;
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0 16px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.search-bar:focus-within {
  border-color: var(--ai);
  box-shadow: 0 0 0 3px rgba(124,58,237,0.1);
}

.search-icon {
  font-size: 16px;
  margin-right: 10px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  font-family: var(--font-sans);
  color: var(--text);
  background: transparent;
  padding: 12px 0;
}
.search-input::placeholder {
  color: var(--text-muted);
}

.search-clear {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
}
.search-clear:hover {
  background: var(--bg);
  color: var(--text);
}

/* 搜索结果 */
.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  margin-top: 4px;
  max-height: 500px;
  overflow-y: auto;
  z-index: 100;
}

.search-result-item {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s ease;
}
.search-result-item:last-child { border-bottom: none; }
.search-result-item:hover { background: var(--surface-hover); }

.sr-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.sr-date {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
}

.sr-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.5;
  margin-bottom: 2px;
}
.sr-title a {
  color: var(--text);
  text-decoration: none;
  transition: color 0.15s ease;
}
.sr-title a:hover { color: var(--ai); }

.sr-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.search-highlight {
  background: #fef08a;
  color: #000;
  padding: 1px 2px;
  border-radius: 2px;
}

/* 搜索遮罩 */
.search-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.15);
  z-index: 99;
}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .app-layout { flex-direction: column; }

  .sidebar {
    position: relative;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 16px 20px;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }
  .sidebar-header { margin-bottom: 0; }
  .sidebar-archive { display: none; }
  .sidebar-footer { display: none; }
  .sidebar-nav { flex-direction: row; margin-bottom: 0; }

  .main-content {
    margin-left: 0;
    padding: 24px 16px;
  }

  .category-nav { gap: 6px; }
  .cat-nav-btn { padding: 6px 12px; font-size: 13px; }
  .news-card { padding: 16px; }
  .card-title { font-size: 15px; }
}
  `.trim();
}

// ========== 执行 ==========
main()
  .then(result => {
    console.log(`AI: ${result.counts.ai} | 科技: ${result.counts.tech} | 财经: ${result.counts.finance}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ 生成失败:', err.message);
    process.exit(1);
  });
