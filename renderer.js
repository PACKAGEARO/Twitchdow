// ── Platform Detection ─────────────────────────────────────────────────────
const platform = window.api.getPlatform();
if (platform === 'win32' || platform === 'linux') {
  document.body.classList.add(`platform-${platform}`);
}

// ── Toast Notifications ────────────────────────────────────────────────────
const toastContainer = document.getElementById('toastContainer');

function showToast(message, type = 'error', duration = 5000) {
  const icons = {
    error: '<svg class="toast-icon" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>',
    warning: '<svg class="toast-icon" viewBox="0 0 256 256" fill="currentColor"><path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z"/></svg>',
    success: '<svg class="toast-icon" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"/></svg>',
    info: '<svg class="toast-icon" viewBox="0 0 256 256" fill="currentColor"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a8,8,0,0,1-8-8V128a8,8,0,0,1,16,0v48A8,8,0,0,1,136,184Z"/></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${icons[type] || icons.error}<span class="toast-message">${message}</span>`;

  toast.addEventListener('click', () => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  });

  toastContainer.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }
  }, duration);
}

// ── Listen for missing binaries warning from main process ──────────────────
window.api.onMissingBinaries((binaries) => {
  showToast(
    `Missing required tools: ${binaries.join(', ')}. Downloads will not work. Please reinstall the app or install them manually.`,
    'warning',
    10000
  );
});

// ── DOM Elements ───────────────────────────────────────────────────────────
const urlInput = document.getElementById('urlInput');
const btnDownload = document.getElementById('btnDownload');
const activeDownloadsEl = document.getElementById('activeDownloads');
const completedDownloadsEl = document.getElementById('completedDownloads');
const downloadsPageActive = document.getElementById('downloadsPageActive');
const downloadsPageCompleted = document.getElementById('downloadsPageCompleted');
const historyList = document.getElementById('historyList');
const outputDirInput = document.getElementById('outputDirInput');
const btnBrowse = document.getElementById('btnBrowse');
const navItems = document.querySelectorAll('.nav-item');

// ── Trimmer DOM Elements ──────────────────────────────────────────────────
const trimmerPanel = document.getElementById('trimmerPanel');
const trimmerTimeline = document.getElementById('trimmerTimeline');
const trimmerSelection = document.getElementById('trimmerSelection');
const trimmerHandleStart = document.getElementById('trimmerHandleStart');
const trimmerHandleEnd = document.getElementById('trimmerHandleEnd');
const trimmerStartInput = document.getElementById('trimmerStart');
const trimmerEndInput = document.getElementById('trimmerEnd');
const trimmerDurationBadge = document.getElementById('trimmerDuration');
const trimmerVideoInfo = document.getElementById('trimmerVideoInfo');
const trimmerTicks = document.getElementById('trimmerTicks');
const btnTrimDownload = document.getElementById('btnTrimDownload');
const trimmerClose = document.getElementById('trimmerClose');
const trimmerPlayerContainer = document.getElementById('trimmerPlayerContainer');
const trimmerPlayerWrapper = document.getElementById('trimmerPlayerWrapper');
const trimmerPlayerOverlay = document.getElementById('trimmerPlayerOverlay');
const trimmerPlayerTime = document.getElementById('trimmerPlayerTime');
const trimmerPlayBtn = document.getElementById('trimmerPlayBtn');
const trimmerPlayhead = document.getElementById('trimmerPlayhead');

// ── State ──────────────────────────────────────────────────────────────────
let pollingInterval = null;
let diskSpaceInterval = null;
let currentPage = 'home';

// Trimmer state
let trimmerState = {
  open: false,
  url: '',
  totalDuration: 0, // seconds
  startTime: 0,     // seconds
  endTime: 0,       // seconds
  videoTitle: '',
  dragging: null,    // 'start' | 'end' | null
  videoId: null,     // Twitch video ID for embed
  player: null,      // Twitch Player instance
  playerReady: false,
  isPlaying: false,
  seekDebounce: null,
  playheadInterval: null,
  lastSeekTime: 0,   // track last seek position for playhead
};

// ── Navigation ─────────────────────────────────────────────────────────────
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    currentPage = page;
    onPageSwitch(page);
  });
});

function onPageSwitch(page) {
  // Auto-refresh data when navigating to specific pages
  if (page === 'history') {
    loadHistory();
  } else if (page === 'following') {
    checkTwitchAuth();
  } else if (page === 'settings') {
    refreshDiskSpace();
    loadFavoritesList();
  } else if (page === 'downloads') {
    updateUI();
  }
}

// ── Sidebar Toggle ─────────────────────────────────────────────────────────
const sidebar = document.querySelector('.sidebar');
const btnSidebarToggle = document.getElementById('btnSidebarToggle');

btnSidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  localStorage.setItem('sidebarCollapsed', isCollapsed ? '1' : '0');
});

// Restore sidebar state
if (localStorage.getItem('sidebarCollapsed') === '1') {
  sidebar.classList.add('collapsed');
}

// ── Smart Bar: URL detection & Search ──────────────────────────────────────
const searchDropdown = document.getElementById('searchDropdown');
const smartBarMode = document.getElementById('smartBarMode');
const smartBarIcon = document.getElementById('smartBarIcon');
const channelDetail = document.getElementById('channelDetail');
const channelContent = document.getElementById('channelContent');
let searchDebounceTimer = null;
let currentSearchQuery = '';
let currentChannelData = null;

function isTwitchUrl(text) {
  return /^https?:\/\/(www\.)?(twitch\.tv|clips\.twitch\.tv)\//i.test(text) ||
         /^(www\.)?twitch\.tv\//i.test(text);
}

const btnTrimSmartBar = document.getElementById('btnTrimSmartBar');

function updateSmartBarMode(value) {
  if (!value) {
    smartBarMode.textContent = '';
    smartBarMode.classList.remove('visible');
    btnTrimSmartBar.classList.remove('visible');
    // Search icon
    smartBarIcon.innerHTML = '<path d="M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z"/>';
  } else if (isTwitchUrl(value)) {
    smartBarMode.textContent = 'Download';
    smartBarMode.classList.add('visible');
    // Show trim button for VOD URLs (not channel URLs)
    const isVodUrl = /twitch\.tv\/videos\/\d+/i.test(value) || /clips\.twitch\.tv\//i.test(value) || /twitch\.tv\/\w+\/clip\//i.test(value);
    if (isVodUrl) {
      btnTrimSmartBar.classList.add('visible');
    } else {
      btnTrimSmartBar.classList.remove('visible');
    }
    // Download icon
    smartBarIcon.innerHTML = '<path d="M240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H80a8,8,0,0,1,0,16H32v64H224V136H176a8,8,0,0,1,0-16h48A16,16,0,0,1,240,136Zm-117.66-2.34a8,8,0,0,0,11.32,0l48-48a8,8,0,0,0-11.32-11.32L136,108.69V24a8,8,0,0,0-16,0v84.69L85.66,74.34A8,8,0,0,0,74.34,85.66ZM200,168a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/>';
  } else {
    smartBarMode.textContent = 'Search';
    smartBarMode.classList.add('visible');
    btnTrimSmartBar.classList.remove('visible');
    // Search icon
    smartBarIcon.innerHTML = '<path d="M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z"/>';
  }
}

urlInput.addEventListener('input', (e) => {
  const value = e.target.value.trim();
  updateSmartBarMode(value);

  // Close dropdown and cancel search if URL detected or empty
  if (!value || isTwitchUrl(value)) {
    closeSearchDropdown();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    return;
  }

  // Debounced search
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    performSearch(value);
  }, 400);
});

