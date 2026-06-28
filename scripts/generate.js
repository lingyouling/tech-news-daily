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

  // 汽车源（暂无稳定RSS，汽车新闻通过关键词从综合源自动识别）:
  // { url: 'https://rsshub.app/autohome/latest',  category: 'car', label: '汽车之家' },
  // { url: 'https://36kr.com/feed',                category: 'car', label: '36氪·汽车' },

  // 备用源:
  // { url: 'https://rsshub.app/jiqizhixin/home', category: 'ai', label: '机器之心' },
  // { url: 'https://www.pingwest.com/feed',      category: 'tech', label: '品玩' },
];

// ========== 分类关键词（用于自动归类） ==========
const CATEGORY_RULES = [
  {
    category: 'car',
    keywords: [
      '汽车', '新车', '轿车', 'SUV', 'MPV', '跑车', '轿跑', '越野',
      '特斯拉', '比亚迪', '蔚来', '理想', '小鹏', '问界', '极氪', '零跑',
      '小米汽车', 'SU7', 'Model', 'Cybertruck', '宝马', '奔驰', '奥迪',
      '丰田', '本田', '大众', '保时捷', '法拉利', '兰博基尼',
      '电动汽车', '新能源车', '混动', '纯电', '增程', '换电',
      '自动驾驶', '智能驾驶', 'FSD', 'NOA', '激光雷达', '毫米波',
      '电池', '续航', '充电', '快充', '超充', '换电站', '固态电池',
      '车机', '座舱', '中控', '车载', '车联网',
      '试驾', '测评', '提车', '交付', '销量', '降价', '涨价',
      '概念车', '车展', '北京车展', '上海车展', '日内瓦车展',
    ],
  },
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
      '手机', '芯片', '苹果', '华为', '小米',
      'App', '软件', '硬件', '产品', '发布', '上线', '更新',
      '操作系统', 'Android', 'iOS', 'Windows', 'Mac',
      '云计算', 'SaaS', '数据', '安全', '开源', 'GitHub',
      '机器人', 'VR', 'AR', 'Apple', 'Vision',
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
  const scores = { ai: 0, tech: 0, finance: 0, car: 0 };

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
    ai: '#c4b5fd',
    tech: '#5eead4',
    finance: '#5eeab0',
    car: '#fbbf24',
  };
  const catLabels = {
    ai: '🤖 AI',
    tech: '💻 科技',
    finance: '📈 财经',
    car: '🚗 汽车',
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
    { key: 'car', label: '汽车', emoji: '🚗' },
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
  var cacheVer = Date.now();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>科技新闻日报 - ${dateCN}</title>
  <link rel="stylesheet" href="${prefix}assets/style.css?v=${cacheVer}">
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
        var catColors = { ai: '#c4b5fd', tech: '#5eead4', finance: '#5eeab0', car: '#fbbf24' };
        var catLabels = { ai: '🤖 AI', tech: '💻 科技', finance: '📈 财经', car: '🚗 汽车' };

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
  <link rel="stylesheet" href="assets/style.css?v=${Date.now()}">
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
  const counts = { ai: 0, tech: 0, finance: 0, car: 0 };
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
/* ==========================================
   紫绿渐变主题 — 毛玻璃卡片
   ========================================== */

/* ===== 基础变量 ===== */
:root {
  --bg: #0f0819;
  --surface-glass: rgba(255,255,255,0.04);
  --surface-glass-hover: rgba(255,255,255,0.08);
  --surface-solid: rgba(30,20,50,0.7);
  --text: #f3eeff;
  --text-secondary: #b8accc;
  --text-muted: #7a6e8e;
  --border-glass: rgba(255,255,255,0.06);
  --border-hover: rgba(255,255,255,0.12);
  --shadow-sm: 0 2px 8px rgba(0,0,0,0.2);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.3);
  --shadow-lg: 0 16px 48px rgba(0,0,0,0.4);
  --radius: 12px;
  --radius-sm: 8px;
  --radius-lg: 16px;
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Display",
               "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
               "Helvetica Neue", sans-serif;
  /* 紫绿配色 */
  --green: #5eeab0;
  --green-dim: #3cc982;
  --green-bg: rgba(94,234,176,0.12);
  --green-border: rgba(94,234,176,0.25);
  --purple: #c4b5fd;
  --purple-dim: #a78bfa;
  --purple-bg: rgba(196,181,253,0.12);
  --purple-border: rgba(196,181,253,0.25);
  --teal: #5eead4;
  --teal-bg: rgba(94,234,212,0.12);
  --pink: #f0abfc;
  --pink-bg: rgba(240,171,252,0.1);
  --ai: var(--purple);
  --ai-bg: var(--purple-bg);
  --tech: var(--teal);
  --tech-bg: var(--teal-bg);
  --finance: var(--green);
  --finance-bg: var(--green-bg);
  --car: #fbbf24;
  --car-dim: #f59e0b;
  --car-bg: rgba(251,191,36,0.12);
  --car-border: rgba(251,191,36,0.25);
  --sidebar-width: 260px;
}

