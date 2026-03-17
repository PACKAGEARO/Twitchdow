const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { autoUpdater } = require('electron-updater');

// ── Persistent Store ──────────────────────────────────────────────────────
// Cross-platform data directory
const DATA_DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Twitchdow')
  : process.platform === 'linux'
    ? path.join(os.homedir(), '.config', 'Twitchdow')
    : path.join(os.homedir(), 'Library', 'Application Support', 'Twitchdow');
const OLD_DATA_DIR = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'TwitchDownloader')
  : null;
const STORE_FILE = path.join(DATA_DIR, 'store.json');

// Migrate from old app name if needed (macOS only)
if (OLD_DATA_DIR && !fs.existsSync(DATA_DIR) && fs.existsSync(OLD_DATA_DIR)) {
  try { fs.renameSync(OLD_DATA_DIR, DATA_DIR); } catch(e) {
    // Migration: could not rename data dir, copying instead
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const oldStore = path.join(OLD_DATA_DIR, 'store.json');
    if (fs.existsSync(oldStore)) {
      fs.copyFileSync(oldStore, STORE_FILE);
    }
  }
} else if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load store:', e.message);
  }
  return { history: [], settings: null, twitchAuth: null };
}

function saveStore() {
  try {
    const data = { history, settings, twitchAuth, favoriteChannels, lastCheckedVods };
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save store:', e.message);
  }
}

const store = loadStore();

// ── State ──────────────────────────────────────────────────────────────────
const downloads = new Map();   // id → { process, meta, progress }
const completed = [];          // in-session completed (shown in "Recently Completed")
const history = store.history || [];  // persistent history across sessions
let twitchAuth = store.twitchAuth || null; // { accessToken, refreshToken, expiresAt, userId, login, displayName, profileImageUrl }
let favoriteChannels = store.favoriteChannels || []; // [{ id, login, displayName, profileImageUrl }]
let lastCheckedVods = store.lastCheckedVods || {}; // { channelId: latestVodId }
let mainWindow;
let downloadCounter = 0;
let autoDownloadInterval = null;

const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'Twitchdow');
const OLD_OUTPUT_DIR = path.join(os.homedir(), 'Downloads', 'TwitchDownloader');

// Migrate old download folder
if (!fs.existsSync(DEFAULT_OUTPUT_DIR) && fs.existsSync(OLD_OUTPUT_DIR)) {
  try { fs.renameSync(OLD_OUTPUT_DIR, DEFAULT_OUTPUT_DIR); } catch(e) {
    // Migration: could not rename downloads dir
  }
}

// Settings (persisted to disk)
let settings = store.settings || {
  outputDir: DEFAULT_OUTPUT_DIR,
  quality: 'best',
  bandwidthLimit: 0,        // 0 = unlimited, otherwise bytes/sec
  segmentedThreads: 8,      // number of aria2c connections
  autoDownloadFavorites: false, // auto-download new VODs from favorite channels
};

// Fix saved outputDir if it still points to old name
if (settings.outputDir && settings.outputDir.includes('TwitchDownloader')) {
  settings.outputDir = settings.outputDir.replace('TwitchDownloader', 'Twitchdow');
  saveStore();
}

// Ensure output dir exists
if (!fs.existsSync(settings.outputDir || DEFAULT_OUTPUT_DIR)) {
  fs.mkdirSync(settings.outputDir || DEFAULT_OUTPUT_DIR, { recursive: true });
}

// ── Helpers ────────────────────────────────────────────────────────────────

// ── Binary Resolution ─────────────────────────────────────────────────────
// When packaged, binaries live in resources/bin/{mac|win}/ inside the app bundle.
// In development, they live in resources/bin/{mac|win}/ relative to the project root.
// Falls back to system-installed versions (Homebrew, PATH, etc.)