async function performSearch(query) {
  if (query !== urlInput.value.trim()) return; // stale
  currentSearchQuery = query;

  // Show loading
  searchDropdown.innerHTML = '<div class="search-loading"><div class="spinner" style="width:20px;height:20px;margin:0 auto 8px;"></div>Searching...</div>';
  openSearchDropdown();

  const result = await window.api.twitchSearchChannels({ query, first: 15 });

  if (query !== currentSearchQuery) return; // stale

  if (!result.success) {
    searchDropdown.innerHTML = `<div class="search-no-results">Failed to search: ${escapeHtml(result.error)}</div>`;
    return;
  }

  if (result.channels.length === 0) {
    searchDropdown.innerHTML = '<div class="search-no-results">No channels found</div>';
    return;
  }

  searchDropdown.innerHTML = result.channels.map(ch => {
    const isLive = ch.is_live;
    const partnerBadge = ch.broadcaster_type === 'partner'
      ? '<svg class="badge-partner" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M225.86,48.32a8,8,0,0,0-7.21-1.1L186.4,56.89,155.71,26.2a8,8,0,0,0-11.32,0L128,42.56,111.61,26.2a8,8,0,0,0-11.32,0L69.6,56.89,37.35,47.22a8,8,0,0,0-9.72,10.07l33.28,120a8,8,0,0,0,5.41,5.41l120,33.28A8,8,0,0,0,188,216a8,8,0,0,0,7.73-5.93l33.28-120A8,8,0,0,0,225.86,48.32ZM175.32,96H160a8,8,0,0,0-6.4,3.2L128,136l-25.6-36.8A8,8,0,0,0,96,96H80.68l47.32-47.32Z" opacity="0.2"/><path d="M128,96a32,32,0,1,0,32,32A32,32,0,0,0,128,96Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,144Z"/></svg>'
      : '';
    return `
      <div class="search-result-item" data-channel-id="${ch.id}" data-channel-login="${escapeHtml(ch.broadcaster_login)}" data-channel-name="${escapeHtml(ch.display_name)}" data-channel-thumb="${escapeHtml(ch.thumbnail_url)}" data-channel-live="${isLive}" data-channel-game="${escapeHtml(ch.game_name || '')}" data-channel-type="${ch.broadcaster_type || ''}">
        <img class="search-result-avatar" src="${escapeHtml(ch.thumbnail_url)}" alt="" onerror="this.style.display='none'">
        <div class="search-result-info">
          <div class="search-result-name">${escapeHtml(ch.display_name)} ${partnerBadge}</div>
          <div class="search-result-game">${escapeHtml(ch.game_name || 'No category')}</div>
        </div>
        ${isLive ? '<div class="search-result-live"><span class="search-result-live-dot"></span>LIVE</div>' : ''}
      </div>
    `;
  }).join('');

  // Attach click handlers
  searchDropdown.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      openChannelDetail({
        id: item.dataset.channelId,
        login: item.dataset.channelLogin,
        name: item.dataset.channelName,
        thumbnail: item.dataset.channelThumb,
        isLive: item.dataset.channelLive === 'true',
        game: item.dataset.channelGame,
        type: item.dataset.channelType,
      });
    });
  });
}

function openSearchDropdown() {
  searchDropdown.classList.add('open');
  urlInput.classList.add('has-results');
}

function closeSearchDropdown() {
  searchDropdown.classList.remove('open');
  urlInput.classList.remove('has-results');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.smart-bar-wrapper')) {
    closeSearchDropdown();
  }
});

// ── Channel Detail View ──────────────────────────────────────────────────
async function openChannelDetail(channel) {
  closeSearchDropdown();
  urlInput.value = '';
  updateSmartBarMode('');
  currentChannelData = channel;

  // Show channel detail, hide downloads sections
  channelDetail.classList.add('active');

  // Populate header
  document.getElementById('channelDetailAvatar').src = channel.thumbnail;
  document.getElementById('channelDetailName').textContent = channel.name;
  document.getElementById('channelDetailBadge').innerHTML = channel.type === 'partner'
    ? '<svg viewBox="0 0 256 256" fill="#9146ff" width="18" height="18"><path d="M225.86,48.32a8,8,0,0,0-7.21-1.1L186.4,56.89,155.71,26.2a8,8,0,0,0-11.32,0L128,42.56,111.61,26.2a8,8,0,0,0-11.32,0L69.6,56.89,37.35,47.22a8,8,0,0,0-9.72,10.07l33.28,120a8,8,0,0,0,5.41,5.41l120,33.28A8,8,0,0,0,188,216a8,8,0,0,0,7.73-5.93l33.28-120A8,8,0,0,0,225.86,48.32ZM128,96a32,32,0,1,0,32,32A32,32,0,0,0,128,96Zm0,48a16,16,0,1,1,16-16A16,16,0,0,1,128,144Z"/></svg>'
    : '';
  document.getElementById('channelDetailLive').innerHTML = channel.isLive
    ? '<span class="channel-detail-live-badge"><span class="search-result-live-dot" style="width:6px;height:6px;"></span>LIVE</span>'
    : '';
  document.getElementById('channelDetailMeta').textContent = channel.game ? `Playing ${channel.game}` : '';

  // Set up tabs
  const tabs = channelDetail.querySelectorAll('.channel-tab');
  tabs.forEach(tab => {
    tab.classList.remove('active');
    if (tab.dataset.tab === 'vods') tab.classList.add('active');
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (tab.dataset.tab === 'vods') {
        loadChannelVods(channel.id);
      } else {
        loadChannelClips(channel.id);
      }
    };
  });

  // Update favorite button
  updateFavoriteButton(channel.id);

  // Load VODs by default
  loadChannelVods(channel.id);
}

function closeChannelDetail() {
  channelDetail.classList.remove('active');
  currentChannelData = null;
}

document.getElementById('btnChannelBack').addEventListener('click', closeChannelDetail);

