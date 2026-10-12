// Exact-match patcher that keeps the file's line endings. usage: node patch.cjs <file> <spec.cjs>; spec exports [[old,new],...]
const fs = require('fs');
const [, , file, spec] = process.argv;
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.includes('\r\n');
let s = raw.replace(/\r\n/g, '\n');
for (const [a, b] of require(require('path').resolve(spec))) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`match count ${n} for: ` + a.slice(0, 80));
  s = s.replace(a, () => b);
}
fs.writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s);
console.log('patched', file);
