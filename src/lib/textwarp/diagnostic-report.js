'use strict';

const asArray = value => {
    if (Array.isArray(value)) return value;
    return [];
};
const asText = value => {
    if (value === null || typeof value === 'undefined') return '';
    return String(value);
};

const line = (label, value) => `${label}: ${asText(value) || '-'}`;

const formatTimestamp = value => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? asText(value) : date.toISOString();
};

const formatDiagnostic = diagnostic => [
    `${String(diagnostic.severity || 'error').toUpperCase()}`,
    `L${diagnostic.line || 1}:${diagnostic.column || 1}`,
    diagnostic.code ? `[${diagnostic.code}]` : '',
    diagnostic.message || ''
].filter(Boolean).join(' ');

const formatConsoleEntry = entry => [
    formatTimestamp(entry.timestamp),
    String(entry.level || 'info').toUpperCase(),
    entry.targetName || entry.targetId || '-',
    entry.line ? `L${entry.line}` : '',
    entry.message || ''
].filter(Boolean).join(' ');

const createDiagnosticReport = (data = {}) => {
    const diagnostics = asArray(data.diagnostics);
    const runtimeErrors = asArray(data.runtimeErrors);
    const consoleEntries = asArray(data.consoleEntries);
    const variables = asArray(data.variables);
    const extensions = asArray(data.extensions);
    const unsupportedOpcodes = asArray(data.conversion && data.conversion.unsupportedOpcodes);
    const sections = [
        '# TextWarp technical report',
        line('Generated', data.generatedAt),
        line('Language version', data.languageVersion || '0.3'),
        line('Locale', data.locale),
        line('Browser', data.userAgent),
        '',
        '## Project',
        line('Title', data.projectTitle),
        line('Targets', data.targetCount),
        line('Extensions', extensions.length),
        extensions.length ? extensions.map(extension => {
            if (typeof extension === 'string') return `- ${extension}`;
            return `- ${extension.id || extension.name || 'unknown'} (${extension.blockCount || 0} blocks)`;
        }).join('\n') : '- none',
        '',
        '## Active target',
        line('Name', data.targetName),
        line('ID', data.targetId),
        line('Type', data.isStage ? 'stage' : 'actor'),
        line('Blocks', data.blockCount),
        line('Variables and lists', variables.length),
        variables.length ? variables.map(variable =>
            `- ${variable.owner || 'target'} ${variable.type === 'list' ? 'list' : 'variable'} ` +
            `${JSON.stringify(variable.name)} id=${variable.id || '-'}`
        ).join('\n') : '- none',
        '',
        '## Editor',
        line('Status', data.status),
        line('Monaco error', data.monacoError),
        line('Source characters', asText(data.source).length),
        line('Source lines', asText(data.source) ? asText(data.source).split('\n').length : 0),
        '',
        '## Blocks to Text conversion',
        line('Successful', data.conversion ? data.conversion.success : ''),
        line('Imported roots', data.conversion && data.conversion.importedRootCount),
        line('Unsupported roots', data.conversion && data.conversion.unsupportedRootCount),
        line('Opaque-preserved opcodes', unsupportedOpcodes.length ? unsupportedOpcodes.join(', ') : 'none'),
        '',
        `## Diagnostics (${diagnostics.length})`,
        diagnostics.length ? diagnostics.map(formatDiagnostic).join('\n') : '- none',
        '',
        `## Runtime errors (${runtimeErrors.length})`,
        runtimeErrors.length ? runtimeErrors.map(error => [
            formatTimestamp(error.timestamp),
            error.targetName || error.targetId || '-',
            error.line ? `L${error.line}` : '',
            error.message || '',
            error.stack || ''
        ].filter(Boolean).join(' ')).join('\n') : '- none',
        '',
        `## Console (${consoleEntries.length})`,
        consoleEntries.length ? consoleEntries.map(formatConsoleEntry).join('\n') : '- none',
        '',
        '## Current TextWarp source',
        '```textwarp',
        asText(data.source),
        '```',
        ''
    ];
    return sections.join('\n');
};

module.exports = {
    createDiagnosticReport,
    formatDiagnostic
};
