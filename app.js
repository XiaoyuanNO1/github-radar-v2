/* ===== app.js — GitHub AI 雷达前端逻辑 ===== */

const DATA_URL = './radar_history.json';
const REDDIT_DATA_URL = './reddit_history.json';

// ===== 全局状态 =====
let allProjects = [];
let currentSort = { key: 'total', dir: 'desc' };
let searchQuery = '';
let trackFilter = 'all';
let currentPage = 1;
const PAGE_SIZE = 15;
let currentTab = 'radar'; // 默认展示 radar tab

// ===== Reddit 全局状态 =====
let allRedditPosts = [];
let currentRedditSub = 'SomebodyMakeThis';
let currentRedditDate = '';
let currentRedditVerdict = 'all'; // 观点筛选：all / yes / watch / no

// Stars 缓存
const starsCache = {};

// ===== 从 GitHub API 获取 Stars =====
async function fetchStars(repoUrl) {
  if (!repoUrl) return null;
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return null;
  const repo = match[1].replace(/\/$/, '');
  if (starsCache[repo] !== undefined) return starsCache[repo];
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) { starsCache[repo] = null; return null; }
    const data = await res.json();
    const stars = data.stargazers_count;
    starsCache[repo] = stars;
    return stars;
  } catch {
    starsCache[repo] = null;
    return null;
  }
}

// 格式化数字
function formatNum(n) {
  if (n === null || n === undefined || n === 0) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatStars(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

// ===== 初始化 =====
async function init() {
  try {
    const [res, redditRes] = await Promise.all([
      fetch(DATA_URL + '?t=' + Date.now()),
      fetch(REDDIT_DATA_URL + '?t=' + Date.now()).catch(() => null),
    ]);

    if (!res.ok) throw new Error('数据加载失败');
    allProjects = await res.json();

    if (redditRes && redditRes.ok) {
      allRedditPosts = await redditRes.json();
    }

    updateLastUpdate();
    updateStats();
    buildDateOptions();
    renderTrending();
    renderTop3();
    renderHistory();
    buildRedditDateOptions();
    renderRedditList();
    bindEvents();
  } catch (e) {
    console.error(e);
    document.getElementById('trending-tbody').innerHTML =
      `<tr><td colspan="6" class="loading-cell"><div class="empty-state"><div class="icon">⚠️</div><p>数据加载失败，请确认 radar_history.json 与 index.html 在同一目录</p></div></td></tr>`;
    document.getElementById('top3-grid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1"><div class="icon">⚠️</div><p>数据加载失败</p></div>`;
    document.getElementById('history-tbody').innerHTML =
      `<tr><td colspan="10" class="loading-cell"><div class="empty-state"><div class="icon">⚠️</div><p>无数据</p></div></td></tr>`;
  }
}

// ===== Tab 切换 =====
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
  });
}

// ===== 更新统计看板 =====
function updateStats() {
  if (!allProjects.length) return;
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();
  const latestDate = dates[0];
  const todayProjects = allProjects.filter(p => p.date === latestDate);

  document.getElementById('stat-total').textContent = allProjects.length;
  document.getElementById('stat-today').textContent = todayProjects.length;
  document.getElementById('stat-days').textContent = dates.length;
}

// ===== 更新最后更新时间 =====
function updateLastUpdate() {
  if (!allProjects.length) return;
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();
  const latest = dates[0];
  // 尝试读取最新日期中最晚的 fetched_at 时间
  const latestProjects = allProjects.filter(p => p.date === latest);
  const fetchedTimes = latestProjects.map(p => p.fetched_at).filter(Boolean).sort().reverse();
  if (fetchedTimes.length > 0) {
    // fetched_at 格式为 "2026-03-22 07:05"，取时间部分
    const timeStr = fetchedTimes[0].includes(' ') ? fetchedTimes[0].split(' ')[1] : '';
    document.getElementById('last-update').textContent = `最近更新：${latest}${timeStr ? ' ' + timeStr : ''}`;
  } else {
    document.getElementById('last-update').textContent = `最近更新：${latest}`;
  }
}

// ===== 构建日期选项 =====
function buildDateOptions() {
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();

  // trending tab 日期选项
  const trendingSel = document.getElementById('trending-date');
  trendingSel.innerHTML = '';
  dates.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d + (i === 0 ? ' (最新)' : '');
    trendingSel.appendChild(opt);
  });

  // 黑马榜日期选项
  const top3Sel = document.getElementById('top3-date');
  top3Sel.innerHTML = '';
  dates.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d + (i === 0 ? ' (最新)' : '');
    top3Sel.appendChild(opt);
  });
}