function getBundledBinDir() {
  const isWin = process.platform === 'win32';
  const platformDir = isWin ? 'win' : 'mac';

  // When packaged by electron-builder, process.resourcesPath points to the app's Resources dir
  const packagedPath = path.join(process.resourcesPath, 'bin', platformDir);
  if (fs.existsSync(packagedPath)) return packagedPath;

  // In development, look relative to __dirname (project root)
  const devPath = path.join(__dirname, 'resources', 'bin', platformDir);
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

const BUNDLED_BIN_DIR = getBundledBinDir();

function findBinary(name, systemLocations) {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? `${name}.exe` : name;

  // 1. Check bundled binaries first
  if (BUNDLED_BIN_DIR) {
    const bundled = path.join(BUNDLED_BIN_DIR, binaryName);
    if (fs.existsSync(bundled)) return bundled;
  }

  // 2. Check system locations
  for (const loc of systemLocations) {
    if (fs.existsSync(loc)) return loc;
  }

  // 3. Fallback to PATH
  return isWin ? `${name}.exe` : name;
}

function findYtDlp() {
  return findBinary('yt-dlp', [
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
  ]);
}

function findFfmpeg() {
  return findBinary('ffmpeg', [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ]);
}

function findAria2c() {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'aria2c.exe' : 'aria2c';

  // 1. Check bundled
  if (BUNDLED_BIN_DIR) {
    const bundled = path.join(BUNDLED_BIN_DIR, binaryName);
    if (fs.existsSync(bundled)) return bundled;
  }

  // 2. Check system
  const systemLocations = [
    '/opt/homebrew/bin/aria2c',
    '/usr/local/bin/aria2c',
    '/usr/bin/aria2c',
  ];
  for (const loc of systemLocations) {
    if (fs.existsSync(loc)) return loc;
  }

  return null; // not found — will fallback to yt-dlp native
}

const YT_DLP = findYtDlp();
const FFMPEG = findFfmpeg();
const ARIA2C = findAria2c();

// Build a PATH that includes bundled binaries + standard locations
const SPAWN_ENV = {
  ...process.env,
  PATH: [BUNDLED_BIN_DIR, '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].filter(Boolean).join(path.delimiter),
};

// Validate critical binaries exist
const MISSING_BINARIES = [];
if (!YT_DLP || !fs.existsSync(YT_DLP)) MISSING_BINARIES.push('yt-dlp');
if (!FFMPEG || !fs.existsSync(FFMPEG)) MISSING_BINARIES.push('ffmpeg');

// ── Twitch GQL (for avatar + partner status) ─────────────────────────────
const https = require('https');

function fetchTwitchUserInfo(login) {
  return new Promise((resolve, reject) => {
    const query = JSON.stringify({
      query: `query { user(login: "${login.replace(/"/g, '')}") { displayName profileImageURL(width: 70) roles { isPartner isAffiliate } } }`
    });

    const req = https.request({
      hostname: 'gql.twitch.tv',
      path: '/gql',
      method: 'POST',
      headers: {
        'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(query),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const user = json?.data?.user;
          if (user) {
            resolve({
              displayName: user.displayName || login,
              profileImageURL: user.profileImageURL || '',
              isPartner: user.roles?.isPartner || false,
              isAffiliate: user.roles?.isAffiliate || false,
            });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.write(query);
    req.end();
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getDiskSpace() {
  try {
    const dir = settings.outputDir || DEFAULT_OUTPUT_DIR;
    if (!fs.existsSync(dir)) return null;
    const { execSync } = require('child_process');

    if (process.platform === 'win32') {
      // Windows: use wmic to get disk space for the drive letter
      const drive = path.parse(dir).root.replace('\\', ''); // e.g. "C:"
      const wmicOutput = execSync(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace,Size /format:csv`, { encoding: 'utf8' });
      const lines = wmicOutput.trim().split('\n').filter(l => l.trim());
      if (lines.length >= 2) {
        const parts = lines[lines.length - 1].split(',');
        const freeBytes = parseInt(parts[1]);
        const totalBytes = parseInt(parts[2]);
        if (totalBytes > 0) {
          return {
            total: totalBytes,
            available: freeBytes,
            usedPercent: Math.round(((totalBytes - freeBytes) / totalBytes) * 100),
          };
        }
      }
    } else {
      // macOS / Linux: use df
      const dfOutput = execSync(`df -k "${dir}"`, { encoding: 'utf8' });
      const lines = dfOutput.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const totalKB = parseInt(parts[1]);
        const availKB = parseInt(parts[3]);
        return {
          total: totalKB * 1024,
          available: availKB * 1024,
          usedPercent: Math.round(((totalKB - availKB) / totalKB) * 100),
        };
      }
    }
  } catch (_) {}
  return null;
}

function pushDiskSpaceUpdate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const diskSpace = getDiskSpace();
    if (diskSpace) {
      mainWindow.webContents.send('disk-space-updated', diskSpace);
    }
  }
}

// ── File System Watcher for instant disk space updates ─────────────────
let diskWatcher = null;
let diskWatchDebounce = null;

function startDiskWatcher() {
  stopDiskWatcher();
  const dir = settings.outputDir || DEFAULT_OUTPUT_DIR;
  if (!fs.existsSync(dir)) return;

  try {
    diskWatcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
      // Debounce: multiple events fire rapidly during file ops (write, rename, delete)
      // Coalesce into a single update after 500ms of quiet
      if (diskWatchDebounce) clearTimeout(diskWatchDebounce);
      diskWatchDebounce = setTimeout(() => {
        pushDiskSpaceUpdate();
      }, 500);
    });

    diskWatcher.on('error', () => {
      // Silently handle — the 30s fallback will cover it
      stopDiskWatcher();
    });
  } catch (_) {
    // Directory might not be watchable — fallback covers it
  }
}

function stopDiskWatcher() {
  if (diskWatchDebounce) { clearTimeout(diskWatchDebounce); diskWatchDebounce = null; }
  if (diskWatcher) { diskWatcher.close(); diskWatcher = null; }
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Fetch video info ───────────────────────────────────────────────────────

function fetchVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--no-download', url];
    const proc = spawn(YT_DLP, args, {
      env: SPAWN_ENV
    });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('error', (err) => {
      reject(new Error(`Failed to launch yt-dlp: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        resolve({
          title: info.title || 'Unknown Title',
          url: info.webpage_url || url,
          duration: info.duration || 0,
          thumbnail: info.thumbnail || info.thumbnails?.[info.thumbnails.length - 1]?.url || '',
          filesize_approx: info.filesize_approx || info.filesize || 0,
          channel: info.uploader || info.channel || '',
          channelUrl: info.uploader_url || info.channel_url || '',
          category: info.categories?.[0] || info.genre || '',
          viewCount: info.view_count || 0,
        });
      } catch (e) {
        reject(new Error('Failed to parse video info'));
      }
    });
  });
}

// ── Start download ─────────────────────────────────────────────────────────

function buildFormatString() {
  // #15 Compression detection: prefer native MP4/M4A to avoid re-encoding
  // Twitch typically serves in MP4 (H.264 + AAC), so we prefer those containers
  // to skip the ffmpeg merge/transcode step entirely
  switch (settings.quality) {
    case '1080': return 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
    case '720':  return 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best';
    case '480':  return 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best';
    case '360':  return 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]/best';
    default:     return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best';
  }
}

function startDownload(url, outputDir, sections) {
  const id = `dl_${++downloadCounter}_${Date.now()}`;
  const dir = outputDir || settings.outputDir || DEFAULT_OUTPUT_DIR;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const formatStr = buildFormatString();

  const args = [
    '-f', formatStr,
    '--merge-output-format', 'mp4',
    // #15 Compression detection: prefer copying streams over re-encoding
    '--postprocessor-args', 'ffmpeg:-c copy',
    '--remux-video', 'mp4',
    '--ffmpeg-location', path.dirname(FFMPEG),
    '--newline',
    '--progress',
    '-o', path.join(dir, '%(title)s.%(ext)s'),
  ];

  // #1 Multi-threaded downloads via aria2c + #6 Bandwidth throttling
  if (ARIA2C) {
    args.push('--external-downloader', ARIA2C);
    let aria2Args = `--max-connection-per-server=${settings.segmentedThreads} --min-split-size=1M --split=${settings.segmentedThreads} --allow-overwrite=true`;
    if (settings.bandwidthLimit > 0) {
      aria2Args += ` --max-overall-download-limit=${settings.bandwidthLimit}`;
    }
    args.push('--external-downloader-args', `aria2c:${aria2Args}`);
  } else if (settings.bandwidthLimit > 0) {
    // #6 Bandwidth throttling via yt-dlp native
    args.push('--limit-rate', `${settings.bandwidthLimit}`);
  }

  // VOD Trimmer: download only a specific time segment
  if (sections) {
    args.push('--download-sections', `*${sections}`);
    // Force keyframe cutting for precise trim points
    args.push('--force-keyframes-at-cuts');
  }

  args.push(url);

  const proc = spawn(YT_DLP, args, {
    env: SPAWN_ENV
  });

  proc.on('error', (err) => {
    const dl = downloads.get(id);
    if (dl) {
      dl.meta.status = 'error';
      dl.meta.speed = 'Failed';
      dl.meta.eta = '--';
      // Notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-error', {
          id,
          error: `Failed to launch yt-dlp: ${err.message}`,
        });
      }
    }
  });

  const meta = {
    id,
    url,
    title: 'Fetching info...',
    progress: 0,
    downloaded: 0,
    total: 0,
    speed: '0 B/s',
    eta: '--:--',
    status: 'downloading', // downloading | completed | error | cancelled
    filePath: '',
    fileSize: '',
    duration: '',
    thumbnail: '',
    startTime: Date.now(),
    retryCount: 0,
    maxRetries: 2,
  };

  downloads.set(id, { process: proc, meta });

  // Also fetch info in parallel for title/thumbnail/channel info
  fetchVideoInfo(url).then(async (info) => {
    const dl = downloads.get(id);
    if (dl) {
      dl.meta.title = info.title;
      dl.meta.thumbnail = info.thumbnail;
      dl.meta.duration = formatDuration(info.duration);
      dl.meta.channel = info.channel;
      dl.meta.channelUrl = info.channelUrl;
      dl.meta.category = info.category;
      dl.meta.viewCount = info.viewCount;
      if (info.filesize_approx) {
        dl.meta.total = info.filesize_approx;
      }

      // Fetch avatar + partner status from Twitch GQL
      if (info.channel) {
        const userInfo = await fetchTwitchUserInfo(info.channel);
        if (userInfo && dl === downloads.get(id)) {
          dl.meta.uploaderThumbnail = userInfo.profileImageURL;
          dl.meta.channel = userInfo.displayName || dl.meta.channel;
          dl.meta.isPartner = userInfo.isPartner;
          dl.meta.isAffiliate = userInfo.isAffiliate;
        }
      }
    }
  }).catch(() => {});

  let lastLine = '';

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      lastLine = line;

      // Parse progress lines like:
      // [download]   0.5% of ~   6.95GiB at    9.93MiB/s ETA 13:12 (frag 6/1113)
      // [download]  45.2% of ~4.70GiB at 12.5MiB/s ETA 03:24
      // [download]   0.1% of ~   7.43GiB at    2.23MiB/s ETA Unknown (frag 0/1113)
      const progressMatch = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\w+)\s+at\s+([\d.]+\s*\w+\/s)\s+ETA\s+(\S+)/);
      if (progressMatch) {
        const dl = downloads.get(id);
        if (dl) {
          dl.meta.progress = parseFloat(progressMatch[1]);
          dl.meta.speed = progressMatch[3];
          dl.meta.eta = progressMatch[4] === 'Unknown' ? 'Calculating...' : progressMatch[4];

          // Parse total size
          const sizeStr = progressMatch[2];
          const sizeMatch = sizeStr.match(/([\d.]+)\s*(\w+)/);
          if (sizeMatch) {
            const val = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            const multipliers = { 'B': 1, 'KIB': 1024, 'MIB': 1048576, 'GIB': 1073741824, 'KB': 1000, 'MB': 1000000, 'GB': 1000000000 };
            dl.meta.total = val * (multipliers[unit] || 1);
          }

          dl.meta.downloaded = (dl.meta.progress / 100) * dl.meta.total;
        }
      }

      // Also parse fragment progress for better % on HLS streams
      const fragMatch = line.match(/\(frag\s+(\d+)\/(\d+)\)/);
      if (fragMatch) {
        const dl = downloads.get(id);
        if (dl) {
          const currentFrag = parseInt(fragMatch[1]);
          const totalFrags = parseInt(fragMatch[2]);
          if (totalFrags > 0) {
            // Use fragment-based progress as it's more accurate for HLS
            dl.meta.progress = Math.max(dl.meta.progress, (currentFrag / totalFrags) * 100);
            dl.meta.downloaded = (dl.meta.progress / 100) * dl.meta.total;
          }
        }
      }

      // Detect destination file
      const destMatch = line.match(/\[(?:download|Merger)\]\s+(?:Destination:\s+)?(.+\.(?:mp4|mkv|webm|ts|m4a|mp3))/);
      if (destMatch) {
        const dl = downloads.get(id);
        if (dl) {
          dl.meta.filePath = destMatch[1].trim();
        }
      }

      // Detect merge output
      const mergeMatch = line.match(/Merging formats into "(.+)"/);
      if (mergeMatch) {
        const dl = downloads.get(id);
        if (dl) {
          dl.meta.filePath = mergeMatch[1].trim();
        }
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString();
    // Also check stderr for destination
    const destMatch = line.match(/\[(?:download|Merger)\]\s+(?:Destination:\s+)?(.+\.(?:mp4|mkv|webm|ts|m4a|mp3))/);
    if (destMatch) {
      const dl = downloads.get(id);
      if (dl) dl.meta.filePath = destMatch[1].trim();
    }
  });

  proc.on('close', (code) => {
    const dl = downloads.get(id);
    if (!dl) return;

    if (dl.meta.status === 'cancelled') return;

    if (code === 0) {
      dl.meta.status = 'completed';
      dl.meta.progress = 100;

      // Get actual file size
      let fileSize = '';
      if (dl.meta.filePath && fs.existsSync(dl.meta.filePath)) {
        const stats = fs.statSync(dl.meta.filePath);
        fileSize = formatBytes(stats.size);
        dl.meta.fileSize = fileSize;
      } else {
        fileSize = formatBytes(dl.meta.total);
        dl.meta.fileSize = fileSize;
      }

      // Build completed entry
      const entry = {
        id: dl.meta.id,
        title: dl.meta.title,
        url: dl.meta.url,
        filePath: dl.meta.filePath,
        fileSize: dl.meta.fileSize,
        duration: dl.meta.duration,
        thumbnail: dl.meta.thumbnail,
        channel: dl.meta.channel || '',
        channelUrl: dl.meta.channelUrl || '',
        category: dl.meta.category || '',
        viewCount: dl.meta.viewCount || 0,
        uploaderThumbnail: dl.meta.uploaderThumbnail || '',
        isPartner: dl.meta.isPartner || false,
        isAffiliate: dl.meta.isAffiliate || false,
        completedAt: new Date().toISOString(),
      };

      // Add to in-session completed list
      completed.unshift(entry);

      // Add to persistent history
      history.unshift(entry);
      // Keep history to last 200 entries
      if (history.length > 200) history.length = 200;
      saveStore();

      downloads.delete(id);

      // macOS native notification
      if (Notification.isSupported()) {
        const notif = new Notification({
          title: dl.meta.title || 'Download Complete',
          body: 'You can get to watching now 🎬',
          silent: false,
        });
        notif.on('click', () => {
          if (dl.meta.filePath && fs.existsSync(dl.meta.filePath)) {
            shell.showItemInFolder(dl.meta.filePath);
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        });
        notif.show();
      }

      // Notify renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-complete', dl.meta);
      }
      // Push updated disk space after download finishes writing to disk
      pushDiskSpaceUpdate();
    } else {
      // Auto-retry logic
      if (dl.meta.retryCount < dl.meta.maxRetries) {
        dl.meta.retryCount++;
        const attempt = dl.meta.retryCount;
        const maxR = dl.meta.maxRetries;
        // Auto-retry in progress

        // Notify renderer about retry
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-retry', {
            id: dl.meta.id,
            url: dl.meta.url,
            title: dl.meta.title,
            attempt,
            maxRetries: maxR,
          });
        }

        downloads.delete(id);

        // Retry after a short delay (3 seconds)
        setTimeout(() => {
          startDownload(dl.meta.url);
        }, 3000);
      } else {
        dl.meta.status = 'error';
        dl.meta.speed = 'Failed';
        dl.meta.eta = '--';

        // Notify about permanent failure
        if (Notification.isSupported()) {
          const notif = new Notification({
            title: 'Download Failed',
            body: `${dl.meta.title || 'Download'} failed after ${dl.meta.maxRetries} retries`,
            silent: false,
          });
          notif.on('click', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
            }
          });
          notif.show();
        }
      }
    }
  });

  return id;
}

