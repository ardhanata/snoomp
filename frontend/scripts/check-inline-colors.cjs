const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

function findFiles(dir, exts, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      findFiles(fullPath, exts, fileList);
    } else if (exts.includes(path.extname(file))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const colorRegex = /(?:#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\))/g;

// Support --scope=redesign (default) or --all
const isAll = process.argv.includes('--all');
const REDESIGN_FILES = [
  'App.tsx',
  'MonitorRow.tsx',
  'MetricsCharts.tsx',
  'TagChip.tsx',
  'Icon.tsx',
  'PreferencesTagsTab.tsx'
];

let files = findFiles(SRC_DIR, ['.tsx', '.jsx']);
if (!isAll) {
  files = files.filter(f => REDESIGN_FILES.some(r => f.endsWith(path.sep + r) || f.endsWith('/' + r)));
}

let totalViolations = 0;
const report = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // Exclude token dictionary declarations in TagChip.tsx
    if (file.endsWith('TagChip.tsx') && (line.includes('dark:') || line.includes('light:'))) {
      return;
    }

    if (line.includes('style=') || line.includes('color:') || line.includes('background:') || line.includes('border:') || line.includes('fill:') || line.includes('stroke:')) {
      const colorMatches = line.match(colorRegex);
      if (colorMatches) {
        for (const col of colorMatches) {
          if (line.includes('style=') || /['"]?(color|background|backgroundColor|borderColor|border|fill|stroke)['"]?\s*:/.test(line)) {
            totalViolations++;
            report.push({
              file: path.relative(path.join(__dirname, '..'), file),
              line: index + 1,
              content: line.trim(),
              color: col
            });
          }
        }
      }
    }
  });
}

console.log(`[check-inline-colors] Scanned ${files.length} JSX/TSX files (${isAll ? 'all files' : 'redesign scope'}).`);
if (totalViolations > 0) {
  console.log(`Found ${totalViolations} inline color literal(s):`);
  report.forEach(r => {
    console.log(`  ${r.file}:${r.line} [${r.color}] -> ${r.content}`);
  });
  process.exitCode = 1;
} else {
  console.log(`✓ 0 inline color literals found in style attributes.`);
  process.exitCode = 0;
}
