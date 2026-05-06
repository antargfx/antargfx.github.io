/**
 * FinTrack — script.js
 * Personal Finance Tracker with Supabase sync + offline localStorage
 *
 * Architecture:
 *  - Config       → Supabase credentials
 *  - DB           → Supabase client wrapper
 *  - Auth         → sign-up / sign-in / logout
 *  - Store        → in-memory state + localStorage cache
 *  - Sync         → bi-directional Supabase sync
 *  - UI           → render functions
 *  - Charts       → Canvas API charts
 *  - CSV          → import / export
 *  - Shortcuts    → keyboard shortcuts
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* ============================================================
   ── CONFIG ── Replace these with your Supabase project values
   ============================================================ */
const SUPABASE_URL     = 'https://vucizbieqiwhbtewqphz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1Y2l6YmllcWl3aGJ0ZXdxcGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNDEyMjMsImV4cCI6MjA5MzYxNzIyM30.MOBUmM2flJAQnYZwWuT4-SOZq1TXCTQu7bl5DG3B7e8';

/* ── Storage Keys ─────────────────────────────────────────── */
const LS_CACHE    = 'finance_tracker_cache';
const LS_UNSYNCED = 'finance_tracker_unsynced';
const LS_THEME    = 'fintrack_theme';
const LS_LASTSYNCED = 'fintrack_last_synced';
const LS_OFFLINE_USER = 'fintrack_offline_user';

/* ── Supabase Client ──────────────────────────────────────── */
let supabase = null;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.warn('Supabase init failed (offline mode):', e.message);
}

/* ============================================================
   ── STORE  (in-memory state)
   ============================================================ */
const Store = {
  transactions: [],   // all local transactions
  user: null,         // current auth user (or null for offline)
  isOfflineMode: false,
  currentView: 'dashboard',
  editingId: null,
  currentMonth: new Date(),
  filters: { search: '', type: '', category: '', from: '', to: '' },

  // Load from localStorage
  load() {
    try {
      const raw = localStorage.getItem(LS_CACHE);
      this.transactions = raw ? JSON.parse(raw) : [];
    } catch { this.transactions = []; }
  },

  // Save to localStorage
  save() {
    localStorage.setItem(LS_CACHE, JSON.stringify(this.transactions));
  },

  // Get unsynced records
  getUnsynced() {
    return this.transactions.filter(t => !t.synced);
  },

  // Mark all as synced
  markAllSynced() {
    this.transactions = this.transactions.map(t => ({ ...t, synced: true }));
    this.save();
  },

  // Upsert a transaction
  upsert(tx) {
    const idx = this.transactions.findIndex(t => t.id === tx.id);
    if (idx >= 0) this.transactions[idx] = tx;
    else this.transactions.unshift(tx);
    this.save();
  },

  // Delete a transaction
  remove(id) {
    this.transactions = this.transactions.filter(t => t.id !== id);
    this.save();
  },

  // Get categories
  getCategories() {
    return [...new Set(this.transactions.map(t => t.category).filter(Boolean))].sort();
  },

  // Filtered transactions
  getFiltered() {
    const { search, type, category, from, to } = this.filters;
    return this.transactions.filter(t => {
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (type && t.type !== type) return false;
      if (category && t.category !== category) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      return true;
    });
  },

  // Transactions for a given month
  getByMonth(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const prefix = `${y}-${m}`;
    return this.transactions.filter(t => t.date && t.date.startsWith(prefix));
  },

  // Totals helper
  totals(list) {
    return list.reduce((acc, t) => {
      if (t.type === 'earning') acc.earnings += parseFloat(t.amount) || 0;
      else acc.expenses += parseFloat(t.amount) || 0;
      return acc;
    }, { earnings: 0, expenses: 0 });
  }
};

/* ============================================================
   ── UTILITY helpers
   ============================================================ */
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ============================================================
   ── TOAST
   ============================================================ */
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fadeout');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

/* ============================================================
   ── AUTH
   ============================================================ */