// ── IPC Handlers ───────────────────────────────────────────────────────────

ipcMain.handle('start-download', async (event, url, options) => {
  try {
    const sections = options?.sections || null;
    const id = startDownload(url, null, sections);
    return { success: true, id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('cancel-download', async (event, id) => {
  const dl = downloads.get(id);
  if (dl) {
    dl.meta.status = 'cancelled';
    dl.process.kill('SIGTERM');
    downloads.delete(id);
    return { success: true };
  }
  return { success: false, error: 'Download not found' };
});

ipcMain.handle('get-downloads', async () => {
  const active = [];
  for (const [id, dl] of downloads) {
    active.push({ ...dl.meta });
  }
  return { active, completed: completed.slice(0, 20) };
});

ipcMain.handle('get-video-info', async (event, url) => {
  try {
    const info = await fetchVideoInfo(url);
    return { success: true, info };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-folder', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  } else if (fs.existsSync(DEFAULT_OUTPUT_DIR)) {
    shell.openPath(DEFAULT_OUTPUT_DIR);
  }
  return { success: true };
});

ipcMain.handle('open-file', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.openPath(filePath);
  }
  return { success: true };
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Download Folder',
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

ipcMain.handle('get-output-dir', async () => {
  return settings.outputDir;
});

ipcMain.handle('set-output-dir', async (event, dir) => {
  settings.outputDir = dir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return { success: true };
});

ipcMain.handle('get-settings', async () => {
  return { ...settings, aria2cAvailable: !!ARIA2C, diskSpace: getDiskSpace() };
});

ipcMain.handle('set-settings', async (event, newSettings) => {
  if (newSettings.quality) settings.quality = newSettings.quality;
  if (newSettings.bandwidthLimit !== undefined) settings.bandwidthLimit = newSettings.bandwidthLimit;
  if (newSettings.segmentedThreads !== undefined) settings.segmentedThreads = newSettings.segmentedThreads;
  if (newSettings.outputDir) {
    settings.outputDir = newSettings.outputDir;
    if (!fs.existsSync(newSettings.outputDir)) {
      fs.mkdirSync(newSettings.outputDir, { recursive: true });
    }
    // Restart file watcher on new directory
    startDiskWatcher();
  }
  if (newSettings.autoDownloadFavorites !== undefined) {
    settings.autoDownloadFavorites = newSettings.autoDownloadFavorites;
    if (settings.autoDownloadFavorites) {
      startAutoDownloadPolling();
    } else {
      stopAutoDownloadPolling();
    }
  }
  saveStore();
  return { success: true };
});

ipcMain.handle('clear-completed', async () => {
  completed.length = 0;
  return { success: true };
});

ipcMain.handle('remove-completed', async (event, id) => {
  const idx = completed.findIndex(c => c.id === id);
  if (idx !== -1) completed.splice(idx, 1);
  return { success: true };
});

// ── History IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('get-history', async (event, { limit = 50, offset = 0 } = {}) => {
  return {
    items: history.slice(offset, offset + limit),
    total: history.length,
  };
});

ipcMain.handle('clear-history', async () => {
  history.length = 0;
  saveStore();
  return { success: true };
});

ipcMain.handle('remove-history-item', async (event, id) => {
  const idx = history.findIndex(h => h.id === id);
  if (idx !== -1) {
    history.splice(idx, 1);
    saveStore();
  }
  return { success: true };
});

ipcMain.handle('delete-file-and-history', async (event, id) => {
  const idx = history.findIndex(h => h.id === id);
  if (idx !== -1) {
    const item = history[idx];
    // Delete the actual file if it exists
    if (item.filePath && fs.existsSync(item.filePath)) {
      try { fs.unlinkSync(item.filePath); } catch (e) {}
    }
    history.splice(idx, 1);
    saveStore();

    // Push updated disk space after file deletion
    pushDiskSpaceUpdate();
  }
  return { success: true };
});

// ── Twitch OAuth (Implicit Grant + Local Server) ──────────────────────────

const TWITCH_CLIENT_ID = 'h4ofj23vu71p023mv0ikmqw9v7yx6k';
const TWITCH_REDIRECT_URI = 'http://localhost:9876/callback';
const TWITCH_SCOPES = 'user:read:follows';

function twitchHelixGet(endpoint, accessToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, 'https://api.twitch.tv');
    const req = https.request({
      hostname: 'api.twitch.tv',
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Client-Id': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 401) {
            reject(new Error('UNAUTHORIZED'));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getValidToken() {
  if (!twitchAuth) return null;
  // Check if token has expired
  if (Date.now() > twitchAuth.expiresAt) {
    twitchAuth = null;
    saveStore();
    return null;
  }
  return twitchAuth.accessToken;
}

async function authedHelixGet(endpoint) {
  const token = await getValidToken();
  if (!token) throw new Error('Not authenticated');
  try {
    return await twitchHelixGet(endpoint, token);
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') {
      twitchAuth = null;
      saveStore();
      throw new Error('Session expired — please reconnect');
    }
    throw e;
  }
}

// ── Twitch OAuth IPC ──────────────────────────────────────────────────────

ipcMain.handle('twitch-login', async () => {
  return new Promise((resolve) => {
    let resolved = false;

    const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(TWITCH_REDIRECT_URI)}&response_type=token&scope=${encodeURIComponent(TWITCH_SCOPES)}`;

    // Local server serves a page that reads the # fragment and sends it via postMessage
    const CALLBACK_HTML = `<!DOCTYPE html><html><body style="background:#0e0e10;color:#efeff1;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
      <p id="msg">Logging in...</p>
      <script>
        const hash = window.location.hash.substring(1);
        document.title = hash ? ('TOKEN:' + hash) : 'TOKEN:error=no_token';
      </script>
    </body></html>`;

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(CALLBACK_HTML);
    });

    function cleanup() {
      try { server.close(); } catch (_) {}
    }

    async function handleToken(hashStr, authWindow) {
      if (resolved) return; // Prevent double-handling
      const params = new URLSearchParams(hashStr);
      const accessToken = params.get('access_token');
      const expiresIn = parseInt(params.get('expires_in') || '0');
      // Twitch implicit grant may not include expires_in; default to 4 hours
      const effectiveExpiresIn = expiresIn || (4 * 60 * 60);

      if (!accessToken) {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: params.get('error') || 'No token in redirect' });
        }
        cleanup();
        if (authWindow) authWindow.close();
        return;
      }

      try {
        const userResult = await twitchHelixGet('/helix/users', accessToken);
        const user = userResult.data?.[0];

        twitchAuth = {
          accessToken,
          expiresAt: Date.now() + (effectiveExpiresIn * 1000),
          userId: user?.id || '',
          login: user?.login || '',
          displayName: user?.display_name || '',
          profileImageUrl: user?.profile_image_url || '',
          bio: user?.description || '',
          broadcasterType: user?.broadcaster_type || '',
          accountType: user?.type || '',
          createdAt: user?.created_at || '',
        };

        // Fetch chat color
        try {
          const colorResult = await twitchHelixGet(`/helix/chat/color?user_id=${twitchAuth.userId}`, accessToken);
          twitchAuth.chatColor = colorResult.data?.[0]?.color || '';
        } catch (_) {
          twitchAuth.chatColor = '';
        }

        saveStore();

        if (!resolved) {
          resolved = true;
          resolve({
            success: true,
            user: {
              userId: twitchAuth.userId,
              login: twitchAuth.login,
              displayName: twitchAuth.displayName,
              profileImageUrl: twitchAuth.profileImageUrl,
              bio: twitchAuth.bio,
              broadcasterType: twitchAuth.broadcasterType,
              accountType: twitchAuth.accountType,
              createdAt: twitchAuth.createdAt,
              chatColor: twitchAuth.chatColor,
            },
          });
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: err.message });
        }
      }
      cleanup();
      if (authWindow) authWindow.close();
    }

    server.listen(9876, () => {
      const authWindow = new BrowserWindow({
        width: 500,
        height: 700,
        parent: mainWindow,
        modal: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      // The callback page sets document.title to "TOKEN:<hash params>"
      authWindow.webContents.on('page-title-updated', (event, title) => {
        if (title.startsWith('TOKEN:')) {
          handleToken(title.substring(6), authWindow);
        }
      });

      authWindow.on('closed', () => {
        cleanup();
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: 'Window closed' });
        }
      });

      authWindow.loadURL(authUrl);
    });

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: `Server error: ${err.message}` });
      }
    });
  });
});

ipcMain.handle('twitch-logout', async () => {
  twitchAuth = null;
  saveStore();
  return { success: true };
});

ipcMain.handle('twitch-get-auth-status', async () => {
  if (!twitchAuth) return { authenticated: false };
  const token = await getValidToken();
  if (!token) return { authenticated: false };

  // Backfill profile fields if missing (e.g. after update)
  if (!twitchAuth.createdAt) {
    try {
      const userResult = await twitchHelixGet('/helix/users', token);
      const user = userResult.data?.[0];
      if (user) {
        twitchAuth.bio = user.description || '';
        twitchAuth.broadcasterType = user.broadcaster_type || '';
        twitchAuth.accountType = user.type || '';
        twitchAuth.createdAt = user.created_at || '';
      }
      const colorResult = await twitchHelixGet(`/helix/chat/color?user_id=${twitchAuth.userId}`, token);
      twitchAuth.chatColor = colorResult.data?.[0]?.color || '';
      saveStore();
    } catch (_) {}
  }

  return {
    authenticated: true,
    user: {
      userId: twitchAuth.userId,
      login: twitchAuth.login,
      displayName: twitchAuth.displayName,
      profileImageUrl: twitchAuth.profileImageUrl,
      bio: twitchAuth.bio || '',
      broadcasterType: twitchAuth.broadcasterType || '',
      accountType: twitchAuth.accountType || '',
      createdAt: twitchAuth.createdAt || '',
      chatColor: twitchAuth.chatColor || '',
      expiresAt: twitchAuth.expiresAt || 0,
    },
  };
});

ipcMain.handle('twitch-get-following', async () => {
  try {
    if (!twitchAuth) return { success: false, error: 'Not authenticated' };
    const result = await authedHelixGet(`/helix/channels/followed?user_id=${twitchAuth.userId}&first=100`);
    return { success: true, channels: result.data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('twitch-get-vods', async (event, { userId, first = 20 } = {}) => {
  try {
    if (!twitchAuth) return { success: false, error: 'Not authenticated' };
    const result = await authedHelixGet(`/helix/videos?user_id=${userId}&type=archive&first=${first}`);
    return { success: true, videos: result.data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('twitch-get-live-followed', async () => {
  try {
    if (!twitchAuth) return { success: false, error: 'Not authenticated' };

    // Get followed channels
    const followResult = await authedHelixGet(`/helix/channels/followed?user_id=${twitchAuth.userId}&first=100`);
    const channels = followResult.data || [];
    if (channels.length === 0) return { success: true, streams: [] };

    // Twitch allows up to 100 user_ids per request
    const userIds = channels.map(ch => ch.broadcaster_id);
    const chunks = [];
    for (let i = 0; i < userIds.length; i += 100) {
      chunks.push(userIds.slice(i, i + 100));
    }

    let allStreams = [];
    for (const chunk of chunks) {
      const query = chunk.map(id => `user_id=${id}`).join('&');
      const result = await authedHelixGet(`/helix/streams?${query}&first=100`);
      allStreams = allStreams.concat(result.data || []);
    }

    // Sort by viewer count, highest first
    allStreams.sort((a, b) => b.viewer_count - a.viewer_count);

    return { success: true, streams: allStreams };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('twitch-get-followed-vods', async (event, { first = 50 } = {}) => {
  try {
    if (!twitchAuth) return { success: false, error: 'Not authenticated' };

    // Get followed channels
    const followResult = await authedHelixGet(`/helix/channels/followed?user_id=${twitchAuth.userId}&first=100`);
    const channels = followResult.data || [];
    if (channels.length === 0) return { success: true, videos: [] };

    // Fetch VODs from each channel in parallel (limit to first 20 channels to avoid rate limits)
    const channelsToFetch = channels.slice(0, 20);
    const vodPromises = channelsToFetch.map(ch =>
      authedHelixGet(`/helix/videos?user_id=${ch.broadcaster_id}&type=archive&first=5`)
        .then(r => (r.data || []).map(v => ({ ...v, channel_login: ch.broadcaster_login, channel_name: ch.broadcaster_name })))
        .catch(() => [])
    );

    const allVods = (await Promise.all(vodPromises)).flat();
    // Sort by creation date, newest first
    allVods.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return { success: true, videos: allVods.slice(0, first) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Twitch Search & Clips IPC ─────────────────────────────────────────────

ipcMain.handle('twitch-search-channels', async (event, { query, first = 20 } = {}) => {
  try {
    if (!twitchAuth) return { success: false, error: 'Not authenticated' };
    const result = await authedHelixGet(`/helix/search/channels?query=${encodeURIComponent(query)}&first=${first}&live_only=false`);
    return { success: true, channels: result.data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('twitch-get-clips', async (event, { broadcasterId, first = 20 } = {}) => {
  try {
    if (!twitchAuth) return { success: false, error: 'Not authenticated' };
    const result = await authedHelixGet(`/helix/clips?broadcaster_id=${broadcasterId}&first=${first}`);
    return { success: true, clips: result.data || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('twitch-get-channel-info', async (event, { broadcasterId } = {}) => {
  try {
    if (!twitchAuth) return { success: false, error: 'Not authenticated' };
    const result = await authedHelixGet(`/helix/channels?broadcaster_id=${broadcasterId}`);
    return { success: true, channel: (result.data || [])[0] || null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Favorite Channels IPC ──────────────────────────────────────────────────

ipcMain.handle('get-favorites', async () => {
  return { success: true, channels: favoriteChannels };
});

ipcMain.handle('add-favorite', async (event, channel) => {
  // channel = { id, login, displayName, profileImageUrl }
  if (favoriteChannels.find(c => c.id === channel.id)) {
    return { success: false, error: 'Already a favorite' };
  }
  favoriteChannels.push(channel);
  saveStore();

  // If auto-download is on, seed this channel's latest VOD so we don't download old ones
  if (settings.autoDownloadFavorites && twitchAuth) {
    try {
      const result = await authedHelixGet(`/helix/videos?user_id=${channel.id}&type=archive&first=1`);
      const latestVod = (result.data || [])[0];
      if (latestVod) {
        lastCheckedVods[channel.id] = latestVod.id;
        saveStore();
      }
    } catch (_) {}
  }

  return { success: true };
});

ipcMain.handle('remove-favorite', async (event, channelId) => {
  favoriteChannels = favoriteChannels.filter(c => c.id !== channelId);
  delete lastCheckedVods[channelId];
  saveStore();
  return { success: true };
});

ipcMain.handle('is-favorite', async (event, channelId) => {
  return { isFavorite: !!favoriteChannels.find(c => c.id === channelId) };
});

// ── Auto-Download Favorites ───────────────────────────────────────────────

async function checkForNewVods() {
  if (!settings.autoDownloadFavorites || !twitchAuth || favoriteChannels.length === 0) return;

  const token = await getValidToken();
  if (!token) return;

  for (const channel of favoriteChannels) {
    try {
      const result = await authedHelixGet(`/helix/videos?user_id=${channel.id}&type=archive&first=3`);
      const vods = result.data || [];
      if (vods.length === 0) continue;

      const lastKnown = lastCheckedVods[channel.id];

      if (!lastKnown) {
        // First time checking — seed with latest VOD, don't download
        lastCheckedVods[channel.id] = vods[0].id;
        saveStore();
        continue;
      }

      // Find new VODs (ones we haven't seen)
      const newVods = [];
      for (const vod of vods) {
        if (vod.id === lastKnown) break;
        newVods.push(vod);
      }

      if (newVods.length > 0) {
        // Update last checked to newest
        lastCheckedVods[channel.id] = vods[0].id;
        saveStore();

        // Download each new VOD
        for (const vod of newVods) {
          const vodUrl = `https://www.twitch.tv/videos/${vod.id}`;
          // Auto-downloading new VOD
          startDownload(vodUrl);

          // Notify user
          if (Notification.isSupported()) {
            const notif = new Notification({
              title: `New VOD from ${channel.displayName}`,
              body: `Auto-downloading: ${vod.title}`,
              silent: false,
            });
            notif.on('click', () => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                mainWindow.focus();
              }
            });
            notif.show();
          }
        }
      }
    } catch (e) {
      console.error(`[Auto-Download] Error checking ${channel.displayName}:`, e.message);
    }
  }
}