// ===== 渲染 GitHub Trending 榜单 =====
function renderTrending(date) {
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();
  const targetDate = date || dates[0];

  // 获取该日期的项目，按 trending_rank 排序（若无则按 stars 降序）
  let data = allProjects.filter(p => p.date === targetDate);
  data.sort((a, b) => {
    const ra = a.trending_rank || 9999;
    const rb = b.trending_rank || 9999;
    if (ra !== rb) return ra - rb;
    return (b.stars || 0) - (a.stars || 0);
  });

  const tbody = document.getElementById('trending-tbody');

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon">📭</div><p>该日期暂无数据</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map((p, i) => {
    const rank = p.trending_rank || (i + 1);
    const langDot = p.language ? `<span class="lang-dot" style="background:${getLangColor(p.language)}"></span>` : '';
    return `
    <tr onclick="openTrendingModal('${p.id}')">
      <td class="col-rank"><span class="rank-num trending-rank">${rank}</span></td>
      <td class="col-title">
        <span class="project-title">
          <a href="${p.url}" target="_blank" onclick="event.stopPropagation()">${p.title}</a>
        </span>
        <span class="project-desc-short">${(p.description || p.raw_description || '').slice(0, 60)}</span>
      </td>
      <td class="col-lang">
        <span class="lang-badge">${langDot}${p.language || '—'}</span>
      </td>
      <td class="col-stars">
        <span class="stars-tag" id="tr-stars-${p.id}">⭐ ${formatNum(p.stars)}</span>
      </td>
      <td class="col-stars-today">
        <span class="stars-today-tag ${(p.stars_today || 0) > 0 ? 'has-stars' : ''}">
          ${(p.stars_today || 0) > 0 ? '▲ ' + formatNum(p.stars_today) : '—'}
        </span>
      </td>
      <td class="col-forks">
        <span class="forks-tag">${p.forks ? '🍴 ' + formatNum(p.forks) : '—'}</span>
      </td>
    </tr>`;
  }).join('');
}

// 语言颜色映射
function getLangColor(lang) {
  const colors = {
    'Python': '#3572A5', 'JavaScript': '#f1e05a', 'TypeScript': '#2b7489',
    'Go': '#00ADD8', 'Rust': '#dea584', 'Java': '#b07219', 'C++': '#f34b7d',
    'C': '#555555', 'C#': '#178600', 'Ruby': '#701516', 'Swift': '#ffac45',
    'Kotlin': '#F18E33', 'PHP': '#4F5D95', 'Shell': '#89e051',
    'HTML': '#e34c26', 'CSS': '#563d7c', 'Vue': '#2c3e50', 'Dart': '#00B4AB',
  };
  return colors[lang] || '#8b949e';
}