async function loadChannelVods(userId) {
  channelContent.innerHTML = `
    <div class="following-loading">
      <div class="spinner"></div>
      <div>Loading VODs...</div>
    </div>`;

  const result = await window.api.twitchGetVods({ userId, first: 30 });

  if (!result.success) {
    channelContent.innerHTML = `<div class="empty-state">Failed to load VODs: ${escapeHtml(result.error)}</div>`;
    return;
  }

  if (result.videos.length === 0) {
    channelContent.innerHTML = '<div class="empty-state">No VODs available for this channel.</div>';
    return;
  }

  channelContent.innerHTML = '<div class="vod-feed">' + result.videos.map(vod => {
    const thumbUrl = getTwitchThumbnailUrl(vod.thumbnail_url, 320, 180);
    const duration = formatTwitchDuration(vod.duration);
    const date = formatTwitchDate(vod.created_at);
    const views = vod.view_count ? Number(vod.view_count).toLocaleString() + ' views' : '';
    const vodUrl = vod.url || `https://www.twitch.tv/videos/${vod.id}`;
    const safeUrl = escapeHtml(vodUrl).replace(/'/g, "\\'");

    return `
      <div class="vod-card">
        <div class="vod-thumb">
          ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" onerror="this.style.display='none'">` : ''}
          ${duration ? `<span class="vod-duration">${duration}</span>` : ''}
        </div>
        <div class="vod-info">
          <div class="vod-title" title="${escapeHtml(vod.title)}">${escapeHtml(vod.title)}</div>
          <div class="vod-meta">${[date, views].filter(Boolean).join(' &bull; ')}</div>
        </div>
        <div class="vod-actions">
          <button class="btn-vod-trim" onclick="openTrimmerFromVod('${safeUrl}', '${escapeHtml(vod.duration || '')}', '${escapeHtml(vod.title).replace(/'/g, "\\'")}')" title="Trim & Download">
            <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M157.73,113.13A36,36,0,0,1,109.2,70.06L78.57,28.8a8,8,0,0,1,12.86-9.5l59.89,80.65A36.24,36.24,0,0,1,157.73,113.13ZM236,192a36,36,0,0,1-60.91,26.12L98.37,128H72.2l-9.63,13a8,8,0,1,1-12.86-9.5l10-13.53-10-13.53a8,8,0,0,1,12.86-9.5l9.63,13H98.37L175.09,29.88A36,36,0,1,1,192,64a35.72,35.72,0,0,1-17.73-4.73L136.63,110l37.64,50.72A35.72,35.72,0,0,1,192,156,36,36,0,0,1,236,192Zm-16,0a20,20,0,1,0-20,20A20,20,0,0,0,220,192Zm0-128a20,20,0,1,0-20,20A20,20,0,0,0,220,64Z"/></svg>
          </button>
          <button class="btn-vod-download" onclick="downloadVod('${safeUrl}', this)">
            <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H80a8,8,0,0,1,0,16H32v64H224V136H176a8,8,0,0,1,0-16h48A16,16,0,0,1,240,136Zm-117.66-2.34a8,8,0,0,0,11.32,0l48-48a8,8,0,0,0-11.32-11.32L136,108.69V24a8,8,0,0,0-16,0v84.69L85.66,74.34A8,8,0,0,0,74.34,85.66ZM200,168a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
            Download
          </button>
        </div>
      </div>
    `;
  }).join('') + '</div>';
}

async function loadChannelClips(broadcasterId) {
  channelContent.innerHTML = `
    <div class="following-loading">
      <div class="spinner"></div>
      <div>Loading clips...</div>
    </div>`;

  const result = await window.api.twitchGetClips({ broadcasterId, first: 30 });

  if (!result.success) {
    channelContent.innerHTML = `<div class="empty-state">Failed to load clips: ${escapeHtml(result.error)}</div>`;
    return;
  }

  if (result.clips.length === 0) {
    channelContent.innerHTML = '<div class="empty-state">No clips available for this channel.</div>';
    return;
  }

  channelContent.innerHTML = '<div class="vod-feed">' + result.clips.map(clip => {
    const clipUrl = clip.url;
    const safeUrl = escapeHtml(clipUrl).replace(/'/g, "\\'");
    const views = clip.view_count ? Number(clip.view_count).toLocaleString() + ' views' : '';
    const date = formatTwitchDate(clip.created_at);
    const creatorName = clip.creator_name || '';

    return `
      <div class="clip-card">
        <div class="clip-thumb">
          <img src="${escapeHtml(clip.thumbnail_url)}" alt="" onerror="this.style.display='none'">
          ${views ? `<span class="clip-views">${views}</span>` : ''}
        </div>
        <div class="clip-info">
          <div class="clip-title" title="${escapeHtml(clip.title)}">${escapeHtml(clip.title)}</div>
          <div class="clip-meta">${[creatorName ? 'Clipped by ' + escapeHtml(creatorName) : '', date].filter(Boolean).join(' &bull; ')}</div>
        </div>
        <div class="clip-actions">
          <button class="btn-clip-download" onclick="downloadVod('${safeUrl}', this)">
            <svg viewBox="0 0 256 256" fill="currentColor" width="12" height="12"><path d="M240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H80a8,8,0,0,1,0,16H32v64H224V136H176a8,8,0,0,1,0-16h48A16,16,0,0,1,240,136Zm-117.66-2.34a8,8,0,0,0,11.32,0l48-48a8,8,0,0,0-11.32-11.32L136,108.69V24a8,8,0,0,0-16,0v84.69L85.66,74.34A8,8,0,0,0,74.34,85.66ZM200,168a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
            Download
          </button>
        </div>
      </div>
    `;
  }).join('') + '</div>';
}

// ── Download Button ────────────────────────────────────────────────────────
btnDownload.addEventListener('click', async () => {
  let url = urlInput.value.trim();

  // If empty, try clipboard
  if (!url) {
    try {
      url = await navigator.clipboard.readText();
      url = url.trim();
      urlInput.value = url;
    } catch (e) {
      // clipboard access denied
    }
  }

  if (!url) return;

  // If it's a search query (not a URL), ignore the download button
  if (!isTwitchUrl(url) && !url.startsWith('http')) {
    return;
  }

  // Basic URL validation
  if (!url.startsWith('http')) {
    url = 'https://' + url;
    urlInput.value = url;
  }

  btnDownload.disabled = true;
  btnDownload.textContent = 'Starting...';

  const result = await window.api.startDownload(url);

  btnDownload.disabled = false;
  btnDownload.innerHTML = `
    <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H80a8,8,0,0,1,0,16H32v64H224V136H176a8,8,0,0,1,0-16h48A16,16,0,0,1,240,136Zm-117.66-2.34a8,8,0,0,0,11.32,0l48-48a8,8,0,0,0-11.32-11.32L136,108.69V24a8,8,0,0,0-16,0v84.69L85.66,74.34A8,8,0,0,0,74.34,85.66ZM200,168a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
    Download
  `;

  if (result.success) {
    urlInput.value = '';
    updateSmartBarMode('');
    startPolling();
    refreshDiskSpace(); // Update disk space as download begins consuming space
  } else {
    showToast('Failed to start download: ' + (result.error || 'Unknown error'), 'error');
  }
});

// Smart bar Trim button — opens the trimmer panel
btnTrimSmartBar.addEventListener('click', () => {
  let url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  // Close channel detail if open
  closeChannelDetail();
  window.openTrimmerFromUrl(url);
});

// Enter key support
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const value = urlInput.value.trim();
    if (isTwitchUrl(value) || !value) {
      btnDownload.click();
    }
  }
  if (e.key === 'Escape') {
    closeSearchDropdown();
    closeChannelDetail();
  }
});

// ── Polling ────────────────────────────────────────────────────────────────
function startPolling() {
  if (pollingInterval) return;
  pollingInterval = setInterval(updateUI, 1000);
  updateUI();
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function updateUI() {
  const data = await window.api.getDownloads();

  // ── Active Downloads ─────────────────────────────────────────
  const emptyActiveIllustrated = `
    <div class="empty-state-illustrated">
      <div class="empty-illustration">
        <img src="98410-meme-the-pepe-frog-sad.png" alt="Sad Pepe" style="width:130px;height:auto;">
      </div>
      <div>No active downloads.</div>
    </div>`;

  const renderActive = (container, useIllustration = false) => {
    if (data.active.length === 0) {
      container.innerHTML = useIllustration ? emptyActiveIllustrated : '<div class="empty-state">No active downloads.</div>';
      return;
    }

    container.innerHTML = data.active.map(dl => `
      <div class="download-card" data-id="${dl.id}">
        <div class="download-card-header">
          <div>
            <div class="download-title">${escapeHtml(dl.title)}</div>
            <div class="download-url">${escapeHtml(truncateUrl(dl.url))}</div>
          </div>
          <button class="btn-cancel" onclick="cancelDownload('${dl.id}')" title="Cancel">&times;</button>
        </div>
        <div class="progress-row">
          <span>Progress: ${Math.round(dl.progress)}%</span>
          <span>${formatBytes(dl.downloaded)} / ${formatBytes(dl.total)}</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${dl.progress}%"></div>
        </div>
        <div class="speed-row">
          <span>Speed: ${dl.speed}</span>
          <span>ETA: ${dl.eta}</span>
        </div>
      </div>
    `).join('');
  };

  renderActive(activeDownloadsEl, true);
  renderActive(downloadsPageActive, false);

  // ── Completed Downloads ──────────────────────────────────────
  const renderCompletedCard = (dl) => {
    const safeFilePath = escapeHtml(dl.filePath || '').replace(/'/g, "\\'");
    return `
      <div class="completed-card">
        <div class="completed-thumbnail">
          ${dl.thumbnail
            ? `<img src="${escapeHtml(dl.thumbnail)}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'placeholder-thumb\\'><svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><rect x=\\'2\\' y=\\'2\\' width=\\'20\\' height=\\'20\\' rx=\\'2\\'/><circle cx=\\'12\\' cy=\\'12\\' r=\\'3\\'/></svg></div>'">`
            : `<div class="placeholder-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`
          }
          ${dl.duration ? `<span class="duration-badge">${dl.duration}</span>` : ''}
        </div>
        <div class="completed-info">
          <div class="completed-title" title="${escapeHtml(dl.title)}">${escapeHtml(dl.title)}</div>
          <div class="completed-meta">${dl.fileSize || '—'} &bull; MP4</div>
          <button class="btn-open-folder" onclick="openFolder('${safeFilePath}')">
            <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M216,72H131.31L104,44.69A15.86,15.86,0,0,0,92.69,40H40A16,16,0,0,0,24,56V200.62A15.4,15.4,0,0,0,39.38,216H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Zm0,128H40V64H92.69l16,16H40a8,8,0,0,0,0,16H216Z"/></svg>
            Open Folder
          </button>
        </div>
      </div>
    `;
  };

  const renderStreamInfoPanel = (dl) => {
    const initial = (dl.channel || '?')[0].toUpperCase();
    const viewStr = dl.viewCount ? Number(dl.viewCount).toLocaleString() : '';
    const categorySlug = (dl.category || '').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
    return `
      <div class="stream-info-panel">
        <div class="stream-info-header">
          <div class="streamer-avatar">
            ${dl.uploaderThumbnail
              ? `<img src="${escapeHtml(dl.uploaderThumbnail)}" alt="" onerror="this.parentElement.innerHTML='<div class=avatar-placeholder>${initial}</div>'">`
              : `<div class="avatar-placeholder">${initial}</div>`
            }
          </div>
          <div class="streamer-name">
            ${escapeHtml(dl.channel || 'Unknown')}
            ${dl.isPartner ? `<span class="verified-badge"><svg viewBox="0 0 24 24" fill="#fff"><polyline points="20 6 9 17 4 12" stroke="#fff" stroke-width="3" fill="none"/></svg></span>` : ''}
          </div>
        </div>
        <div class="stream-title">${escapeHtml(dl.title)}</div>
        ${dl.category ? `
          <div class="stream-category">
            <div class="category-thumb">
              <img src="https://static-cdn.jtvnw.net/ttv-boxart/${encodeURIComponent(dl.category)}-36x48.jpg" alt="" onerror="this.style.display='none'">
            </div>
            <div class="category-info">
              <div class="category-name">${escapeHtml(dl.category)}</div>
              ${viewStr ? `<div class="category-viewers">Peak Viewers: ${viewStr}</div>` : ''}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  };

  const renderCompleted = (container, withInfoPanel = false) => {
    if (data.completed.length === 0) {
      container.innerHTML = '<div class="empty-state" style="width:100%">No completed downloads yet.</div>';
      return;
    }

    if (withInfoPanel) {
      container.innerHTML = data.completed.map(dl => `
        <div class="completed-with-info">
          ${renderCompletedCard(dl)}
          ${renderStreamInfoPanel(dl)}
        </div>
      `).join('');
    } else {
      container.innerHTML = data.completed.map(dl => renderCompletedCard(dl)).join('');
    }
  };

  renderCompleted(completedDownloadsEl, true);
  renderCompleted(downloadsPageCompleted, false);

  // History is loaded separately via loadHistory()

  // Stop polling if no active downloads
  if (data.active.length === 0 && pollingInterval) {
    // Keep polling for a few more seconds in case new downloads start
    setTimeout(() => {
      window.api.getDownloads().then(d => {
        if (d.active.length === 0) stopPolling();
      });
    }, 3000);
  }
}

// ── Actions ────────────────────────────────────────────────────────────────
window.cancelDownload = async (id) => {
  await window.api.cancelDownload(id);
  updateUI();
};

window.openFolder = async (filePath) => {
  await window.api.openFolder(filePath);
};

window.removeHistoryItem = async (id) => {
  await window.api.removeHistoryItem(id);
  loadHistory();
};

window.deleteFileAndHistory = async (id) => {
  await window.api.deleteFileAndHistory(id);
  loadHistory();
  refreshDiskSpace(); // Disk space changed after file deletion
};

window.redownload = async (url) => {
  if (!url) return;
  const result = await window.api.startDownload(url);
  if (result.success) {
    // Switch to home page
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector('[data-page="home"]').classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-home').classList.add('active');
    startPolling();
  }
};

// ── History ────────────────────────────────────────────────────────────────
let historyOffset = 0;
const HISTORY_PAGE_SIZE = 30;

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function renderHistoryItem(item) {
  const safeFilePath = escapeHtml(item.filePath || '').replace(/'/g, "\\'");
  const safeUrl = escapeHtml(item.url || '').replace(/'/g, "\\'");
  return `
    <div class="history-item" data-id="${item.id}">
      <div class="history-thumb">
        ${item.thumbnail
          ? `<img src="${escapeHtml(item.thumbnail)}" alt="" onerror="this.parentElement.innerHTML='<div class=thumb-placeholder><svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><rect x=\\'2\\' y=\\'2\\' width=\\'20\\' height=\\'20\\' rx=\\'2\\'/><circle cx=\\'12\\' cy=\\'12\\' r=\\'3\\'/></svg></div>'">`
          : `<div class="thumb-placeholder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`
        }
        ${item.duration ? `<span class="mini-duration">${item.duration}</span>` : ''}
      </div>
      <div class="history-item-info">
        <div class="history-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="history-item-meta">${item.fileSize || '—'} &bull; MP4 &bull; ${escapeHtml(truncateUrl(item.url))}</div>
        <div class="history-item-date">${formatDate(item.completedAt)}</div>
      </div>
      <div class="history-actions">
        <button class="btn-small" onclick="openFolder('${safeFilePath}')">Open</button>
        <button class="btn-small" onclick="redownload('${safeUrl}')">Re-download</button>
        <button class="btn-small danger" onclick="removeHistoryItem('${item.id}')">Remove</button>
      </div>
    </div>
  `;
}

async function loadHistory(append = false) {
  if (!append) historyOffset = 0;

  const { items, total } = await window.api.getHistory({ limit: HISTORY_PAGE_SIZE, offset: historyOffset });

  const loadMoreEl = document.getElementById('historyLoadMore');
  const btnClearHistory = document.getElementById('btnClearHistory');

  if (total === 0) {
    historyList.innerHTML = '<div class="empty-state">No download history yet.</div>';
    loadMoreEl.style.display = 'none';
    btnClearHistory.style.display = 'none';
    return;
  }

  btnClearHistory.style.display = 'block';

  if (append) {
    historyList.insertAdjacentHTML('beforeend', items.map(renderHistoryItem).join(''));
  } else {
    historyList.innerHTML = items.map(renderHistoryItem).join('');
  }

  historyOffset += items.length;
  loadMoreEl.style.display = historyOffset < total ? 'block' : 'none';
}

// Clear history button
document.getElementById('btnClearHistory').addEventListener('click', async () => {
  await window.api.clearHistory();
  loadHistory();
});

// Load more button
document.getElementById('btnLoadMore').addEventListener('click', () => {
  loadHistory(true);
});

// ── Helpers ────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function truncateUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url.substring(0, 60);
  }
}

// ── Settings Profile Card ──────────────────────────────────────────────────
const settingsProfileCard = document.getElementById('settingsProfileCard');
const settingsProfileLoggedOut = document.getElementById('settingsProfileLoggedOut');

async function loadSettingsProfile() {
  const status = await window.api.twitchGetAuthStatus();
  if (!status.authenticated) {
    settingsProfileCard.style.display = 'none';
    settingsProfileLoggedOut.style.display = 'block';
    return;
  }
  settingsProfileCard.style.display = 'block';
  settingsProfileLoggedOut.style.display = 'none';

  const u = status.user;

  document.getElementById('settingsProfileAvatar').src = u.profileImageUrl;
  document.getElementById('settingsProfileName').textContent = u.displayName;
  document.getElementById('settingsProfileLogin').textContent = '@' + u.login;
  document.getElementById('settingsProfileId').textContent = u.userId;

  // Broadcaster badge
  const badge = document.getElementById('settingsProfileBadge');
  if (u.broadcasterType === 'partner') {
    badge.textContent = '✓ Partner';
    badge.className = 'profile-badge partner';
    badge.style.display = 'inline-flex';
  } else if (u.broadcasterType === 'affiliate') {
    badge.textContent = '★ Affiliate';
    badge.className = 'profile-badge affiliate';
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }

  // Bio
  const bioEl = document.getElementById('settingsProfileBio');
  if (u.bio) {
    bioEl.textContent = '"' + u.bio + '"';
    bioEl.style.display = 'block';
  } else {
    bioEl.style.display = 'none';
  }

  // Member since
  if (u.createdAt) {
    const date = new Date(u.createdAt);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const memberSince = `${months[date.getMonth()]} ${date.getFullYear()}`;
    const years = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    document.getElementById('settingsProfileAge').textContent = memberSince + (years > 0 ? ` (${years}y)` : '');
  } else {
    document.getElementById('settingsProfileAge').textContent = '—';
  }

  // Chat color
  const colorEl = document.getElementById('settingsProfileColor');
  const colorStat = document.getElementById('settingsProfileColorStat');
  if (u.chatColor) {
    colorEl.innerHTML = `<span class="profile-color-swatch" style="background:${u.chatColor};"></span>${u.chatColor}`;
    colorStat.style.display = 'flex';
  } else {
    colorEl.innerHTML = '<span style="color:#6a6a8a;">Default</span>';
    colorStat.style.display = 'flex';
  }
}

// Load profile on startup
loadSettingsProfile();

// "Connect on Following page" link
document.getElementById('settingsGoToFollowing')?.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('[data-page="following"]').classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-following').classList.add('active');
});

// ── Settings ───────────────────────────────────────────────────────────────
const qualitySelect = document.getElementById('qualitySelect');
const bandwidthInput = document.getElementById('bandwidthInput');
const bandwidthUnit = document.getElementById('bandwidthUnit');
const threadsSlider = document.getElementById('threadsSlider');
const threadsValue = document.getElementById('threadsValue');
const aria2cStatus = document.getElementById('aria2cStatus');

// Load settings from backend
(async () => {
  const s = await window.api.getSettings();
  outputDirInput.value = s.outputDir;
  qualitySelect.value = s.quality;
  threadsSlider.value = s.segmentedThreads;
  threadsValue.textContent = s.segmentedThreads;

  // Show bandwidth in MB/s by default
  if (s.bandwidthLimit > 0) {
    bandwidthInput.value = Math.round(s.bandwidthLimit / 1048576);
  } else {
    bandwidthInput.value = 0;
  }

  // aria2c status indicator
  if (s.aria2cAvailable) {
    aria2cStatus.innerHTML = '<span style="color:#4ade80;">— Installed</span>';
    threadsSlider.disabled = false;
  } else {
    aria2cStatus.innerHTML = '<span style="color:#ff6b6b;">— Not installed (brew install aria2)</span>';
    threadsSlider.disabled = true;
  }

  // Disk space indicator
  updateDiskSpace(s);
})();

function updateDiskSpace(s) {
  const bar = document.getElementById('diskSpaceBar');
  const text = document.getElementById('diskSpaceText');
  const fill = document.getElementById('diskSpaceFill');
  if (s && s.diskSpace) {
    bar.style.display = 'block';
    const avail = formatBytes(s.diskSpace.available);
    const total = formatBytes(s.diskSpace.total);
    const pct = s.diskSpace.usedPercent;
    text.textContent = `${avail} free of ${total}`;
    fill.style.width = pct + '%';
    // Color: green < 70%, yellow 70-90%, red > 90%
    if (pct > 90) {
      fill.style.background = '#ef4444';
      text.style.color = '#ef4444';
    } else if (pct > 70) {
      fill.style.background = '#f59e0b';
      text.style.color = '#f59e0b';
    } else {
      fill.style.background = '#4ade80';
      text.style.color = '#9a9ab0';
    }
  } else {
    bar.style.display = 'none';
  }
}

// Lightweight disk space refresh — callable from anywhere
async function refreshDiskSpace() {
  const s = await window.api.getSettings();
  updateDiskSpace(s);
}

// Auto-refresh disk space every 30 seconds (catches external file changes, deletions, etc.)
function startDiskSpaceRefresh() {
  if (diskSpaceInterval) return;
  diskSpaceInterval = setInterval(refreshDiskSpace, 30000);
}

startDiskSpaceRefresh();

btnBrowse.addEventListener('click', async () => {
  const result = await window.api.selectOutputDir();
  if (result.success) {
    outputDirInput.value = result.path;
    await window.api.setSettings({ outputDir: result.path });
    // Refresh disk space for new location
    const s = await window.api.getSettings();
    updateDiskSpace(s);
  }
});

qualitySelect.addEventListener('change', async () => {
  await window.api.setSettings({ quality: qualitySelect.value });
});

bandwidthInput.addEventListener('change', async () => {
  const val = parseInt(bandwidthInput.value) || 0;
  const unit = parseInt(bandwidthUnit.value);
  await window.api.setSettings({ bandwidthLimit: val * unit });
});

bandwidthUnit.addEventListener('change', async () => {
  const val = parseInt(bandwidthInput.value) || 0;
  const unit = parseInt(bandwidthUnit.value);
  await window.api.setSettings({ bandwidthLimit: val * unit });
});

threadsSlider.addEventListener('input', () => {
  threadsValue.textContent = threadsSlider.value;
});

threadsSlider.addEventListener('change', async () => {
  await window.api.setSettings({ segmentedThreads: parseInt(threadsSlider.value) });
});

// ── Auto-Download Favorites Toggle ────────────────────────────────────────
const autoDownloadToggle = document.getElementById('autoDownloadToggle');
const autoDownloadStatus = document.getElementById('autoDownloadStatus');
const favoritesList = document.getElementById('favoritesList');
const favoritesGrid = document.getElementById('favoritesGrid');

// Load initial state
(async () => {
  const s = await window.api.getSettings();
  updateToggleVisual(s.autoDownloadFavorites);
  loadFavoritesList();
})();

function updateToggleVisual(on) {
  const knob = autoDownloadToggle.querySelector('.toggle-knob');
  if (on) {
    autoDownloadToggle.style.background = '#9146ff';
    knob.style.left = '22px';
    knob.style.background = '#fff';
    autoDownloadStatus.textContent = 'On';
    autoDownloadStatus.style.color = '#9146ff';
  } else {
    autoDownloadToggle.style.background = '#3a3a5c';
    knob.style.left = '2px';
    knob.style.background = '#6a6a8a';
    autoDownloadStatus.textContent = 'Off';
    autoDownloadStatus.style.color = '#6a6a8a';
  }
}

autoDownloadToggle.addEventListener('click', async () => {
  const s = await window.api.getSettings();
  const newVal = !s.autoDownloadFavorites;
  await window.api.setSettings({ autoDownloadFavorites: newVal });
  updateToggleVisual(newVal);
});

async function loadFavoritesList() {
  const result = await window.api.getFavorites();
  const channels = result.channels || [];
  if (channels.length === 0) {
    favoritesList.style.display = 'none';
    return;
  }
  favoritesList.style.display = 'block';
  favoritesGrid.innerHTML = channels.map(ch => `
    <div class="favorite-chip">
      <img src="${escapeHtml(ch.profileImageUrl)}" alt="">
      <span>${escapeHtml(ch.displayName)}</span>
      <button class="remove-fav" data-id="${escapeHtml(ch.id)}" title="Remove">×</button>
    </div>
  `).join('');

  favoritesGrid.querySelectorAll('.remove-fav').forEach(btn => {
    btn.addEventListener('click', async () => {
      await window.api.removeFavorite(btn.dataset.id);
      loadFavoritesList();
    });
  });
}

// ── Favorite Button (Channel Detail) ──────────────────────────────────────
const btnFavorite = document.getElementById('btnFavorite');

async function updateFavoriteButton(channelId) {
  const result = await window.api.isFavorite(channelId);
  if (result.isFavorite) {
    btnFavorite.classList.add('favorited');
    btnFavorite.title = 'Remove from favorites';
    // Filled star SVG
    btnFavorite.innerHTML = '<svg viewBox="0 0 256 256" width="20" height="20" fill="currentColor"><path d="M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z"/></svg>';
  } else {
    btnFavorite.classList.remove('favorited');
    btnFavorite.title = 'Add to favorites';
    // Outline star SVG (duotone)
    btnFavorite.innerHTML = '<svg viewBox="0 0 256 256" width="20" height="20" fill="currentColor"><path d="M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z" opacity="0.2"/><path d="M239.18,97.26A16.38,16.38,0,0,0,224.92,86l-59-4.76L143.14,26.15a16.36,16.36,0,0,0-30.27,0L90.11,81.23,31.08,86a16.46,16.46,0,0,0-9.37,28.86l45,38.83L53,211.75a16.4,16.4,0,0,0,24.5,17.82L128,198.49l50.53,31.08A16.4,16.4,0,0,0,203,211.75l-13.76-58.07,45-38.83A16.43,16.43,0,0,0,239.18,97.26Zm-15.34,13.89-49.54,42.77a8,8,0,0,0-2.56,7.91l15.15,63.94a.37.37,0,0,1-.17.48.22.22,0,0,1-.13,0l-55.67-34.26a7.93,7.93,0,0,0-8.38,0L47.4,225.94a.22.22,0,0,1-.13,0,.37.37,0,0,1-.17-.48l15.18-63.94a8,8,0,0,0-2.56-7.91L10.18,111.15a.37.37,0,0,1-.12-.48.39.39,0,0,1,.36-.28l64.86-5.23A8,8,0,0,0,82,100.65l25.05-60.66a.39.39,0,0,1,.72,0L132.8,100.65a8,8,0,0,0,6.75,4.51l64.86,5.23a.39.39,0,0,1,.36.28A.37.37,0,0,1,223.84,111.15Z"/></svg>';
  }
}

btnFavorite.addEventListener('click', async () => {
  if (!currentChannelData) return;
  const result = await window.api.isFavorite(currentChannelData.id);
  if (result.isFavorite) {
    await window.api.removeFavorite(currentChannelData.id);
  } else {
    await window.api.addFavorite({
      id: currentChannelData.id,
      login: currentChannelData.login,
      displayName: currentChannelData.name,
      profileImageUrl: currentChannelData.thumbnail,
    });
  }
  updateFavoriteButton(currentChannelData.id);
  loadFavoritesList();
});

// ── Following Page ──────────────────────────────────────────────────────────

const followingLoggedOut = document.getElementById('followingLoggedOut');
const followingLoggedIn = document.getElementById('followingLoggedIn');
const followingVodList = document.getElementById('followingVodList');
const followingAvatar = document.getElementById('followingAvatar');
const followingUsername = document.getElementById('followingUsername');
const liveSection = document.getElementById('liveSection');
const liveChannelsList = document.getElementById('liveChannelsList');
const liveCount = document.getElementById('liveCount');

// Track which channels are live (for VOD card indicators)
let liveChannelLogins = new Set();

function formatTwitchDuration(duration) {
  // Twitch format: "1h2m3s", "45m12s", "3m5s"
  if (!duration) return '';
  const h = duration.match(/(\d+)h/);
  const m = duration.match(/(\d+)m/);
  const s = duration.match(/(\d+)s/);
  const hours = h ? parseInt(h[1]) : 0;
  const mins = m ? parseInt(m[1]) : 0;
  const secs = s ? parseInt(s[1]) : 0;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }
  return `${mins}:${String(secs).padStart(2,'0')}`;
}

function formatTwitchDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const diff = now - d;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getTwitchThumbnailUrl(template, width, height) {
  if (!template) return '';
  return template.replace('%{width}', width).replace('%{height}', height);
}

function renderVodCard(vod) {
  const thumbUrl = getTwitchThumbnailUrl(vod.thumbnail_url, 320, 180);
  const duration = formatTwitchDuration(vod.duration);
  const date = formatTwitchDate(vod.created_at);
  const views = vod.view_count ? Number(vod.view_count).toLocaleString() + ' views' : '';
  const vodUrl = vod.url || `https://www.twitch.tv/videos/${vod.id}`;
  const safeUrl = escapeHtml(vodUrl).replace(/'/g, "\\'");
  const channelName = vod.channel_name || vod.user_name || '';
  const channelLogin = (vod.channel_login || vod.user_login || '').toLowerCase();
  const isLive = liveChannelLogins.has(channelLogin);

  return `
    <div class="vod-card">
      <div class="vod-thumb">
        ${thumbUrl
          ? `<img src="${escapeHtml(thumbUrl)}" alt="" onerror="this.style.display='none'">`
          : ''
        }
        ${duration ? `<span class="vod-duration">${duration}</span>` : ''}
      </div>
      <div class="vod-info">
        <div class="vod-title" title="${escapeHtml(vod.title)}">${escapeHtml(vod.title)}</div>
        <div class="vod-channel">${isLive ? '<span class="vod-channel-live"><span class="vod-live-dot"></span></span>' : ''}${escapeHtml(channelName)}</div>
        <div class="vod-meta">${[date, views].filter(Boolean).join(' &bull; ')}</div>
      </div>
      <div class="vod-actions">
        <button class="btn-vod-trim" onclick="openTrimmerFromVod('${safeUrl}', '${escapeHtml(vod.duration || '')}', '${escapeHtml(vod.title).replace(/'/g, "\\'")}')" title="Trim & Download">
          <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M157.73,113.13A36,36,0,0,1,109.2,70.06L78.57,28.8a8,8,0,0,1,12.86-9.5l59.89,80.65A36.24,36.24,0,0,1,157.73,113.13ZM236,192a36,36,0,0,1-60.91,26.12L98.37,128H72.2l-9.63,13a8,8,0,1,1-12.86-9.5l10-13.53-10-13.53a8,8,0,0,1,12.86-9.5l9.63,13H98.37L175.09,29.88A36,36,0,1,1,192,64a35.72,35.72,0,0,1-17.73-4.73L136.63,110l37.64,50.72A35.72,35.72,0,0,1,192,156,36,36,0,0,1,236,192Zm-16,0a20,20,0,1,0-20,20A20,20,0,0,0,220,192Zm0-128a20,20,0,1,0-20,20A20,20,0,0,0,220,64Z"/></svg>
        </button>
        <button class="btn-vod-download" onclick="downloadVod('${safeUrl}', this)">
          <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H80a8,8,0,0,1,0,16H32v64H224V136H176a8,8,0,0,1,0-16h48A16,16,0,0,1,240,136Zm-117.66-2.34a8,8,0,0,0,11.32,0l48-48a8,8,0,0,0-11.32-11.32L136,108.69V24a8,8,0,0,0-16,0v84.69L85.66,74.34A8,8,0,0,0,74.34,85.66ZM200,168a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
          Download
        </button>
      </div>
    </div>
  `;
}

window.downloadVod = async (url, btn) => {
  if (!url) return;
  btn.disabled = true;
  btn.textContent = 'Starting...';
  const result = await window.api.startDownload(url);
  if (result.success) {
    btn.textContent = 'Queued';
    startPolling();
  } else {
    btn.disabled = false;
    btn.innerHTML = `
      <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H80a8,8,0,0,1,0,16H32v64H224V136H176a8,8,0,0,1,0-16h48A16,16,0,0,1,240,136Zm-117.66-2.34a8,8,0,0,0,11.32,0l48-48a8,8,0,0,0-11.32-11.32L136,108.69V24a8,8,0,0,0-16,0v84.69L85.66,74.34A8,8,0,0,0,74.34,85.66ZM200,168a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
      Download
    `;
    showToast('Download failed: ' + (result.error || 'Unknown error'), 'error');
  }
};

function formatViewerCount(count) {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return String(count);
}

function getLiveStreamThumbnail(template, width, height) {
  if (!template) return '';
  return template.replace('{width}', width).replace('{height}', height);
}

function renderLiveCard(stream) {
  const thumbUrl = getLiveStreamThumbnail(stream.thumbnail_url, 440, 248);
  const viewers = formatViewerCount(stream.viewer_count);

  return `
    <div class="live-card"
      data-channel="${escapeHtml(stream.user_login)}"
      data-name="${escapeHtml(stream.user_name)}"
      data-game="${escapeHtml(stream.game_name || '')}"
      data-title="${escapeHtml(stream.title || '')}"
      data-viewers="${stream.viewer_count}"
      title="${escapeHtml(stream.title)}">
      <div class="live-card-thumb">
        ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="live-badge">LIVE</span>
        <span class="live-viewers"><span class="live-viewers-dot"></span>${viewers}</span>
      </div>
      <div class="live-card-info">
        <div class="live-card-name">${escapeHtml(stream.user_name)}</div>
        <div class="live-card-game">${escapeHtml(stream.game_name || '')}</div>
        <div class="live-card-title">${escapeHtml(stream.title || '')}</div>
      </div>
    </div>
  `;
}

async function loadLiveStreams() {
  const result = await window.api.twitchGetLiveFollowed();
  if (!result.success || result.streams.length === 0) {
    liveSection.style.display = 'none';
    liveChannelLogins = new Set();
    return;
  }

  liveChannelLogins = new Set(result.streams.map(s => s.user_login.toLowerCase()));
  liveSection.style.display = 'block';
  liveCount.textContent = `(${result.streams.length})`;
  liveChannelsList.innerHTML = result.streams.map(renderLiveCard).join('');
  attachLiveCardHoverListeners();
}

// ── Live Inline Player on Hover ────────────────────────────────────────────
let hoverTimeout = null;
let activePlayerCard = null;

function attachLiveCardHoverListeners() {
  const cards = liveChannelsList.querySelectorAll('.live-card');
  cards.forEach(card => {
    card.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        const channel = card.dataset.channel;
        if (activePlayerCard === card) return;

        // Remove player from any other card
        if (activePlayerCard) removeInlinePlayer(activePlayerCard);

        activePlayerCard = card;
        card.classList.add('playing');
        const thumb = card.querySelector('.live-card-thumb');
        const iframe = document.createElement('iframe');
        iframe.className = 'live-inline-player';
        iframe.src = `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=localhost&muted=true&autoplay=true`;
        iframe.setAttribute('allowfullscreen', '');
        thumb.appendChild(iframe);
      }, 600);
    });

    card.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        if (activePlayerCard === card) {
          removeInlinePlayer(card);
          activePlayerCard = null;
        }
      }, 300);
    });
  });
}

