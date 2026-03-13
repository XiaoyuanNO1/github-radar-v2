/* ===== app.js — GitHub AI 雷达前端逻辑 ===== */

const DATA_URL = './radar_history.json';

// ===== 全局状态 =====
let allProjects = [];
let currentSort = { key: 'total', dir: 'desc' };
let searchQuery = '';
let trackFilter = 'all';
let currentPage = 1;       // 新增：当前页
const PAGE_SIZE = 15;      // 新增：每页条数

// ===== 初始化 =====
async function init() {
  try {
    const res = await fetch(DATA_URL + '?t=' + Date.now());
    if (!res.ok) throw new Error('数据加载失败');
    allProjects = await res.json();

    updateLastUpdate();
    updateStats();       // 新增：更新统计看板
    buildDateOptions();
    renderTop3();
    renderHistory();
    bindEvents();
  } catch (e) {
    console.error(e);
    document.getElementById('top3-grid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1"><div class="icon">⚠️</div><p>数据加载失败，请确认 radar_history.json 与 index.html 在同一目录</p></div>`;
    document.getElementById('history-tbody').innerHTML =
      `<tr><td colspan="9" class="loading-cell"><div class="empty-state"><div class="icon">⚠️</div><p>无数据</p></div></td></tr>`;
  }
}

// ===== 更新统计看板 =====
function updateStats() {
  if (!allProjects.length) return;
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();
  const latestDate = dates[0];
  const todayProjects = allProjects.filter(p => p.date === latestDate);

  // 累计归档
  document.getElementById('stat-total').textContent = allProjects.length;
  // 今日新增
  document.getElementById('stat-today').textContent = todayProjects.length;
  // 已扫描天数
  document.getElementById('stat-days').textContent = dates.length;
  // 今日均分
  const avg = todayProjects.length
    ? (todayProjects.reduce((s, p) => s + p.scores.total, 0) / todayProjects.length).toFixed(1)
    : '—';
  document.getElementById('stat-avg').textContent = avg;
  // 今日最高分
  const topScore = todayProjects.length
    ? Math.max(...todayProjects.map(p => p.scores.total))
    : '—';
  document.getElementById('stat-top-score').textContent = topScore;
}

// ===== 更新最后更新时间 =====
function updateLastUpdate() {
  if (!allProjects.length) return;
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();
  const latest = dates[0];
  document.getElementById('last-update').textContent = `最近更新：${latest}`;
}

// ===== 构建日期选项 =====
function buildDateOptions() {
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();
  const sel = document.getElementById('top3-date');
  dates.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d + (i === 0 ? ' (最新)' : '');
    sel.appendChild(opt);
  });
}

