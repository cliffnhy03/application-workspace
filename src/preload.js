// The only bridge between the window and the rest of the computer.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  state: () => call('state'),
  createApp: fields => call('app:create', fields),
  updateApp: (id, patch) => call('app:update', id, patch),
  deleteApp: id => call('app:delete', id),
  addFiles: opts => call('file:add', opts),
  copyFile: opts => call('file:copy', opts),
  updateFile: (id, patch) => call('file:update', id, patch),
  removeFile: id => call('file:remove', id),
  openFile: id => call('file:open', id),
  revealFile: id => call('file:reveal', id),
  exportFile: id => call('file:export', id),
  openLink: url => call('link:open', url),
  openDataFolder: () => call('data:open'),
  backup: () => call('data:backup'),
  restore: () => call('data:restore'),
  loadSample: () => call('sample:load'),
  clearSample: () => call('sample:clear'),
  // Dropped files carry no path in the page itself; Electron resolves it here.
  pathForFile: file => webUtils.getPathForFile(file),
  onCommand: fn => ipcRenderer.on('command', (_e, cmd) => fn(cmd)),
});