function removeInlinePlayer(card) {
  card.classList.remove('playing');
  const iframe = card.querySelector('.live-inline-player');
  if (iframe) iframe.remove();
}

async function loadFollowingVods() {
  followingVodList.innerHTML = `
    <div class="following-loading">
      <div class="spinner"></div>
      <div>Loading VODs from followed channels...</div>
    </div>`;

  // Load live streams and VODs in parallel
  const [_, result] = await Promise.all([
    loadLiveStreams(),
    window.api.twitchGetFollowedVods({ first: 50 }),
  ]);

  if (!result.success) {
    followingVodList.innerHTML = `<div class="empty-state">Failed to load: ${escapeHtml(result.error)}</div>`;
    return;
  }

  if (result.videos.length === 0) {
    followingVodList.innerHTML = '<div class="empty-state">No recent VODs from channels you follow.</div>';
    return;
  }

  followingVodList.innerHTML = '<div class="vod-feed">' + result.videos.map(renderVodCard).join('') + '</div>';
}

// Auto-refresh live status every 60 seconds
let liveRefreshInterval = null;
function startLiveRefresh() {
  if (liveRefreshInterval) clearInterval(liveRefreshInterval);
  liveRefreshInterval = setInterval(() => loadLiveStreams(), 60000);
}
function stopLiveRefresh() {
  if (liveRefreshInterval) { clearInterval(liveRefreshInterval); liveRefreshInterval = null; }
}

