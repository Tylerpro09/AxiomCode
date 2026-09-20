const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

class ConfigurationService {
  constructor(app) {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.defaults = {
      editor: {
        fontSize: 14,
        fontFamily: 'Cascadia Code, Consolas, monospace',
        lineHeight: 21,
        wordWrap: 'off',
        minimap: {enabled: true},
        renderWhitespace: 'selection',
        stickyScroll: {enabled: true},
        smoothScrolling: true,
        bracketPairColorization: {enabled: true},
        formatOnPaste: false,
        formatOnType: false,
        tabSize: 4
      },
      workbench: {
        restoreLastWorkspace: true,
        colorTheme: 'AxiomCode Dark Modern',
        iconTheme: 'material',
        activityBarVisible: true,
        commandCenterVisible: true
      },
      files: {autoSave: 'off', autoSaveDelay: 1000},
      terminal: {defaultProfile: 'powershell', fontSize: 13, scrollback: 5000},
      update: {autoCheck: true},
      keybindings: {},
      profiles: {active: 'Default', items: {}}
    };
    this.data = null;
  }
  mergeDefaults(target, defaults=this.defaults) {
    const out = target && typeof target === 'object' && !Array.isArray(target) ? structuredClone(target) : {};
    for (const [key,value] of Object.entries(defaults)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = this.mergeDefaults(out[key], value);
      else if (out[key] === undefined) out[key] = structuredClone(value);
    }
    return out;
  }
  async persist() {
    await fsp.mkdir(path.dirname(this.file), {recursive:true});
    await fsp.writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }
  async load() {
    if (this.data) return this.data;
    try { this.data = this.mergeDefaults(JSON.parse(await fsp.readFile(this.file, 'utf8'))); }
    catch { this.data = structuredClone(this.defaults); }
    return this.data;
  }
  async reload() {
    this.data = null;
    return this.getAll();
  }
  async getAll() { return structuredClone(await this.load()); }
  async getDefaults() { return structuredClone(this.defaults); }
  async get(section) {
    const data = await this.load();
    return section.split('.').reduce((v, k) => v?.[k], data);
  }
  async set(section, value) {
    const data = await this.load();
    const keys = section.split('.');
    let target = data;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = value;
    await this.persist();
    return value;
  }
  async setMany(values={}) {
    for (const [section,value] of Object.entries(values)) {
      const keys = section.split('.');
      let target = await this.load();
      for (const key of keys.slice(0,-1)) target = target[key] ??= {};
      target[keys.at(-1)] = value;
    }
    await this.persist();
    return this.getAll();
  }
  async replaceAll(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuración no válida');
    this.data = this.mergeDefaults(value);
    await this.persist();
    return this.getAll();
  }
  async reset() {
    this.data = structuredClone(this.defaults);
    await this.persist();
    return this.getAll();
  }
}
module.exports = { ConfigurationService };