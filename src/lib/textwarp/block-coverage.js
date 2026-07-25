'use strict';

const {blockRegistry, controlRegistry, eventRegistry, operatorRegistry} = require('./block-registry');

const specialSyntax = Object.freeze({
    argument_reporter_boolean: 'parâmetro booleano dentro de procedure',
    argument_reporter_string_number: 'parâmetro any, number ou string dentro de procedure',
    data_changevariableby: 'atribuição variable += value ou variable -= value',
    data_listcontents: 'nome da lista usado como expressão',
    data_setvariableto: 'atribuição variable = value',
    data_variable: 'nome da variável usado como expressão',
    procedures_call: 'chamada pelo nome declarado em procedure',
    procedures_definition: 'procedure name(arguments):',
    procedures_return: 'return value'
});

// Estes opcodes aparecem entre as primitivas da VM, mas são blocos-sombra que
// materializam um argumento de outro bloco. Eles têm sintaxe como string/número
// no argumento correspondente e nunca formam uma instrução TextWarp isolada.
const syntaxComponents = Object.freeze({
    argument_editor_boolean: 'editor interno de um parâmetro booleano em procedure',
    argument_editor_string_number: 'editor interno de um parâmetro any, number ou string em procedure',
    colour_picker: 'literal de cor escrito como "#rrggbb"',
    control_create_clone_of_menu: 'argumento actor de create_clone(actor)',
    data_listindexall: 'argumento index que aceita número, "last" ou "all"',
    data_listindexrandom: 'argumento index que aceita número, "last" ou "random"',
    event_broadcast_menu: 'argumento message de broadcast(message) e broadcast_wait(message)',
    event_touchingobjectmenu: 'argumento object de on touching_object(object)',
    looks_backdrops: 'argumento backdrop de switch_backdrop e switch_backdrop_wait',
    looks_costume: 'argumento costume de switch_costume ou de uma extensão',
    math_angle: 'literal numérico usado em entradas de ângulo',
    math_integer: 'literal numérico inteiro',
    math_number: 'literal numérico geral',
    math_positive_number: 'literal numérico positivo',
    math_whole_number: 'literal numérico inteiro não negativo',
    matrix: 'literal string de uma matriz de LEDs',
    motion_glideto_menu: 'argumento target de glide_to_target',
    motion_goto_menu: 'argumento target de go_to_target',
    motion_pointtowards_menu: 'argumento target de point_towards',
    note: 'literal numérico de nota MIDI',
    procedures_declaration: 'editor visual interno da assinatura de procedure',
    procedures_prototype: 'protótipo visual interno gerado por procedure',
    sensing_distancetomenu: 'argumento object de distance_to(object)',
    sensing_keyoptions: 'argumento key de key_pressed(key)',
    sensing_of_object_menu: 'argumento object de property_of(property, object)',
    sensing_touchingobjectmenu: 'argumento object de touching(object)',
    sound_beats_menu: 'argumento numérico de duração em batidas',
    sound_effects_menu: 'argumento de menu de efeito sonoro',
    sound_sounds_menu: 'argumento sound de play_sound/play_sound_until_done',
    text: 'literal de texto escrito entre aspas'
});

const opcodeMap = registry => Object.entries(registry).reduce((result, [name, metadata]) => {
    if (metadata && metadata.opcode) {
        if (!result[metadata.opcode]) result[metadata.opcode] = [];
        result[metadata.opcode].push(name);
    }
    if (metadata && metadata.stageOpcode) {
        if (!result[metadata.stageOpcode]) result[metadata.stageOpcode] = [];
        result[metadata.stageOpcode].push(name);
    }
    return result;
}, {});

const namedSyntax = Object.freeze([
    blockRegistry,
    controlRegistry,
    eventRegistry,
    operatorRegistry
].reduce((result, registry) => {
    const mapped = opcodeMap(registry);
    Object.entries(mapped).forEach(([opcode, names]) => {
        if (!result[opcode]) result[opcode] = [];
        result[opcode].push(...names);
    });
    return result;
}, {}));

const buildExtensionCoverage = extensionCatalog => {
    const blocks = {};
    const components = {};
    Object.values(extensionCatalog || {}).forEach(metadata => {
        if (metadata.opcode) blocks[metadata.opcode] = metadata.canonicalName;
        (metadata.arguments || []).forEach(argument => {
            if (argument.menuOpcode) components[argument.menuOpcode] =
                `menu ${argument.name} de ${metadata.canonicalName}`;
        });
    });
    return {blocks, components};
};

const classifyOpcode = (opcode, extensionCatalog = null) => {
    if (namedSyntax[opcode]) return {kind: 'named', syntax: namedSyntax[opcode].slice()};
    if (specialSyntax[opcode]) return {kind: 'special', syntax: specialSyntax[opcode]};
    if (syntaxComponents[opcode]) return {kind: 'component', syntax: syntaxComponents[opcode]};
    const extension = buildExtensionCoverage(extensionCatalog);
    if (extension.blocks[opcode]) return {kind: 'extension', syntax: extension.blocks[opcode]};
    if (extension.components[opcode]) return {kind: 'component', syntax: extension.components[opcode]};
    return {kind: 'missing', syntax: null};
};

const auditRuntimeCoverage = (runtimeOrVm, extensionCatalog = null) => {
    const runtime = runtimeOrVm && runtimeOrVm.runtime ? runtimeOrVm.runtime : runtimeOrVm;
    const primitiveOpcodes = Object.keys(runtime && runtime._primitives || {}).sort();
    const hatOpcodes = Object.keys(runtime && runtime._hats || {}).sort();
    const audit = opcodes => opcodes.map(opcode => Object.assign({opcode}, classifyOpcode(opcode, extensionCatalog)));
    const primitives = audit(primitiveOpcodes);
    const hats = audit(hatOpcodes);
    return {
        primitives,
        hats,
        missing: primitives.concat(hats).filter(item => item.kind === 'missing')
    };
};

module.exports = {
    auditRuntimeCoverage,
    buildExtensionCoverage,
    classifyOpcode,
    namedSyntax,
    specialSyntax,
    syntaxComponents
};
