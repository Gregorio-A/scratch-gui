'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const VM = require('scratch-vm');

const {auditRuntimeCoverage, syntaxComponents} = require('../../src/lib/textwarp/block-coverage');
const {blockRegistry, controlRegistry, eventRegistry, operatorRegistry} = require('../../src/lib/textwarp/block-registry');
const {compileText} = require('../../src/lib/textwarp/compiler');
const {decompileTarget} = require('../../src/lib/textwarp/decompiler');
const {buildExtensionCatalog, dynamicMetadata} = require('../../src/lib/textwarp/extension-catalog');

const actorOptions = {
    targetId: 'complete-coverage-sprite',
    stageId: 'complete-coverage-stage',
    targetName: 'Player',
    isStage: false
};

const argumentSource = argument => {
    if (argument.role === 'list') return 'items';
    if (argument.role === 'variable') return 'value';
    if (argument.role === 'broadcast' || argument.role === 'broadcast-field') return '"message"';
    if (argument.valueType === 'boolean') return 'true';
    if (argument.valueType === 'number') return '1';
    if (Object.prototype.hasOwnProperty.call(argument, 'defaultValue')) {
        return JSON.stringify(argument.defaultValue);
    }
    return '"value"';
};

const callSource = (name, metadata) => `${name}(${(metadata.arguments || []).map(argumentSource).join(', ')})`;

const sourceForBlock = (name, metadata) => {
    const call = callSource(name, metadata);
    let statement;
    if (metadata.kind === 'command') statement = call;
    else if (metadata.kind === 'boolean') statement = `if ${call}:\n        wait(0)`;
    else if (metadata.kind === 'reporter') statement = `say(${call})`;
    else {
        statement = `${call}:\n        wait(0)`;
        for (let branch = 2; branch <= Math.max(1, Number(metadata.branchCount) || 1); branch++) {
            statement += `\n    branch ${branch}:\n        wait(0)`;
        }
    }
    return `actor Player\nvariable value = 0\nlist items = []\non green_flag:\n    ${statement}`;
};

const fakeTarget = compilation => {
    const variables = Object.fromEntries(compilation.graph.declarations.map(declaration => [declaration.id, {
        id: declaration.id,
        name: declaration.name,
        type: declaration.variableType,
        value: declaration.initialValue
    }]));
    return {
        id: actorOptions.targetId,
        isStage: false,
        variables,
        getName: () => 'Player',
        blocks: {
            _blocks: compilation.graph.blocks,
            getBlock: id => compilation.graph.blocks[id]
        },
        runtime: {getTargetForStage: () => null, _hats: {}}
    };
};

test('every primitive and hat in scratch-vm has TextWarp syntax', () => {
    const vm = new VM();
    const audit = auditRuntimeCoverage(vm);
    assert.equal(audit.primitives.length, 140);
    assert.equal(audit.hats.length, 9);
    assert.deepEqual(audit.missing, []);
    ['sound_beats_menu', 'sound_effects_menu', 'sound_sounds_menu'].forEach(opcode => {
        assert.ok(syntaxComponents[opcode], opcode);
    });
});

