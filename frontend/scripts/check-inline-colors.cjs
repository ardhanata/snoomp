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
// Matches style={{ ... }}
const stylePropRegex = /style=\{\{([^}]+)\}\}/g;

const files = findFiles(SRC_DIR, ['.tsx', '.jsx']);
let totalViolations = 0;
const report = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    // Check if line contains a style attribute with literal hex/rgb
    let match;
    // Simple heuristic: look for style={{ ... }} or multi-line style blocks with color literals
    if (line.includes('style=') || line.includes('color:') || line.includes('background:') || line.includes('border:') || line.includes('fill:') || line.includes('stroke:')) {
      const colorMatches = line.match(colorRegex);
      if (colorMatches) {
        // Exclude allowed SVG icon definitions or chart gradient defs if applicable
        // But flag all style={{ ... }} literal colors
        for (const col of colorMatches) {
          // Check if this appears inside a style={{ or style object property
          if (line.includes('style=') || /['"]?(color|background|backgroundColor|borderColor|border|fill|stroke)['"]?\s*:/.test(line)) {
            // White and pure black for specific icon strokes or print media might have special rules,
            // but let's report them so they can be inspected.
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

console.log(`[check-inline-colors] Scanned ${files.length} JSX/TSX files.`);
if (totalViolations > 0) {
  console.log(`Found ${totalViolations} potential inline color literal(s):`);
  report.forEach(r => {
    console.log(`  ${r.file}:${r.line} [${r.color}] -> ${r.content}`);
  });
} else {
  console.log(`✓ 0 inline color literals found in style attributes.`);
}