// ===== 渲染 Top 3 =====
function renderTop3(date) {
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();
  const targetDate = date || dates[0];

  let tops = allProjects.filter(p => p.date === targetDate && p.is_top);
  if (tops.length < 3) {
    const others = allProjects
      .filter(p => p.date === targetDate && !p.is_top)
      .sort((a, b) => b.scores.total - a.scores.total);
    tops = [...tops, ...others].slice(0, 3);
  }
  tops = tops.sort((a, b) => b.scores.total - a.scores.total).slice(0, 3);

  const grid = document.getElementById('top3-grid');
  if (!tops.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="icon">📭</div><p>该日期暂无数据</p></div>`;
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const rankClass = ['rank-1', 'rank-2', 'rank-3'];

  grid.innerHTML = tops.map((p, i) => {
    const s = p.scores;
    return `
    <div class="top3-card ${rankClass[i]}" onclick="openModal('${p.id}')">
      <div class="card-rank-badge">${medals[i]}</div>
      <div class="card-title">
        <a href="${p.url}" target="_blank" onclick="event.stopPropagation()">${p.title}</a>
      </div>
      <div class="card-description">${p.description}</div>
      <div class="card-scores">
        <div class="score-item">
          <span class="score-label">Vibecoding</span>
          <div class="score-bar-wrap">
            <div class="score-bar"><div class="score-bar-fill vibe" style="width:${(s.vibecoding_ease/3)*100}%"></div></div>
            <span class="score-val">${s.vibecoding_ease}/3</span>
          </div>
        </div>
        <div class="score-item">
          <span class="score-label">逻辑护城河</span>
          <div class="score-bar-wrap">
            <div class="score-bar"><div class="score-bar-fill moat" style="width:${(s.logic_moat/3)*100}%"></div></div>
            <span class="score-val">${s.logic_moat}/3</span>
          </div>
        </div>
        <div class="score-item">
          <span class="score-label">赛道契合</span>
          <div class="score-bar-wrap">
            <div class="score-bar"><div class="score-bar-fill track" style="width:${(s.track_fit/2)*100}%"></div></div>
            <span class="score-val">${s.track_fit}/2</span>
          </div>
        </div>
        <div class="score-item">
          <span class="score-label">增长潜力</span>
          <div class="score-bar-wrap">
            <div class="score-bar"><div class="score-bar-fill growth" style="width:${(s.growth_potential/2)*100}%"></div></div>
            <span class="score-val">${s.growth_potential}/2</span>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <div class="total-score">
          <span class="num">${s.total}</span>
          <span class="denom">/10</span>
        </div>
        <div class="card-footer-right">
          <span class="card-stars" id="stars-card-${p.id}">⭐ —</span>
          <span class="card-date">${p.date}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  tops.forEach(p => {
    fetchStars(p.url).then(stars => {
      const el = document.getElementById(`stars-card-${p.id}`);
      if (el) el.textContent = '⭐ ' + formatStars(stars);
    });
  });
}

// ===== 计算评分样式 =====
function scoreClass(val, max) {
  const ratio = val / max;
  if (ratio >= 0.67) return 'high';
  if (ratio >= 0.34) return 'mid';
  return 'low';
}

// ===== 渲染历史表格 =====
function renderHistory() {
  document.getElementById('total-count').textContent = allProjects.length;

  let data = [...allProjects];

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.raw_description || '').toLowerCase().includes(q)
    );
  }

  if (trackFilter === 'top') {
    data = data.filter(p => p.is_top);
  } else if (trackFilter === 'high') {
    data = data.filter(p => p.scores.total >= 8);
  } else if (trackFilter === 'vibe') {
    data = data.filter(p => p.scores.vibecoding_ease >= 3);
  } else if (trackFilter === 'growth') {
    data = data.filter(p => p.scores.growth_potential >= 2);
  }

  const { key, dir } = currentSort;
  data.sort((a, b) => {
    let va, vb;
    if (key === 'date') { va = a.date; vb = b.date; }
    else if (key === 'title') { va = a.title.toLowerCase(); vb = b.title.toLowerCase(); }
    else if (key === 'total') { va = a.scores.total; vb = b.scores.total; }
    else if (key === 'vibecoding_ease') { va = a.scores.vibecoding_ease; vb = b.scores.vibecoding_ease; }
    else if (key === 'logic_moat') { va = a.scores.logic_moat; vb = b.scores.logic_moat; }
    else if (key === 'track_fit') { va = a.scores.track_fit; vb = b.scores.track_fit; }
    else if (key === 'growth_potential') { va = a.scores.growth_potential; vb = b.scores.growth_potential; }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalItems = data.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = data.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('history-tbody');

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="icon">🔍</div><p>没有找到匹配的项目</p></div></td></tr>`;
    renderPagination(0, 1, totalItems);
    return;
  }

  tbody.innerHTML = pageData.map((p, i) => {
    const s = p.scores;
    const globalIndex = start + i + 1;
    return `
    <tr onclick="openModal('${p.id}')">
      <td class="col-rank"><span class="rank-num">${globalIndex}</span></td>
      <td class="col-title">
        <span class="project-title">
          <a href="${p.url}" target="_blank" onclick="event.stopPropagation()">${p.title}</a>
        </span>
        <span class="project-desc-short">${p.description}</span>
      </td>
      <td class="col-date"><span class="date-tag">${p.date}</span></td>
      <td class="col-stars"><span class="stars-tag" id="stars-${p.id}">⭐ —</span></td>
      <td class="col-score"><span class="score-chip total ${scoreClass(s.total, 10)}">${s.total}</span></td>
      <td class="col-score"><span class="score-chip ${scoreClass(s.vibecoding_ease, 3)}">${s.vibecoding_ease}</span></td>
      <td class="col-score"><span class="score-chip ${scoreClass(s.logic_moat, 3)}">${s.logic_moat}</span></td>
      <td class="col-score"><span class="score-chip ${scoreClass(s.track_fit, 2)}">${s.track_fit}</span></td>
      <td class="col-score"><span class="score-chip ${scoreClass(s.growth_potential, 2)}">${s.growth_potential}</span></td>
      <td class="col-top"><span class="top-badge">${p.is_top ? '🏆' : ''}</span></td>
    </tr>`;
  }).join('');

  renderPagination(currentPage, totalPages, totalItems);

  pageData.forEach(p => {
    fetchStars(p.url).then(stars => {
      const el = document.getElementById(`stars-${p.id}`);
      if (el) el.textContent = '⭐ ' + formatStars(stars);
    });
  });
}

// ===== 渲染分页控件 =====
function renderPagination(page, totalPages, totalItems) {
  let el = document.getElementById('pagination');
  if (!el) return;

  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalItems);

  let pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages = [1];
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  el.innerHTML = `
    <div class="pagination-info">显示 ${start}–${end} 条，共 ${totalItems} 条</div>
    <div class="pagination-btns">
      <button class="page-btn" ${page === 1 ? 'disabled' : ''} onclick="goPage(${page - 1})">‹ 上一页</button>
      ${pages.map(p =>
        p === '...'
          ? `<span class="page-ellipsis">…</span>`
          : `<button class="page-btn ${p === page ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`
      ).join('')}
      <button class="page-btn" ${page === totalPages ? 'disabled' : ''} onclick="goPage(${page + 1})">下一页 ›</button>
    </div>
  `;
}

function goPage(p) {
  currentPage = p;
  renderHistory();
  document.getElementById('history-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== 打开 Trending Modal（无评分，只展示简介/比喻/使用场景）=====
function openTrendingModal(id) {
  const p = allProjects.find(x => x.id === id);
  if (!p) return;

  const usageScene = generateUsageScene(p);
  const rank = p.trending_rank || '—';
  const langDot = p.language ? `<span class="lang-dot-inline" style="background:${getLangColor(p.language)}"></span>` : '';

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <div class="modal-rank-label">🔥 GitHub Trending #${rank} · ${p.date}</div>
      <div class="modal-title">
        <a href="${p.url}" target="_blank">${p.title}</a>
      </div>
      <div class="modal-meta-row">
        <span class="modal-stars-row" id="modal-stars-${p.id}">⭐ 加载中...</span>
        ${p.stars_today ? `<span class="modal-stars-today">▲ ${formatNum(p.stars_today)} 今日新增</span>` : ''}
        ${p.forks ? `<span class="modal-forks">🍴 ${formatNum(p.forks)} Forks</span>` : ''}
        ${p.language ? `<span class="modal-lang">${langDot} ${p.language}</span>` : ''}
      </div>
    </div>

    <div class="modal-trending-grid">
      <div class="modal-section">
        <div class="modal-section-label">项目简介</div>
        <div class="modal-desc">${p.description || p.raw_description || '暂无描述'}</div>
      </div>
      <div class="modal-section">
        <div class="modal-section-label">生动比喻</div>
        <div class="modal-metaphor">${p.metaphor || '—'}</div>
      </div>
      <div class="modal-section">
        <div class="modal-section-label">使用场景</div>
        <div class="modal-usage">${usageScene}</div>
      </div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  fetchStars(p.url).then(stars => {
    const el = document.getElementById(`modal-stars-${p.id}`);
    if (el) el.textContent = '⭐ ' + formatStars(stars) + ' Stars';
  });
}

// ===== 打开黑马榜 Modal（含评分）=====
function openModal(id) {
  const p = allProjects.find(x => x.id === id);
  if (!p) return;
  const s = p.scores;
  const r = p.score_reasons || {};

  const usageScene = generateUsageScene(p);

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <div class="modal-rank-label">${p.is_top ? '🏆 今日精选' : '📦 归档项目'} · ${p.date}</div>
      <div class="modal-title">
        <a href="${p.url}" target="_blank">${p.title}</a>
      </div>
      <div class="modal-meta-row">
        <span class="modal-stars-row" id="modal-stars-${p.id}">⭐ 加载中...</span>
      </div>
    </div>

    <div class="modal-body-grid">
      <!-- 左栏：简介 + 比喻 + 使用场景 -->
      <div class="modal-body-left">
        <div class="modal-section">
          <div class="modal-section-label">项目简介</div>
          <div class="modal-desc">${p.description}</div>
        </div>
        <div class="modal-section">
          <div class="modal-section-label">生动比喻</div>
          <div class="modal-metaphor">${p.metaphor}</div>
        </div>
        <div class="modal-section">
          <div class="modal-section-label">使用场景</div>
          <div class="modal-usage">${usageScene}</div>
        </div>
      </div>

      <!-- 右栏：评分详情 + 综合总分 -->
      <div class="modal-body-right">
        <div class="modal-section">
          <div class="modal-section-label">评分详情</div>
          <div class="modal-scores-grid">
            <div class="modal-score-item">
              <div class="modal-score-header">
                <div class="modal-score-name">⚡ Vibecoding 实现难度</div>
                <div class="modal-score-badge">
                  <span class="modal-score-value vibe">${s.vibecoding_ease}</span>
                  <span class="modal-score-max">/ 3</span>
                </div>
              </div>
              <div class="modal-score-bar-wrap">
                <div class="modal-score-bar"><div class="modal-score-bar-fill vibe" style="width:${(s.vibecoding_ease/3)*100}%"></div></div>
              </div>
              ${r.vibecoding_ease ? `<div class="modal-score-reason">${r.vibecoding_ease}</div>` : ''}
            </div>
            <div class="modal-score-item">
              <div class="modal-score-header">
                <div class="modal-score-name">🏰 逻辑护城河</div>
                <div class="modal-score-badge">
                  <span class="modal-score-value moat">${s.logic_moat}</span>
                  <span class="modal-score-max">/ 3</span>
                </div>
              </div>
              <div class="modal-score-bar-wrap">
                <div class="modal-score-bar"><div class="modal-score-bar-fill moat" style="width:${(s.logic_moat/3)*100}%"></div></div>
              </div>
              ${r.logic_moat ? `<div class="modal-score-reason">${r.logic_moat}</div>` : ''}
            </div>
            <div class="modal-score-item">
              <div class="modal-score-header">
                <div class="modal-score-name">🎯 赛道契合度</div>
                <div class="modal-score-badge">
                  <span class="modal-score-value track">${s.track_fit}</span>
                  <span class="modal-score-max">/ 2</span>
                </div>
              </div>
              <div class="modal-score-bar-wrap">
                <div class="modal-score-bar"><div class="modal-score-bar-fill track" style="width:${(s.track_fit/2)*100}%"></div></div>
              </div>
              ${r.track_fit ? `<div class="modal-score-reason">${r.track_fit}</div>` : ''}
            </div>
            <div class="modal-score-item">
              <div class="modal-score-header">
                <div class="modal-score-name">📈 增长潜力</div>
                <div class="modal-score-badge">
                  <span class="modal-score-value growth">${s.growth_potential}</span>
                  <span class="modal-score-max">/ 2</span>
                </div>
              </div>
              <div class="modal-score-bar-wrap">
                <div class="modal-score-bar"><div class="modal-score-bar-fill growth" style="width:${(s.growth_potential/2)*100}%"></div></div>
              </div>
              ${r.growth_potential ? `<div class="modal-score-reason">${r.growth_potential}</div>` : ''}
            </div>
          </div>
          <div class="modal-total">
            <span class="modal-total-label">综合总分</span>
            <div>
              <span class="modal-total-value">${s.total}</span>
              <span class="modal-total-denom"> / 10</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  fetchStars(p.url).then(stars => {
    const el = document.getElementById(`modal-stars-${p.id}`);
    if (el) el.textContent = '⭐ ' + formatStars(stars) + ' Stars';
  });
}

// ===== 生成使用场景 =====
function generateUsageScene(p) {
  // 优先使用 JSON 中已有的深度分析内容
  if (p.usage_scene && p.usage_scene.length > 20) {
    return p.usage_scene;
  }
  const desc = (p.description || '') + ' ' + (p.raw_description || '') + ' ' + (p.metaphor || '');
  const d = desc.toLowerCase();
  const title = (p.title || '').toLowerCase();

  const scenes = [];

  if (d.includes('视频') || d.includes('video') || d.includes('短视频') || d.includes('配音') || d.includes('tts') || d.includes('音频') || d.includes('audio')) {
    scenes.push('🎬 <strong>内容创作者</strong>：适合 UP 主、自媒体人用来批量生产视频脚本、配音或剪辑素材，大幅压缩内容生产时间');
  }
  if (d.includes('代码') || d.includes('coding') || d.includes('code') || d.includes('开发') || d.includes('编程') || d.includes('ide') || d.includes('cursor') || d.includes('vscode')) {
    scenes.push('💻 <strong>软件开发日常</strong>：适合开发者在编码、调试、代码审查等日常工作中直接使用，提升研发效率');
  }
  if (d.includes('agent') || d.includes('自动化') || d.includes('automation') || d.includes('workflow') || d.includes('工作流')) {
    scenes.push('🤖 <strong>自动化业务流程</strong>：适合将重复性工作交给 AI Agent 自动执行，如数据采集、报告生成、定时任务等');
  }
  if (d.includes('科研') || d.includes('research') || d.includes('分析') || d.includes('analysis') || d.includes('数据') || d.includes('data') || d.includes('金融') || d.includes('finance')) {
    scenes.push('📊 <strong>数据分析与科研</strong>：适合研究员、数据分析师在文献整理、数据处理、报告撰写等场景中辅助使用');
  }
  if (d.includes('微调') || d.includes('fine-tun') || d.includes('训练') || d.includes('train') || d.includes('llm') || d.includes('模型')) {
    scenes.push('🧠 <strong>AI 模型研发</strong>：适合算法工程师或研究员在模型微调、实验迭代、性能优化等场景中使用');
  }
  if (d.includes('沙箱') || d.includes('sandbox') || d.includes('隔离') || d.includes('安全') || d.includes('security') || d.includes('docker') || d.includes('container')) {
    scenes.push('🔒 <strong>安全隔离执行环境</strong>：适合需要在隔离环境中运行不可信代码的场景，如在线评测、AI 代码执行、多租户 SaaS 平台');
  }
  if (d.includes('rag') || d.includes('知识库') || d.includes('检索') || d.includes('search') || d.includes('向量') || d.includes('embedding')) {
    scenes.push('🔍 <strong>企业知识管理</strong>：适合构建内部知识库、智能客服或文档检索系统，让员工快速找到所需信息');
  }
  if (d.includes('多agent') || d.includes('multi-agent') || d.includes('多智能体') || d.includes('协作') || d.includes('orchestrat')) {
    scenes.push('🏗️ <strong>复杂任务编排</strong>：适合需要多个 AI 角色协同完成复杂任务的场景，如自动化研究、代码生成流水线');
  }
  if (d.includes('教育') || d.includes('学习') || d.includes('education') || d.includes('learn') || d.includes('课程') || d.includes('course') || d.includes('tutor')) {
    scenes.push('📚 <strong>教育与学习辅助</strong>：适合学生、教师或培训机构用来制作教学内容、个性化辅导或练习题生成');
  }
  if (d.includes('营销') || d.includes('marketing') || d.includes('电商') || d.includes('ecommerce') || d.includes('运营') || d.includes('变现') || d.includes('monetiz')) {
    scenes.push('💰 <strong>电商与内容营销</strong>：适合电商卖家、运营人员用来批量生成商品文案、营销素材或自动化运营流程');
  }
  if (d.includes('cli') || d.includes('命令行') || d.includes('terminal') || d.includes('shell') || d.includes('bash')) {
    scenes.push('⌨️ <strong>开发者命令行工作流</strong>：适合喜欢命令行操作的开发者，将其集成到终端工作流中提升效率');
  }
  if (d.includes('sdk') || d.includes('api') || d.includes('接口') || d.includes('集成') || d.includes('integrat') || d.includes('plugin') || d.includes('插件')) {
    scenes.push('🔌 <strong>产品功能集成</strong>：适合将其作为模块集成进现有产品或平台，快速扩展功能而无需从零开发');
  }

  const result = scenes.slice(0, 3);

  if (result.length === 0) {
    result.push('🛠️ <strong>开发者工具增强</strong>：可集成到现有技术栈，作为功能模块使用，提升团队开发效率');
    result.push('🔍 <strong>技术调研与学习</strong>：适合作为了解该领域最新技术实践的参考项目，帮助团队做技术选型决策');
  }

  return result.map(scene => `<div class="usage-scene-item">${scene}</div>`).join('');
}

// ===== 关闭 Modal =====
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ===== 绑定事件 =====
function bindEvents() {
  // Tab 切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Trending 日期切换
  document.getElementById('trending-date').addEventListener('change', e => {
    renderTrending(e.target.value);
  });

  // 黑马榜日期切换
  document.getElementById('top3-date').addEventListener('change', e => {
    renderTop3(e.target.value);
  });

  // Reddit 日期切换
  document.getElementById('reddit-date').addEventListener('change', e => {
    currentRedditDate = e.target.value;
    renderRedditList();
  });

  // Reddit 子版块切换
  document.getElementById('reddit-section').addEventListener('click', e => {
    const btn = e.target.closest('.reddit-sub-btn');
    if (!btn) return;
    document.querySelectorAll('.reddit-sub-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRedditSub = btn.dataset.sub;
    renderRedditList();
  });

  // Reddit 观点筛选
  document.getElementById('reddit-verdict-filter').addEventListener('click', e => {
    const btn = e.target.closest('.reddit-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.reddit-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRedditVerdict = btn.dataset.verdict;
    renderRedditList();
  });

  // 搜索
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    currentPage = 1;
    renderHistory();
  });

  // 下拉排序
  document.getElementById('sort-select').addEventListener('change', e => {
    const val = e.target.value;
    if (val === 'vibecoding_desc') {
      currentSort = { key: 'vibecoding_ease', dir: 'desc' };
    } else if (val === 'logic_desc') {
      currentSort = { key: 'logic_moat', dir: 'desc' };
    } else if (val === 'growth_desc') {
      currentSort = { key: 'growth_potential', dir: 'desc' };
    } else {
      const [key, dir] = val.split('_').length === 2
        ? val.split('_')
        : [val.replace(/_desc$|_asc$/, ''), val.endsWith('asc') ? 'asc' : 'desc'];
      currentSort = { key, dir };
    }
    currentPage = 1;
    renderHistory();
    syncTableHeader();
  });

  // 表头点击排序
  document.querySelectorAll('.history-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (currentSort.key === key) {
        currentSort.dir = currentSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        currentSort = { key, dir: 'desc' };
      }
      currentPage = 1;
      renderHistory();
      syncTableHeader();
    });
  });

  // 赛道标签筛选
  document.getElementById('track-filter').addEventListener('click', e => {
    const btn = e.target.closest('.track-btn');
    if (!btn) return;
    document.querySelectorAll('.track-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    trackFilter = btn.dataset.track;
    currentPage = 1;
    renderHistory();
  });

  // ESC 关闭 modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

// ===== 同步表头排序状态 =====
function syncTableHeader() {
  document.querySelectorAll('.history-table th.sortable').forEach(th => {
    th.classList.remove('active', 'asc', 'desc');
    if (th.dataset.sort === currentSort.key) {
      th.classList.add('active', currentSort.dir);
    }
  });
}

// ===== Reddit：构建日期选项 =====
function buildRedditDateOptions() {
  if (!allRedditPosts.length) return;
  const dates = [...new Set(allRedditPosts.map(p => p.date))].sort().reverse();
  currentRedditDate = dates[0] || '';

  const sel = document.getElementById('reddit-date');
  sel.innerHTML = '';
  dates.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d + (i === 0 ? ' (最新)' : '');
    sel.appendChild(opt);
  });
}

// ===== Reddit：渲染帖子列表 =====
function renderRedditList() {
  const container = document.getElementById('reddit-list');
  if (!container) return;

  if (!allRedditPosts.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>暂无数据，等待明日自动更新</p></div>`;
    return;
  }

  const targetDate = currentRedditDate || [...new Set(allRedditPosts.map(p => p.date))].sort().reverse()[0];
  let posts = allRedditPosts.filter(p => p.date === targetDate && p.subreddit === currentRedditSub);

  // 观点筛选
  if (currentRedditVerdict === 'yes') {
    posts = posts.filter(p => p.verdict && p.verdict.startsWith('✅'));
  } else if (currentRedditVerdict === 'watch') {
    posts = posts.filter(p => p.verdict && p.verdict.startsWith('⚠️'));
  } else if (currentRedditVerdict === 'no') {
    posts = posts.filter(p => p.verdict && p.verdict.startsWith('❌'));
  }

  // 更新筛选计数
  updateVerdictCounts(targetDate);

  if (!posts.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><p>${currentRedditVerdict === 'all' ? '该日期 / 子版块暂无数据' : '没有符合筛选条件的帖子'}</p></div>`;
    return;
  }

  container.innerHTML = posts.map((p, i) => {
    const tags = (p.tags || []).map(t => `<span class="reddit-tag">${t}</span>`).join('');
    const publishedDate = p.published ? p.published.slice(0, 10) : p.date;
    const scores = p.scores || {};
    const total = scores.total || (scores.vibecoding + scores.moat + scores.track_fit + scores.growth) || 0;
    const titleDisplay = p.title_zh && !p.title_zh.startsWith('（待翻译）') ? p.title_zh : p.title;
    const titleSub = p.title_zh && !p.title_zh.startsWith('（待翻译）') ? `<div class="reddit-card-title-en">${p.title}</div>` : '';
    const verdictClass = p.verdict && p.verdict.startsWith('✅') ? 'verdict-yes'
      : p.verdict && p.verdict.startsWith('❌') ? 'verdict-no' : 'verdict-watch';

    return `
    <div class="reddit-card" onclick="openRedditModal('${p.id}')">
      <div class="reddit-card-header">
        <span class="reddit-rank">${i + 1}</span>
        <div class="reddit-card-title-wrap">
          <div class="reddit-card-title">
            <a href="${p.permalink}" target="_blank" onclick="event.stopPropagation()">${titleDisplay}</a>
          </div>
          ${titleSub}
        </div>
        <div class="reddit-heat">
          <span class="heat-label">热度</span>
          <span class="heat-score heat-${p.heat_score || 1}">${p.heat_score || 1}/5</span>
        </div>
      </div>
      <div class="reddit-card-meta">
        <span class="reddit-author">👤 u/${p.author || '匿名'}</span>
        <span class="reddit-date">📅 ${publishedDate}</span>
        <span class="reddit-sub-label">r/${p.subreddit}</span>
        ${total ? `<span class="reddit-total-score">综合 ${total}/10</span>` : ''}
      </div>
      ${p.verdict ? `<div class="reddit-verdict ${verdictClass}">${p.verdict}</div>` : ''}
      <div class="reddit-card-summary">${p.summary || p.content_snippet || '（无摘要）'}</div>
      <div class="reddit-card-footer">
        <div class="reddit-tags">${tags}</div>
        <span class="reddit-read-more">查看详情 →</span>
      </div>
    </div>`;
  }).join('');
}

// ===== Reddit：更新筛选按钮计数 =====
function updateVerdictCounts(targetDate) {
  const allPosts = allRedditPosts.filter(p => p.date === targetDate && p.subreddit === currentRedditSub);
  const yesCount = allPosts.filter(p => p.verdict && p.verdict.startsWith('✅')).length;
  const watchCount = allPosts.filter(p => p.verdict && p.verdict.startsWith('⚠️')).length;
  const noCount = allPosts.filter(p => p.verdict && p.verdict.startsWith('❌')).length;

  const btns = document.querySelectorAll('.reddit-filter-btn');
  btns.forEach(btn => {
    const v = btn.dataset.verdict;
    if (v === 'all') btn.textContent = `全部 (${allPosts.length})`;
    else if (v === 'yes') btn.textContent = `✅ 值得关注 (${yesCount})`;
    else if (v === 'watch') btn.textContent = `⚠️ 谨慎观望 (${watchCount})`;
    else if (v === 'no') btn.textContent = `❌ 不建议 (${noCount})`;
  });
}

// ===== Reddit：打开帖子详情 Modal =====
function openRedditModal(id) {
  const p = allRedditPosts.find(x => x.id === id);
  if (!p) return;

  const heatBar = Array.from({length: 5}, (_, i) =>
    `<span class="heat-dot ${i < (p.heat_score || 1) ? 'active' : ''}"></span>`
  ).join('');

  const tags = (p.tags || []).map(t => `<span class="reddit-tag">${t}</span>`).join('');
  const publishedDate = p.published ? p.published.slice(0, 10) : p.date;
  const scores = p.scores || {};
  const total = scores.total || 0;

  const titleZh = p.title_zh && !p.title_zh.startsWith('（待翻译）') ? p.title_zh : p.title;
  const verdictClass = p.verdict && p.verdict.startsWith('✅') ? 'verdict-yes'
    : p.verdict && p.verdict.startsWith('❌') ? 'verdict-no' : 'verdict-watch';

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <div class="modal-rank-label">👾 Reddit · r/${p.subreddit} · ${publishedDate}</div>
      <div class="modal-title">
        <a href="${p.permalink}" target="_blank">${titleZh}</a>
      </div>
      <div class="modal-title-en">${p.title}</div>
      <div class="modal-meta-row">
        <span>👤 u/${p.author || '匿名'}</span>
        <span style="margin-left:12px">热度：${heatBar}</span>
        ${total ? `<span style="margin-left:12px" class="reddit-total-score">综合 ${total}/10</span>` : ''}
      </div>
    </div>

    <div class="modal-body-grid">
      <!-- 左栏：翻译 + 分析 -->
      <div class="modal-body-left">
        ${p.verdict ? `
        <div class="modal-section">
          <div class="modal-section-label">🎯 观点结论</div>
          <div class="modal-verdict ${verdictClass}">${p.verdict}</div>
        </div>` : ''}

        <div class="modal-section">
          <div class="modal-section-label">📝 原帖正文（中文翻译）</div>
          <div class="modal-desc">${p.content_zh || p.content_snippet || '（无正文）'}</div>
        </div>

        <div class="modal-section">
          <div class="modal-section-label">💬 评论区观点</div>
          <div class="modal-desc">${p.comments_summary || '（暂无评论数据）'}</div>
        </div>

        <div class="modal-section">
          <div class="modal-section-label">🧠 需求分析</div>
          <div class="modal-desc">${p.summary || '—'}</div>
        </div>

        <div class="modal-section">
          <div class="modal-section-label">💡 产品机会</div>
          <div class="modal-metaphor">${p.opportunity || '—'}</div>
        </div>

        <div class="modal-section">
          <div class="modal-section-label">🏷️ 标签</div>
          <div class="reddit-tags" style="margin-top:6px">${tags || '—'}</div>
        </div>
      </div>

      <!-- 右栏：四维评分 -->
      <div class="modal-body-right">
        <div class="modal-section">
          <div class="modal-section-label">评分详情</div>
          <div class="modal-scores-grid">
            <div class="modal-score-item">
              <div class="modal-score-header">
                <div class="modal-score-name">⚡ Vibecoding 实现难度</div>
                <div class="modal-score-badge">
                  <span class="modal-score-value vibe">${scores.vibecoding || '—'}</span>
                  <span class="modal-score-max">/ 3</span>
                </div>
              </div>
              <div class="modal-score-bar-wrap">
                <div class="modal-score-bar"><div class="modal-score-bar-fill vibe" style="width:${((scores.vibecoding||0)/3)*100}%"></div></div>
              </div>
              <div class="modal-score-reason">用 AI 工具快速实现原型的难易程度</div>
            </div>
            <div class="modal-score-item">
              <div class="modal-score-header">
                <div class="modal-score-name">🏰 逻辑护城河</div>
                <div class="modal-score-badge">
                  <span class="modal-score-value moat">${scores.moat || '—'}</span>
                  <span class="modal-score-max">/ 3</span>
                </div>
              </div>
              <div class="modal-score-bar-wrap">
                <div class="modal-score-bar"><div class="modal-score-bar-fill moat" style="width:${((scores.moat||0)/3)*100}%"></div></div>
              </div>
              <div class="modal-score-reason">产品壁垒：数据/网络效应/算法复杂度</div>
            </div>
            <div class="modal-score-item">
              <div class="modal-score-header">
                <div class="modal-score-name">🎯 赛道契合度</div>
                <div class="modal-score-badge">
                  <span class="modal-score-value track">${scores.track_fit || '—'}</span>
                  <span class="modal-score-max">/ 2</span>
                </div>
              </div>
              <div class="modal-score-bar-wrap">
                <div class="modal-score-bar"><div class="modal-score-bar-fill track" style="width:${((scores.track_fit||0)/2)*100}%"></div></div>
              </div>
              <div class="modal-score-reason">AI/SaaS/消费互联网等热门赛道契合度</div>
            </div>
            <div class="modal-score-item">
              <div class="modal-score-header">
                <div class="modal-score-name">📈 增长潜力</div>
                <div class="modal-score-badge">
                  <span class="modal-score-value growth">${scores.growth || '—'}</span>
                  <span class="modal-score-max">/ 2</span>
                </div>
              </div>
              <div class="modal-score-bar-wrap">
                <div class="modal-score-bar"><div class="modal-score-bar-fill growth" style="width:${((scores.growth||0)/2)*100}%"></div></div>
              </div>
              <div class="modal-score-reason">潜在用户规模与市场增长空间</div>
            </div>
          </div>
          <div class="modal-total">
            <span class="modal-total-label">综合总分</span>
            <div>
              <span class="modal-total-value">${total}</span>
              <span class="modal-total-denom"> / 10</span>
            </div>
          </div>
        </div>

        <div class="modal-section" style="margin-top:16px">
          <div class="modal-section-label">🔥 热度评分</div>
          <div class="reddit-heat-detail">
            <div class="heat-dots-row">${heatBar}</div>
            <span class="heat-score-big heat-${p.heat_score || 1}">${p.heat_score || 1} / 5</span>
            <div class="modal-score-reason">${p.heat_reason || ''}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);