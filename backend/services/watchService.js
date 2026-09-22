const fs = require('fs');
const path = require('path');

class WatchService {
  constructor(send) {
    this.send = send;
    this.watcher = null;
    this.timer = null;
    this.root = null;
    this.generation = 0;
  }

  watch(root) {
    this.dispose();
    if (!root || !fs.existsSync(root)) return false;

    this.root = root;
    const generation = ++this.generation;

    try {
      this.watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
        const rel = String(filename || '');
        if (!rel || rel.startsWith('.git') || rel.includes(`${path.sep}node_modules${path.sep}`)) return;

        clearTimeout(this.timer);
        const watchedRoot = this.root;
        this.timer = setTimeout(() => {
          this.timer = null;
          if (generation !== this.generation || !this.watcher || this.root !== watchedRoot) return;

          try {
            this.send('workspace:fileChanged', {
              root: watchedRoot,
              eventType,
              path: path.join(watchedRoot, rel)
            });
          } catch {}
        }, 120);
      });
      return true;
    } catch {
      this.root = null;
      return false;
    }
  }

  dispose() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = null;

    try { this.watcher?.close(); } catch {}

    this.watcher = null;
    this.root = null;
  }
}

module.exports = { WatchService };