function startAutoDownloadPolling() {
  if (autoDownloadInterval) return;
  // Check every 10 minutes
  autoDownloadInterval = setInterval(checkForNewVods, 10 * 60 * 1000);
  // Also check immediately
  checkForNewVods();
}

function stopAutoDownloadPolling() {
  if (autoDownloadInterval) {
    clearInterval(autoDownloadInterval);
    autoDownloadInterval = null;
  }
}

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  const windowOptions = {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  // macOS: custom title bar with traffic lights
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 15, y: 15 };
  }
  // Windows/Linux: use frameless with custom drag region, or default frame
  if (process.platform === 'win32') {
    windowOptions.frame = true;  // Use native Windows frame
    windowOptions.autoHideMenuBar = true;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Serve app from localhost so Twitch embeds work (parent=localhost)
  const appServer = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon', '.json': 'application/json',
    };
    const fs = require('fs');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  appServer.listen(19876, '127.0.0.1', () => {
    mainWindow.loadURL('http://localhost:19876');

    // Warn renderer if critical binaries are missing
    if (MISSING_BINARIES.length > 0) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('missing-binaries', MISSING_BINARIES);
      });
    }
  });
}

// ── Auto Updater ──────────────────────────────────────────────────────────
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes || '',
    });
  }
});

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', {
      percent: Math.round(progress.percent),
    });
  }
});

autoUpdater.on('update-downloaded', () => {
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded');
  }
});

autoUpdater.on('error', (err) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-error', err.message);
  }
});

ipcMain.handle('check-for-updates', () => {
  autoUpdater.checkForUpdates().catch(() => {});
});

ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate().catch(() => {});
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

app.whenReady().then(() => {
  createWindow();
  startDiskWatcher();
  if (settings.autoDownloadFavorites) {
    startAutoDownloadPolling();
  }
  // Check for updates 5 seconds after launch (only in packaged app)
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }
});

app.on('window-all-closed', () => {
  stopDiskWatcher();
  // Kill all active downloads
  for (const [id, dl] of downloads) {
    dl.process.kill('SIGTERM');
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