async function checkTwitchAuth() {
  const status = await window.api.twitchGetAuthStatus();
  if (status.authenticated) {
    followingLoggedOut.style.display = 'none';
    followingLoggedIn.style.display = 'block';
    followingAvatar.src = status.user.profileImageUrl;
    followingUsername.textContent = status.user.displayName;
    loadFollowingVods();
    startLiveRefresh();
  } else {
    followingLoggedOut.style.display = 'block';
    followingLoggedIn.style.display = 'none';
    stopLiveRefresh();
    liveSection.style.display = 'none';
  }
}

document.getElementById('btnTwitchConnect').addEventListener('click', async () => {
  const btn = document.getElementById('btnTwitchConnect');
  btn.disabled = true;
  btn.textContent = 'Connecting...';

  const result = await window.api.twitchLogin();

  if (result.success) {
    checkTwitchAuth();
    loadSettingsProfile();
  } else {
    showToast('Failed to connect to Twitch: ' + (result.error || 'Unknown error'), 'error');
  }

  btn.disabled = false;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="#fff"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>
    Connect with Twitch
  `;
});

// Logout from Settings profile card
document.getElementById('btnTwitchLogout').addEventListener('click', async () => {
  await window.api.twitchLogout();
  followingLoggedOut.style.display = 'block';
  followingLoggedIn.style.display = 'none';
  loadSettingsProfile();
});

// Check auth on load
checkTwitchAuth();

// ── Listen for completion events ───────────────────────────────────────────
window.api.onDownloadComplete((data) => {
  updateUI();
  loadHistory(); // Refresh history when a download completes
  // Refresh disk space after download completes
  window.api.getSettings().then(s => updateDiskSpace(s));
});

// ── Listen for disk space updates (pushed from backend) ──────────────────
window.api.onDiskSpaceUpdated((diskSpace) => {
  updateDiskSpace({ diskSpace });
});

// ── Listen for retry events ───────────────────────────────────────────────
window.api.onDownloadRetry((data) => {
  // Retry in progress — keep polling
  // Keep polling active so the retried download shows up
  startPolling();
});

// ── Initial load ───────────────────────────────────────────────────────────
updateUI();
loadHistory();

// Start polling on load to catch any active downloads
window.api.getDownloads().then(data => {
  if (data.active.length > 0) startPolling();
});

// ── VOD Trimmer ─────────────────────────────────────────────────────────────

function secondsToHMS(totalSecs) {
  totalSecs = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function hmsToSeconds(hms) {
  const parts = hms.replace(/[^0-9:]/g, '').split(':');
  if (parts.length === 3) {
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
  } else if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  } else if (parts.length === 1) {
    return parseInt(parts[0]) || 0;
  }
  return 0;
}

function formatDurationShort(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Trimmer Video Player ──────────────────────────────────────────────────

function extractTwitchVideoId(url) {
  // Match twitch.tv/videos/XXXXXXXXXX
  const vodMatch = url.match(/twitch\.tv\/videos\/(\d+)/i);
  if (vodMatch) return { type: 'video', id: vodMatch[1] };

  // Match clips
  const clipMatch = url.match(/clips\.twitch\.tv\/([A-Za-z0-9_-]+)/i) ||
                     url.match(/twitch\.tv\/\w+\/clip\/([A-Za-z0-9_-]+)/i);
  if (clipMatch) return { type: 'clip', id: clipMatch[1] };

  return null;
}

function loadTrimmerPlayer(url, seekToSeconds) {
  const info = extractTwitchVideoId(url);
  if (!info) {
    trimmerPlayerContainer.style.display = 'none';
    return;
  }

  // Destroy existing player without hiding the container (avoid flash)
  stopPlayheadTracking();
  if (trimmerState.player) {
    try { trimmerState.player.destroy(); } catch(e) {}
    trimmerState.player = null;
  }
  trimmerPlayerWrapper.innerHTML = '';
  trimmerPlayerTime.classList.remove('visible');
  trimmerPlayhead.classList.remove('visible');
  if (trimmerState.seekDebounce) {
    clearTimeout(trimmerState.seekDebounce);
    trimmerState.seekDebounce = null;
  }

  trimmerState.videoId = info.id;
  trimmerState.playerReady = false;
  trimmerState.isPlaying = false;
  trimmerPlayerContainer.style.display = 'block';
  trimmerPlayerOverlay.classList.remove('hidden');
  trimmerPlayerTime.classList.remove('visible');
  trimmerPlayBtn.classList.remove('playing');
  trimmerPlayhead.classList.remove('visible');

  // Check if Twitch Player API is available
  if (typeof Twitch === 'undefined' || !Twitch.Player) {
    console.warn('[Trimmer] Twitch Player API not available, falling back to iframe');
    const iframe = document.createElement('iframe');
    let embedUrl;
    if (info.type === 'video') {
      embedUrl = `https://player.twitch.tv/?video=v${info.id}&parent=localhost&autoplay=false&muted=true`;
    } else {
      embedUrl = `https://clips.twitch.tv/embed?clip=${info.id}&parent=localhost&autoplay=false&muted=true`;
    }
    iframe.src = embedUrl;
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('allow', 'autoplay; encrypted-media');
    trimmerPlayerWrapper.appendChild(iframe);
    setTimeout(() => {
      trimmerPlayerOverlay.classList.add('hidden');
      trimmerState.playerReady = true;
    }, 3000);
    return;
  }

  // Clips don't support the Twitch Player API — use iframe embed instead
  if (info.type === 'clip') {
    const iframe = document.createElement('iframe');
    iframe.src = `https://clips.twitch.tv/embed?clip=${info.id}&parent=localhost&autoplay=false&muted=true`;
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('allow', 'autoplay; encrypted-media');
    trimmerPlayerWrapper.appendChild(iframe);
    setTimeout(() => {
      trimmerPlayerOverlay.classList.add('hidden');
      trimmerState.playerReady = true;
    }, 3000);
    return;
  }

  // Use the Twitch Player API for proper seek support (VODs only)
  const playerOptions = {
    width: '100%',
    height: '100%',
    parent: ['localhost'],
    autoplay: false,
    muted: true,
    controls: false,  // Hide Twitch transport controls — we have our own
    video: info.id,
  };

  if (seekToSeconds > 0) playerOptions.time = secondsToHMS(seekToSeconds);

  // Create a container div for the player
  const playerDiv = document.createElement('div');
  playerDiv.id = 'trimmerTwitchPlayer';
  trimmerPlayerWrapper.appendChild(playerDiv);

  try {
    const player = new Twitch.Player('trimmerTwitchPlayer', playerOptions);
    trimmerState.player = player;

    player.addEventListener(Twitch.Player.READY, () => {
      trimmerState.playerReady = true;
      trimmerPlayerOverlay.classList.add('hidden');
      player.setMuted(true);
      player.pause();
      // Start playhead tracking
      startPlayheadTracking();
    });

    // Also listen for play/pause to sync button
    player.addEventListener(Twitch.Player.PLAY, () => {
      trimmerState.isPlaying = true;
      trimmerPlayBtn.classList.add('playing');
    });
    player.addEventListener(Twitch.Player.PAUSE, () => {
      trimmerState.isPlaying = false;
      trimmerPlayBtn.classList.remove('playing');
    });
    player.addEventListener(Twitch.Player.ENDED, () => {
      trimmerState.isPlaying = false;
      trimmerPlayBtn.classList.remove('playing');
    });

    // Fallback in case READY never fires
    setTimeout(() => {
      if (!trimmerState.playerReady) {
        trimmerState.playerReady = true;
        trimmerPlayerOverlay.classList.add('hidden');
        startPlayheadTracking();
      }
    }, 5000);
  } catch (err) {
    console.error('[Trimmer] Failed to create Twitch Player:', err);
    trimmerPlayerOverlay.classList.add('hidden');
  }
}