const Auth = {
  async signIn(email, password) {
    if (!supabase) throw new Error('No Supabase connection');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  },

  async signUp(email, password) {
    if (!supabase) throw new Error('No Supabase connection');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  },

  async signOut() {
    if (supabase) await supabase.auth.signOut();
    Store.user = null;
    Store.isOfflineMode = false;
    Store.transactions = [];
    Store.save();
    showAuthScreen();
  },

  async getUser() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getUser();
    return data.user || null;
  }
};

/* ============================================================
   ── SYNC
   ============================================================ */
const Sync = {
  isSyncing: false,

  // Push unsynced local records to Supabase
  async push() {
    if (!supabase || !Store.user || !navigator.onLine) return;
    const unsynced = Store.getUnsynced();
    if (!unsynced.length) return;

    const rows = unsynced.map(t => ({
      id: t.id,
      user_id: Store.user.id,
      type: t.type,
      title: t.title,
      amount: t.amount,
      category: t.category || 'General',
      date: t.date,
      synced: true,
      created_at: t.created_at,
      updated_at: t.updated_at
    }));

    const { error } = await supabase.from('transactions').upsert(rows, { onConflict: 'id' });
    if (!error) Store.markAllSynced();
  },

  // Pull latest from Supabase
  async pull() {
    if (!supabase || !Store.user || !navigator.onLine) return;
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', Store.user.id)
      .order('date', { ascending: false });

    if (error || !data) return;

    // Merge: keep local unsynced, add/update from remote
    const localUnsynced = Store.getUnsynced();
    const localUnsyncedIds = new Set(localUnsynced.map(t => t.id));

    const remote = data.map(t => ({ ...t, synced: true }));
    const merged = [...localUnsynced];
    for (const r of remote) {
      if (!localUnsyncedIds.has(r.id)) merged.push(r);
    }
    merged.sort((a, b) => new Date(b.date) - new Date(a.date));
    Store.transactions = merged;
    Store.save();
  },

  async syncNow() {
    if (this.isSyncing || !navigator.onLine) return;
    this.isSyncing = true;
    setSyncStatus('syncing');
    try {
      await this.push();
      await this.pull();
      const now = new Date().toLocaleTimeString();
      localStorage.setItem(LS_LASTSYNCED, now);
      document.getElementById('last-synced').textContent = `Last synced: ${now}`;
      setSyncStatus('synced');
      renderAll();
    } catch (e) {
      console.error('Sync error:', e);
      setSyncStatus('offline');
    }
    this.isSyncing = false;
  },

  // Delete from Supabase
  async delete(id) {
    if (!supabase || !Store.user || !navigator.onLine) return;
    await supabase.from('transactions').delete().eq('id', id).eq('user_id', Store.user.id);
  }
};

/* ============================================================
   ── TRANSACTION CRUD
   ============================================================ */
async function saveTransaction(data) {
  const isEdit = !!Store.editingId;
  const now = new Date().toISOString();

  const tx = {
    id: isEdit ? Store.editingId : uuid(),
    type: data.type,
    title: data.title.trim(),
    amount: parseFloat(data.amount),
    category: (data.category || 'General').trim(),
    date: data.date,
    synced: false,
    created_at: isEdit
      ? (Store.transactions.find(t => t.id === Store.editingId)?.created_at || now)
      : now,
    updated_at: now
  };

  Store.upsert(tx);
  toast(isEdit ? 'Transaction updated!' : 'Transaction added!', 'success');

  if (navigator.onLine && !Store.isOfflineMode) {
    await Sync.syncNow();
  } else {
    renderAll();
  }
}

async function deleteTransaction(id) {
  Store.remove(id);
  if (navigator.onLine && !Store.isOfflineMode) {
    await Sync.delete(id);
    await Sync.syncNow();
  } else {
    renderAll();
  }
  toast('Transaction deleted.', 'warning');
}

/* ============================================================
   ── RENDER
   ============================================================ */
function renderAll() {
  renderSummaryCards();
  renderMonthlySummary();
  renderRecentList();
  renderTransactionList();
  renderCategoryChart();
  renderMonthlyBarChart();
  renderAnalyticsGrid();
  updateCategoryFilter();
}

