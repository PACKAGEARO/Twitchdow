const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startDownload: (url, options) => ipcRenderer.invoke('start-download', url, options),
  cancelDownload: (id) => ipcRenderer.invoke('cancel-download', id),
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  getVideoInfo: (url) => ipcRenderer.invoke('get-video-info', url),
  openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  getOutputDir: () => ipcRenderer.invoke('get-output-dir'),
  setOutputDir: (dir) => ipcRenderer.invoke('set-output-dir', dir),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  clearCompleted: () => ipcRenderer.invoke('clear-completed'),
  removeCompleted: (id) => ipcRenderer.invoke('remove-completed', id),
  getHistory: (opts) => ipcRenderer.invoke('get-history', opts),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  removeHistoryItem: (id) => ipcRenderer.invoke('remove-history-item', id),
  deleteFileAndHistory: (id) => ipcRenderer.invoke('delete-file-and-history', id),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (event, data) => callback(data)),
  onDownloadRetry: (callback) => ipcRenderer.on('download-retry', (event, data) => callback(data)),
  onDiskSpaceUpdated: (callback) => ipcRenderer.on('disk-space-updated', (event, data) => callback(data)),
  // Twitch Auth
  twitchLogin: () => ipcRenderer.invoke('twitch-login'),
  twitchLogout: () => ipcRenderer.invoke('twitch-logout'),
  twitchGetAuthStatus: () => ipcRenderer.invoke('twitch-get-auth-status'),
  twitchGetFollowing: () => ipcRenderer.invoke('twitch-get-following'),
  twitchGetVods: (opts) => ipcRenderer.invoke('twitch-get-vods', opts),
  twitchGetLiveFollowed: () => ipcRenderer.invoke('twitch-get-live-followed'),
  twitchGetFollowedVods: (opts) => ipcRenderer.invoke('twitch-get-followed-vods', opts),
  // Twitch Search
  twitchSearchChannels: (opts) => ipcRenderer.invoke('twitch-search-channels', opts),
  twitchGetClips: (opts) => ipcRenderer.invoke('twitch-get-clips', opts),
  twitchGetChannelInfo: (opts) => ipcRenderer.invoke('twitch-get-channel-info', opts),
  // Favorites
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  addFavorite: (channel) => ipcRenderer.invoke('add-favorite', channel),
  removeFavorite: (channelId) => ipcRenderer.invoke('remove-favorite', channelId),
  isFavorite: (channelId) => ipcRenderer.invoke('is-favorite', channelId),
  // Platform
  getPlatform: () => process.platform,
  // System warnings
  onMissingBinaries: (callback) => ipcRenderer.on('missing-binaries', (event, data) => callback(data)),
});