function unloadTrimmerPlayer() {
  stopPlayheadTracking();
  if (trimmerState.player) {
    try { trimmerState.player.destroy(); } catch(e) {}
    trimmerState.player = null;
  }
  trimmerPlayerWrapper.innerHTML = '';
  trimmerPlayerContainer.style.display = 'none';
  trimmerState.videoId = null;
  trimmerState.playerReady = false;
  trimmerState.isPlaying = false;
  trimmerPlayerTime.classList.remove('visible');
  trimmerPlayhead.classList.remove('visible');
  if (trimmerState.seekDebounce) {
    clearTimeout(trimmerState.seekDebounce);
    trimmerState.seekDebounce = null;
  }
}

function seekTrimmerPlayer(seconds, immediate) {
  // Show the time indicator and playhead immediately (no debounce for visual feedback)
  trimmerPlayerTime.textContent = secondsToHMS(seconds);
  trimmerPlayerTime.classList.add('visible');
  trimmerState.lastSeekTime = seconds;
  updatePlayheadPosition(seconds);

  // Debounce the actual player seek to avoid hammering during drag
  if (trimmerState.seekDebounce) clearTimeout(trimmerState.seekDebounce);
  const delay = immediate ? 50 : 200;
  trimmerState.seekDebounce = setTimeout(() => {
    if (!trimmerState.videoId || !trimmerState.playerReady) return;

    // Use Twitch Player API seek
    if (trimmerState.player && typeof trimmerState.player.seek === 'function') {
      trimmerState.player.seek(seconds);
      // Don't auto-pause — let the user control play/pause via the button
    }
  }, delay);
}