test('every non-executable core block definition is represented as a syntax component', () => {
    const vm = new VM();
    const runtimeOpcodes = new Set([
        ...Object.keys(vm.runtime._primitives),
        ...Object.keys(vm.runtime._hats)
    ]);
    const scratchBlocksRoot = path.dirname(require.resolve('scratch-blocks/package.json'));
    const directories = ['blocks_common', 'blocks_vertical'];
    const definitions = new Set();
    directories.forEach(directory => {
        const absolute = path.join(scratchBlocksRoot, directory);
        fs.readdirSync(absolute).filter(file => file.endsWith('.js')).forEach(file => {
            const source = fs.readFileSync(path.join(absolute, file), 'utf8');
            for (const match of source.matchAll(/Blockly\.Blocks\['([^']+)'\]/g)) definitions.add(match[1]);
        });
    });
    const components = Array.from(definitions).filter(opcode =>
        !runtimeOpcodes.has(opcode) && !opcode.startsWith('extension_')
    ).sort();
    assert.equal(components.length, 27);
    assert.deepEqual(components.filter(opcode => !syntaxComponents[opcode]), []);
});

test('every named core block compiles, decompiles without raw and recompiles to the same opcode', () => {
    Object.entries(blockRegistry).forEach(([name, metadata]) => {
        const source = sourceForBlock(name, metadata);
        const compilation = compileText(source, actorOptions);
        assert.equal(compilation.success, true, `${name}: ${JSON.stringify(compilation.diagnostics)}`);
        assert.ok(
            Object.values(compilation.graph.blocks).some(block => block.opcode === metadata.opcode),
            `${name} não gerou ${metadata.opcode}`
        );

        const decompiled = decompileTarget(fakeTarget(compilation));
        assert.equal(decompiled.success, true, `${name}: ${JSON.stringify(decompiled.unsupportedOpcodes)}`);
        assert.doesNotMatch(decompiled.source, /\braw\./, name);

        const recompiled = compileText(decompiled.source, actorOptions);
        assert.equal(recompiled.success, true, `${name}: ${JSON.stringify(recompiled.diagnostics)}`);
        assert.ok(
            Object.values(recompiled.graph.blocks).some(block => block.opcode === metadata.opcode),
            `${name} não preservou ${metadata.opcode} no round-trip`
        );
    });
});

test('every core event compiles, decompiles without raw and preserves its hat opcode', () => {
    Object.entries(eventRegistry).forEach(([name, metadata]) => {
        const header = callSource(name, metadata);
        const source = `actor Player\non ${header.replace(/\(\)$/, '')}:\n    wait(0)`;
        const compilation = compileText(source, actorOptions);
        assert.equal(compilation.success, true, `${name}: ${JSON.stringify(compilation.diagnostics)}`);
        assert.ok(Object.values(compilation.graph.blocks).some(block => block.opcode === metadata.opcode), name);

        const decompiled = decompileTarget(fakeTarget(compilation));
        assert.equal(decompiled.success, true, `${name}: ${JSON.stringify(decompiled.unsupportedOpcodes)}`);
        assert.doesNotMatch(decompiled.source, /\braw\./, name);
        const recompiled = compileText(decompiled.source, actorOptions);
        assert.equal(recompiled.success, true, `${name}: ${JSON.stringify(recompiled.diagnostics)}`);
        assert.ok(Object.values(recompiled.graph.blocks).some(block => block.opcode === metadata.opcode), name);
    });
});

test('every native control form preserves the exact Scratch opcode', () => {
    const forms = {
        repeat: 'repeat(2):\n        wait(0)',
        forever: 'forever:\n        wait(0)',
        if: 'if true:\n        wait(0)',
        if_else: 'if true:\n        wait(0)\n    else:\n        wait(0)',
        repeat_until: 'repeat_until(true):\n        wait(0)',
        while: 'while(true):\n        wait(0)'
    };
    Object.entries(controlRegistry).forEach(([name, metadata]) => {
        const source = `actor Player\non green_flag:\n    ${forms[name]}`;
        const compilation = compileText(source, actorOptions);
        assert.equal(compilation.success, true, `${name}: ${JSON.stringify(compilation.diagnostics)}`);
        assert.ok(Object.values(compilation.graph.blocks).some(block => block.opcode === metadata.opcode), name);
        const decompiled = decompileTarget(fakeTarget(compilation));
        assert.equal(decompiled.success, true, name);
        assert.doesNotMatch(decompiled.source, /\braw\./, name);
        assert.match(decompiled.source, new RegExp(name === 'if_else' ? 'else:' : `\\b${name}\\b`));
    });
});

test('all executable extension block kinds and argument types have named round-trip syntax', () => {
    const category = {
        id: 'weird-extension',
        name: 'Complete extension',
        menuInfo: {
            fixed: {acceptReporters: false},
            flexible: {acceptReporters: true}
        },
        customFieldTypes: {
            dial: {
                argumentTypeInfo: {
                    shadow: {type: 'weird-extension_dial', fieldName: 'field_weird-extension_dial'}
                }
            }
        },
        blocks: []
    };
    const executable = [
        {
            opcode: 'allArguments', blockType: 'command', text: 'all arguments',
            arguments: {
                IMAGE: {type: 'image', dataURI: 'data:image/svg+xml;base64,AA=='},
                NUMBER: {type: 'number', defaultValue: 1},
                ANGLE: {type: 'angle', defaultValue: 90},
                NOTE: {type: 'note', defaultValue: 60},
                COLOR: {type: 'color', defaultValue: '#ff0000'},
                BOOLEAN: {type: 'Boolean', defaultValue: false},
                STRING: {type: 'string', defaultValue: 'text'},
                MATRIX: {type: 'matrix', defaultValue: '0101'},
                COSTUME: {type: 'costume', defaultValue: 'costume1'},
                SOUND: {type: 'sound', defaultValue: 'pop'},
                FIXED: {type: 'string', menu: 'fixed', defaultValue: 'one'},
                FLEXIBLE: {type: 'string', menu: 'flexible', defaultValue: 'two'},
                CUSTOM: {type: 'dial', defaultValue: 7}
            }
        },
        {opcode: 'value', blockType: 'reporter', text: 'value', arguments: {}},
        {opcode: 'predicate', blockType: 'Boolean', text: 'predicate', arguments: {}},
        {opcode: 'started', blockType: 'hat', text: 'started', arguments: {}},
        {opcode: 'emitted', blockType: 'event', text: 'emitted', arguments: {}},
        {opcode: 'choose', blockType: 'conditional', text: 'choose', branchCount: 2, arguments: {}},
        {opcode: 'repeat', blockType: 'loop', text: 'repeat', branchCount: 1, arguments: {}},
        {opcode: 'finish', blockType: 'command', text: 'finish', isTerminal: true, arguments: {}}
    ];
    category.blocks = executable.map(info => ({info, json: {type: `${category.id}_${info.opcode}`}}));
    const catalog = buildExtensionCatalog({_blockInfo: [category]});
    assert.equal(Object.keys(catalog).length, executable.length);
    assert.ok(Object.keys(catalog).every(name => /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(name)));

    Object.entries(catalog).forEach(([name, metadata]) => {
        const call = callSource(name, metadata);
        let source;
        if (metadata.kind === 'hat' || metadata.kind === 'event') {
            source = `actor Player\non ${call.replace(/\(\)$/, '')}:\n    wait(0)`;
        } else {
            source = sourceForBlock(name, metadata);
        }
        const options = Object.assign({}, actorOptions, {extensionCatalog: catalog});
        const compilation = compileText(source, options);
        assert.equal(compilation.success, true, `${name}: ${JSON.stringify(compilation.diagnostics)}`);
        assert.ok(Object.values(compilation.graph.blocks).some(block => block.opcode === metadata.opcode), name);
        const decompiled = decompileTarget(fakeTarget(compilation), {extensionCatalog: catalog});
        assert.equal(decompiled.success, true, `${name}: ${JSON.stringify(decompiled.unsupportedOpcodes)}`);
        assert.doesNotMatch(decompiled.source, /\braw\./, name);
        const recompiled = compileText(decompiled.source, options);
        assert.equal(recompiled.success, true, `${name}: ${JSON.stringify(recompiled.diagnostics)}`);
        assert.ok(Object.values(recompiled.graph.blocks).some(block => block.opcode === metadata.opcode), name);
    });

    const argumentsMetadata = Object.values(catalog).find(metadata => metadata.extensionOpcode === 'allArguments').arguments;
    assert.equal(argumentsMetadata.length, 12, 'imagem inline não é argumento executável');
    assert.equal(argumentsMetadata.find(argument => argument.originalName === 'FIXED').role, 'field');
    assert.equal(argumentsMetadata.find(argument => argument.originalName === 'FLEXIBLE').menuField, 'flexible');
    assert.equal(argumentsMetadata.find(argument => argument.originalName === 'CUSTOM').shadowOpcode, 'weird-extension_dial');
});

test('special data and procedure syntax covers every non-call primitive without raw', () => {
    const source = `actor Player
variable value = 0
list items = [1]
procedure choose(item: any, enabled: boolean) -> any:
    if enabled:
        return item
    return items
on green_flag:
    value = choose(value, true)
    value += 1
    say(items)`;
    const expected = [
        'argument_reporter_boolean',
        'argument_reporter_string_number',
        'data_changevariableby',
        'data_listcontents',
        'data_setvariableto',
        'data_variable',
        'procedures_call',
        'procedures_definition',
        'procedures_return'
    ];
    const compilation = compileText(source, actorOptions);
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    const opcodes = new Set(Object.values(compilation.graph.blocks).map(block => block.opcode));
    expected.forEach(opcode => assert.ok(opcodes.has(opcode), opcode));
    const decompiled = decompileTarget(fakeTarget(compilation));
    assert.equal(decompiled.success, true, JSON.stringify(decompiled.unsupportedOpcodes));
    assert.doesNotMatch(decompiled.source, /\braw\./);
    const recompiled = compileText(decompiled.source, actorOptions);
    assert.equal(recompiled.success, true, JSON.stringify(recompiled.diagnostics));
    const roundTripOpcodes = new Set(Object.values(recompiled.graph.blocks).map(block => block.opcode));
    expected.forEach(opcode => assert.ok(roundTripOpcodes.has(opcode), opcode));
});

test('dynamic extension variants preserve their mutation-defined syntax without raw', () => {
    const baseInfo = {
        opcode: 'configure',
        blockType: 'command',
        text: 'configure [VALUE]',
        isDynamic: true,
        arguments: {VALUE: {type: 'string', defaultValue: 'base'}}
    };
    const category = {
        id: 'dynamic',
        name: 'Dynamic',
        menuInfo: {mode: {acceptReporters: false}},
        customFieldTypes: {},
        blocks: [{info: baseInfo, json: {type: 'dynamic_configure'}}]
    };
    const catalog = buildExtensionCatalog({_blockInfo: [category]});
    const base = catalog['dynamic.configure'];
    const variantInfo = {
        opcode: 'configure',
        blockType: 'command',
        text: 'configure [COUNT] [COLOR] [MODE]',
        isDynamic: true,
        arguments: {
            COUNT: {type: 'number', defaultValue: 3},
            COLOR: {type: 'color', defaultValue: '#00ff00'},
            MODE: {type: 'string', menu: 'mode', defaultValue: 'fast'}
        }
    };
    const variant = dynamicMetadata(base, variantInfo);
    const source = sourceForBlock(variant.canonicalName, variant);
    const options = Object.assign({}, actorOptions, {extensionCatalog: catalog});
    const compilation = compileText(source, options);
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    const block = Object.values(compilation.graph.blocks).find(candidate => candidate.opcode === 'dynamic_configure');
    assert.deepEqual(JSON.parse(block.mutation.blockInfo), variantInfo);
    assert.equal(block.fields.MODE.value, 'fast');

    const decompiled = decompileTarget(fakeTarget(compilation), {extensionCatalog: catalog});
    assert.equal(decompiled.success, true, JSON.stringify(decompiled.unsupportedOpcodes));
    assert.doesNotMatch(decompiled.source, /\braw\./);
    assert.ok(decompiled.source.includes(`${variant.canonicalName}(`));
    const recompiled = compileText(decompiled.source, options);
    assert.equal(recompiled.success, true, JSON.stringify(recompiled.diagnostics));
    const recompiledBlock = Object.values(recompiled.graph.blocks).find(candidate => candidate.opcode === 'dynamic_configure');
    assert.deepEqual(JSON.parse(recompiledBlock.mutation.blockInfo), variantInfo);
});

test('every operator primitive has textual expression syntax and round-trips', () => {
    const expressions = {
        '+': '1 + 2',
        '-': '1 - 2',
        '*': '1 * 2',
        '/': '1 / 2',
        '%': '1 % 2',
        '<': '1 < 2',
        '==': '1 == 2',
        '>': '1 > 2',
        and: 'true and false',
        or: 'true or false',
        not: 'not true'
    };
    Object.entries(operatorRegistry).forEach(([name, metadata]) => {
        const source = `actor Player\nvariable value = 0\non green_flag:\n    value = ${expressions[name]}`;
        const compilation = compileText(source, actorOptions);
        assert.equal(compilation.success, true, `${name}: ${JSON.stringify(compilation.diagnostics)}`);
        assert.ok(Object.values(compilation.graph.blocks).some(block => block.opcode === metadata.opcode), name);
        const decompiled = decompileTarget(fakeTarget(compilation));
        assert.equal(decompiled.success, true, name);
        assert.doesNotMatch(decompiled.source, /\braw\./, name);
        const recompiled = compileText(decompiled.source, actorOptions);
        assert.equal(recompiled.success, true, `${name}: ${JSON.stringify(recompiled.diagnostics)}`);
        assert.ok(Object.values(recompiled.graph.blocks).some(block => block.opcode === metadata.opcode), name);
    });
});

test('the generated reference documents every syntax and component', () => {
    const documentation = fs.readFileSync(path.resolve(__dirname, '../../TEXTWARP_BLOCOS.md'), 'utf8');
    Object.keys(blockRegistry).forEach(name => assert.ok(documentation.includes(`| \`${name}(`), name));
    Object.keys(eventRegistry).forEach(name => assert.ok(documentation.includes(`| \`on ${name}`), name));
    Object.values(controlRegistry).forEach(metadata => assert.match(documentation, new RegExp(metadata.opcode), metadata.opcode));
    Object.values(operatorRegistry).forEach(metadata => assert.match(documentation, new RegExp(metadata.opcode), metadata.opcode));
    Object.keys(syntaxComponents).forEach(opcode => assert.match(documentation, new RegExp(opcode), opcode));
});
