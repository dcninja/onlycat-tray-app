const fs = require('fs');
const path = require('path');

const renderers = ['token-dialog', 'activity-window', 'video-window', 'notification-settings'];
const srcBase = path.join(__dirname, '../src/renderer');
const distBase = path.join(__dirname, '../dist/renderer/renderer');

for (const name of renderers) {
  const srcDir = path.join(srcBase, name);
  const distDir = path.join(distBase, name);

  fs.mkdirSync(distDir, { recursive: true });

  // Copy HTML and CSS
  for (const file of fs.readdirSync(srcDir)) {
    if (file.endsWith('.html') || file.endsWith('.css')) {
      fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
      console.log(`Copied ${name}/${file}`);
    }
  }
}