/* ===== 全局重置 ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-sans);
  background: var(--bg);
  background-image:
    radial-gradient(ellipse 80% 60% at 20% 0%, rgba(139,92,246,0.18) 0%, transparent 60%),
    radial-gradient(ellipse 60% 50% at 80% 100%, rgba(16,185,129,0.08) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 50% 50%, rgba(139,92,246,0.06) 0%, transparent 70%);
  color: var(--text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-weight: 400;
  letter-spacing: -0.01em;
  min-height: 100vh;
}

a { color: inherit; text-decoration: none; }

/* ===== 应用布局 ===== */
.app-layout {
  display: flex;
  min-height: 100vh;
  position: relative;
}

/* ===== 侧边栏 — 毛玻璃效果 ===== */
.sidebar {
  width: var(--sidebar-width);
  background: rgba(20,13,40,0.7);
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  border-right: 1px solid var(--border-glass);
  padding: 32px 20px;
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; left: 0; bottom: 0;
  z-index: 10;
  overflow-y: auto;
}

.sidebar-header { margin-bottom: 32px; }

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 18px;
  font-weight: 650;
  color: var(--text);
  text-decoration: none;
  letter-spacing: -0.02em;
  transition: opacity 0.15s ease;
}
.logo:hover { opacity: 0.8; }
.logo-icon { font-size: 24px; opacity: 0.9; }
.logo-sub {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 6px;
  padding-left: 34px;
  letter-spacing: 0.06em;
  font-weight: 500;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 32px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 450;
  color: var(--text-secondary);
  transition: all 0.15s ease;
  text-decoration: none;
}
.nav-item:hover { background: rgba(255,255,255,0.06); color: var(--text); }
.nav-item.active {
  background: var(--purple-bg);
  color: var(--purple);
  font-weight: 550;
}

.sidebar-archive { flex: 1; }
.sidebar-archive h4 {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
  padding-left: 12px;
  font-weight: 550;
}

.sidebar-date-list { list-style: none; }
.sidebar-date-list li { }
.sidebar-date-list a {
  display: block;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  border-radius: 5px;
  transition: all 0.12s ease;
  text-decoration: none;
  font-weight: 450;
}
.sidebar-date-list a:hover {
  background: rgba(255,255,255,0.06);
  color: var(--text);
}

.no-archive {
  font-size: 13px;
  color: var(--text-muted);
  padding-left: 12px;
}

.sidebar-footer {
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px solid var(--border-glass);
}
.sidebar-footer p {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  font-weight: 450;
}

/* ===== 主内容区 ===== */
.main-content {
  flex: 1;
  margin-left: var(--sidebar-width);
  padding: 48px 56px;
  max-width: 880px;
}

.page-header {
  margin-bottom: 32px;
}
.page-header h1 {
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.03em;
  color: var(--text);
  background: linear-gradient(135deg, var(--purple), var(--green));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.page-date {
  font-size: 14px;
  color: var(--text-muted);
  margin-top: 6px;
  font-weight: 450;
}

/* ===== 分类导航按钮 ===== */
.category-nav {
  display: flex;
  gap: 6px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.cat-nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--border-glass);
  border-radius: 8px;
  background: var(--surface-glass);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  font-size: 13px;
  font-weight: 480;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-sans);
  letter-spacing: -0.01em;
}
.cat-nav-btn:hover {
  border-color: var(--border-hover);
  background: var(--surface-glass-hover);
  color: var(--text);
}
.cat-nav-btn.active {
  background: var(--purple-bg);
  border-color: var(--purple-border);
  color: var(--purple);
  font-weight: 550;
  box-shadow: 0 0 20px rgba(167,139,250,0.1);
}
.cat-nav-btn .cat-emoji { font-size: 14px; }
.cat-nav-btn .cat-count {
  font-size: 11px;
  background: rgba(255,255,255,0.06);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--text-muted);
  font-weight: 500;
}
.cat-nav-btn.active .cat-count {
  background: var(--purple);
  color: #0f0819;
  font-weight: 600;
}

/* ===== 统计条 ===== */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 0 16px;
  margin-bottom: 24px;
  font-size: 13px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-glass);
  font-weight: 450;
}
.stats-bar strong { color: var(--text); font-weight: 550; }
.stats-sources { font-size: 12px; }

/* ===== 新闻列表 ===== */
.news-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ===== 毛玻璃新闻卡片 ===== */
.news-card {
  background: rgba(255,255,255,0.03);
  backdrop-filter: blur(16px) saturate(1.1);
  -webkit-backdrop-filter: blur(16px) saturate(1.1);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: default;
  position: relative;
  overflow: hidden;
}

/* 卡片微光效果 */
.news-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(135deg,
    rgba(139,92,246,0.04) 0%,
    transparent 40%,
    rgba(94,234,176,0.02) 100%);
  border-radius: var(--radius-lg);
  pointer-events: none;
}