// ── Playhead tracking ─────────────────────────────────────────────────────

function updatePlayheadPosition(seconds) {
  if (!trimmerState.totalDuration || trimmerState.totalDuration <= 0) return;
  const pct = (seconds / trimmerState.totalDuration) * 100;
  trimmerPlayhead.style.left = pct + '%';
  trimmerPlayhead.classList.add('visible');
}

function startPlayheadTracking() {
  stopPlayheadTracking();
  let loopCooldown = 0; // timestamp of last loop seek — prevents rapid-fire re-seeks
  trimmerState.playheadInterval = setInterval(() => {
    if (!trimmerState.player || !trimmerState.playerReady) return;
    try {
      const currentTime = trimmerState.player.getCurrentTime();
      if (typeof currentTime === 'number' && currentTime >= 0) {
        const now = Date.now();

        // Loop enforcement: if playback goes past the end trim point, loop back to start
        // But only if we haven't just looped (cooldown prevents stutter)
        if (trimmerState.isPlaying && currentTime >= trimmerState.endTime && now - loopCooldown > 1500) {
          loopCooldown = now;
          trimmerState.player.seek(trimmerState.startTime);
          return;
        }
        // If playback is before the start trim point after a loop, nudge forward
        // Same cooldown guard
        if (trimmerState.isPlaying && currentTime < trimmerState.startTime - 2 && now - loopCooldown > 1500) {
          loopCooldown = now;
          trimmerState.player.seek(trimmerState.startTime);
          return;
        }

        updatePlayheadPosition(currentTime);
        if (trimmerState.isPlaying) {
          trimmerPlayerTime.textContent = secondsToHMS(currentTime);
          trimmerPlayerTime.classList.add('visible');
        }
      }
    } catch(e) {}
  }, 250);
}

function stopPlayheadTracking() {
  if (trimmerState.playheadInterval) {
    clearInterval(trimmerState.playheadInterval);
    trimmerState.playheadInterval = null;
  }
}

// ── Play/Pause button ─────────────────────────────────────────────────────

trimmerPlayBtn.addEventListener('click', () => {
  if (!trimmerState.player || !trimmerState.playerReady) return;
  if (trimmerState.isPlaying) {
    trimmerState.player.pause();
  } else {
    // If current position is outside the trim range, seek to start first
    try {
      const currentTime = trimmerState.player.getCurrentTime();
      if (currentTime < trimmerState.startTime || currentTime >= trimmerState.endTime) {
        trimmerState.player.seek(trimmerState.startTime);
      }
    } catch(e) {}
    trimmerState.player.setMuted(false);
    trimmerState.player.play();
  }
});

function openTrimmer(url, duration, title) {
  trimmerState.open = true;
  trimmerState.url = url;
  trimmerState.totalDuration = duration;
  trimmerState.startTime = 0;
  trimmerState.endTime = duration;
  trimmerState.videoTitle = title || '';

  trimmerPanel.classList.add('open');

  // Set video info
  trimmerVideoInfo.textContent = title ? `${title} — ${formatDurationShort(duration)}` : formatDurationShort(duration);

  // Set initial values
  trimmerStartInput.value = '00:00:00';
  trimmerEndInput.value = secondsToHMS(duration);
  updateTrimmerUI();
  generateTicks();

  // Load the video player
  loadTrimmerPlayer(url, 0);
}