// ===== 渲染 Top 3 =====
function renderTop3(date) {
  const dates = [...new Set(allProjects.map(p => p.date))].sort().reverse();
  const targetDate = date || dates[0];

  // 取当天 is_top 项目，不足则按分数补，最终按总分降序排列
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
        <span class="card-date">${p.date}</span>
      </div>
    </div>`;
  }).join('');
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

  // 搜索过滤
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.raw_description || '').toLowerCase().includes(q)
    );
  }

  // 赛道标签过滤
  if (trackFilter === 'top') {
    data = data.filter(p => p.is_top);
  } else if (trackFilter === 'high') {
    data = data.filter(p => p.scores.total >= 8);
  } else if (trackFilter === 'vibe') {
    data = data.filter(p => p.scores.vibecoding_ease >= 3);
  } else if (trackFilter === 'growth') {
    data = data.filter(p => p.scores.growth_potential >= 2);
  }

  // 排序
  const { key, dir } = currentSort;
  data.sort((a, b) => {
    let va, vb;
    if (key === 'date') {
      va = a.date; vb = b.date;
    } else if (key === 'title') {
      va = a.title.toLowerCase(); vb = b.title.toLowerCase();
    } else if (key === 'total') {
      va = a.scores.total; vb = b.scores.total;
    } else if (key === 'vibecoding_ease') {
      va = a.scores.vibecoding_ease; vb = b.scores.vibecoding_ease;
    } else if (key === 'logic_moat') {
      va = a.scores.logic_moat; vb = b.scores.logic_moat;
    } else if (key === 'track_fit') {
      va = a.scores.track_fit; vb = b.scores.track_fit;
    } else if (key === 'growth_potential') {
      va = a.scores.growth_potential; vb = b.scores.growth_potential;
    }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  // 分页计算
  const totalItems = data.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageData = data.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('history-tbody');

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="icon">🔍</div><p>没有找到匹配的项目</p></div></td></tr>`;
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
      <td class="col-score"><span class="score-chip total ${scoreClass(s.total, 10)}">${s.total}</span></td>
      <td class="col-score"><span class="score-chip ${scoreClass(s.vibecoding_ease, 3)}">${s.vibecoding_ease}</span></td>
      <td class="col-score"><span class="score-chip ${scoreClass(s.logic_moat, 3)}">${s.logic_moat}</span></td>
      <td class="col-score"><span class="score-chip ${scoreClass(s.track_fit, 2)}">${s.track_fit}</span></td>
      <td class="col-score"><span class="score-chip ${scoreClass(s.growth_potential, 2)}">${s.growth_potential}</span></td>
      <td class="col-top"><span class="top-badge">${p.is_top ? '🏆' : ''}</span></td>
    </tr>`;
  }).join('');

  renderPagination(currentPage, totalPages, totalItems);
}

// ===== 渲染分页控件 =====
function renderPagination(page, totalPages, totalItems) {
  let el = document.getElementById('pagination');
  if (!el) return;

  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalItems);

  // 生成页码按钮（最多显示7个）
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

// ===== 跳转页码 =====
function goPage(p) {
  currentPage = p;
  renderHistory();
  // 平滑滚动到表格顶部
  document.getElementById('history-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== 打开 Modal =====
function openModal(id) {
  const p = allProjects.find(x => x.id === id);
  if (!p) return;
  const s = p.scores;
  const r = p.score_reasons || {};

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <div class="modal-rank-label">${p.is_top ? '🏆 今日精选' : '📦 归档项目'} · ${p.date}</div>
      <div class="modal-title">
        <a href="${p.url}" target="_blank">${p.title}</a>
      </div>
    </div>

    <div class="modal-body-grid">
      <!-- 左栏：简介 + 比喻 + 链接 -->
      <div class="modal-body-left">
        <div class="modal-section">
          <div class="modal-section-label">项目简介</div>
          <div class="modal-desc">${p.description}</div>
        </div>
        <div class="modal-section">
          <div class="modal-section-label">生动比喻</div>
          <div class="modal-metaphor">${p.metaphor}</div>
        </div>
        <a href="${p.url}" target="_blank" class="modal-link-btn">
          🔗 前往 GitHub 查看项目
        </a>
      </div>

      <!-- 右栏：评分详情 -->
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
}

// ===== 关闭 Modal =====
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ===== 绑定事件 =====
function bindEvents() {
  // 日期切换
  document.getElementById('top3-date').addEventListener('change', e => {
    renderTop3(e.target.value);
  });

  // 搜索
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    currentPage = 1;  // 搜索时重置页码
    renderHistory();
  });

  // 下拉排序
  document.getElementById('sort-select').addEventListener('change', e => {
    const val = e.target.value;
    const [key, dir] = val.split('_').length === 2
      ? val.split('_')
      : [val.replace(/_desc$|_asc$/, ''), val.endsWith('asc') ? 'asc' : 'desc'];

    // 特殊处理 vibecoding_ease / logic_moat / growth_potential
    if (val === 'vibecoding_desc') {
      currentSort = { key: 'vibecoding_ease', dir: 'desc' };
    } else if (val === 'logic_desc') {
      currentSort = { key: 'logic_moat', dir: 'desc' };
    } else if (val === 'growth_desc') {
      currentSort = { key: 'growth_potential', dir: 'desc' };
    } else {
      currentSort = { key, dir };
    }
    currentPage = 1;  // 排序时重置页码
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
      currentPage = 1;  // 排序时重置页码
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
    currentPage = 1;  // 筛选时重置页码
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

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);