function renderSummaryCards() {
  const { earnings, expenses } = Store.totals(Store.transactions);
  const net = earnings - expenses;
  document.getElementById('total-earnings').textContent = fmt(earnings);
  document.getElementById('total-expenses').textContent = fmt(expenses);
  document.getElementById('net-balance').textContent = fmt(net);
  document.getElementById('net-balance').className = 'card-value ' + (net >= 0 ? 'text-green' : 'text-red');
  document.getElementById('tx-count').textContent = Store.transactions.length;
}

function renderMonthlySummary() {
  const monthTx = Store.getByMonth(Store.currentMonth);
  const { earnings, expenses } = Store.totals(monthTx);
  const savings = earnings - expenses;
  document.getElementById('month-earnings').textContent = fmt(earnings);
  document.getElementById('month-expenses').textContent = fmt(expenses);
  const savEl = document.getElementById('month-savings');
  savEl.textContent = fmt(savings);
  savEl.className = 'mc-value ' + (savings >= 0 ? 'text-green' : 'text-red');

  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('current-month-label').textContent =
    `${months[Store.currentMonth.getMonth()]} ${Store.currentMonth.getFullYear()}`;
}

function renderTxItem(tx) {
  const div = document.createElement('div');
  div.className = 'tx-item';
  div.dataset.id = tx.id;
  const unsyncedBadge = !tx.synced ? '<span class="unsynced-badge" title="Not synced"></span>' : '';
  div.innerHTML = `
    <div class="tx-type-dot ${tx.type}">${tx.type === 'earning' ? '▲' : '▼'}</div>
    <div class="tx-info">
      <div class="tx-title">${escHtml(tx.title)}${unsyncedBadge}</div>
      <div class="tx-meta">
        <span class="tx-category">${escHtml(tx.category || 'General')}</span>
        <span>${fmtDate(tx.date)}</span>
      </div>
    </div>
    <div class="tx-amount ${tx.type}">${tx.type === 'earning' ? '+' : '-'}${fmt(tx.amount)}</div>
    <div class="tx-actions">
      <button class="tx-action-btn edit" title="Edit" data-id="${tx.id}">✎</button>
      <button class="tx-action-btn delete" title="Delete" data-id="${tx.id}">✕</button>
    </div>`;
  return div;
}

function renderRecentList() {
  const container = document.getElementById('recent-list');
  container.innerHTML = '';
  const recent = Store.transactions.slice(0, 6);
  if (!recent.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">◈</div><p>No transactions yet</p></div>';
    return;
  }
  recent.forEach(tx => container.appendChild(renderTxItem(tx)));
  attachTxActions(container);
}

