'use strict';

const blockTypeToKind = blockType => {
    switch (blockType) {
    case 'command': return 'command';
    case 'reporter': return 'reporter';
    case 'Boolean': return 'boolean';
    case 'hat': return 'hat';
    case 'event': return 'event';
    case 'conditional': return 'conditional';
    case 'loop': return 'loop';
    case 'button': return 'button';
    case 'label': return 'label';
    case 'xml': return 'xml';
    default: return null;
    }
};

const typeDefaults = Object.freeze({
    number: {valueType: 'number', shadowOpcode: 'math_number', shadowField: 'NUM', defaultValue: 0},
    angle: {valueType: 'number', shadowOpcode: 'math_angle', shadowField: 'NUM', defaultValue: 90},
    note: {valueType: 'number', shadowOpcode: 'note', shadowField: 'NOTE', defaultValue: 60},
    color: {valueType: 'string', shadowOpcode: 'colour_picker', shadowField: 'COLOUR', defaultValue: '#ff0000'},
    Boolean: {valueType: 'boolean', shadowOpcode: 'text', shadowField: 'TEXT', defaultValue: false},
    string: {valueType: 'any', shadowOpcode: 'text', shadowField: 'TEXT', defaultValue: ''},
    matrix: {valueType: 'string', shadowOpcode: 'matrix', shadowField: 'MATRIX', defaultValue: ''},
    costume: {valueType: 'string', shadowOpcode: 'looks_costume', shadowField: 'COSTUME', defaultValue: ''},
    sound: {valueType: 'string', shadowOpcode: 'sound_sounds_menu', shadowField: 'SOUND_MENU', defaultValue: ''}
});

const syntaxSegment = value => {
    const segment = String(value || '');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) return segment;
    const encoded = Array.from(segment).map(character => character.codePointAt(0).toString(16)).join('_');
    return `encoded_${encoded || 'empty'}`;
};

const encodeSyntaxPayload = value => Array.from(JSON.stringify(value)).map(character =>
    character.codePointAt(0).toString(16)
).join('_');

const decodeSyntaxPayload = value => JSON.parse(value.split('_').map(code =>
    String.fromCodePoint(parseInt(code, 16))
).join(''));

const formatText = value => {
    if (typeof value === 'string') return value;
    if (value && typeof value.default === 'string') return value.default;
    if (value && typeof value.defaultMessage === 'string') return value.defaultMessage;
    return '';
};

const extensionArgument = (extensionId, name, info, category = {}) => {
    if (info.type === 'image') return null;
    const defaults = typeDefaults[info.type] || typeDefaults.string;
    const defaultValue = Object.prototype.hasOwnProperty.call(info, 'defaultValue') ?
        info.defaultValue : defaults.defaultValue;
    if (info.menu) {
        const menuInfo = category.menuInfo && category.menuInfo[info.menu] || {};
        if (!menuInfo.acceptReporters) return {
            name: name.toLowerCase(),
            originalName: name,
            role: 'field',
            valueType: defaults.valueType,
            field: name,
            defaultValue
        };
        return {
            name: name.toLowerCase(),
            originalName: name,
            role: 'menu',
            valueType: defaults.valueType,
            input: name,
            menuOpcode: `${extensionId}_menu_${info.menu}`,
            menuField: info.menu,
            defaultValue
        };
    }
    const customField = category.customFieldTypes && category.customFieldTypes[info.type];
    const customShadow = customField && customField.argumentTypeInfo && customField.argumentTypeInfo.shadow;
    return {
        name: name.toLowerCase(),
        originalName: name,
        role: 'input',
        valueType: defaults.valueType,
        input: name,
        shadowOpcode: customShadow && customShadow.type || defaults.shadowOpcode,
        shadowField: customShadow && customShadow.fieldName || defaults.shadowField,
        defaultValue
    };
};

const argumentContext = category => ({
    menuInfo: Object.fromEntries(Object.entries(category.menuInfo || {}).map(([name, info]) => [name, {
        acceptReporters: Boolean(info && info.acceptReporters)
    }])),
    customFieldTypes: Object.fromEntries(Object.entries(category.customFieldTypes || {}).map(([name, info]) => [name, {
        argumentTypeInfo: {
            shadow: info && info.argumentTypeInfo && info.argumentTypeInfo.shadow || null
        }
    }]))
});

const dynamicMetadata = (baseMetadata, blockInfo) => {
    if (!baseMetadata || !baseMetadata.isDynamic || !blockInfo || typeof blockInfo !== 'object') return baseMetadata;
    const context = baseMetadata.argumentContext || {};
    const canonicalName = `${baseMetadata.canonicalName}.variant_${encodeSyntaxPayload(blockInfo)}`;
    return Object.assign({}, baseMetadata, {
        canonicalName,
        dynamicVariant: true,
        kind: blockTypeToKind(blockInfo.blockType) || baseMetadata.kind,
        terminal: Boolean(blockInfo.isTerminal || blockInfo.terminal),
        branchCount: blockInfo.branchCount || 0,
        allowStage: !Array.isArray(blockInfo.filter) || blockInfo.filter.includes('stage'),
        allowSprite: !Array.isArray(blockInfo.filter) || blockInfo.filter.includes('sprite'),
        arguments: Object.entries(blockInfo.arguments || {}).map(([name, info]) =>
            extensionArgument(baseMetadata.extensionId, name, info || {}, context)
        ).filter(Boolean),
        mutation: {
            tagName: 'mutation',
            children: [],
            blockInfo: JSON.stringify(blockInfo)
        },
        documentation: `${canonicalName} — variante dinâmica de ${baseMetadata.canonicalName}`
    });
};