.news-card:hover {
  background: rgba(255,255,255,0.06);
  border-color: var(--border-hover);
  transform: translateY(-2px);
  box-shadow:
    0 8px 32px rgba(139,92,246,0.12),
    0 2px 8px rgba(0,0,0,0.2);
}

.news-card:hover::before {
  background: linear-gradient(135deg,
    rgba(139,92,246,0.08) 0%,
    transparent 40%,
    rgba(94,234,176,0.04) 100%);
}

.card-content { position: relative; z-index: 1; }

.card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.category-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.source-tag {
  font-size: 11px;
  color: var(--text-muted);
  padding: 1px 6px;
  background: rgba(255,255,255,0.04);
  border-radius: 4px;
  font-weight: 480;
}

.card-title {
  font-size: 15px;
  font-weight: 550;
  line-height: 1.45;
  margin-bottom: 4px;
  letter-spacing: -0.01em;
}
.card-title a {
  color: var(--text);
  text-decoration: none;
  transition: color 0.2s ease;
}
.card-title a:hover { color: var(--green); }

.card-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 4px;
  font-weight: 430;
}

.card-time {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 450;
}

/* ===== 空状态 ===== */
.empty-state {
  text-align: center;
  padding: 100px 40px;
  color: var(--text-muted);
}
.empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.4; }
.empty-state h3 { font-size: 18px; font-weight: 550; color: var(--text-secondary); margin-bottom: 8px; }
.empty-state p { font-size: 14px; font-weight: 450; }

/* ===== 归档页 ===== */
.archive-list-wrapper {
  background: var(--surface-glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  padding: 4px 0;
  overflow: hidden;
}
.archive-list { list-style: none; }
.archive-item { }
.archive-item a {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 480;
  color: var(--text);
  transition: background 0.1s ease;
  text-decoration: none;
  letter-spacing: -0.01em;
}
.archive-item a:hover { background: rgba(255,255,255,0.05); }
.archive-date-icon { font-size: 16px; opacity: 0.6; }
.archive-count {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 6px;
  font-weight: 450;
}

/* ===== 搜索栏 — 毛玻璃 ===== */
.search-bar-wrapper {
  position: relative;
  margin-bottom: 24px;
}

.search-bar {
  display: flex;
  align-items: center;
  background: var(--surface-glass);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  padding: 0 16px;
  transition: all 0.25s ease;
}
.search-bar:hover {
  border-color: var(--border-hover);
}
.search-bar:focus-within {
  border-color: var(--purple-border);
  background: rgba(255,255,255,0.06);
  box-shadow: 0 0 0 4px rgba(167,139,250,0.08), 0 0 24px rgba(167,139,250,0.08);
}

.search-icon {
  font-size: 15px;
  margin-right: 10px;
  flex-shrink: 0;
  opacity: 0.5;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  font-family: var(--font-sans);
  font-weight: 450;
  color: var(--text);
  background: transparent;
  padding: 11px 0;
  letter-spacing: -0.01em;
}
.search-input::placeholder {
  color: var(--text-muted);
}

.search-clear {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.12s ease;
}
.search-clear:hover {
  background: rgba(255,255,255,0.08);
  color: var(--text);
}

/* 搜索结果 — 毛玻璃 */
.search-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: rgba(25,16,45,0.95);
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  border: 1px solid var(--border-hover);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  max-height: 480px;
  overflow-y: auto;
  z-index: 100;
}

.search-result-item {
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-glass);
  transition: background 0.1s ease;
}
.search-result-item:last-child { border-bottom: none; }
.search-result-item:hover { background: rgba(255,255,255,0.06); }

.sr-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.sr-date {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
  font-weight: 450;
}

.sr-title {
  font-size: 14px;
  font-weight: 530;
  line-height: 1.45;
  margin-bottom: 2px;
  letter-spacing: -0.01em;
}
.sr-title a {
  color: var(--text);
  text-decoration: none;
  transition: color 0.12s ease;
}
.sr-title a:hover { color: var(--green); }

.sr-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  font-weight: 430;
}

.search-highlight {
  background: rgba(94,234,176,0.2);
  color: var(--green);
  padding: 1px 3px;
  border-radius: 3px;
  font-weight: 550;
}

/* 搜索遮罩 */
.search-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(8,4,16,0.5);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 99;
}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .app-layout { flex-direction: column; }

  .sidebar {
    position: relative;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-glass);
    padding: 16px 20px;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: rgba(20,13,40,0.95);
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
  .cat-nav-btn { padding: 6px 12px; font-size: 12px; }
  .news-card { padding: 14px 16px; }
  .card-title { font-size: 14px; }
}
  `.trim();
}

// ========== 执行 ==========
main()
  .then(result => {
    console.log(`AI: ${result.counts.ai} | 科技: ${result.counts.tech} | 财经: ${result.counts.finance} | 汽车: ${result.counts.car}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ 生成失败:', err.message);
    process.exit(1);
  });
