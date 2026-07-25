'use strict';

const {normalizeLocale} = require('./i18n');

const normalizeSearch = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const slugify = value => normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'topico';

const markdownToText = markdown => String(markdown || '')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const firstSummary = markdown => {
    const paragraphs = String(markdown || '').split(/\n\s*\n/).map(markdownToText).filter(Boolean);
    const paragraph = paragraphs.find(value => !/^arquivo gerado/i.test(value)) || paragraphs[0] || '';
    return paragraph.length > 150 ? `${paragraph.slice(0, 147).trim()}…` : paragraph;
};

const splitMarkdownDocument = ({id, group, markdown, overviewTitle}) => {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const sections = [];
    let documentTitle = '';
    let current = {title: overviewTitle, lines: []};

    const finish = () => {
        const body = current.lines.join('\n').trim();
        if (!body) return;
        sections.push({
            id: `${id}-${slugify(current.title)}`,
            documentId: id,
            group,
            title: current.title,
            summary: firstSummary(body),
            markdown: body,
            searchText: normalizeSearch(`${group} ${current.title} ${markdownToText(body)}`),
            type: 'markdown'
        });
    };

    lines.forEach(line => {
        const firstHeading = line.match(/^#\s+(.+)$/);
        if (firstHeading && !documentTitle) {
            documentTitle = firstHeading[1].trim();
            return;
        }
        const sectionHeading = line.match(/^#{2,3}\s+(.+)$/);
        if (sectionHeading) {
            finish();
            current = {title: sectionHeading[1].trim(), lines: []};
            return;
        }
        current.lines.push(line);
    });
    finish();
    return sections;
};

const argumentList = metadata => (metadata.arguments || []).map(argument => argument.name).join(', ');

const extensionSyntax = metadata => {
    const call = `${metadata.canonicalName}(${argumentList(metadata)})`;
    if (metadata.kind === 'hat' || metadata.kind === 'event') return `on ${call}:`;
    if (metadata.kind === 'conditional' || metadata.kind === 'loop') return `${call}:`;
    return call;
};

const extensionScope = (metadata, locale) => {
    const portuguese = normalizeLocale(locale) === 'pt';
    if (metadata.allowStage === false) return portuguese ? 'Somente atores' : 'Actors only';
    if (metadata.allowSprite === false) return portuguese ? 'Somente palco' : 'Stage only';
    return portuguese ? 'Palco e atores' : 'Stage and actors';
};

const buildExtensionSection = (extensionCatalog, extensionPalette, locale) => {
    const portuguese = normalizeLocale(locale) === 'pt';
    const entries = Object.values(extensionCatalog || {}).sort((left, right) =>
        left.canonicalName.localeCompare(right.canonicalName)
    ).map(metadata => ({
        name: metadata.canonicalName,
        syntax: extensionSyntax(metadata),
        opcode: metadata.opcode,
        kind: metadata.kind,
        scope: extensionScope(metadata, locale),
        description: metadata.documentation || (portuguese ?
            `${metadata.canonicalName} — bloco da extensão ${metadata.extensionId}` :
            `${metadata.canonicalName} — ${metadata.extensionId} extension block`),
        extensionName: metadata.extensionName || metadata.extensionId
    }));
    const palette = (extensionPalette || []).filter(item =>
        ['button', 'label', 'xml', 'separator'].includes(item.kind)
    ).map(item => ({
        name: item.canonicalName,
        kind: item.kind,
        description: item.text || item.xml || (portuguese ? 'Separador visual da paleta.' : 'Visual palette separator.'),
        extensionName: item.extensionName || item.extensionId
    }));
    const searchText = normalizeSearch([
        portuguese ? 'Projeto atual Extensões carregadas' : 'Current project Loaded extensions',
        ...entries.flatMap(entry => Object.values(entry)),
        ...palette.flatMap(entry => Object.values(entry))
    ].join(' '));
    return {
        id: 'runtime-extensoes-carregadas',
        documentId: 'runtime',
        group: portuguese ? 'Projeto atual' : 'Current project',
        title: portuguese ? 'Extensões carregadas' : 'Loaded extensions',
        summary: entries.length ?
            (portuguese ?
                `${entries.length} bloco(s) executável(is) possuem sintaxe TextWarp neste projeto.` :
                `${entries.length} executable extension block(s) have TextWarp syntax in this project.`) :
            (portuguese ?
                'Carregue uma extensão para ver aqui suas chamadas TextWarp geradas pelo getInfo().' :
                'Load an extension to see its getInfo()-generated TextWarp calls here.'),
        entries,
        palette,
        searchText,
        type: 'extensions'
    };
};

const buildDocumentationSections = options => {
    const portuguese = normalizeLocale(options.locale === undefined ? 'pt-BR' : options.locale) === 'pt';
    return [
    ...splitMarkdownDocument({
        id: 'manual',
        group: 'Manual TextWarp',
        markdown: options.guideMarkdown,
        overviewTitle: portuguese ? 'Visão geral' : 'Overview'
    }),
    ...splitMarkdownDocument({
        id: 'ide',
        group: 'IDE TextWarp',
        markdown: options.ideMarkdown,
        overviewTitle: portuguese ? 'Visão geral da IDE' : 'IDE overview'
    }),
    ...splitMarkdownDocument({
        id: 'reference',
        group: portuguese ? 'Referência completa' : 'Complete reference',
        markdown: options.referenceMarkdown,
        overviewTitle: portuguese ? 'Sobre a referência' : 'About this reference'
    }),
    ...splitMarkdownDocument({
        id: 'status',
        group: portuguese ? 'Estado do projeto' : 'Project status',
        markdown: options.prioritiesMarkdown,
        overviewTitle: portuguese ? 'Visão geral do status' : 'Status overview'
    }),
    ...splitMarkdownDocument({
        id: 'legal',
        group: portuguese ? 'Licenças e compatibilidade' : 'Licenses and compatibility',
        markdown: options.legalMarkdown,
        overviewTitle: portuguese ? 'Visão geral legal' : 'Legal overview'
    }),
    buildExtensionSection(
        options.extensionCatalog,
        options.extensionPalette,
        options.locale === undefined ? 'pt-BR' : options.locale
    )
    ];
};

const filterDocumentationSections = (sections, query) => {
    const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return sections;
    return sections.reduce((result, section) => {
        const sectionHeader = normalizeSearch(`${section.group} ${section.title} ${section.summary}`);
        const headerMatches = tokens.every(token => sectionHeader.includes(token));
        if (section.type !== 'extensions') {
            if (tokens.every(token => section.searchText.includes(token))) result.push(section);
            return result;
        }
        const matches = value => tokens.every(token => normalizeSearch(Object.values(value).join(' ')).includes(token));
        const entries = headerMatches ? section.entries : section.entries.filter(matches);
        const palette = headerMatches ? section.palette : section.palette.filter(matches);
        if (headerMatches || entries.length || palette.length) result.push(Object.assign({}, section, {entries, palette}));
        return result;
    }, []);
};

module.exports = {
    buildDocumentationSections,
    filterDocumentationSections,
    markdownToText,
    normalizeSearch,
    slugify,
    splitMarkdownDocument
};