const resolveDynamicMetadata = (name, catalog) => {
    const marker = '.variant_';
    const markerIndex = String(name).lastIndexOf(marker);
    if (markerIndex < 0) return null;
    const baseName = name.slice(0, markerIndex);
    const baseMetadata = catalog && catalog[baseName];
    if (!baseMetadata || !baseMetadata.isDynamic) return null;
    try {
        return dynamicMetadata(baseMetadata, decodeSyntaxPayload(name.slice(markerIndex + marker.length)));
    } catch (error) {
        return null;
    }
};

const buildExtensionInventory = runtimeOrVm => {
    const runtime = runtimeOrVm && runtimeOrVm.runtime ? runtimeOrVm.runtime : runtimeOrVm;
    const catalog = {};
    const palette = [];
    if (!runtime || !Array.isArray(runtime._blockInfo)) return {catalog, palette};

    runtime._blockInfo.forEach(category => {
        if (!category || !category.id || !Array.isArray(category.blocks)) return;
        category.blocks.forEach((converted, index) => {
            const info = converted && converted.info;
            const json = converted && converted.json;
            if (!info) return;
            const kind = blockTypeToKind(info.blockType);
            if (!kind) {
                if (converted.xml && /^\s*<sep\b/i.test(converted.xml)) palette.push({
                    extensionId: category.id,
                    extensionName: category.name || category.id,
                    canonicalName: `${category.id}.@separator.${index}`,
                    kind: 'separator',
                    xml: converted.xml
                });
                return;
            }
            if (!json || !info.opcode) {
                const nativeButtons = ['MAKE_A_LIST', 'MAKE_A_PROCEDURE', 'MAKE_A_VARIABLE'];
                const actionId = kind === 'button' && info.func && !nativeButtons.includes(info.func) ?
                    `${category.id}_${info.func}` : null;
                palette.push({
                    extensionId: category.id,
                    extensionName: category.name || category.id,
                    canonicalName: `${category.id}.@${kind}.${info.func || index}`,
                    kind,
                    text: formatText(info.text),
                    actionId,
                    xml: converted.xml || info.xml || ''
                });
                return;
            }
            const candidateName = `${syntaxSegment(category.id)}.${syntaxSegment(info.opcode)}`;
            let canonicalName = candidateName;
            let duplicate = 2;
            while (catalog[canonicalName]) canonicalName = `${candidateName}_${duplicate++}`;
            const metadata = {
                canonicalName,
                extensionId: category.id,
                extensionName: category.name || category.id,
                extensionOpcode: info.opcode,
                opcode: json.type || `${category.id}_${info.opcode}`,
                kind,
                allowStage: !Array.isArray(info.filter) || info.filter.includes('stage'),
                allowSprite: !Array.isArray(info.filter) || info.filter.includes('sprite'),
                terminal: Boolean(info.isTerminal || info.terminal),
                branchCount: info.branchCount || 0,
                arguments: Object.entries(info.arguments || {}).map(([name, argumentInfo]) =>
                    extensionArgument(category.id, name, argumentInfo || {}, category)
                ).filter(Boolean),
                documentation: `${canonicalName} — ${formatText(info.text) || 'bloco de extensão'}`,
                color: category.color1 || null
            };
            if (info.isDynamic) {
                metadata.isDynamic = true;
                metadata.argumentContext = argumentContext(category);
                metadata.mutation = {
                    tagName: 'mutation',
                    children: [],
                    blockInfo: JSON.stringify(info)
                };
            }
            catalog[canonicalName] = metadata;
            palette.push(Object.assign({text: formatText(info.text), xml: converted.xml || ''}, metadata));
        });
    });
    return {catalog, palette};
};

const buildExtensionCatalog = runtimeOrVm => buildExtensionInventory(runtimeOrVm).catalog;

const summarizeExtensionCatalog = catalog => {
    const entries = Object.values(catalog || {});
    return {
        extensionCount: new Set(entries.map(item => item.extensionId)).size,
        blockCount: entries.length,
        extensions: Array.from(new Set(entries.map(item => item.extensionId))).sort()
    };
};

module.exports = {
    blockTypeToKind,
    buildExtensionCatalog,
    buildExtensionInventory,
    decodeSyntaxPayload,
    dynamicMetadata,
    encodeSyntaxPayload,
    extensionArgument,
    resolveDynamicMetadata,
    syntaxSegment,
    summarizeExtensionCatalog
};
