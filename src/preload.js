const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quad', {
  acao: (acao, i, valor) => ipcRenderer.send('acao', { acao, i, valor }),
  configSalvar: (c) => ipcRenderer.invoke('config:salvar', c),
  abrirPasta: () => ipcRenderer.send('abrir-pasta'),
  configLer: () => ipcRenderer.invoke('config:ler'),
  credsLer: (i) => ipcRenderer.invoke('creds:ler', i),
  credsSalvar: (i, user, pass, metodo) => ipcRenderer.invoke('creds:salvar', { i, user, pass, metodo }),
  credsLimpar: (i) => ipcRenderer.invoke('creds:limpar', i),
  extListar: () => ipcRenderer.invoke('ext:listar'),
  extAtivar: (id, ativa) => ipcRenderer.invoke('ext:ativar', { id, ativa }),
  extAtualizar: (id) => ipcRenderer.invoke('ext:atualizar', id),
  extPagina: (id) => ipcRenderer.send('ext:pagina', id),
  onEstado: (cb) => ipcRenderer.on('estado', (_e, s) => cb(s)),
  onAviso: (cb) => ipcRenderer.on('aviso', (_e, t) => cb(t)),
});