function renderTransactionList() {
  const container = document.getElementById('tx-list');
  const empty = document.getElementById('tx-empty');
  container.innerHTML = '';
  const filtered = Store.getFiltered();
  document.getElementById('tx-count-label').textContent =
    `${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  filtered.forEach(tx => container.appendChild(renderTxItem(tx)));
  attachTxActions(container);
}

function attachTxActions(container) {
  container.querySelectorAll('.tx-action-btn.edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
  container.querySelectorAll('.tx-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
  });
}

function updateCategoryFilter() {
  const sel = document.getElementById('filter-category');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>';
  Store.getCategories().forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    if (cat === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

/* ============================================================
   ── CHARTS (Canvas API)
   ============================================================ */
function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    text: isDark ? '#888898' : '#5a5a70',
    grid: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    bg:   isDark ? '#16161f' : '#ffffff'
  };
}

const PALETTE = [
  '#6c63ff','#22d3a0','#ff5e7e','#38b2f5','#f5a623',
  '#a78bfa','#34d399','#fb7185','#60a5fa','#fbbf24'
];

function renderCategoryChart() {
  const canvas = document.getElementById('category-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 700;
  const H = 260;
  canvas.width = W * window.devicePixelRatio;
  canvas.height = H * window.devicePixelRatio;
  canvas.style.height = H + 'px';
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.clearRect(0, 0, W, H);

  const expenses = Store.transactions.filter(t => t.type === 'expense');
  if (!expenses.length) {
    const colors = getChartColors();
    ctx.fillStyle = colors.text;
    ctx.font = '14px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No expense data yet', W / 2, H / 2);
    document.getElementById('chart-legend').innerHTML = '';
    return;
  }

  // Aggregate by category
  const byCategory = {};
  expenses.forEach(t => {
    const cat = t.category || 'General';
    byCategory[cat] = (byCategory[cat] || 0) + parseFloat(t.amount);
  });
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  // Draw horizontal bar chart
  const padL = 140, padR = 80, padT = 20, barH = 22, gap = 10;
  const chartW = W - padL - padR;
  const colors = getChartColors();

  sorted.forEach(([cat, val], i) => {
    const y = padT + i * (barH + gap);
    const barW = (val / total) * chartW;
    const color = PALETTE[i % PALETTE.length];

    // Label
    ctx.fillStyle = colors.text;
    ctx.font = '12px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(cat.length > 16 ? cat.slice(0, 14) + '…' : cat, padL - 8, y + barH / 2 + 4);

    // Bar background
    ctx.fillStyle = colors.grid;
    ctx.beginPath();
    ctx.roundRect(padL, y, chartW, barH, 4);
    ctx.fill();

    // Bar fill
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(padL, y, Math.max(barW, 4), barH, 4);
    ctx.fill();

    // Value
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';
    ctx.font = '11px Space Mono, monospace';
    ctx.fillText(fmt(val), padL + barW + 6, y + barH / 2 + 4);
  });

  // Legend
  const legendEl = document.getElementById('chart-legend');
  legendEl.innerHTML = sorted.map(([cat], i) =>
    `<div class="legend-item">
      <div class="legend-dot" style="background:${PALETTE[i % PALETTE.length]}"></div>
      <span>${escHtml(cat)}</span>
    </div>`
  ).join('');
}

function renderMonthlyBarChart() {
  const canvas = document.getElementById('monthly-bar-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 700;
  const H = 300;
  canvas.width = W * window.devicePixelRatio;
  canvas.height = H * window.devicePixelRatio;
  canvas.style.height = H + 'px';
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  ctx.clearRect(0, 0, W, H);
  const colors = getChartColors();

  // Build last 6 months data
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const label = d.toLocaleDateString('en-US', { month: 'short' });
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const prefix = `${y}-${m}`;
    const txs = Store.transactions.filter(t => t.date && t.date.startsWith(prefix));
    const { earnings, expenses } = Store.totals(txs);
    months.push({ label, earnings, expenses });
  }

  const maxVal = Math.max(...months.flatMap(m => [m.earnings, m.expenses]), 1);
  const padL = 56, padR = 20, padT = 20, padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const groupW = chartW / months.length;
  const barW = Math.min((groupW - 20) / 2, 30);

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i;
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    const val = maxVal * (1 - i / 4);
    ctx.fillStyle = colors.text;
    ctx.font = '10px Space Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val >= 1000 ? `$${(val/1000).toFixed(1)}k` : `$${val.toFixed(0)}`, padL - 6, y + 4);
  }

  months.forEach((m, i) => {
    const cx = padL + i * groupW + groupW / 2;
    const drawBar = (val, offsetX, color) => {
      const bH = (val / maxVal) * chartH;
      const x = cx + offsetX - barW / 2;
      const y = padT + chartH - bH;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, bH, [4, 4, 0, 0]);
      ctx.fill();
    };
    drawBar(m.earnings, -barW / 2 - 2, '#22d3a0');
    drawBar(m.expenses,  barW / 2 + 2, '#ff5e7e');

    ctx.fillStyle = colors.text;
    ctx.font = '11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(m.label, cx, H - padB + 16);
  });

  // Legend
  ctx.fillStyle = '#22d3a0';
  ctx.fillRect(padL, H - padB + 24, 10, 10);
  ctx.fillStyle = colors.text;
  ctx.font = '11px Outfit, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Earnings', padL + 14, H - padB + 33);
  ctx.fillStyle = '#ff5e7e';
  ctx.fillRect(padL + 80, H - padB + 24, 10, 10);
  ctx.fillStyle = colors.text;
  ctx.fillText('Expenses', padL + 94, H - padB + 33);
}

function renderAnalyticsGrid() {
  const container = document.getElementById('analytics-grid');
  if (!container) return;
  const byCategory = {};
  Store.transactions.forEach(t => {
    const cat = t.category || 'General';
    if (!byCategory[cat]) byCategory[cat] = { earnings: 0, expenses: 0 };
    if (t.type === 'earning') byCategory[cat].earnings += parseFloat(t.amount);
    else byCategory[cat].expenses += parseFloat(t.amount);
  });

  const entries = Object.entries(byCategory).sort((a, b) =>
    (b[1].earnings + b[1].expenses) - (a[1].earnings + a[1].expenses)
  );
  const total = entries.reduce((s, [, v]) => s + v.earnings + v.expenses, 0) || 1;

  container.innerHTML = entries.map(([cat, vals], i) => {
    const sum = vals.earnings + vals.expenses;
    const pct = ((sum / total) * 100).toFixed(1);
    const color = PALETTE[i % PALETTE.length];
    return `<div class="analytics-card">
      <div class="analytics-card-title">${escHtml(cat)}</div>
      <div class="analytics-bar-wrap">
        <div class="analytics-bar" style="width:${pct}%;background:${color}"></div>
      </div>
      <div>
        <span class="analytics-amount" style="color:${color}">${fmt(sum)}</span>
        <span class="analytics-pct">${pct}%</span>
      </div>
    </div>`;
  }).join('');
}

/* ============================================================
   ── MODAL
   ============================================================ */
function openAddModal() {
  Store.editingId = null;
  document.getElementById('modal-title').textContent = 'Add Transaction';
  document.getElementById('tx-title').value = '';
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-date').value = today();
  document.getElementById('tx-category').value = '';
  // Reset type toggle
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.type-btn[data-type="expense"]').classList.add('active');
  document.getElementById('tx-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('tx-title').focus(), 50);
}

function openEditModal(id) {
  const tx = Store.transactions.find(t => t.id === id);
  if (!tx) return;
  Store.editingId = id;
  document.getElementById('modal-title').textContent = 'Edit Transaction';
  document.getElementById('tx-title').value = tx.title;
  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-date').value = tx.date;
  document.getElementById('tx-category').value = tx.category || '';
  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === tx.type);
  });
  document.getElementById('tx-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('tx-title').focus(), 50);
}

function closeModal() {
  document.getElementById('tx-modal').classList.add('hidden');
  Store.editingId = null;
}

function confirmDelete(id) {
  const tx = Store.transactions.find(t => t.id === id);
  document.getElementById('confirm-message').textContent =
    `Delete "${tx?.title || 'transaction'}"? This cannot be undone.`;
  document.getElementById('confirm-modal').classList.remove('hidden');
  document.getElementById('confirm-ok').onclick = async () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    await deleteTransaction(id);
  };
}

/* ============================================================
   ── CSV
   ============================================================ */
function exportCSV() {
  const rows = [['id','title','amount','type','category','date']];
  Store.getFiltered().forEach(t => {
    rows.push([t.id, `"${t.title.replace(/"/g,'""')}"`, t.amount, t.type,
      `"${(t.category||'').replace(/"/g,'""')}"`, t.date]);
  });
  const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fintrack_${today()}.csv`;
  a.click();
  toast('CSV exported!', 'success');
}

async function importCSV(file) {
  try {
    const text = await file.text();
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g,''));
    const get = (row, key) => {
      const i = headers.indexOf(key);
      return i >= 0 ? row[i]?.trim().replace(/^"|"$/g, '').replace(/""/g, '"') : '';
    };
    let imported = 0, skipped = 0;
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$)/g) || lines[i].split(',');
      const title    = get(row, 'title');
      const amountRaw = parseFloat(get(row, 'amount'));
      const type     = get(row, 'type');
      const category = get(row, 'category') || 'General';
      const date     = get(row, 'date') || today();

      if (!title || isNaN(amountRaw) || !['expense','earning'].includes(type)) {
        skipped++; continue;
      }
      const tx = {
        id: uuid(), type, title, amount: amountRaw,
        category, date, synced: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      Store.upsert(tx);
      imported++;
    }
    toast(`Imported ${imported} transaction${imported !== 1 ? 's' : ''}${skipped ? ` (${skipped} skipped)` : ''}`, 'success');
    if (navigator.onLine && !Store.isOfflineMode) await Sync.syncNow();
    else renderAll();
  } catch (e) {
    toast('CSV import failed: ' + e.message, 'error');
  }
}

/* ============================================================
   ── SYNC STATUS UI
   ============================================================ */
function setSyncStatus(state) {
  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  dot.className = 'sync-dot ' + state;
  if (state === 'synced')  label.textContent = 'Synced';
  if (state === 'syncing') label.textContent = 'Syncing…';
  if (state === 'offline') label.textContent = 'Offline';
  if (state === 'local')   label.textContent = 'Local only';
}

function updateOnlineIndicator() {
  const el = document.getElementById('online-indicator');
  const lbl = document.getElementById('online-label');
  if (navigator.onLine) {
    el.classList.remove('offline');
    lbl.textContent = 'Online';
  } else {
    el.classList.add('offline');
    lbl.textContent = 'Offline';
  }
}

/* ============================================================
   ── NAVIGATION
   ============================================================ */
function switchView(viewName) {
  Store.currentView = viewName;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const viewEl = document.getElementById('view-' + viewName);
  if (viewEl) viewEl.classList.add('active');

  document.querySelectorAll(`.nav-item[data-view="${viewName}"]`).forEach(n =>
    n.classList.add('active')
  );

  const titles = { dashboard: 'Dashboard', transactions: 'Transactions', analytics: 'Analytics' };
  document.getElementById('topbar-title').textContent = titles[viewName] || viewName;

  // Re-render charts when their view becomes visible
  if (viewName === 'dashboard') { renderCategoryChart(); renderMonthlyBarChart(); }
  if (viewName === 'analytics') { renderMonthlyBarChart(); renderAnalyticsGrid(); }

  closeSidebar();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('visible');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

/* ============================================================
   ── AUTH SCREEN
   ============================================================ */
function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}
function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('danger-zone').classList.remove('hidden');
}

/* ============================================================
   ── THEME
   ============================================================ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-icon').textContent = theme === 'dark' ? '☀' : '☾';
  localStorage.setItem(LS_THEME, theme);
}
function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme');
  applyTheme(curr === 'dark' ? 'light' : 'dark');
  // Redraw charts for new theme
  setTimeout(() => { renderCategoryChart(); renderMonthlyBarChart(); }, 100);
}

/* ============================================================
   ── INIT
   ============================================================ */
async function init() {
  // Apply saved theme
  applyTheme(localStorage.getItem(LS_THEME) || 'dark');

  // Last synced timestamp
  const ls = localStorage.getItem(LS_LASTSYNCED);
  if (ls) document.getElementById('last-synced').textContent = `Last synced: ${ls}`;

  // Load local data
  Store.load();

  // Try to restore auth session
  let user = null;
  const offlineUser = localStorage.getItem(LS_OFFLINE_USER);

  if (supabase && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    try {
      user = await Auth.getUser();
    } catch (e) {
      console.warn('Could not restore session:', e.message);
    }
  }

  if (user) {
    Store.user = user;
    Store.isOfflineMode = false;
    showApp();
    document.getElementById('user-info').textContent = user.email;
    renderAll();
    if (navigator.onLine) await Sync.syncNow();
    else setSyncStatus('offline');
  } else if (offlineUser === 'true') {
    Store.isOfflineMode = true;
    showApp();
    setSyncStatus('local');
    renderAll();
  } else {
    showAuthScreen();
  }

  updateOnlineIndicator();
  bindEvents();
  registerServiceWorker();
}

/* ============================================================
   ── EVENT BINDINGS
   ============================================================ */
function bindEvents() {

  // ── Auth tabs ──
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + '-form').classList.add('active');
    });
  });

  // ── Sign In ──
  document.getElementById('signin-btn').addEventListener('click', async () => {
    const email = document.getElementById('signin-email').value.trim();
    const pass  = document.getElementById('signin-password').value;
    const errEl = document.getElementById('signin-error');
    errEl.classList.add('hidden');

    if (!email || !pass) { errEl.textContent = 'Please fill in all fields.'; errEl.classList.remove('hidden'); return; }

    const btn = document.getElementById('signin-btn');
    btn.querySelector('.btn-text').classList.add('hidden');
    btn.querySelector('.btn-spinner').classList.remove('hidden');

    try {
      const user = await Auth.signIn(email, pass);
      Store.user = user;
      Store.isOfflineMode = false;
      localStorage.removeItem(LS_OFFLINE_USER);
      showApp();
      document.getElementById('user-info').textContent = user.email;
      await Sync.syncNow();
      renderAll();
      toast('Welcome back!', 'success');
    } catch (e) {
      errEl.textContent = e.message || 'Sign in failed.';
      errEl.classList.remove('hidden');
    } finally {
      btn.querySelector('.btn-text').classList.remove('hidden');
      btn.querySelector('.btn-spinner').classList.add('hidden');
    }
  });

  // ── Sign Up ──
  document.getElementById('signup-btn').addEventListener('click', async () => {
    const email   = document.getElementById('signup-email').value.trim();
    const pass    = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    const errEl   = document.getElementById('signup-error');
    const sucEl   = document.getElementById('signup-success');
    errEl.classList.add('hidden');
    sucEl.classList.add('hidden');

    if (!email || !pass || !confirm) { errEl.textContent = 'Please fill in all fields.'; errEl.classList.remove('hidden'); return; }
    if (pass.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; errEl.classList.remove('hidden'); return; }
    if (pass !== confirm) { errEl.textContent = 'Passwords do not match.'; errEl.classList.remove('hidden'); return; }

    const btn = document.getElementById('signup-btn');
    btn.querySelector('.btn-text').classList.add('hidden');
    btn.querySelector('.btn-spinner').classList.remove('hidden');

    try {
      await Auth.signUp(email, pass);
      sucEl.classList.remove('hidden');
      toast('Account created! Check your email.', 'success');
    } catch (e) {
      errEl.textContent = e.message || 'Sign up failed.';
      errEl.classList.remove('hidden');
    } finally {
      btn.querySelector('.btn-text').classList.remove('hidden');
      btn.querySelector('.btn-spinner').classList.add('hidden');
    }
  });

  // ── Password strength ──
  document.getElementById('signup-password').addEventListener('input', e => {
    const v = e.target.value;
    const el = document.getElementById('password-strength');
    if (!v) { el.className = 'password-strength'; return; }
    if (v.length < 6) el.className = 'password-strength weak';
    else if (v.length < 10 || !/[A-Z]/.test(v) || !/[0-9]/.test(v)) el.className = 'password-strength medium';
    else el.className = 'password-strength strong';
  });

  // ── Offline mode ──
  document.getElementById('offline-btn').addEventListener('click', () => {
    Store.isOfflineMode = true;
    localStorage.setItem(LS_OFFLINE_USER, 'true');
    showApp();
    setSyncStatus('local');
    renderAll();
    toast('Running in offline mode. Data saved locally.', 'warning');
  });

  // ── Logout ──
  document.getElementById('logout-btn').addEventListener('click', async () => {
    localStorage.removeItem(LS_OFFLINE_USER);
    await Auth.signOut();
    toast('Signed out.', 'info');
  });

  // ── Navigation ──
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('view-all-btn')?.addEventListener('click', () => switchView('transactions'));
  document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);

  // ── Sidebar mobile ──
  document.getElementById('menu-toggle').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // ── Theme toggle ──
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // ── Sync button ──
  document.getElementById('sync-btn').addEventListener('click', async () => {
    if (!Store.user) { toast('Sign in to sync.', 'warning'); return; }
    await Sync.syncNow();
    renderAll();
  });

  // ── Add button ──
  document.getElementById('add-btn').addEventListener('click', openAddModal);

  // ── Modal close ──
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', closeModal);

  // ── Type toggle ──
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Modal save ──
  document.getElementById('modal-save').addEventListener('click', async () => {
    const title  = document.getElementById('tx-title').value.trim();
    const amount = document.getElementById('tx-amount').value;
    const date   = document.getElementById('tx-date').value;
    const cat    = document.getElementById('tx-category').value.trim();
    const type   = document.querySelector('.type-btn.active')?.dataset.type || 'expense';

    if (!title) { toast('Please enter a title.', 'error'); return; }
    if (!amount || parseFloat(amount) <= 0) { toast('Please enter a valid amount.', 'error'); return; }
    if (!date) { toast('Please select a date.', 'error'); return; }

    await saveTransaction({ title, amount: parseFloat(amount), date, category: cat || 'General', type });
    closeModal();
  });

  // ── Confirm modal ──
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.add('hidden');
  });
  document.getElementById('confirm-backdrop').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.add('hidden');
  });

  // ── Filters ──
  const applyFilters = () => {
    Store.filters.search   = document.getElementById('search-input').value;
    Store.filters.type     = document.getElementById('filter-type').value;
    Store.filters.category = document.getElementById('filter-category').value;
    Store.filters.from     = document.getElementById('filter-date-from').value;
    Store.filters.to       = document.getElementById('filter-date-to').value;
    renderTransactionList();
  };
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('filter-type').addEventListener('change', applyFilters);
  document.getElementById('filter-category').addEventListener('change', applyFilters);
  document.getElementById('filter-date-from').addEventListener('change', applyFilters);
  document.getElementById('filter-date-to').addEventListener('change', applyFilters);
  document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('filter-type').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    Store.filters = { search:'', type:'', category:'', from:'', to:'' };
    renderTransactionList();
  });

  // ── CSV ──
  document.getElementById('export-btn').addEventListener('click', exportCSV);
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('csv-import-input').click();
  });
  document.getElementById('csv-import-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importCSV(file);
    e.target.value = '';
  });

  // ── Month navigation ──
  document.getElementById('prev-month').addEventListener('click', () => {
    Store.currentMonth.setMonth(Store.currentMonth.getMonth() - 1);
    renderMonthlySummary();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    Store.currentMonth.setMonth(Store.currentMonth.getMonth() + 1);
    renderMonthlySummary();
  });

  // ── Clear all data ──
  document.getElementById('clear-all-btn').addEventListener('click', () => {
    document.getElementById('confirm-message').textContent =
      'This will permanently delete ALL your local transactions. Are you sure?';
    document.getElementById('confirm-modal').classList.remove('hidden');
    document.getElementById('confirm-ok').textContent = 'Clear All';
    document.getElementById('confirm-ok').onclick = async () => {
      document.getElementById('confirm-modal').classList.add('hidden');
      Store.transactions = [];
      Store.save();
      renderAll();
      toast('All local data cleared.', 'warning');
    };
  });

  // ── Online/offline events ──
  window.addEventListener('online', async () => {
    updateOnlineIndicator();
    toast('Back online — syncing…', 'info');
    if (Store.user) await Sync.syncNow();
    renderAll();
  });
  window.addEventListener('offline', () => {
    updateOnlineIndicator();
    setSyncStatus('offline');
    toast('You\'re offline. Changes saved locally.', 'warning');
  });

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', e => {
    // Alt+N = new transaction
    if (e.altKey && e.key === 'n') { e.preventDefault(); openAddModal(); }
    // Alt+T = toggle theme
    if (e.altKey && e.key === 't') { e.preventDefault(); toggleTheme(); }
    // Escape = close modals
    if (e.key === 'Escape') {
      closeModal();
      document.getElementById('confirm-modal').classList.add('hidden');
      closeSidebar();
    }
    // Enter in modal inputs = save
    if (e.key === 'Enter' && !document.getElementById('tx-modal').classList.contains('hidden')) {
      document.getElementById('modal-save').click();
    }
  });

  // ── Window resize → redraw charts ──
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderCategoryChart();
      renderMonthlyBarChart();
    }, 200);
  });

  // ── Auto-save reminder every 30s if unsynced ──
  setInterval(() => {
    if (navigator.onLine && Store.user && Store.getUnsynced().length > 0) {
      Sync.syncNow();
    }
  }, 30000);
}

/* ============================================================
   ── SERVICE WORKER
   ============================================================ */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e =>
      console.warn('SW registration failed:', e)
    );
  }
}

/* ── Start ─── */
init();