function closeTrimmer() {
  trimmerState.open = false;
  trimmerState.url = '';
  trimmerPanel.classList.remove('open');
  unloadTrimmerPlayer();
}

function updateTrimmerUI() {
  const { startTime, endTime, totalDuration } = trimmerState;
  if (totalDuration <= 0) return;

  const startPct = (startTime / totalDuration) * 100;
  const endPct = (endTime / totalDuration) * 100;

  // Update selection highlight
  trimmerSelection.style.left = startPct + '%';
  trimmerSelection.style.width = (endPct - startPct) + '%';

  // Update handle positions
  trimmerHandleStart.style.left = startPct + '%';
  trimmerHandleEnd.style.left = endPct + '%';

  // Update duration badge
  const segmentDuration = Math.max(0, endTime - startTime);
  trimmerDurationBadge.textContent = formatDurationShort(segmentDuration);
}

function generateTicks() {
  const dur = trimmerState.totalDuration;
  if (dur <= 0) { trimmerTicks.innerHTML = ''; return; }

  // Pick a sensible number of ticks based on duration
  let tickCount;
  if (dur <= 60) tickCount = 6;
  else if (dur <= 600) tickCount = 6;
  else if (dur <= 3600) tickCount = 6;
  else if (dur <= 7200) tickCount = 8;
  else tickCount = 8;

  const interval = dur / tickCount;
  let html = '';
  for (let i = 0; i <= tickCount; i++) {
    const t = Math.round(i * interval);
    html += `<span class="trimmer-tick">${formatDurationShort(t)}</span>`;
  }
  trimmerTicks.innerHTML = html;
}

// Close button
trimmerClose.addEventListener('click', closeTrimmer);

// Time input handling
trimmerStartInput.addEventListener('change', () => {
  let secs = hmsToSeconds(trimmerStartInput.value);
  secs = Math.max(0, Math.min(secs, trimmerState.endTime - 1));
  trimmerState.startTime = secs;
  trimmerStartInput.value = secondsToHMS(secs);
  updateTrimmerUI();
  seekTrimmerPlayer(secs, true);
});

trimmerEndInput.addEventListener('change', () => {
  let secs = hmsToSeconds(trimmerEndInput.value);
  secs = Math.max(trimmerState.startTime + 1, Math.min(secs, trimmerState.totalDuration));
  trimmerState.endTime = secs;
  trimmerEndInput.value = secondsToHMS(secs);
  updateTrimmerUI();
  seekTrimmerPlayer(secs, true);
});

// Timeline drag handling
function getTimeFromMouseEvent(e) {
  const rect = trimmerTimeline.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const pct = x / rect.width;
  return Math.round(pct * trimmerState.totalDuration);
}

trimmerHandleStart.addEventListener('mousedown', (e) => {
  e.preventDefault();
  trimmerState.dragging = 'start';
  trimmerHandleStart.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
});

trimmerHandleEnd.addEventListener('mousedown', (e) => {
  e.preventDefault();
  trimmerState.dragging = 'end';
  trimmerHandleEnd.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
});

document.addEventListener('mousemove', (e) => {
  if (!trimmerState.dragging) return;
  const t = getTimeFromMouseEvent(e);

  if (trimmerState.dragging === 'start') {
    trimmerState.startTime = Math.max(0, Math.min(t, trimmerState.endTime - 1));
    trimmerStartInput.value = secondsToHMS(trimmerState.startTime);
    // Live seek during drag (debounced)
    seekTrimmerPlayer(trimmerState.startTime);
  } else if (trimmerState.dragging === 'end') {
    trimmerState.endTime = Math.max(trimmerState.startTime + 1, Math.min(t, trimmerState.totalDuration));
    trimmerEndInput.value = secondsToHMS(trimmerState.endTime);
    // Live seek during drag (debounced)
    seekTrimmerPlayer(trimmerState.endTime);
  }
  updateTrimmerUI();
});

document.addEventListener('mouseup', () => {
  if (trimmerState.dragging) {
    // Final immediate seek on release
    const seekTime = trimmerState.dragging === 'start' ? trimmerState.startTime : trimmerState.endTime;
    seekTrimmerPlayer(seekTime, true);
    trimmerHandleStart.classList.remove('dragging');
    trimmerHandleEnd.classList.remove('dragging');
    trimmerState.dragging = null;
    document.body.style.cursor = '';
  }
});

// Click on timeline to move nearest handle
trimmerTimeline.addEventListener('click', (e) => {
  if (e.target.classList.contains('trimmer-handle') || e.target.closest('.trimmer-handle')) return;
  const t = getTimeFromMouseEvent(e);
  const distToStart = Math.abs(t - trimmerState.startTime);
  const distToEnd = Math.abs(t - trimmerState.endTime);

  if (distToStart <= distToEnd) {
    trimmerState.startTime = Math.max(0, Math.min(t, trimmerState.endTime - 1));
    trimmerStartInput.value = secondsToHMS(trimmerState.startTime);
    seekTrimmerPlayer(trimmerState.startTime, true);
  } else {
    trimmerState.endTime = Math.max(trimmerState.startTime + 1, Math.min(t, trimmerState.totalDuration));
    trimmerEndInput.value = secondsToHMS(trimmerState.endTime);
    seekTrimmerPlayer(trimmerState.endTime, true);
  }
  updateTrimmerUI();
});

// Trim & Download button
btnTrimDownload.addEventListener('click', async () => {
  if (!trimmerState.url) return;

  const startHMS = secondsToHMS(trimmerState.startTime);
  const endHMS = secondsToHMS(trimmerState.endTime);
  const sections = `${startHMS}-${endHMS}`;

  btnTrimDownload.disabled = true;
  btnTrimDownload.textContent = 'Starting...';

  const result = await window.api.startDownload(trimmerState.url, { sections });

  btnTrimDownload.disabled = false;
  btnTrimDownload.innerHTML = `
    <svg viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H80a8,8,0,0,1,0,16H32v64H224V136H176a8,8,0,0,1,0-16h48A16,16,0,0,1,240,136Zm-117.66-2.34a8,8,0,0,0,11.32,0l48-48a8,8,0,0,0-11.32-11.32L136,108.69V24a8,8,0,0,0-16,0v84.69L85.66,74.34A8,8,0,0,0,74.34,85.66ZM200,168a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
    Trim & Download
  `;

  if (result.success) {
    closeTrimmer();
    urlInput.value = '';
    updateSmartBarMode('');
    startPolling();
    refreshDiskSpace();
  } else {
    showToast('Failed to start trimmed download: ' + (result.error || 'Unknown error'), 'error');
  }
});

// Open trimmer from the smart bar when a URL is detected
window.openTrimmerFromUrl = async function(url) {
  if (!url) return;

  // Close channel detail if it's covering the trimmer
  closeChannelDetail();

  // Fetch video info to get duration
  trimmerVideoInfo.textContent = 'Loading video info...';
  trimmerPanel.classList.add('open');
  trimmerState.open = true;

  // Scroll to show the loading trimmer
  setTimeout(() => trimmerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

  try {
    const result = await window.api.getVideoInfo(url);
    if (result.success && result.info && result.info.duration) {
      openTrimmer(url, result.info.duration, result.info.title || '');
    } else {
      trimmerVideoInfo.textContent = 'Could not get video duration.';
      // Still open with a default 1hr duration for manual input
      openTrimmer(url, 3600, result.info?.title || '');
    }
  } catch (err) {
    trimmerVideoInfo.textContent = 'Failed to load info.';
    openTrimmer(url, 3600, '');
  }
};

// Open trimmer from a VOD card (may be on Following page or Channel Detail)
window.openTrimmerFromVod = async function(url, durationStr, title) {
  // Navigate to Home page where the trimmer panel lives
  if (currentPage !== 'home') {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const homeNav = document.querySelector('[data-page="home"]');
    if (homeNav) homeNav.classList.add('active');
    document.getElementById('page-home').classList.add('active');
    currentPage = 'home';
  }

  // Close channel detail view if it's open (it overlays the trimmer)
  closeChannelDetail();

  // Set URL in smart bar for context
  urlInput.value = url;
  updateSmartBarMode(url);

  // Parse Twitch duration like "3h24m10s"
  let totalSecs = 0;
  if (durationStr) {
    const hMatch = durationStr.match(/(\d+)h/);
    const mMatch = durationStr.match(/(\d+)m/);
    const sMatch = durationStr.match(/(\d+)s/);
    if (hMatch) totalSecs += parseInt(hMatch[1]) * 3600;
    if (mMatch) totalSecs += parseInt(mMatch[1]) * 60;
    if (sMatch) totalSecs += parseInt(sMatch[1]);
  }

  if (totalSecs > 0) {
    openTrimmer(url, totalSecs, title || '');
    // Scroll to trimmer panel smoothly
    setTimeout(() => trimmerPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  } else {
    // Fall back to fetching duration from yt-dlp
    window.openTrimmerFromUrl(url);
  }
};
