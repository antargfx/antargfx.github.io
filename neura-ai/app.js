(() => {
  'use strict';

  const STORAGE_KEY = 'neura_ai_workspace_v2';
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const COOLDOWN_MS = 60 * 1000;

  const CAPABILITIES = [
    { id: 'coding', label: 'Coding', icon: '⌘' },
    { id: 'reasoning', label: 'Reasoning', icon: '◈' },
    { id: 'writing', label: 'Writing', icon: '✎' },
    { id: 'vision', label: 'Vision', icon: '◉' },
    { id: 'fast', label: 'Fast / General', icon: '⚡' }
  ];

  const VIEW_TITLES = {
    chat: 'Chat',
    arena: 'Model Arena',
    projects: 'Chat Projects',
    files: 'File Analyzer',
    models: 'Model Library',
    prompts: 'Prompt Studio',
    usage: 'Usage Dashboard',
    settings: 'Settings'
  };

  const DEFAULT_PROMPTS = [
    {
      id: 'p_code_review',
      title: 'Code Review & Fix',
      body: 'Review the following code for bugs, security risks, edge cases, and performance issues. Provide corrected code and explain each fix clearly:\n\n'
    },
    {
      id: 'p_summarize',
      title: 'Structured Summary',
      body: 'Summarize the following content into: 1) Key Takeaways, 2) Action Items, and 3) Open Questions:\n\n'
    },
    {
      id: 'p_explain',
      title: 'Step-by-Step Tutor',
      body: 'Explain the following concept clearly from first principles, then give a concrete real-world example:\n\n'
    }
  ];

  const uid = (prefix = 'id') =>
    (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? `${prefix}_${window.crypto.randomUUID()}`
      : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const escapeHtml = (str = '') =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const estimateTokens = (text = '') => Math.max(1, Math.ceil(String(text).length / 4));

  const createEmptyChat = (projectId = '') => ({
    id: uid('chat'),
    title: 'New chat',
    projectId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  });

  function loadState() {
    const fallback = {
      theme: 'dark',
      providers: [],
      capabilities: {},
      projects: [],
      prompts: DEFAULT_PROMPTS.slice(),
      chats: [createEmptyChat()],
      currentChatId: '',
      usage: [],
      settings: {
        autoSelect: true,
        autoFallback: true,
        confirmArena: true,
        selectedRoute: 'auto',
        freeOnlyAuto: false
      }
    };
    fallback.currentChatId = fallback.chats[0].id;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return fallback;

      const state = {
        theme: parsed.theme === 'light' ? 'light' : 'dark',
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
        capabilities: parsed.capabilities && typeof parsed.capabilities === 'object' ? parsed.capabilities : {},
        workingModels: parsed.workingModels && typeof parsed.workingModels === 'object' ? parsed.workingModels : {},
        paidModels: parsed.paidModels && typeof parsed.paidModels === 'object' ? parsed.paidModels : {},
        modelHealth: parsed.modelHealth && typeof parsed.modelHealth === 'object' ? parsed.modelHealth : {},
        modelCooldownUntil: parsed.modelCooldownUntil && typeof parsed.modelCooldownUntil === 'object' ? parsed.modelCooldownUntil : {},
        freeModelOverrides: parsed.freeModelOverrides && typeof parsed.freeModelOverrides === 'object' ? parsed.freeModelOverrides : {},
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        prompts: Array.isArray(parsed.prompts) ? parsed.prompts : DEFAULT_PROMPTS.slice(),
        chats: Array.isArray(parsed.chats) && parsed.chats.length ? parsed.chats : [createEmptyChat()],
        currentChatId: parsed.currentChatId || '',
        usage: Array.isArray(parsed.usage) ? parsed.usage : [],
        settings: {
          autoSelect: parsed.settings?.autoSelect !== false,
          autoFallback: parsed.settings?.autoFallback !== false,
          confirmArena: parsed.settings?.confirmArena !== false,
          selectedRoute: parsed.settings?.selectedRoute || 'auto',
          freeOnlyAuto: parsed.settings?.freeOnlyAuto === true
        }
      };
      if (!state.chats.some(c => c.id === state.currentChatId)) {
        state.currentChatId = state.chats[0].id;
      }
      return state;
    } catch {
      return fallback;
    }
  }

  let state = loadState();
  let pendingAttachments = [];
  let isSending = false;
  let activeMenuProviderId = 'auto';
  let currentPreviewCode = '';
  let lastExtractedFileText = '';
  let lastExtractedFileName = '';
  const cooldowns = new Map(); // account-level cooldown only
  const modelCooldowns = new Map(Object.entries(state.modelCooldownUntil || {}).map(([k,v])=>[k,Number(v)||0])); // provider/model scoped temporary cooldowns
  let modelLibraryFilter = 'all';
  const collapsedModelProviders = new Set();
  let pdfJsPromise = null;
  let tesseractPromise = null;

  const $ = (id) => document.getElementById(id);

  // Local-only workspace storage. Each browser profile/device has its own isolated data.
  // IndexedDB is a persistent recovery copy; localStorage remains the fast synchronous source.
  const RECOVERY_DB = 'neura_ai_workspace_recovery_v1';
  const RECOVERY_STORE = 'workspace';
  let recoveryDbPromise = null;
  function openRecoveryDb() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (recoveryDbPromise) return recoveryDbPromise;
    recoveryDbPromise = new Promise(resolve => {
      try {
        const req = indexedDB.open(RECOVERY_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(RECOVERY_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
    return recoveryDbPromise;
  }
  async function writeRecoveryCopy(snapshot) {
    const db = await openRecoveryDb();
    if (!db) return;
    try {
      await new Promise(resolve => {
        const tx = db.transaction(RECOVERY_STORE, 'readwrite');
        tx.objectStore(RECOVERY_STORE).put(snapshot, STORAGE_KEY);
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      });
    } catch { /* localStorage still contains the current workspace */ }
  }
  async function readRecoveryCopy() {
    const db = await openRecoveryDb();
    if (!db) return null;
    try {
      return await new Promise(resolve => {
        const tx = db.transaction(RECOVERY_STORE, 'readonly');
        const req = tx.objectStore(RECOVERY_STORE).get(STORAGE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }
  async function clearRecoveryCopy() {
    const db = await openRecoveryDb();
    if (!db) return;
    try {
      await new Promise(resolve => {
        const tx = db.transaction(RECOVERY_STORE, 'readwrite');
        tx.objectStore(RECOVERY_STORE).delete(STORAGE_KEY);
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      });
    } catch { /* best-effort cleanup */ }
  }
  function saveState() {
    try {
      const snapshot = JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY, snapshot);
      writeRecoveryCopy(snapshot).catch(() => {});
    } catch {
      showToast('Browser storage is full. Export your workspace or clear old chats.');
    }
  }
  // If fast storage is empty, recover the latest workspace from IndexedDB.
  async function recoverWorkspaceIfNeeded() {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const recovered = await readRecoveryCopy();
    if (!recovered) return;
    try {
      const snapshot = typeof recovered === 'string' ? recovered : JSON.stringify(recovered);
      const parsed = JSON.parse(snapshot);
      if (!parsed || typeof parsed !== 'object') return;
      localStorage.setItem(STORAGE_KEY, snapshot);
      state = loadState();
      initUI();
      showToast('Workspace restored from browser recovery storage');
    } catch { /* leave the default workspace available */ }
  }

  const DRAFT_KEY = 'neura_ai_workspace_drafts_v1';
  function loadDrafts() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveDraftForCurrentChat(value) {
    try {
      const drafts = loadDrafts();
      drafts[state.currentChatId] = String(value || '');
      localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
    } catch { /* keep typing uninterrupted if storage is unavailable */ }
  }
  function restoreDraftForCurrentChat() {
    const input = $('messageInput');
    if (!input) return;
    input.value = loadDrafts()[state.currentChatId] || '';
    autoResizeInput();
  }

  // Pull narrowly relevant snippets from other saved chats (same project first).
  // Current-chat messages are already sent as the main conversation history.
  function getRelevantSavedHistory(prompt, currentChat) {
    const stop = new Set(['this','that','with','from','have','your','about','then','when','what','where','which','please','make','add','now','into','also','for','the','and','are','you','can','new','more','it','my','to','of','in','on','a','an']);
    const words = String(prompt || '').toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
    const terms = new Set(words.filter(w => !stop.has(w)));
    if (!terms.size) return '';
    const candidates = state.chats.filter(c => c.id !== currentChat.id && c.messages?.length);
    const ranked = candidates.map(c => {
      const sameProject = !!currentChat.projectId && c.projectId === currentChat.projectId;
      const text = `${c.title || ''} ${c.messages.slice(-8).map(m => m.content || '').join(' ')}`.toLowerCase();
      const hits = [...terms].reduce((n, term) => n + (text.includes(term) ? 1 : 0), 0);
      return { chat: c, sameProject, hits, score: hits + (sameProject ? 3 : 0) };
    }).filter(x => x.score >= 2 || (x.sameProject && x.hits >= 1))
      .sort((a,b) => b.score - a.score || (b.chat.updatedAt || 0) - (a.chat.updatedAt || 0)).slice(0,2);
    if (!ranked.length) return '';
    return ranked.map(({chat}) => {
      const msgs = chat.messages.slice(-4).map(m => `${m.role === 'user' ? 'User' : 'NEURA'}: ${String(m.content || '').slice(0,450)}`).join('\n');
      return `Saved chat: ${chat.title || 'Untitled'}\n${msgs}`;
    }).join('\n\n').slice(0,1800);
  }

  function showToast(msg) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function getCurrentChat() {
    let chat = state.chats.find(c => c.id === state.currentChatId);
    if (!chat) {
      chat = createEmptyChat();
      state.chats.unshift(chat);
      state.currentChatId = chat.id;
      saveState();
    }
    return chat;
  }

  function getProviderModels(provider) {
    const discovered = Array.isArray(provider.discoveredModels) ? provider.discoveredModels : [];
    const manual = Array.isArray(provider.manualModels) ? provider.manualModels : [];
    return [...new Set([...discovered, ...manual].map(m => String(m).trim()).filter(Boolean))];
  }

  function getModelCaps(modelId) {
    return Array.isArray(state.capabilities[modelId]) ? state.capabilities[modelId] : [];
  }

  function modelKey(providerId, modelId) { return `${providerId}::${modelId}`; }
  function getModelHealth(providerId, modelId) { return state.modelHealth[modelKey(providerId, modelId)] || { status: 'untested', testedAt: 0, latency: null, error: '' }; }
  function setModelCooldown(providerId, modelId, until) { const k=modelKey(providerId,modelId); if(until>0) modelCooldowns.set(k,until); else modelCooldowns.delete(k); state.modelCooldownUntil=Object.fromEntries(modelCooldowns); saveState(); }
  function isModelCooling(providerId, modelId) { const k = modelKey(providerId, modelId), until = modelCooldowns.get(k); if (!until) return false; if (Date.now() >= until) { modelCooldowns.delete(k); state.modelCooldownUntil=Object.fromEntries(modelCooldowns); saveState(); return false; } return true; }
  function cooldownRemaining(providerId, modelId) { return Math.max(0, (modelCooldowns.get(modelKey(providerId, modelId)) || 0) - Date.now()); }
  function isWorkingModel(providerId, modelId) { return Boolean(state.workingModels[modelKey(providerId, modelId)]); }
  function isPaidModel(providerId, modelId) { return Boolean(state.paidModels[modelKey(providerId, modelId)]); }
  function setPaidModel(providerId, modelId, paid) { const k=modelKey(providerId,modelId); if(paid) state.paidModels[k]=true; else delete state.paidModels[k]; saveState(); }
  function isFreeModel(providerId, modelId) { const key = modelKey(providerId, modelId), override = state.freeModelOverrides[key]; if (override === 'free') return true; if (override === 'paid') return false; return /(^|:)free($|:)|\bfree\b/i.test(modelId); }
  function setWorkingModel(providerId, modelId, working) { const k = modelKey(providerId, modelId); if (working) state.workingModels[k] = true; else delete state.workingModels[k]; saveState(); }

  function isCoolingDown(providerId) {
    const until = cooldowns.get(providerId);
    if (!until) return false;
    if (Date.now() >= until) {
      cooldowns.delete(providerId);
      return false;
    }
    return true;
  }

  function getActiveProviders(includeCooled = false) {
    return state.providers
      .filter(p => p.enabled !== false && (includeCooled || !isCoolingDown(p.id)))
      .slice()
      .sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99));
  }

  function formatCredit(p) {
    if (p.credit === '' || p.credit === null || p.credit === undefined || Number.isNaN(Number(p.credit))) return '';
    return `${Number(p.credit).toFixed(2)} ${p.currency || 'USD'}`;
  }

  function normalizeBaseUrl(url, type) {
    let clean = String(url || '').trim().replace(/\/+$/, '');
    if (!clean) {
      return type === 'gemini'
        ? 'https://generativelanguage.googleapis.com/v1beta'
        : 'https://api.openai.com/v1';
    }
    if (type === 'gemini' && !/\/v1(beta)?$/i.test(clean)) {
      clean += '/v1beta';
    }
    return clean;
  }

  function applyTheme() {
    document.body.classList.toggle('light', state.theme === 'light');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'light' ? '#f3f5fb' : '#090c16');
  }

  function switchView(view) {
    document.querySelectorAll('.view').forEach(el => el.classList.toggle('hidden', el.id !== `view-${view}`));
    document.querySelectorAll('.nav[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    $('viewName').textContent = VIEW_TITLES[view] || 'Workspace';
    closeMobileSidebar();

    if (view === 'models') renderModelLibrary();
    if (view === 'providers') renderProviders();
    if (view === 'arena') renderArenaSelectors();
    if (view === 'projects') renderProjects();
    if (view === 'prompts') renderPrompts();
    if (view === 'usage') renderUsage();
    if (view === 'settings') syncSettingsUI();
  }

  function openMobileSidebar() {
    $('sidebar').classList.add('open');
    $('sidebarBackdrop').classList.remove('hidden');
  }

  function closeMobileSidebar() {
    $('sidebar').classList.remove('open');
    $('sidebarBackdrop').classList.add('hidden');
  }

  function updateHealthAndCounts() {
    const enabled = state.providers.filter(p => p.enabled !== false);
    const allModels = enabled.reduce((sum, p) => sum + getProviderModels(p).length, 0);
    $('navProviderCount').textContent = String(enabled.length);
    const dot = $('healthDot');
    const txt = $('healthText');
    if (enabled.length && allModels > 0) {
      dot.classList.add('ok');
      txt.textContent = `${enabled.length} API${enabled.length > 1 ? 's' : ''} · ${allModels} models`;
    } else if (enabled.length) {
      dot.classList.remove('ok');
      txt.textContent = `${enabled.length} API enabled · Auto-discovering models`;
    } else {
      dot.classList.remove('ok');
      txt.textContent = 'No API connected';
    }
    $('chatCountBadge').textContent = String(state.chats.length);
  }

  function parseRouteValue(val) {
    if (!val || val === 'auto') return { mode: 'auto', providerId: null, modelId: null };
    if (val === 'free::auto') return { mode: 'free', providerId: null, modelId: null };
    if (val === 'paid::auto') return { mode: 'paid', providerId: null, modelId: null };
    const idx = val.indexOf('::');
    if (idx === -1) return { mode: 'auto', providerId: null, modelId: null };
    return { mode: 'manual', providerId: val.slice(0, idx), modelId: val.slice(idx + 2) };
  }

  function renderRouteOptions() {
    const select = $('chatModel');
    select.innerHTML = '<option value="auto">✦ Auto-select best model</option><option value="free::auto">Free Models</option><option value="paid::auto">Paid Models</option>'; 

    const enabledProviders = getActiveProviders(true);
    enabledProviders.forEach(p => {
      const models = getProviderModels(p);
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = `${p.id}::${m}`;
        opt.textContent = `${p.name} - ${m}`;
        select.appendChild(opt);
      });
    });

    if (state.settings.autoSelect && !['free::auto','paid::auto'].includes(state.settings.selectedRoute)) {
      state.settings.selectedRoute = 'auto';
    }
    const exists = Array.from(select.options).some(o => o.value === state.settings.selectedRoute);
    if (!exists) state.settings.selectedRoute = 'auto';
    select.value = state.settings.selectedRoute;

    updateRouteTriggerDisplay();
    renderRouteMenuProviders();
    renderRouteMenuModels(activeMenuProviderId);
  }

  function updateRouteTriggerDisplay() {
    const route = parseRouteValue(state.settings.selectedRoute);
    const activeDot = $('activeRouteDot');
    if (route.mode === 'free' || route.mode === 'paid') {
      const isFree=route.mode==='free';
      $('routeChosenName').textContent = isFree ? 'Free Models' : 'Paid Models';
      $('routeChosenMeta').textContent = isFree ? 'Selects only free-tier models' : 'Selects only models in your Paid Library';
      $('activeRouteLabel').textContent = isFree ? 'Free model routing' : 'Paid model routing';
      $('activeRouteSub').textContent = isFree ? 'Free-tier models only · no paid fallback' : 'Your manually marked paid models';
      $('routeHint').textContent = isFree ? 'Routes only to models marked as free-tier.' : 'Routes only to models in your Paid Models list.';
      activeDot.classList.toggle('warn', !getActiveProviders(false).length);
    } else if (route.mode === 'auto') {
      $('routeChosenName').textContent = 'Auto-select best model';
      $('routeChosenMeta').textContent = 'NEURA recommends a model for each task';
      $('activeRouteLabel').textContent = 'Auto model selection';
      $('activeRouteSub').textContent = getActiveProviders(false).length
        ? 'Ready · chooses from connected catalog'
        : 'Add an API account to start';
      $('routeHint').textContent = 'Auto mode chooses from your connected model catalog.';
      activeDot.classList.toggle('warn', !getActiveProviders(false).length);
    } else {
      const provider = state.providers.find(p => p.id === route.providerId);
      $('routeChosenName').textContent = route.modelId;
      $('routeChosenMeta').textContent = provider ? `${provider.name} · Priority ${provider.priority || 1}` : 'Manual selection';
      $('activeRouteLabel').textContent = route.modelId;
      $('activeRouteSub').textContent = provider ? `Via ${provider.name}` : 'Provider unavailable';
      $('routeHint').textContent = `Pinned to ${route.modelId} (${provider ? provider.name : 'unknown provider'}).`;
      activeDot.classList.toggle('warn', !provider || provider.enabled === false);
    }
  }

  function renderRouteMenuProviders() {
    const list = $('routeProviderList');
    const route = parseRouteValue(state.settings.selectedRoute);
    const providers = getActiveProviders(true);

    let html = `
      <button type="button" class="route-provider auto-provider ${activeMenuProviderId === 'auto' ? 'active' : ''}" data-provider="auto">
        <span class="route-provider-logo">✦</span>
        <span class="route-provider-copy">
          <b>Auto Routing</b>
          <small>${route.mode === 'auto' ? 'Active' : 'Smart task selection'}</small>
        </span>
      </button>
    `;

    const freeCount=providers.reduce((n,p)=>n+getProviderModels(p).filter(m=>isFreeModel(p.id,m)).length,0);
    const paidCount=providers.reduce((n,p)=>n+getProviderModels(p).filter(m=>isPaidModel(p.id,m)).length,0);
    html += `
      <button type="button" class="route-provider free-provider ${activeMenuProviderId==='free'?'active':''}" data-provider="free"><span class="route-provider-logo">$</span><span class="route-provider-copy"><b>Free Models</b><small>${freeCount} free-tier candidate${freeCount===1?'':'s'} · no paid fallback</small></span></button>
      <button type="button" class="route-provider paid-provider ${activeMenuProviderId==='paid'?'active':''}" data-provider="paid"><span class="route-provider-logo">◆</span><span class="route-provider-copy"><b>Paid Models</b><small>${paidCount} manually added</small></span></button>
    `;

    providers.forEach(p => {
      const models = getProviderModels(p);
      const credit = formatCredit(p);
      const cooled = isCoolingDown(p.id);
      const initial = (p.name || 'A').trim().charAt(0).toUpperCase();
      html += `
        <button type="button" class="route-provider ${activeMenuProviderId === p.id ? 'active' : ''}" data-provider="${escapeHtml(p.id)}">
          <span class="route-provider-logo">${escapeHtml(initial)}</span>
          <span class="route-provider-copy">
            <b>${escapeHtml(p.name)}</b>
            <small>${models.length} model${models.length === 1 ? '' : 's'}${cooled ? ' · Cooldown' : ''}</small>
          </span>
          ${credit ? `<span class="route-credit">${escapeHtml(credit)}</span>` : ''}
        </button>
      `;
    });

    list.innerHTML = html;

    list.querySelectorAll('.route-provider').forEach(btn => {
      const pid = btn.dataset.provider;
      const activate = () => {
        activeMenuProviderId = pid;
        list.querySelectorAll('.route-provider').forEach(b => b.classList.toggle('active', b.dataset.provider === pid));
        renderRouteMenuModels(pid);
      };
      btn.addEventListener('mouseenter', activate);
      btn.addEventListener('click', activate);
    });
  }

  function renderRouteMenuModels(providerId) {
    const panel = $('routeModelPanel');
    const selected = state.settings.selectedRoute;

    if (providerId === 'free' || providerId === 'paid') {
      const freeMode=providerId==='free';
      const items=getActiveProviders(true).flatMap(p=>getProviderModels(p).filter(m=>freeMode?isFreeModel(p.id,m):isPaidModel(p.id,m)).map(m=>({p,m}))); 
      const value=freeMode?'free::auto':'paid::auto';
      const modelButtons=items.map(x=>{const routeValue=`${x.p.id}::${x.m}`, isSelected=selected===routeValue, cooling=isModelCooling(x.p.id,x.m), health=getModelHealth(x.p.id,x.m); const status=cooling?`Temporary cooldown · ${formatCooldown(cooldownRemaining(x.p.id,x.m))}`:(isWorkingModel(x.p.id,x.m)?'Working':health.status==='failed'?'Last test failed':'Not yet verified'); return `<button type="button" class="route-model ${isSelected?'selected':''} ${cooling?'route-model-cooling':''}" data-route="${escapeHtml(routeValue)}" ${cooling?'disabled title="Temporarily unavailable"':''}><span class="route-model-check">${isSelected?'✓':'◈'}</span><span class="route-model-copy"><b>${escapeHtml(x.m)}</b><small>${escapeHtml(x.p.name)} · ${escapeHtml(status)}</small></span></button>`;}).join('');
      panel.innerHTML=`<div class="route-model-head"><div class="route-model-head-row"><b>${freeMode?'Free Models':'Paid Models'}</b><span class="route-model-count">${items.filter(x=>!isModelCooling(x.p.id,x.m)).length} available · ${items.length} total</span></div><small>Choose one model to pin it, or use category routing to let NEURA choose automatically. ${freeMode?'Paid fallback is disabled.':'Only models manually added to Paid Models are shown.'}</small></div>${items.length?modelButtons:'<div class="route-empty"><b>No eligible models</b><small>Mark models in Model Library and test them first.</small></div>'}<button type="button" class="route-model ${selected===value?'selected':''}" data-route="${value}"><span class="route-model-check">${selected===value?'✓':'✦'}</span><span class="route-model-copy"><b>Use ${freeMode?'Free':'Paid'} Model Routing</b><small>Automatically chooses the best available model in this category.</small></span></button>`;
      panel.querySelectorAll('[data-route]').forEach(btn=>btn.addEventListener('click',()=>selectRoute(btn.dataset.route)));
      return;
    }

    if (providerId === 'auto') {
      const totalModels = getActiveProviders(true).reduce((s, p) => s + getProviderModels(p).length, 0);
      panel.innerHTML = `
        <div class="route-model-head">
          <div class="route-model-head-row">
            <b>Automatic Model Selection</b>
            <span class="route-model-count">${totalModels} total</span>
          </div>
          <small>Classifies each prompt and matches your capability tags in Model Library.</small>
        </div>
        <button type="button" class="route-model ${selected === 'auto' ? 'selected' : ''}" data-route="auto">
          <span class="route-model-check">${selected === 'auto' ? '✓' : '✦'}</span>
          <span class="route-model-copy">
            <b>Auto-select best model</b>
            <small>Prefers coding, reasoning, writing, vision, or fast tags based on your prompt and falls back by account priority.</small>
          </span>
        </button>
      `;
      panel.querySelector('.route-model').addEventListener('click', () => selectRoute('auto'));
      return;
    }

    const provider = state.providers.find(p => p.id === providerId);
    if (!provider) {
      panel.innerHTML = '<div class="route-empty"><span>✦</span><b>Pick a provider</b><small>Its available models will appear here</small></div>';
      return;
    }

    const models = getProviderModels(provider);
    if (!models.length) {
      panel.innerHTML = `
        <div class="route-empty">
          <span>⌘</span>
          <b>No models yet</b>
          <small>Open API Manager and fetch models or add manual model IDs for ${escapeHtml(provider.name)}.</small>
        </div>
      `;
      return;
    }

    const head = `
      <div class="route-model-head">
        <div class="route-model-head-row">
          <b>${escapeHtml(provider.name)}</b>
          <span class="route-model-count">${models.length} model${models.length === 1 ? '' : 's'}</span>
        </div>
        <small>${escapeHtml(provider.type === 'gemini' ? 'Google Gemini' : 'OpenAI-compatible')} · Priority ${provider.priority || 1}</small>
      </div>
    `;

    const items = models.map(m => {
      const value = `${provider.id}::${m}`;
      const isSel = selected === value;
      const caps = getModelCaps(m);
      const cooling = isModelCooling(provider.id, m);
      const statusText = cooling ? `⏳ Cooldown ${formatCooldown(cooldownRemaining(provider.id,m))}` : (isWorkingModel(provider.id,m) ? '✓ Working' : '');
      const tagsHtml = caps.length
        ? caps.map(c => `<i>${escapeHtml(c)}</i>`).join('')
        : '<i class="untagged">Untagged</i>';
      return `
        <button type="button" class="route-model ${isSel ? 'selected' : ''}" data-route="${escapeHtml(value)}">
          <span class="route-model-check">${isSel ? '✓' : '◈'}</span>
          <span class="route-model-copy">
            <b>${escapeHtml(m)}</b>
            <div class="route-model-tags">${tagsHtml}${statusText ? `<i class="${cooling?'cooling-tag':'working-tag'}">${statusText}</i>` : ''}</div>
          </span>
        </button>
      `;
    }).join('');

    panel.innerHTML = head + items;
    panel.querySelectorAll('.route-model').forEach(btn => {
      btn.addEventListener('click', () => selectRoute(btn.dataset.route));
    });
  }

  function selectRoute(value) {
    state.settings.selectedRoute = value || 'auto';
    state.settings.autoSelect = ['auto','free::auto','paid::auto'].includes(state.settings.selectedRoute);
    $('chatModel').value = state.settings.selectedRoute;
    saveState();
    updateRouteTriggerDisplay();
    closeRouteMenu();
    syncSettingsUI();
  }

  function toggleRouteMenu(force) {
    const picker = $('routePicker');
    const menu = $('routeMenu');
    const trigger = $('routeTrigger');
    const willOpen = typeof force === 'boolean' ? force : menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !willOpen);
    picker.classList.toggle('open', willOpen);
    trigger.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      const route = parseRouteValue(state.settings.selectedRoute);
      activeMenuProviderId = route.mode === 'manual' && route.providerId ? route.providerId : (route.mode==='free'?'free':route.mode==='paid'?'paid':'auto');
      renderRouteMenuProviders();
      renderRouteMenuModels(activeMenuProviderId);
    }
  }

  function closeRouteMenu() {
    toggleRouteMenu(false);
  }

  function formatInlineMarkdown(escapedText) {
    return escapedText
      .replace(/`([^`\n]+)`/g, (_, code) => `<code class="inline-code">${code}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  }

  function renderTextSegment(text) {
    const lines = text.split('\n');
    let out = '';
    let inUl = false;
    let inOl = false;

    const closeLists = () => {
      if (inUl) { out += '</ul>'; inUl = false; }
      if (inOl) { out += '</ol>'; inOl = false; }
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const escaped = escapeHtml(line);

      if (/^---+$/.test(line.trim())) {
        closeLists();
        out += '<hr>';
        continue;
      }

      const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        closeLists();
        const level = hMatch[1].length;
        out += `<h${level}>${formatInlineMarkdown(escapeHtml(hMatch[2]))}</h${level}>`;
        continue;
      }

      const bqMatch = line.match(/^>\s?(.*)$/);
      if (bqMatch) {
        closeLists();
        out += `<blockquote>${formatInlineMarkdown(escapeHtml(bqMatch[1]))}</blockquote>`;
        continue;
      }

      const ulMatch = line.match(/^[-*+]\s+(.+)$/);
      if (ulMatch) {
        if (inOl) { out += '</ol>'; inOl = false; }
        if (!inUl) { out += '<ul>'; inUl = true; }
        out += `<li>${formatInlineMarkdown(escapeHtml(ulMatch[1]))}</li>`;
        continue;
      }

      const olMatch = line.match(/^\d+\.\s+(.+)$/);
      if (olMatch) {
        if (inUl) { out += '</ul>'; inUl = false; }
        if (!inOl) { out += '<ol>'; inOl = true; }
        out += `<li>${formatInlineMarkdown(escapeHtml(olMatch[1]))}</li>`;
        continue;
      }

      closeLists();
      if (line.trim() === '') {
        out += '<br>';
      } else {
        out += `<p>${formatInlineMarkdown(escaped)}</p>`;
      }
    }
    closeLists();
    return out;
  }

  function isPreviewableLanguage(lang, code) {
    const l = (lang || '').toLowerCase();
    if (['html', 'htm', 'svg'].includes(l)) return true;
    if (!l && /<!doctype\s+html|<html[\s>]|<svg[\s>]/i.test(code)) return true;
    return false;
  }

  function renderRichContent(rawText) {
    const text = String(rawText || '');
    const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let html = '';
    let lastIndex = 0;
    let match;

    while ((match = fenceRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        html += renderTextSegment(text.slice(lastIndex, match.index));
      }
      const lang = (match[1] || 'text').toLowerCase();
      const code = match[2].replace(/\n$/, '');
      const previewable = isPreviewableLanguage(lang, code);
      const encoded = encodeURIComponent(code);

      html += `
        <div class="code-block">
          <div class="code-toolbar">
            <span>${escapeHtml(lang)}</span>
            <div>
              ${previewable ? `<button type="button" class="mini-btn preview-code-btn" data-code="${encoded}" data-lang="${escapeHtml(lang)}">Instant Preview</button>` : ''}
              <button type="button" class="mini-btn copy-code-btn" data-code="${encoded}">Copy</button>
            </div>
          </div>
          <pre><code>${escapeHtml(code)}</code></pre>
        </div>
      `;
      lastIndex = fenceRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      html += renderTextSegment(text.slice(lastIndex));
    }
    return html || '<p></p>';
  }

  function extractPreviewableCode(rawText) {
    const text = String(rawText || '');
    // Detect HTML/SVG in any fenced code block, even if the model mislabeled the language.
    const fences = [...text.matchAll(/```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g)];
    for (const fence of fences) {
      const block = (fence[2] || '').trim();
      if (isPreviewableLanguage(fence[1], block) || /<!doctype\s+html|<html[\s>]|<svg[\s>]/i.test(block)) {
        return { code: block, lang: /<svg[\s>]/i.test(block) && !/<html/i.test(block) ? 'svg' : 'html' };
      }
    }
    const raw = text.trim();
    if (/^(?:<!doctype\s+html|<html[\s>]|<svg[\s>])/i.test(raw)) return { code: raw, lang: /^<svg[\s>]/i.test(raw) ? 'svg' : 'html' };
    return null;
  }

  function openCodePreview(code, lang = 'html') {
    let htmlDoc = code;
    if (lang === 'svg' || (/^\s*<svg[\s>]/i.test(code) && !/<html/i.test(code))) {
      htmlDoc = `<!doctype html><html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${code}</body></html>`;
    }
    currentPreviewCode = htmlDoc;
    $('previewTitle').textContent = 'Live Code Preview';
    $('previewMeta').textContent = `${lang.toUpperCase()} · Sandboxed output`;
    $('previewFrame').srcdoc = htmlDoc;
    $('previewFrame').classList.remove('preview-mobile');
    $('mobilePreview').textContent = 'Mobile';
    $('codePreview').classList.remove('hidden');
  }

  function closeCodePreview() {
    $('codePreview').classList.add('hidden');
    $('codePreview').classList.remove('preview-expanded');
    $('expandPreview').textContent = 'Expand';
    $('previewFrame').srcdoc = '';
  }

  function renderChatMessages() {
    const chat = getCurrentChat();
    const area = $('chatArea');
    restoreDraftForCurrentChat();

    if (!chat.messages.length) {
      area.innerHTML = '';
      const welcome = document.createElement('div');
      welcome.className = 'welcome';
      welcome.id = 'chatWelcome';
      welcome.innerHTML = `
        <div class="welcome-symbol">✧</div>
        <h2>Your AI workspace is ready.</h2>
        <p>Add API accounts, discover their models, then let NEURA choose a suitable model for each task.</p>
        <div class="welcome-cards">
          <button type="button" class="suggestion" data-prompt="Explain a difficult topic in simple steps with examples."><b>✦ Learn something</b><small>Clear explanations and examples</small></button>
          <button type="button" class="suggestion" data-prompt="Create a responsive landing page using HTML, CSS and JavaScript."><b>⌘ Build with code</b><small>Plan, code and debug a project</small></button>
          <button type="button" class="suggestion" data-prompt="Compare the advantages and disadvantages of three possible solutions."><b>◫ Analyze an idea</b><small>Structured reasoning and comparison</small></button>
        </div>
      `;
      area.appendChild(welcome);
      welcome.querySelectorAll('.suggestion').forEach(btn => {
        btn.addEventListener('click', () => {
          $('messageInput').value = btn.dataset.prompt || '';
          autoResizeInput();
          $('messageInput').focus();
        });
      });
      return;
    }

    area.innerHTML = '';
    chat.messages.forEach(msg => {
      area.appendChild(buildMessageElement(msg));
    });
    area.scrollTop = area.scrollHeight;
  }

  function buildMessageElement(msg) {
    const wrap = document.createElement('div');
    wrap.className = `message ${msg.role === 'user' ? 'user' : 'assistant'}`;

    const icon = document.createElement('div');
    icon.className = 'message-icon';
    icon.textContent = msg.role === 'user' ? 'U' : 'N';

    const body = document.createElement('div');
    body.className = 'message-body';
    if (msg.role === 'user') {
      body.innerHTML = `<p>${escapeHtml(msg.content).replace(/\n/g, '<br>')}</p>`;
    } else {
      body.innerHTML = renderRichContent(msg.content);
    }

    if (Array.isArray(msg.attachments) && msg.attachments.length) {
      const attDiv = document.createElement('div');
      attDiv.className = 'message-attachments';
      msg.attachments.forEach(att => {
        if (att.previewUrl) {
          const img = document.createElement('img');
          img.src = att.previewUrl;
          img.alt = att.name;
          attDiv.appendChild(img);
        } else {
          const chip = document.createElement('span');
          chip.className = 'chip';
          chip.textContent = `${att.isImage ? '🖼' : '📄'} ${att.name}`;
          attDiv.appendChild(chip);
        }
      });
      body.appendChild(attDiv);
    }

    if (msg.meta) {
      const meta = document.createElement('div');
      meta.className = 'message-meta';
      meta.textContent = msg.meta;
      body.appendChild(meta);
    }

    wrap.appendChild(icon);
    wrap.appendChild(body);
    return wrap;
  }

  function autoResizeInput() {
    const el = $('messageInput');
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function ensurePdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    if (!pdfJsPromise) {
      pdfJsPromise = loadScriptOnce('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js')
        .then(() => {
          if (!window.pdfjsLib) throw new Error('PDF.js unavailable');
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
          return window.pdfjsLib;
        })
        .catch(err => {
          pdfJsPromise = null;
          throw err;
        });
    }
    return pdfJsPromise;
  }

  async function ensureTesseract() {
    if (window.Tesseract) return window.Tesseract;
    if (!tesseractPromise) {
      tesseractPromise = loadScriptOnce('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js')
        .then(() => {
          if (!window.Tesseract) throw new Error('Tesseract.js unavailable');
          return window.Tesseract;
        })
        .catch(err => {
          tesseractPromise = null;
          throw err;
        });
    }
    return tesseractPromise;
  }

  async function runOcrOnSource(source, onProgress) {
    const Tesseract = await ensureTesseract();
    try {
      const res = await Tesseract.recognize(source, 'eng+ben', {
        logger: m => {
          if (onProgress && m.status === 'recognizing text') {
            onProgress(Math.round((m.progress || 0) * 100));
          }
        }
      });
      return res?.data?.text?.trim() || '';
    } catch {
      const res = await Tesseract.recognize(source, 'eng');
      return res?.data?.text?.trim() || '';
    }
  }

  async function extractPdfText(file, onProgress) {
    const pdfjsLib = await ensurePdfJs();
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const pageTexts = [];

    for (let i = 1; i <= doc.numPages; i++) {
      if (onProgress) onProgress(`Reading PDF page ${i}/${doc.numPages}…`);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const txt = content.items.map(it => it.str).join(' ').trim();
      if (txt) pageTexts.push(`[Page ${i}]\n${txt}`);
    }

    const combined = pageTexts.join('\n\n').trim();
    if (combined.length >= 30) return combined;

    const ocrTexts = [];
    const maxOcrPages = Math.min(doc.numPages, 10);
    for (let i = 1; i <= maxOcrPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const txt = await runOcrOnSource(canvas, pct => {
        if (onProgress) onProgress(`OCR on scanned page ${i}/${maxOcrPages} (${pct}%)…`);
      });
      if (txt) ocrTexts.push(`[Page ${i} OCR]\n${txt}`);
    }
    return ocrTexts.join('\n\n').trim() || 'No extractable text found in PDF.';
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }

  async function processChatFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        showToast(`${file.name} exceeds the 12 MB limit.`);
        continue;
      }
      const lower = file.name.toLowerCase();
      const isImage = /^image\/(png|jpeg|webp|gif)$/i.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(lower);
      const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf');
      const isText = /\.(txt|md|csv|json|html|htm)$/i.test(lower) || file.type.startsWith('text/') || file.type === 'application/json';

      if (!isImage && !isPdf && !isText) {
        showToast(`Unsupported file type: ${file.name}`);
        continue;
      }

      try {
        if (isImage) {
          const dataUrl = await readFileAsDataUrl(file);
          pendingAttachments.push({
            id: uid('att'),
            name: file.name,
            type: file.type || 'image/png',
            size: file.size,
            isImage: true,
            dataUrl
          });
        } else if (isPdf) {
          showToast(`Extracting ${file.name}…`);
          const text = await extractPdfText(file, msg => { $('routeHint').textContent = msg; });
          pendingAttachments.push({
            id: uid('att'),
            name: file.name,
            type: 'application/pdf',
            size: file.size,
            isImage: false,
            textContent: text
          });
          updateRouteTriggerDisplay();
        } else {
          const text = await file.text();
          pendingAttachments.push({
            id: uid('att'),
            name: file.name,
            type: file.type || 'text/plain',
            size: file.size,
            isImage: false,
            textContent: text
          });
        }
      } catch (err) {
        showToast(`Could not read ${file.name}: ${err.message}`);
        updateRouteTriggerDisplay();
      }
    }
    renderPendingAttachments();
  }

  function renderPendingAttachments() {
    const box = $('attachedContext');
    box.innerHTML = '';
    pendingAttachments.forEach(att => {
      const item = document.createElement('div');
      item.className = 'attachment-item';
      if (att.isImage && att.dataUrl) {
        const img = document.createElement('img');
        img.src = att.dataUrl;
        img.alt = att.name;
        item.appendChild(img);
      } else {
        const badge = document.createElement('span');
        badge.textContent = '📄';
        badge.style.flex = '0 0 auto';
        item.appendChild(badge);
      }
      const name = document.createElement('span');
      name.textContent = att.name;
      name.title = att.name;
      item.appendChild(name);

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = 'Remove attachment';
      rm.addEventListener('click', () => {
        pendingAttachments = pendingAttachments.filter(x => x.id !== att.id);
        renderPendingAttachments();
      });
      item.appendChild(rm);
      box.appendChild(item);
    });
  }

  function classifyPromptIntent(prompt, hasImages) {
    if (hasImages) return 'vision';
    const p = String(prompt || '').toLowerCase();
    if (/\b(code|javascript|typescript|python|java|c\+\+|html|css|react|vue|sql|regex|api|bug|debug|error|function|script|git|docker|json|bash)\b/.test(p)) {
      return 'coding';
    }
    if (/\b(compare|analyze|analysis|pros and cons|evaluate|reason|logic|math|proof|architecture|strategy|trade-off|step by step|why)\b/.test(p)) {
      return 'reasoning';
    }
    if (/\b(write|essay|email|blog|story|poem|rewrite|summarize|summary|translate|draft|caption|tone)\b/.test(p)) {
      return 'writing';
    }
    return 'fast';
  }

  function pickAutoModels(prompt, hasImages, routeMode = 'auto') {
    const enforceFree = routeMode === 'free' || (routeMode === 'auto' && state.settings.freeOnlyAuto);
    const providers = getActiveProviders(false);
    if (!providers.length) {
      const anyEnabled = getActiveProviders(true);
      if (anyEnabled.length) throw new Error('All enabled API accounts are temporarily cooling down. Wait a moment or reset cooldown in API Manager.');
      throw new Error('No enabled API account found. Open API Manager to add one.');
    }
    const intent = classifyPromptIntent(prompt, hasImages);
    const candidates = [];
    providers.forEach((p, pIdx) => {
      getProviderModels(p).forEach((modelId, mIdx) => {
        const caps = getModelCaps(modelId);
        if (hasImages && !caps.includes('vision')) return;
        if (isModelCooling(p.id, modelId)) return;
        if (enforceFree && !isFreeModel(p.id, modelId)) return;
        if (routeMode === 'paid' && !isPaidModel(p.id, modelId)) return;
        let score = 0;
        if (enforceFree && isFreeModel(p.id, modelId)) score += 250;
        if (isWorkingModel(p.id, modelId)) score += 35;
        if (getModelHealth(p.id, modelId).status === 'working') score += 15;
        if (caps.includes(intent)) score += 100;
        else if (!hasImages && caps.includes('fast')) score += 20;
        candidates.push({ provider: p, modelId, score, pIdx, mIdx, intent });
      });
    });
    if (!candidates.length) {
      throw new Error(hasImages ? 'No available Vision-capable models found. Update model capability tags or fetch models.' : 'No models found on your enabled accounts. Fetch models or add model IDs in API Manager.');
    }
    candidates.sort((a, b) => (b.score - a.score) || (a.pIdx - b.pIdx) || (a.mIdx - b.mIdx));
    return candidates;
  }

  function isRetryableError(status, message) {
    if ([402, 408, 429, 500, 502, 503, 504].includes(status)) return true;
    const m = String(message || '').toLowerCase();
    return /quota|billing|insufficient|rate.?limit|overloaded|capacity|timeout|network|failed to fetch/.test(m);
  }

  async function callProviderApi(provider, modelId, historyMessages, currentAttachments, systemPrompt) {
    const base = normalizeBaseUrl(provider.baseUrl, provider.type);
    const key = String(provider.apiKey || '').trim();
    if (!key) throw Object.assign(new Error(`Missing API key for ${provider.name}`), { status: 401 });

    if (provider.type === 'gemini') {
      const cleanModel = modelId.replace(/^models\//, '');
      const url = `${base}/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(key)}`;

      const contents = historyMessages.map((msg, idx) => {
        const isLastUser = idx === historyMessages.length - 1 && msg.role === 'user';
        const parts = [{ text: msg.apiText || msg.content || ' ' }];
        if (isLastUser && currentAttachments.length) {
          currentAttachments.forEach(att => {
            if (att.isImage && att.dataUrl) {
              const comma = att.dataUrl.indexOf(',');
              const header = att.dataUrl.slice(0, comma);
              const data = att.dataUrl.slice(comma + 1);
              const mimeMatch = header.match(/data:([^;]+)/);
              parts.push({
                inlineData: {
                  mimeType: mimeMatch ? mimeMatch[1] : (att.type || 'image/png'),
                  data
                }
              });
            }
          });
        }
        return { role: msg.role === 'assistant' ? 'model' : 'user', parts };
      });

      const payload = { contents };
      if (systemPrompt) {
        payload.systemInstruction = { parts: [{ text: systemPrompt }] };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.error?.message || `Gemini HTTP ${res.status}`;
        throw Object.assign(new Error(errMsg), { status: res.status, retryAfter: res.headers.get('Retry-After') });
      }
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      if (!text) {
        const block = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
        throw Object.assign(new Error(block ? `Blocked (${block})` : 'Empty response from Gemini'), { status: res.status });
      }
      const u = data?.usageMetadata;
      return {
        text,
        tokens: u?.totalTokenCount || (estimateTokens(JSON.stringify(contents)) + estimateTokens(text)),
        reported: Boolean(u?.totalTokenCount)
      };
    }

    const url = `${base}/chat/completions`;
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    historyMessages.forEach((msg, idx) => {
      const isLastUser = idx === historyMessages.length - 1 && msg.role === 'user';
      const txt = msg.apiText || msg.content || '';
      if (isLastUser && currentAttachments.some(a => a.isImage && a.dataUrl)) {
        const contentParts = [{ type: 'text', text: txt || 'Analyze the attached image(s).' }];
        currentAttachments.forEach(att => {
          if (att.isImage && att.dataUrl) {
            contentParts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
          }
        });
        messages.push({ role: 'user', content: contentParts });
      } else {
        messages.push({ role: msg.role, content: txt });
      }
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ model: modelId, messages })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.error?.message || data?.message || `API HTTP ${res.status}`;
      throw Object.assign(new Error(errMsg), { status: res.status, retryAfter: res.headers.get('Retry-After') });
    }

    const rawContent = data?.choices?.[0]?.message?.content;
    const text = Array.isArray(rawContent)
      ? rawContent.map(p => (typeof p === 'string' ? p : p?.text || '')).join('')
      : String(rawContent || '');
    if (!text) throw new Error('Empty response from provider.');

    const u = data?.usage;
    return {
      text,
      tokens: u?.total_tokens || (estimateTokens(JSON.stringify(messages)) + estimateTokens(text)),
      reported: Boolean(u?.total_tokens)
    };
  }

  function recordUsage({ providerName, modelId, tokens, reported, status }) {
    state.usage.unshift({
      id: uid('use'),
      time: Date.now(),
      providerName,
      modelId,
      tokens: Number(tokens) || 0,
      reported: Boolean(reported),
      status
    });
    if (state.usage.length > 200) state.usage.length = 200;
    saveState();
  }

  async function executeWithFallback({ candidates, historyMessages, currentAttachments, systemPrompt, allowFallback }) {
    const ordered = (candidates || []).filter(Boolean);
    if (!ordered.length) throw new Error('No available models to try.');
    const tryList = allowFallback ? ordered : ordered.slice(0, 1);
    let lastErr = null;
    for (let i = 0; i < tryList.length; i++) {
      const candidate = tryList[i];
      const p = candidate.provider;
      const modelId = candidate.modelId;
      try {
        const result = await callProviderApi(p, modelId, historyMessages, currentAttachments, systemPrompt);
        recordUsage({ providerName: p.name, modelId, tokens: result.tokens, reported: result.reported, status: i > 0 ? 'fallback' : 'ok' });
        return { ...result, provider: p, modelId, usedFallback: i > 0 };
      } catch (err) {
        lastErr = err;
        if (isRetryableError(err.status, err.message)) { const retryMs=Number(err.retryAfter)>0?Number(err.retryAfter)*1000:(/quota|limit/i.test(err.message)?5*60*1000:COOLDOWN_MS); setModelCooldown(p.id, modelId, Date.now()+retryMs); }
        recordUsage({ providerName: p.name, modelId, tokens: 0, reported: false, status: 'error' });
        // Try the next available model/provider silently, including model-not-found or auth errors.
        if (!allowFallback || i === tryList.length - 1) break;
      }
    }
    throw lastErr || new Error('All available models failed.');
  }

  async function autoDiscoverModelsIfNeeded() {
    const enabled = state.providers.filter(p => p.enabled !== false && String(p.apiKey || '').trim());
    const providersNeedingModels = enabled.filter(p => !getProviderModels(p).length);
    if (!providersNeedingModels.length) return 0;
    let discoveredCount = 0;
    for (const provider of providersNeedingModels) {
      try {
        const models = await discoverModels(provider);
        if (Array.isArray(models) && models.length) {
          provider.discoveredModels = models;
          discoveredCount += models.length;
        }
      } catch (err) {
        // Silent discovery: never interrupt the user with provider/model diagnostics.
      }
    }
    if (discoveredCount) {
      saveState();
      renderRouteOptions();
      updateHealthAndCounts();
    }
    return discoveredCount;
  }

  async function handleSendMessage() {
    if (isSending) return;
    const input = $('messageInput');
    const rawPrompt = input.value.trim();
    const attachments = pendingAttachments.slice();

    if (!rawPrompt && !attachments.length) return;

    const hasImages = attachments.some(a => a.isImage);
    const route = parseRouteValue(state.settings.selectedRoute);
    if (['auto','free','paid'].includes(route.mode) && !state.providers.some(p => p.enabled !== false && getProviderModels(p).length)) {
      await autoDiscoverModelsIfNeeded();
    }
    let candidates = [];
    let chosenProvider;
    let chosenModelId;
    let intentLabel = 'auto';

    try {
      if (['auto','free','paid'].includes(route.mode)) {
      candidates = pickAutoModels(rawPrompt, hasImages, route.mode);
      chosenProvider = candidates[0].provider;
      chosenModelId = candidates[0].modelId;
      intentLabel = candidates[0].intent || classifyPromptIntent(rawPrompt, hasImages);
      } else {
        chosenProvider = state.providers.find(p => p.id === route.providerId && p.enabled !== false);
        if (!chosenProvider) throw new Error('Selected provider is disabled or missing.');
        chosenModelId = route.modelId;
        if (hasImages && !getModelCaps(chosenModelId).includes('vision')) throw new Error(`"${chosenModelId}" is not tagged with Vision. Switch to Auto to find a compatible model.`);
        candidates = [{ provider: chosenProvider, modelId: chosenModelId, intent: intentLabel }];
        if ($('autoFallback').checked) {
          const alternatives = pickAutoModels(rawPrompt, hasImages, route.mode).filter(c => !(c.provider.id === chosenProvider.id && c.modelId === chosenModelId));
          candidates.push(...alternatives);
        }
      }
    } catch (err) {
      showToast(err.message);
      return;
    }

    const chat = getCurrentChat();
    const project = state.projects.find(pr => pr.id === chat.projectId);
    const savedContext = getRelevantSavedHistory(rawPrompt, chat);
    const baseSystemPrompt = project?.systemPrompt || '';
    const systemPrompt = [baseSystemPrompt, savedContext ? `\nRelevant context recalled from previous saved chats (use only when relevant; current conversation takes priority):\n${savedContext}` : ''].filter(Boolean).join('\n\n');

    const textAtts = attachments.filter(a => !a.isImage && a.textContent);
    const apiText = textAtts.length
      ? `${rawPrompt || 'Analyze the attached file(s).'}\n\n${textAtts.map(a => `--- File: ${a.name} ---\n${a.textContent}`).join('\n\n')}`
      : (rawPrompt || 'Analyze the attached image(s).');

    const userMsg = {
      id: uid('msg'),
      role: 'user',
      content: rawPrompt || (hasImages ? '[Image attachment]' : '[File attachment]'),
      apiText,
      attachments: attachments.map(a => ({
        name: a.name,
        isImage: a.isImage,
        previewUrl: a.isImage ? a.dataUrl : ''
      })),
      time: Date.now()
    };

    if (!chat.messages.length && rawPrompt) {
      chat.title = rawPrompt.slice(0, 44) + (rawPrompt.length > 44 ? '…' : '');
    }

    const persistableUserMsg = {
      ...userMsg,
      attachments: attachments.map(a => ({ name: a.name, isImage: a.isImage }))
    };

    chat.messages.push(persistableUserMsg);
    chat.updatedAt = Date.now();
    saveState();

    const area = $('chatArea');
    const welcome = $('chatWelcome');
    if (welcome) welcome.remove();
    area.appendChild(buildMessageElement(userMsg));

    const thinkingMsg = buildMessageElement({
      role: 'assistant',
      content: 'Thinking…',
      meta: 'Checking available models'
    });
    area.appendChild(thinkingMsg);
    area.scrollTop = area.scrollHeight;

    input.value = '';
    saveDraftForCurrentChat('');
    autoResizeInput();
    pendingAttachments = [];
    renderPendingAttachments();

    isSending = true;
    $('sendMessage').disabled = true;
    $('activeRouteLabel').textContent = route.mode === 'auto' ? 'Auto Model' : chosenModelId;
    $('activeRouteSub').textContent = 'Trying available models';

    try {
      const historyForApi = chat.messages.map((m, idx) =>
        idx === chat.messages.length - 1 ? { ...m, apiText } : m
      );

      const result = await executeWithFallback({
        candidates,
        historyMessages: historyForApi,
        currentAttachments: attachments,
        systemPrompt,
        allowFallback: ['auto','free','paid'].includes(route.mode) ? true : $('autoFallback').checked
      });

      const meta = `Auto-selected · ~${result.tokens} tokens${result.reported ? '' : ' (estimated)'}`;
      const assistantMsg = {
        id: uid('msg'),
        role: 'assistant',
        content: result.text,
        meta,
        time: Date.now()
      };
      chat.messages.push(assistantMsg);
      chat.updatedAt = Date.now();
      saveState();

      thinkingMsg.replaceWith(buildMessageElement(assistantMsg));
      area.scrollTop = area.scrollHeight;
      const previewable = extractPreviewableCode(assistantMsg.content);
      if (previewable) {
        openCodePreview(previewable.code, previewable.lang);
        showToast('Live preview opened automatically');
      }
      $('activeRouteSub').textContent = 'Ready';
    } catch (err) {
      const errMsg = {
        id: uid('msg'),
        role: 'assistant',
        content: 'All available models could not respond. Check your API keys or model availability and try again.',
        meta: 'All available models failed',
        time: Date.now()
      };
      chat.messages.push(errMsg);
      saveState();
      thinkingMsg.replaceWith(buildMessageElement(errMsg));
      area.scrollTop = area.scrollHeight;
      showToast('All available models failed. Check API keys or model availability.');
    } finally {
      isSending = false;
      $('sendMessage').disabled = false;
      updateHealthAndCounts();
    }
  }

  async function discoverModels(provider) {
    const base = normalizeBaseUrl(provider.baseUrl, provider.type);
    const key = String(provider.apiKey || '').trim();
    if (!key) throw new Error('Enter an API key first.');

    if (provider.type === 'gemini') {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 12000);
      let res;
      try { res = await fetch(`${base}/models?key=${encodeURIComponent(key)}`, { signal: ctl.signal }); } finally { clearTimeout(timer); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
      const list = Array.isArray(data.models) ? data.models : [];
      return list
        .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, ''))
        .filter(Boolean);
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    let res;
    try {
      res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: ctl.signal });
    } finally { clearTimeout(timer); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
    const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : (Array.isArray(data) ? data : []));
    return list.map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  }

  function openProviderModal(provider = null) {
    $('providerForm').reset();
    $('providerFormStatus').textContent = '';
    if (provider) {
      $('providerModalTitle').textContent = 'Edit API account';
      $('providerId').value = provider.id;
      $('providerType').value = provider.type || 'openai';
      $('providerName').value = provider.name || '';
      $('providerBase').value = provider.baseUrl || '';
      $('providerKey').value = provider.apiKey || '';
      $('providerPriority').value = provider.priority || 1;
      $('providerCredit').value = provider.credit ?? '';
      $('providerCurrency').value = provider.currency || 'USD';
      $('providerEnabled').value = String(provider.enabled !== false);
      $('providerManualModels').value = (provider.manualModels || []).join(', ');
    } else {
      $('providerModalTitle').textContent = 'Add API account';
      $('providerId').value = '';
      $('providerType').value = 'openai';
      $('providerBase').value = 'https://api.openai.com/v1';
      $('providerPriority').value = String(state.providers.length + 1);
      $('providerEnabled').value = 'true';
    }
    $('providerModal').classList.remove('hidden');
  }

  function closeProviderModal() {
    $('providerModal').classList.add('hidden');
  }

  function renderProviders() {
    const container = $('providerCards');
    if (!state.providers.length) {
      container.innerHTML = '<div class="empty-state">No API accounts added yet. Click <b>＋ Add API account</b> to connect OpenAI-compatible or Gemini APIs.</div>';
      return;
    }

    const sorted = state.providers.slice().sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99));
    container.innerHTML = sorted.map(p => {
      const models = getProviderModels(p);
      const cooled = isCoolingDown(p.id);
      const credit = formatCredit(p);
      return `
        <div class="provider-card" data-id="${escapeHtml(p.id)}">
          <div class="provider-top">
            <div>
              <div class="provider-name">${escapeHtml(p.name)}</div>
              <div class="provider-meta">${p.type === 'gemini' ? 'Google Gemini' : 'OpenAI-compatible'} · ${escapeHtml(p.baseUrl)} · Priority ${p.priority || 1}</div>
            </div>
            <div class="provider-actions">
              <button type="button" class="mini-btn" data-action="fetch">Fetch models</button>
              <button type="button" class="mini-btn" data-action="toggle">${p.enabled === false ? 'Enable' : 'Disable'}</button>
              ${cooled ? '<button type="button" class="mini-btn" data-action="clear-cooldown">Reset cooldown</button>' : ''}
              <button type="button" class="mini-btn" data-action="edit">Edit</button>
              <button type="button" class="mini-btn danger" data-action="delete">Delete</button>
            </div>
          </div>
          <div class="tags">
            <span class="tag ${p.enabled === false ? 'warn' : 'good'}">${p.enabled === false ? 'Disabled' : 'Enabled'}</span>
            ${cooled ? '<span class="tag warn">Cooling down</span>' : ''}
            <span class="tag">${models.length} model${models.length === 1 ? '' : 's'}</span>
            ${credit ? `<span class="tag good">Balance: ${escapeHtml(credit)}</span>` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.provider-card').forEach(card => {
      const id = card.dataset.id;
      const provider = state.providers.find(p => p.id === id);
      card.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const action = btn.dataset.action;
          if (!provider) return;
          if (action === 'edit') openProviderModal(provider);
          if (action === 'toggle') {
            provider.enabled = provider.enabled === false;
            saveState();
            renderProviders();
            renderRouteOptions();
            updateHealthAndCounts();
          }
          if (action === 'clear-cooldown') {
            cooldowns.delete(provider.id);
            renderProviders();
            renderRouteOptions();
            showToast(`Cooldown cleared for ${provider.name}`);
          }
          if (action === 'delete') {
            if (!confirm(`Delete account "${provider.name}"?`)) return;
            state.providers = state.providers.filter(p => p.id !== id);
            saveState();
            renderProviders();
            renderRouteOptions();
            updateHealthAndCounts();
            showToast('Account deleted');
          }
          if (action === 'fetch') {
            btn.disabled = true;
            btn.textContent = 'Fetching…';
            try {
              const found = await discoverModels(provider);
              provider.discoveredModels = found;
              saveState();
              renderProviders();
              renderRouteOptions();
              updateHealthAndCounts();
              showToast(`Discovered ${found.length} models for ${provider.name}`);
            } catch (err) {
              showToast(`Discovery failed: ${err.message}`);
            } finally {
              btn.disabled = false;
              btn.textContent = 'Fetch models';
            }
          }
        });
      });
    });
  }

  function formatCooldown(ms) { const seconds=Math.ceil(ms/1000); return `${Math.floor(seconds/60)}m ${seconds%60}s`; }
  async function testModel(provider, modelId, addToWorkingOnSuccess = false) {
    const key=modelKey(provider.id, modelId), started=Date.now();
    const health={ status:'testing', testedAt:started, latency:null, error:'' }; state.modelHealth[key]=health; saveState(); renderModelLibrary();
    try { const result=await callProviderApi(provider, modelId, [{role:'user',content:'Reply with exactly: NEURA TEST OK'}], [], ''); health.status='working'; health.latency=Date.now()-started; health.error=''; health.testedAt=Date.now(); setModelCooldown(provider.id,modelId,0); if(addToWorkingOnSuccess) setWorkingModel(provider.id,modelId,true); saveState(); showToast(`${modelId} test successful`); return true; }
    catch(err) { health.status='failed'; health.latency=Date.now()-started; health.error=String(err.message||err).slice(0,180); health.testedAt=Date.now(); if(isRetryableError(err.status,err.message)) { const retryMs=Number(err.retryAfter)>0?Number(err.retryAfter)*1000:(/quota|limit/i.test(err.message)?5*60*1000:COOLDOWN_MS); setModelCooldown(provider.id,modelId,Date.now()+retryMs); } if(state.workingModels[key]) delete state.workingModels[key]; saveState(); showToast(`${modelId} test failed: ${health.error}`); return false; }
    finally { renderModelLibrary(); renderRouteOptions(); }
  }
  async function testModelBatch(list) { const status=$('modelScanStatus'); status.textContent=`Testing ${list.length} model(s)…`; let passed=0; for(let i=0;i<list.length;i++){ status.textContent=`Testing ${i+1}/${list.length}: ${list[i].model}`; const ok=await testModel(list[i].provider,list[i].model,false); if(ok) passed++; } status.textContent=`Scan complete: ${passed}/${list.length} passed. Successful models can be added to Working Models.`; showToast(`Model scan: ${passed}/${list.length} passed`); }
  function renderModelLibrary() {
    const query = ($('modelSearch').value || '').trim().toLowerCase();
    const providers = state.providers.slice().sort((a,b)=>(Number(a.priority)||99)-(Number(b.priority)||99));
    const all = providers.flatMap(p => getProviderModels(p).map(model => ({provider:p,model}))).filter(x => !query || x.model.toLowerCase().includes(query) || x.provider.name.toLowerCase().includes(query));
    const visible = all.filter(x => {
      const health=getModelHealth(x.provider.id,x.model), working=isWorkingModel(x.provider.id,x.model), free=isFreeModel(x.provider.id,x.model), cooling=isModelCooling(x.provider.id,x.model);
      if(modelLibraryFilter==='working') return working;
      if(modelLibraryFilter==='paid') return isPaidModel(x.provider.id,x.model);
      if(modelLibraryFilter==='free') return free;
      if(modelLibraryFilter==='cooldown') return cooling;
      return true;
    });
    const uniqueModels=new Set(all.map(x=>x.model)); let tagged=0, vision=0;
    uniqueModels.forEach(m=>{const caps=getModelCaps(m); if(caps.length)tagged++; if(caps.includes('vision'))vision++;});
    $('capProviderCount').textContent=String(state.providers.filter(p=>p.enabled!==false).length);
    $('capModelCount').textContent=String(uniqueModels.size); $('capTaggedCount').textContent=String(tagged); $('capVisionCount').textContent=String(vision);
    const catalog=$('modelCatalog');
    if(!state.providers.length){catalog.innerHTML='<div class="empty-state">No models discovered yet. Add an API account in <b>API Manager</b> first.</div>';return;}
    const grouped=new Map(); visible.forEach(x=>{if(!grouped.has(x.provider.id))grouped.set(x.provider.id,[]);grouped.get(x.provider.id).push(x.model);});
    const groupsHtml=providers.filter(p=>grouped.has(p.id)).map(p=>{
      const models=grouped.get(p.id), initial=(p.name||'A').trim().charAt(0).toUpperCase();
      const items=models.map(m=>{
        const key=modelKey(p.id,m), caps=getModelCaps(m), health=getModelHealth(p.id,m), working=isWorkingModel(p.id,m), paid=isPaidModel(p.id,m), free=isFreeModel(p.id,m), cooling=isModelCooling(p.id,m), remaining=cooldownRemaining(p.id,m);
        const status=health.status==='working'?'WORKING':health.status==='failed'?'FAILED':health.status==='testing'?'TESTING':'UNTESTED';
        const freeLabel=state.freeModelOverrides[key]==='paid'?'PAID':free?'FREE / LIKELY':'UNKNOWN';
        const coolLabel=cooling?`Temporary cooldown · ${formatCooldown(remaining)}`:'';
        const capBtns=CAPABILITIES.map(c=>{const selected=caps.includes(c.id);return `<button type="button" class="cap-option ${selected?'selected':''}" data-model="${escapeHtml(m)}" data-cap="${c.id}"><span class="cap-option-icon">${c.icon}</span><span>${c.label}</span>${selected?'<span class="cap-check">✓</span>':''}</button>`;}).join('');
        return `<div class="model-item model-health-item"><div class="model-item-top"><div class="model-item-icon">◈</div><div class="model-item-info"><div class="model-name">${escapeHtml(m)}</div><div class="model-item-sub">${p.type==='gemini'?'Gemini':'OpenAI-compatible'} · ${escapeHtml(status)} · ${freeLabel}${health.latency?` · ${health.latency}ms`:''}</div>${cooling?`<div class="model-cooldown">⏳ ${coolLabel}</div>`:''}${health.error&&health.status==='failed'?`<div class="model-error-note">${escapeHtml(health.error)}</div>`:''}</div><span class="model-selected-count">${caps.length} tags</span></div><div class="model-actions"><button type="button" class="mini-btn" data-model-action="test" data-provider="${escapeHtml(p.id)}" data-model="${escapeHtml(m)}">▶ Test</button><button type="button" class="mini-btn ${working?'is-working':''}" data-model-action="toggle-working" data-provider="${escapeHtml(p.id)}" data-model="${escapeHtml(m)}">${working?'✓ Working · Remove':'＋ Add to Working'}</button><button type="button" class="mini-btn ${paid?'is-paid':''}" data-model-action="toggle-paid" data-provider="${escapeHtml(p.id)}" data-model="${escapeHtml(m)}">${paid?'✓ Paid · Remove':'＋ Add to Paid'}</button><button type="button" class="mini-btn" data-model-action="free-toggle" data-provider="${escapeHtml(p.id)}" data-model="${escapeHtml(m)}">${state.freeModelOverrides[key]==='free'?'✓ Mark Free':state.freeModelOverrides[key]==='paid'?'Mark Unknown':'Mark Free'}</button></div><div class="capability-label">CAPABILITIES</div><div class="capability-options">${capBtns}</div></div>`;
      }).join('');
      const collapsed = collapsedModelProviders.has(p.id);
      return `<section class="model-group ${collapsed?'is-collapsed':''}" data-provider-group="${escapeHtml(p.id)}"><div class="provider-head-row"><button type="button" class="model-group-head model-group-toggle" data-provider-toggle="${escapeHtml(p.id)}" aria-expanded="${!collapsed}" aria-controls="provider-model-list-${escapeHtml(p.id)}"><span class="provider-mark">${escapeHtml(initial)}</span><span class="provider-heading"><span class="provider-name">${escapeHtml(p.name)} <span class="provider-model-count">${models.length} MODELS</span></span><span class="provider-meta">${escapeHtml(p.baseUrl)}</span></span><span class="provider-status ${p.enabled===false?'off':'on'}">${p.enabled===false?'DISABLED':'ACTIVE'}</span><span class="provider-dropdown-chevron" aria-hidden="true">${collapsed?'▾':'▴'}</span></button><button type="button" class="provider-test-all" data-provider-test="${escapeHtml(p.id)}" ${p.enabled===false?'disabled':''}>▶ Test all ${models.length}</button></div><div class="provider-scan-progress" data-provider-progress="${escapeHtml(p.id)}" aria-live="polite"></div><div class="model-list" id="provider-model-list-${escapeHtml(p.id)}" ${collapsed?'hidden':''}>${items}</div></section>`;
    }).join('');
    catalog.innerHTML=groupsHtml||'<div class="empty-state">No models match this filter. Use All Models or test models first.</div>';
    catalog.querySelectorAll('[data-provider-toggle]').forEach(btn=>btn.addEventListener('click',()=>{const id=btn.dataset.providerToggle;if(collapsedModelProviders.has(id))collapsedModelProviders.delete(id);else collapsedModelProviders.add(id);const group=btn.closest('[data-provider-group]');const list=group?.querySelector('.model-list');const collapsed=collapsedModelProviders.has(id);btn.setAttribute('aria-expanded',String(!collapsed));btn.querySelector('.provider-dropdown-chevron').textContent=collapsed?'▾':'▴';group?.classList.toggle('is-collapsed',collapsed);if(list)list.hidden=collapsed;}));
    catalog.querySelectorAll('[data-provider-test]').forEach(btn=>btn.addEventListener('click',async()=>{const provider=state.providers.find(x=>x.id===btn.dataset.providerTest);if(!provider||provider.enabled===false)return;const models=getProviderModels(provider);if(!models.length){showToast('No models discovered for this provider');return;}btn.disabled=true;const progress=btn.closest('[data-provider-group]')?.querySelector('[data-provider-progress]');let passed=0,failed=0;try{for(let i=0;i<models.length;i++){if(progress)progress.textContent=`Testing ${i+1}/${models.length}: ${models[i]}`;btn.textContent=`Testing ${i+1}/${models.length}`;const ok=await testModel(provider,models[i],false);if(ok)passed++;else failed++;}if(progress)progress.textContent=`Completed · ${passed} working · ${failed} failed`;showToast(`${provider.name}: ${passed}/${models.length} models working`);}finally{btn.disabled=false;btn.textContent=`▶ Test all ${models.length}`;}}));
    catalog.querySelectorAll('.cap-option').forEach(btn=>btn.addEventListener('click',()=>{const model=btn.dataset.model,cap=btn.dataset.cap,current=getModelCaps(model).slice(),idx=current.indexOf(cap);if(idx>=0)current.splice(idx,1);else current.push(cap);state.capabilities[model]=current;saveState();renderModelLibrary();renderRouteOptions();}));
    catalog.querySelectorAll('[data-model-action]').forEach(btn=>btn.addEventListener('click',async()=>{const provider=state.providers.find(x=>x.id===btn.dataset.provider),model=btn.dataset.model,action=btn.dataset.modelAction;if(!provider)return;if(action==='test'){btn.disabled=true;await testModel(provider,model,false);return;}const key=modelKey(provider.id,model);if(action==='toggle-working'){setWorkingModel(provider.id,model,!isWorkingModel(provider.id,model));showToast(isWorkingModel(provider.id,model)?'Added to Working Models':'Removed from Working Models');}if(action==='toggle-paid'){setPaidModel(provider.id,model,!isPaidModel(provider.id,model));showToast(isPaidModel(provider.id,model)?'Added to Paid Models':'Removed from Paid Models');}if(action==='free-toggle'){state.freeModelOverrides[key]=state.freeModelOverrides[key]==='free'?'unknown':'free';saveState();showToast(state.freeModelOverrides[key]==='free'?'Marked as free-tier candidate':'Free override cleared');}renderModelLibrary();}));
  }

  function renderArenaSelectors() {

    const container = $('arenaSelectors');
    const providers = getActiveProviders(true);
    const options = [];
    providers.forEach(p => {
      getProviderModels(p).forEach(m => {
        options.push({ value: `${p.id}::${m}`, label: `${p.name} - ${m}` });
      });
    });

    if (!options.length) {
      container.innerHTML = '<span class="muted small">Connect an API and discover models first.</span>';
      return;
    }

    const prev = Array.from(container.querySelectorAll('select')).map(s => s.value);
    container.innerHTML = [0, 1, 2].map(slot => {
      const selOpts = ['<option value="">- None -</option>']
        .concat(options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`))
        .join('');
      return `<select class="arena-model-select" data-slot="${slot}">${selOpts}</select>`;
    }).join('');

    container.querySelectorAll('select').forEach((sel, idx) => {
      if (prev[idx] && options.some(o => o.value === prev[idx])) {
        sel.value = prev[idx];
      } else if (options[idx]) {
        sel.value = options[idx].value;
      }
    });
  }

  async function runArena() {
    const prompt = $('arenaPrompt').value.trim();
    if (!prompt) return showToast('Enter a test prompt first.');
    const selected = Array.from(document.querySelectorAll('.arena-model-select'))
      .map(s => s.value)
      .filter(Boolean);
    if (!selected.length) return showToast('Select at least one model.');

    if (state.settings.confirmArena && !confirm(`Send this prompt to ${selected.length} model(s)? This will make ${selected.length} separate API request(s).`)) {
      return;
    }

    const resultsBox = $('arenaResults');
    resultsBox.innerHTML = selected.map((val, idx) => {
      const r = parseRouteValue(val);
      const p = state.providers.find(x => x.id === r.providerId);
      return `<div class="arena-result" id="arenaCard_${idx}"><h3>${escapeHtml(r.modelId)} <small class="muted">(${escapeHtml(p?.name || '')})</small></h3><p class="muted">Running…</p></div>`;
    }).join('');

    $('runArena').disabled = true;
    await Promise.allSettled(selected.map(async (val, idx) => {
      const card = $(`arenaCard_${idx}`);
      const r = parseRouteValue(val);
      const p = state.providers.find(x => x.id === r.providerId);
      if (!p) {
        card.querySelector('p').textContent = 'Error: Provider not found.';
        return;
      }
      const started = performance.now();
      try {
        const res = await callProviderApi(p, r.modelId, [{ role: 'user', content: prompt }], [], '');
        const ms = Math.round(performance.now() - started);
        recordUsage({ providerName: p.name, modelId: r.modelId, tokens: res.tokens, reported: res.reported, status: 'arena' });
        card.innerHTML = `
          <h3>${escapeHtml(r.modelId)}</h3>
          <div class="message-meta" style="margin:0 0 8px">${escapeHtml(p.name)} · ${ms} ms · ~${res.tokens} tokens</div>
          <p>${escapeHtml(res.text)}</p>
        `;
      } catch (err) {
        recordUsage({ providerName: p.name, modelId: r.modelId, tokens: 0, reported: false, status: 'error' });
        card.querySelector('p').textContent = `Error: ${err.message}`;
      }
    }));
    $('runArena').disabled = false;
  }

  function openGenericModal(title, bodyHtml) {
    $('genericTitle').textContent = title;
    $('genericBody').innerHTML = bodyHtml;
    $('genericModal').classList.remove('hidden');
  }

  function closeGenericModal() {
    $('genericModal').classList.add('hidden');
  }

  function openChatHistoryModal() {
    const items = state.chats
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(c => {
        const proj = state.projects.find(p => p.id === c.projectId);
        const active = c.id === state.currentChatId;
        return `
          <div class="chat-history-item ${active ? 'active' : ''}" data-chat="${escapeHtml(c.id)}">
            <div class="chat-history-meta" data-open="${escapeHtml(c.id)}">
              <b>${escapeHtml(c.title || 'New chat')}</b>
              <small>${c.messages.length} message${c.messages.length === 1 ? '' : 's'}${proj ? ` · Project: ${escapeHtml(proj.name)}` : ''}</small>
            </div>
            <button type="button" class="mini-btn danger" data-del="${escapeHtml(c.id)}">Delete</button>
          </div>
        `;
      }).join('');

    openGenericModal('Saved Chats', `
      <div>${items || '<p class="muted small">No saved chats yet.</p>'}</div>
      <div class="modal-actions">
        <button type="button" class="primary-btn" id="modalNewChatBtn">＋ New chat</button>
      </div>
    `);

    $('genericBody').querySelectorAll('[data-open]').forEach(el => {
      el.addEventListener('click', () => {
        state.currentChatId = el.dataset.open;
        saveState();
        renderChatMessages();
        updateHealthAndCounts();
        closeGenericModal();
        switchView('chat');
      });
    });

    $('genericBody').querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.del;
        state.chats = state.chats.filter(c => c.id !== id);
        if (!state.chats.length) state.chats.push(createEmptyChat());
        if (state.currentChatId === id) state.currentChatId = state.chats[0].id;
        saveState();
        renderChatMessages();
        updateHealthAndCounts();
        openChatHistoryModal();
      });
    });

    $('modalNewChatBtn').addEventListener('click', () => {
      const c = createEmptyChat();
      state.chats.unshift(c);
      state.currentChatId = c.id;
      saveState();
      renderChatMessages();
      updateHealthAndCounts();
      closeGenericModal();
      switchView('chat');
    });
  }

  function renderProjects() {
    const container = $('projectList');
    if (!state.projects.length) {
      container.innerHTML = '<div class="empty-state">No projects yet. Create one to group chats and attach custom system instructions.</div>';
      return;
    }

    container.innerHTML = state.projects.map(proj => {
      const count = state.chats.filter(c => c.projectId === proj.id).length;
      return `
        <div class="project-card" data-id="${escapeHtml(proj.id)}">
          <h3>${escapeHtml(proj.name)}</h3>
          <p>${escapeHtml(proj.description || 'No description')}</p>
          <div class="tags"><span class="tag">${count} chat${count === 1 ? '' : 's'}</span></div>
          <div class="button-row">
            <button type="button" class="mini-btn" data-act="start">New chat here</button>
            <button type="button" class="mini-btn" data-act="assign">Assign current chat</button>
            <button type="button" class="mini-btn" data-act="edit">Edit</button>
            <button type="button" class="mini-btn danger" data-act="del">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.project-card').forEach(card => {
      const id = card.dataset.id;
      const proj = state.projects.find(p => p.id === id);
      card.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.act;
          if (!proj) return;
          if (act === 'start') {
            const c = createEmptyChat(proj.id);
            c.title = `${proj.name} chat`;
            state.chats.unshift(c);
            state.currentChatId = c.id;
            saveState();
            renderChatMessages();
            updateHealthAndCounts();
            switchView('chat');
            showToast(`Started chat in "${proj.name}"`);
          }
          if (act === 'assign') {
            const c = getCurrentChat();
            c.projectId = proj.id;
            saveState();
            renderProjects();
            showToast(`Current chat assigned to "${proj.name}"`);
          }
          if (act === 'edit') openProjectModal(proj);
          if (act === 'del') {
            if (!confirm(`Delete project "${proj.name}"?`)) return;
            state.projects = state.projects.filter(p => p.id !== id);
            state.chats.forEach(c => { if (c.projectId === id) c.projectId = ''; });
            saveState();
            renderProjects();
          }
        });
      });
    });
  }

  function openProjectModal(proj = null) {
    openGenericModal(proj ? 'Edit Project' : 'New Project', `
      <form id="projectForm">
        <label class="field-label">PROJECT NAME</label>
        <input class="generic-input" id="projNameInput" value="${escapeHtml(proj?.name || '')}" placeholder="e.g. Web App Build" required>
        <label class="field-label">DESCRIPTION</label>
        <input class="generic-input" id="projDescInput" value="${escapeHtml(proj?.description || '')}" placeholder="Optional short note">
        <label class="field-label">SYSTEM INSTRUCTIONS (OPTIONAL)</label>
        <textarea class="generic-textarea" id="projSysInput" rows="4" placeholder="Applied to every request inside this project…">${escapeHtml(proj?.systemPrompt || '')}</textarea>
        <div class="modal-actions">
          <button type="submit" class="primary-btn">${proj ? 'Save project' : 'Create project'}</button>
        </div>
      </form>
    `);

    $('projectForm').addEventListener('submit', e => {
      e.preventDefault();
      const name = $('projNameInput').value.trim();
      if (!name) return;
      if (proj) {
        proj.name = name;
        proj.description = $('projDescInput').value.trim();
        proj.systemPrompt = $('projSysInput').value.trim();
      } else {
        state.projects.push({
          id: uid('proj'),
          name,
          description: $('projDescInput').value.trim(),
          systemPrompt: $('projSysInput').value.trim()
        });
      }
      saveState();
      closeGenericModal();
      renderProjects();
    });
  }

  function renderPrompts() {
    const grid = $('promptLibrary');
    if (!state.prompts.length) {
      grid.innerHTML = '<div class="empty-state">No saved prompts yet. Click <b>＋ New prompt</b> to add one.</div>';
      return;
    }

    grid.innerHTML = state.prompts.map(pr => `
      <div class="prompt-card" data-id="${escapeHtml(pr.id)}">
        <h3>${escapeHtml(pr.title)}</h3>
        <p>${escapeHtml(pr.body.slice(0, 140))}${pr.body.length > 140 ? '…' : ''}</p>
        <div class="button-row">
          <button type="button" class="mini-btn" data-act="use">Use in chat</button>
          <button type="button" class="mini-btn" data-act="edit">Edit</button>
          <button type="button" class="mini-btn danger" data-act="del">Delete</button>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.prompt-card').forEach(card => {
      const id = card.dataset.id;
      const pr = state.prompts.find(p => p.id === id);
      card.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.act;
          if (!pr) return;
          if (act === 'use') {
            $('messageInput').value = pr.body;
            switchView('chat');
            autoResizeInput();
            $('messageInput').focus();
          }
          if (act === 'edit') openPromptModal(pr);
          if (act === 'del') {
            state.prompts = state.prompts.filter(p => p.id !== id);
            saveState();
            renderPrompts();
          }
        });
      });
    });
  }

  function openPromptModal(pr = null) {
    openGenericModal(pr ? 'Edit Prompt' : 'New Prompt', `
      <form id="promptForm">
        <label class="field-label">TITLE</label>
        <input class="generic-input" id="promptTitleInput" value="${escapeHtml(pr?.title || '')}" placeholder="e.g. Bug Fixer" required>
        <label class="field-label">PROMPT TEMPLATE</label>
        <textarea class="generic-textarea" id="promptBodyInput" rows="5" placeholder="Write reusable prompt text…" required>${escapeHtml(pr?.body || '')}</textarea>
        <div class="modal-actions">
          <button type="submit" class="primary-btn">${pr ? 'Save prompt' : 'Add prompt'}</button>
        </div>
      </form>
    `);

    $('promptForm').addEventListener('submit', e => {
      e.preventDefault();
      const title = $('promptTitleInput').value.trim();
      const body = $('promptBodyInput').value;
      if (!title || !body.trim()) return;
      if (pr) {
        pr.title = title;
        pr.body = body;
      } else {
        state.prompts.unshift({ id: uid('pmt'), title, body });
      }
      saveState();
      closeGenericModal();
      renderPrompts();
    });
  }

  async function analyzeLocalFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      showToast('File exceeds 12 MB limit.');
      return;
    }
    const preview = $('filePreview');
    lastExtractedFileName = file.name;
    preview.textContent = `Reading ${file.name}…`;

    try {
      const lower = file.name.toLowerCase();
      let text = '';
      if (/^image\/(png|jpeg|webp|gif)$/i.test(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
        preview.textContent = `Running OCR on ${file.name}…`;
        text = await runOcrOnSource(file, pct => {
          preview.textContent = `Running OCR on ${file.name} (${pct}%)…`;
        });
      } else if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
        text = await extractPdfText(file, msg => { preview.textContent = msg; });
      } else {
        text = await file.text();
      }
      lastExtractedFileText = text || 'No text extracted.';
      preview.textContent = lastExtractedFileText;
    } catch (err) {
      lastExtractedFileText = '';
      preview.textContent = `Error reading file: ${err.message}`;
    }
  }

  function renderUsage() {
    const totalTokens = state.usage.reduce((s, u) => s + (Number(u.tokens) || 0), 0);
    const enabled = state.providers.filter(p => p.enabled !== false);
    const totalModels = new Set(enabled.flatMap(getProviderModels)).size;

    $('statRequests').textContent = String(state.usage.length);
    $('statTokens').textContent = totalTokens.toLocaleString();
    $('statAccounts').textContent = String(enabled.length);
    $('statModels').textContent = String(totalModels);

    const rows = $('usageRows');
    if (!state.usage.length) {
      rows.innerHTML = '<p class="muted small">No activity recorded yet.</p>';
      return;
    }
    rows.innerHTML = state.usage.slice(0, 40).map(u => {
      const dt = new Date(u.time).toLocaleString();
      return `
        <div class="usage-row">
          <div>
            <b>${escapeHtml(u.modelId)}</b> · <span class="muted">${escapeHtml(u.providerName)}</span>
            <div class="muted tiny">${escapeHtml(dt)} · ${escapeHtml(u.status)}</div>
          </div>
          <div><b>${Number(u.tokens || 0).toLocaleString()}</b> <span class="muted tiny">${u.reported ? 'reported' : 'est.'}</span></div>
        </div>
      `;
    }).join('');
  }

  function syncSettingsUI() {
    $('settingAuto').checked = Boolean(state.settings.autoSelect);
    $('settingFallback').checked = Boolean(state.settings.autoFallback);
    $('settingConfirm').checked = Boolean(state.settings.confirmArena);
    $('autoFallback').checked = Boolean(state.settings.autoFallback);
  }

  function exportCurrentChat() {
    const chat = getCurrentChat();
    if (!chat.messages.length) return showToast('Current chat is empty.');
    const md = chat.messages.map(m =>
      `### ${m.role === 'user' ? 'You' : 'NEURA AI'}${m.meta ? ` (${m.meta})` : ''}\n\n${m.content}\n`
    ).join('\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(chat.title || 'neura-chat').replace(/[^a-z0-9_-]+/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bindEvents() {
    $('mobileMenu').addEventListener('click', openMobileSidebar);
    $('sidebarBackdrop').addEventListener('click', closeMobileSidebar);
    $('themeToggle').addEventListener('click', () => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      saveState();
      applyTheme();
    });

    document.querySelectorAll('.nav[data-view]').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $('newChat').addEventListener('click', () => {
      const c = createEmptyChat();
      state.chats.unshift(c);
      state.currentChatId = c.id;
      saveState();
      renderChatMessages();
      updateHealthAndCounts();
      switchView('chat');
      $('messageInput').focus();
    });

    $('chatHistoryBtn').addEventListener('click', openChatHistoryModal);
    $('exportCurrent').addEventListener('click', exportCurrentChat);

    $('routeTrigger').addEventListener('click', e => {
      e.stopPropagation();
      toggleRouteMenu();
    });
    document.addEventListener('click', e => {
      if (!$('routePicker').contains(e.target)) closeRouteMenu();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeRouteMenu();
        closeProviderModal();
        closeGenericModal();
        if ($('codePreview').classList.contains('preview-expanded')) {
          $('codePreview').classList.remove('preview-expanded');
          $('expandPreview').textContent = 'Expand';
        }
      }
    });

    $('autoFallback').addEventListener('change', () => {
      state.settings.autoFallback = $('autoFallback').checked;
      saveState();
      syncSettingsUI();
    });

    $('chatArea').addEventListener('click', e => {
      const copyBtn = e.target.closest('.copy-code-btn');
      if (copyBtn) {
        const code = decodeURIComponent(copyBtn.dataset.code || '');
        navigator.clipboard?.writeText(code).then(() => showToast('Code copied')).catch(() => showToast('Copy failed'));
        return;
      }
      const prevBtn = e.target.closest('.preview-code-btn');
      if (prevBtn) {
        const code = decodeURIComponent(prevBtn.dataset.code || '');
        openCodePreview(code, prevBtn.dataset.lang || 'html');
      }
    });

    $('messageInput').addEventListener('input', () => {
      autoResizeInput();
      saveDraftForCurrentChat($('messageInput').value);
    });
    // Save workspace promptly when the tab is hidden/closed; no page reload is triggered.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveState(); });
    window.addEventListener('pagehide', saveState);
    $('messageInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        handleSendMessage();
      }
    });
    $('sendMessage').addEventListener('click', handleSendMessage);

    $('chatFileInput').addEventListener('change', e => {
      if (e.target.files?.length) processChatFiles(e.target.files);
      e.target.value = '';
    });

    $('messageInput').addEventListener('paste', e => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        e.preventDefault();
        processChatFiles(files);
      }
    });

    const shell = $('composerShell');
    ['dragenter', 'dragover'].forEach(ev => {
      shell.addEventListener(ev, e => {
        e.preventDefault();
        shell.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      shell.addEventListener(ev, e => {
        e.preventDefault();
        shell.classList.remove('drag-over');
      });
    });
    shell.addEventListener('drop', e => {
      if (e.dataTransfer?.files?.length) processChatFiles(e.dataTransfer.files);
    });

    $('closePreview').addEventListener('click', closeCodePreview);
    $('refreshPreview').addEventListener('click', () => {
      if (currentPreviewCode) { $('previewFrame').srcdoc = ''; requestAnimationFrame(() => { $('previewFrame').srcdoc = currentPreviewCode; }); }
    });
    $('mobilePreview').addEventListener('click', () => {
      const frame = $('previewFrame');
      const mobile = frame.classList.toggle('preview-mobile');
      $('mobilePreview').textContent = mobile ? 'Desktop' : 'Mobile';
    });
    $('expandPreview').addEventListener('click', () => {
      const box = $('codePreview');
      const expanded = box.classList.toggle('preview-expanded');
      $('expandPreview').textContent = expanded ? 'Collapse' : 'Expand';
    });
    $('openPreviewTab').addEventListener('click', () => {
      if (!currentPreviewCode) return;
      const blob = new Blob([currentPreviewCode], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });

    $('addProvider').addEventListener('click', () => openProviderModal());
    $('closeProviderModal').addEventListener('click', closeProviderModal);
    $('providerModal').addEventListener('click', e => {
      if (e.target === $('providerModal')) closeProviderModal();
    });

    $('providerType').addEventListener('change', () => {
      const type = $('providerType').value;
      const base = $('providerBase').value.trim();
      if (!base || base === 'https://api.openai.com/v1' || base === 'https://generativelanguage.googleapis.com' || base === 'https://generativelanguage.googleapis.com/v1beta') {
        $('providerBase').value = type === 'gemini'
          ? 'https://generativelanguage.googleapis.com'
          : 'https://api.openai.com/v1';
      }
    });

    $('fetchModelsInModal').addEventListener('click', async () => {
      const status = $('providerFormStatus');
      status.textContent = 'Discovering models…';
      try {
        const temp = {
          type: $('providerType').value,
          baseUrl: $('providerBase').value,
          apiKey: $('providerKey').value
        };
        const models = await discoverModels(temp);
        status.textContent = `Found ${models.length} model(s). Save account to keep them.`;
        $('providerForm').dataset.fetchedModels = JSON.stringify(models);
      } catch (err) {
        status.textContent = `Discovery failed: ${err.message}`;
      }
    });

    $('providerForm').addEventListener('submit', async e => {
      e.preventDefault();
      const id = $('providerId').value;
      const existing = id ? state.providers.find(p => p.id === id) : null;
      const manualModels = $('providerManualModels').value
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      let discovered = existing?.discoveredModels || [];
      if ($('providerForm').dataset.fetchedModels) {
        try {
          discovered = JSON.parse($('providerForm').dataset.fetchedModels);
        } catch {}
        delete $('providerForm').dataset.fetchedModels;
      }

      const creditRaw = $('providerCredit').value.trim();
      const record = {
        id: existing ? existing.id : uid('prov'),
        type: $('providerType').value,
        name: $('providerName').value.trim(),
        baseUrl: $('providerBase').value.trim(),
        apiKey: $('providerKey').value.trim(),
        priority: Math.max(1, Number($('providerPriority').value) || 1),
        credit: creditRaw === '' ? '' : Number(creditRaw),
        currency: $('providerCurrency').value,
        enabled: $('providerEnabled').value !== 'false',
        manualModels,
        discoveredModels: discovered
      };

      if (!discovered.length && !manualModels.length && record.apiKey) {
        $('providerFormStatus').textContent = 'Saving and discovering models…';
        try {
          record.discoveredModels = await discoverModels(record);
        } catch {}
      }

      if (existing) {
        Object.assign(existing, record);
      } else {
        state.providers.push(record);
      }

      saveState();
      closeProviderModal();
      renderProviders();
      renderRouteOptions();
      updateHealthAndCounts();
      showToast(existing ? 'Account updated' : 'Account added');
    });

    $('modelSearch').addEventListener('input', renderModelLibrary);
    $('modelLibraryTabs')?.addEventListener('click',e=>{const btn=e.target.closest('[data-model-filter]');if(!btn)return;modelLibraryFilter=btn.dataset.modelFilter;$('modelLibraryTabs').querySelectorAll('[data-model-filter]').forEach(b=>b.classList.toggle('active',b===btn));renderModelLibrary();});
    $('testAllModels')?.addEventListener('click',()=>{const list=state.providers.filter(p=>p.enabled!==false).flatMap(p=>getProviderModels(p).map(model=>({provider:p,model})));testModelBatch(list);});
    $('testWorkingModels')?.addEventListener('click',()=>{const list=state.providers.filter(p=>p.enabled!==false).flatMap(p=>getProviderModels(p).filter(model=>isWorkingModel(p.id,model)).map(model=>({provider:p,model})));testModelBatch(list);});
    const freeAutoBtn=$('toggleFreeAuto'); if(freeAutoBtn){ const updateFreeAuto=()=>{freeAutoBtn.textContent=`⚡ Free-only Auto: ${state.settings.freeOnlyAuto?'On':'Off'}`; freeAutoBtn.classList.toggle('active',state.settings.freeOnlyAuto);}; updateFreeAuto(); freeAutoBtn.addEventListener('click',()=>{state.settings.freeOnlyAuto=!state.settings.freeOnlyAuto;saveState();updateFreeAuto();showToast(state.settings.freeOnlyAuto?'Auto routing restricted to free models':'Free-only routing disabled');}); }
    $('refreshModels').addEventListener('click', async () => {
      const enabled = state.providers.filter(p => p.enabled !== false);
      if (!enabled.length) return showToast('No enabled accounts to refresh.');
      $('refreshModels').disabled = true;
      let ok = 0;
      for (const p of enabled) {
        try {
          p.discoveredModels = await discoverModels(p);
          ok++;
        } catch {}
      }
      saveState();
      renderModelLibrary();
      renderRouteOptions();
      updateHealthAndCounts();
      $('refreshModels').disabled = false;
      showToast(`Refreshed ${ok}/${enabled.length} account(s).`);
    });

    $('runArena').addEventListener('click', runArena);
    $('newProject').addEventListener('click', () => openProjectModal());
    $('addPrompt').addEventListener('click', () => openPromptModal());
    $('closeGeneric').addEventListener('click', closeGenericModal);
    $('genericModal').addEventListener('click', e => {
      if (e.target === $('genericModal')) closeGenericModal();
    });

    const dropZone = $('dropZone');
    $('fileInput').addEventListener('change', e => {
      if (e.target.files?.[0]) analyzeLocalFile(e.target.files[0]);
    });
    ['dragenter', 'dragover'].forEach(ev => {
      dropZone.addEventListener(ev, e => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dropZone.addEventListener(ev, e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });
    });
    dropZone.addEventListener('drop', e => {
      if (e.dataTransfer?.files?.[0]) analyzeLocalFile(e.dataTransfer.files[0]);
    });

    $('copyFileText').addEventListener('click', () => {
      if (!lastExtractedFileText) return showToast('No extracted text yet.');
      navigator.clipboard?.writeText(lastExtractedFileText)
        .then(() => showToast('Extracted text copied'))
        .catch(() => showToast('Copy failed'));
    });

    $('askAboutFile').addEventListener('click', () => {
      if (!lastExtractedFileText) return showToast('Select a file first.');
      pendingAttachments.push({
        id: uid('att'),
        name: lastExtractedFileName || 'document.txt',
        type: 'text/plain',
        size: lastExtractedFileText.length,
        isImage: false,
        textContent: lastExtractedFileText
      });
      renderPendingAttachments();
      switchView('chat');
      $('messageInput').focus();
      showToast('Extracted content attached to chat');
    });

    $('clearUsage').addEventListener('click', () => {
      state.usage = [];
      saveState();
      renderUsage();
      showToast('Usage data cleared');
    });

    $('settingAuto').addEventListener('change', () => {
      state.settings.autoSelect = $('settingAuto').checked;
      if (state.settings.autoSelect) state.settings.selectedRoute = 'auto';
      saveState();
      renderRouteOptions();
    });
    $('settingFallback').addEventListener('change', () => {
      state.settings.autoFallback = $('settingFallback').checked;
      $('autoFallback').checked = state.settings.autoFallback;
      saveState();
    });
    $('settingConfirm').addEventListener('change', () => {
      state.settings.confirmArena = $('settingConfirm').checked;
      saveState();
    });

    $('backupData').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `neura-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $('restoreData').addEventListener('click', () => $('restoreFile').click());
    $('restoreFile').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.providers)) {
          throw new Error('Invalid NEURA workspace JSON.');
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        writeRecoveryCopy(JSON.stringify(parsed)).catch(() => {});
        state = loadState();
        initUI();
        showToast('Workspace imported');
      } catch (err) {
        showToast(err.message);
      }
    });

    $('wipeData').addEventListener('click', () => {
      if (!confirm('Delete all local NEURA data, including saved API keys, chats, projects, and prompts?')) return;
      localStorage.removeItem(STORAGE_KEY);
      clearRecoveryCopy().catch(() => {});
      cooldowns.clear();
      pendingAttachments = [];
      state = loadState();
      initUI();
      showToast('All local data deleted');
    });
  }

  function initUI() {
    applyTheme();
    syncSettingsUI();
    renderRouteOptions();
    renderChatMessages();
    renderPendingAttachments();
    updateHealthAndCounts();
  }

  bindEvents();
  initUI();
  recoverWorkspaceIfNeeded().catch(() => {});
  // Background discovery prevents the empty-model state from persisting after reload.
  autoDiscoverModelsIfNeeded().catch(() => {});
})();