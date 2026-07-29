import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';

const buildDirectory = path.resolve('build');
const MEBIBYTE = 1024 * 1024;
const budgets = {
    buildBytes: 26 * MEBIBYTE,
    buildFiles: 460,
    initialGzipBytes: 1.8 * MEBIBYTE,
    initialRawBytes: 7.3 * MEBIBYTE,
    monacoBytes: 4.6 * MEBIBYTE,
    monacoFiles: 20
};

const walk = directory => fs.existsSync(directory) ?
    fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
    }) :
    [];

const scriptsFor = fileName => {
    const html = fs.readFileSync(path.join(buildDirectory, fileName), 'utf8');
    return Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), match => {
        const pathname = new URL(match[1], 'https://textwarp.invalid').pathname;
        const relative = pathname.replace(/^\/textwarp\//, '').replace(/^\//, '');
        return path.join(buildDirectory, relative);
    });
};

if (!fs.existsSync(path.join(buildDirectory, 'index.html'))) {
    throw new Error('Build output is missing. Run npm run build:textwarp:web first.');
}

const indexScripts = scriptsFor('index.html');
const editorScripts = scriptsFor('editor.html');
const initialRawBytes = indexScripts.reduce((total, file) => total + fs.statSync(file).size, 0);
const initialGzipBytes = indexScripts.reduce(
    (total, file) => total + zlib.gzipSync(fs.readFileSync(file)).length,
    0
);
const buildFiles = walk(buildDirectory);
const monacoDirectory = path.join(buildDirectory, 'static/monaco/vs');
const monacoFiles = walk(monacoDirectory);
const measurements = {
    buildBytes: buildFiles.reduce((total, file) => total + fs.statSync(file).size, 0),
    buildFiles: buildFiles.length,
    initialGzipBytes,
    initialRawBytes,
    monacoBytes: monacoFiles.reduce((total, file) => total + fs.statSync(file).size, 0),
    monacoFiles: monacoFiles.length
};

const failures = Object.entries(budgets)
    .filter(([name, budget]) => measurements[name] > budget)
    .map(([name, budget]) => `${name}: ${measurements[name]} exceeds ${budget}`);

if (
    indexScripts.map(file => path.basename(file)).join('\n') !==
    editorScripts.map(file => path.basename(file)).join('\n')
) {
    failures.push('index.html and editor.html do not share the same entry assets');
}
if (buildFiles.some(file => /[/\\]player\.[^/\\]+\.js$/.test(file))) {
    failures.push('a duplicate player route entry was emitted');
}
[
    'loader.js',
    'nls.messages-loader.js',
    'nls.messages.js.js',
    'nls.messages.pt-br.js.js',
    'editor/editor.main.css',
    'editor/editor.main.js'
].forEach(file => {
    if (!fs.existsSync(path.join(monacoDirectory, file))) {
        failures.push(`required Monaco runtime asset is missing: ${file}`);
    }
});
if (!monacoFiles.some(file => /editor\.api-[^/\\]+\.js$/.test(file))) {
    failures.push('the Monaco editor API asset is missing');
}
if (!monacoFiles.some(file => /assets[/\\]editor\.worker-[^/\\]+\.js$/.test(file))) {
    failures.push('the Monaco editor worker asset is missing');
}

console.log(JSON.stringify({budgets, measurements}, null, 2));
if (failures.length) {
    failures.forEach(failure => console.error(`Performance budget failed: ${failure}`));
    process.exitCode = 1;
}
