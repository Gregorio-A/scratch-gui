'use strict';

const {blockRegistry, eventRegistry} = require('./block-registry');
const {dynamicMetadata} = require('./extension-catalog');
const {decodeArgumentTypes, decodeParameterIdType, decodeReturnType} = require('./procedure-metadata');

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const sanitizeIdentifier = (value, fallback = 'symbol') => {
    const normalized = String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/^([0-9])/, '_$1')
        .replace(/^_+|_+$/g, '');
    return IDENTIFIER.test(normalized) ? normalized : fallback;
};

const quote = value => JSON.stringify(String(value));

const fieldValue = (block, name, fallback = '') => {
    const field = block && block.fields && block.fields[name];
    return field && Object.prototype.hasOwnProperty.call(field, 'value') ? field.value : fallback;
};

const getBlock = (target, id) => id && target.blocks && typeof target.blocks.getBlock === 'function' ?
    target.blocks.getBlock(id) : null;

const activeInputBlock = (target, block, name) => {
    const input = block && block.inputs && block.inputs[name];
    return input ? getBlock(target, input.block || input.shadow) : null;
};

const reverseCore = Object.entries(blockRegistry).reduce((result, [name, metadata]) => {
    if (!result[metadata.opcode]) result[metadata.opcode] = {name, metadata};
    return result;
}, {});

const operatorByOpcode = Object.freeze({
    operator_add: '+',
    operator_subtract: '-',
    operator_multiply: '*',
    operator_divide: '/',
    operator_mod: '%',
    operator_lt: '<',
    operator_equals: '==',
    operator_gt: '>',
    operator_and: 'and',
    operator_or: 'or'
});

const eventByOpcode = Object.entries(eventRegistry).reduce((result, [name, metadata]) => {
    result[metadata.opcode] = {name, metadata};
    if (metadata.stageOpcode) result[metadata.stageOpcode] = {name, metadata};
    return result;
}, {});

const buildReverseExtensions = catalog => Object.values(catalog || {}).reduce((result, metadata) => {
    result[metadata.opcode] = metadata;
    return result;
}, {});

const decompileTarget = (target, options = {}) => {
    const extensionByOpcode = buildReverseExtensions(options.extensionCatalog);
    const extensionForBlock = block => {
        const base = block && extensionByOpcode[block.opcode];
        if (!base || !base.isDynamic || !block.mutation || !block.mutation.blockInfo) return base;
        try {
            const info = typeof block.mutation.blockInfo === 'string' ?
                JSON.parse(block.mutation.blockInfo) : block.mutation.blockInfo;
            return dynamicMetadata(base, info);
        } catch (error) {
            return base;
        }
    };
    const variableNames = new Map();
    const procedureByCode = new Map();
    const usedProcedureNames = new Set();
    const unsupportedOpcodes = new Set();
    const importedRootIds = [];
    const unsupportedRootIds = [];
    const output = [];
    const sourceMap = {};

    const emit = (text, block = null) => {
        output.push(text);
        if (block) {
            const line = output.length;
            sourceMap[block.id] = {
                blockId: block.id,
                actorId: target.id,
                file: target.isStage ? 'stage.tw' : `${target.getName ? target.getName() : target.sprite && target.sprite.name || 'actor'}.tw`,
                startLine: line,
                startColumn: text.search(/\S|$/) + 1,
                endLine: line,
                endColumn: text.length + 1
            };
        }
    };

    const uniqueName = (raw, fallback, used) => {
        const base = sanitizeIdentifier(raw, fallback);
        let candidate = base;
        let suffix = 2;
        while (used.has(candidate)) candidate = `${base}_${suffix++}`;
        used.add(candidate);
        return candidate;
    };

    const usedVariables = new Set();
    const targetVariables = Object.values(target.variables || {}).filter(variable => variable.type !== 'broadcast_msg');
    const runtime = target.runtime;
    const stageTarget = !target.isStage && (options.stageTarget || runtime && (
        typeof runtime.getTargetForStage === 'function' ? runtime.getTargetForStage() :
            Array.isArray(runtime.targets) ? runtime.targets.find(candidate => candidate.isStage) : null
    ));
    const stageVariables = stageTarget ? Object.values(stageTarget.variables || {}).filter(variable =>
        variable.type !== 'broadcast_msg' && !targetVariables.some(local => local.id === variable.id)
    ) : [];
    const registerVariable = (variable, index) => {
        if (variable.type === 'broadcast_msg') return;
        const sourceName = uniqueName(variable.name, `value_${index + 1}`, usedVariables);
        variableNames.set(variable.id, sourceName);
        const fallbackKey = `${variable.type}:${variable.name}`;
        if (!variableNames.has(fallbackKey)) variableNames.set(fallbackKey, sourceName);
    };
    targetVariables.forEach(registerVariable);
    stageVariables.forEach((variable, index) => registerVariable(variable, targetVariables.length + index));

    const allBlocks = target.blocks && target.blocks._blocks ? Object.values(target.blocks._blocks) : [];

    allBlocks.filter(block => block.opcode === 'procedures_definition').forEach((definition, index) => {
        const prototype = activeInputBlock(target, definition, 'custom_block');
        if (!prototype || !prototype.mutation) return;
        let parameterNames = [];
        let parameterIds = [];
        try {
            parameterNames = JSON.parse(prototype.mutation.argumentnames || '[]');
            parameterIds = JSON.parse(prototype.mutation.argumentids || '[]');
        } catch (error) {
            parameterNames = [];
            parameterIds = [];
        }
        const procedureCode = String(prototype.mutation.proccode || `procedure_${index + 1}`);
        const rawName = procedureCode.split(/\s+%[sbn]/)[0];
        const fallbackParameterTypes = Array.from(procedureCode.matchAll(/%([sbn])/g)).map((match, parameterIndex) =>
            decodeParameterIdType(parameterIds[parameterIndex]) || (match[1] === 'b' ? 'boolean' : 'any')
        );
        const parameterTypes = decodeArgumentTypes(prototype.mutation, fallbackParameterTypes);
        const name = uniqueName(rawName, `procedure_${index + 1}`, usedProcedureNames);
        const usedParameters = new Set();
        const parameters = parameterNames.map((raw, parameterIndex) => ({
            id: parameterIds[parameterIndex],
            rawName: raw,
            name: uniqueName(raw, `arg_${parameterIndex + 1}`, usedParameters),
            valueType: parameterTypes[parameterIndex] || 'any'
        }));
        let warp = false;
        try {
            warp = typeof prototype.mutation.warp === 'boolean' ? prototype.mutation.warp :
                JSON.parse(prototype.mutation.warp || 'false');
        } catch (error) { // Invalid legacy mutations are treated as non-warp.
            warp = false;
        }
        procedureByCode.set(prototype.mutation.proccode, {
            name,
            parameters,
            definition,
            prototype,
            warp,
            returnType: decodeReturnType(prototype.mutation)
        });
    });

    const booleanOpcodes = new Set([
        'argument_reporter_boolean', 'operator_not', 'operator_lt', 'operator_equals', 'operator_gt',
        'operator_and', 'operator_or', 'sensing_touchingobject', 'sensing_touchingcolor',
        'sensing_coloristouchingcolor', 'sensing_keypressed', 'sensing_mousedown', 'sensing_loud',
        'operator_contains'
    ]);
    const isBooleanExpressionBlock = block => Boolean(block && (
        booleanOpcodes.has(block.opcode) ||
        block.opcode === 'procedures_call' && Number(block.mutation && block.mutation.return) === 2 ||
        extensionForBlock(block) && extensionForBlock(block).kind === 'boolean'
    ));
    procedureByCode.forEach(procedure => {
        const returns = [];
        const visited = new Set();
        const visit = id => {
            if (!id || visited.has(id)) return;
            const block = getBlock(target, id);
            if (!block) return;
            visited.add(id);
            if (block.opcode === 'procedures_return') returns.push(activeInputBlock(target, block, 'VALUE'));
            Object.entries(block.inputs || {}).forEach(([name, input]) => {
                if (name.startsWith('SUBSTACK')) visit(input.block);
            });
            visit(block.next);
        };
        visit(procedure.definition.next);
        if (!procedure.returnType && returns.length) {
            procedure.returnType = returns.every(isBooleanExpressionBlock) ? 'boolean' : 'any';
        }
    });

    const expression = (block, guard = new Set()) => {
        if (!block) return {text: '0', supported: false};
        if (guard.has(block.id)) return {text: '0', supported: false};
        const nextGuard = new Set(guard);
        nextGuard.add(block.id);
        if (/^math_(?:number|positive_number|whole_number|integer|angle)$/.test(block.opcode)) {
            const raw = fieldValue(block, 'NUM', 0);
            const number = Number(raw);
            return {text: Number.isFinite(number) ? String(number) : quote(raw), supported: true};
        }
        if (block.opcode === 'text') return {text: quote(fieldValue(block, 'TEXT')), supported: true};
        if (block.opcode === 'colour_picker') return {text: quote(fieldValue(block, 'COLOUR')), supported: true};
        if (block.opcode === 'data_listindexall' || block.opcode === 'data_listindexrandom') {
            const raw = fieldValue(block, 'INDEX', 1);
            const number = Number(raw);
            return {text: Number.isFinite(number) ? String(number) : quote(raw), supported: true};
        }
        if (block.opcode === 'data_variable' || block.opcode === 'data_listcontents') {
            const field = block.opcode === 'data_variable' ? block.fields.VARIABLE : block.fields.LIST;
            const type = block.opcode === 'data_variable' ? '' : 'list';
            const name = field && (variableNames.get(field.id) || variableNames.get(`${type}:${field.value}`));
            return {text: name || sanitizeIdentifier(field && field.value, 'unknown_value'), supported: Boolean(name)};
        }
        if (block.opcode === 'argument_reporter_string_number' || block.opcode === 'argument_reporter_boolean') {
            return {text: sanitizeIdentifier(fieldValue(block, 'VALUE'), 'argument'), supported: true};
        }
        if (block.opcode === 'procedures_call' && block.mutation && block.mutation.return) {
            const procedure = procedureByCode.get(block.mutation.proccode);
            if (procedure) {
                const values = procedure.parameters.map(parameter => expression(activeInputBlock(target, block, parameter.id), nextGuard));
                return {
                    text: `${procedure.name}(${values.map(item => item.text).join(', ')})`,
                    supported: values.every(item => item.supported)
                };
            }
        }
        if (block.opcode === 'operator_not') {
            const value = expression(activeInputBlock(target, block, 'OPERAND'), nextGuard);
            return {text: `not (${value.text})`, supported: value.supported};
        }
        const operator = operatorByOpcode[block.opcode];
        if (operator) {
            const leftInput = ['operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide', 'operator_mod'].includes(block.opcode) ? 'NUM1' : 'OPERAND1';
            const rightInput = leftInput === 'NUM1' ? 'NUM2' : 'OPERAND2';
            const left = expression(activeInputBlock(target, block, leftInput), nextGuard);
            const right = expression(activeInputBlock(target, block, rightInput), nextGuard);
            return {text: `(${left.text} ${operator} ${right.text})`, supported: left.supported && right.supported};
        }
        const registered = reverseCore[block.opcode];
        const extension = extensionForBlock(block);
        const call = registered || (extension ? {name: extension.canonicalName, metadata: extension} : null);
        if (call && ['reporter', 'boolean'].includes(call.metadata.kind)) {
            const args = decompileArguments(block, call.metadata, nextGuard);
            return {text: `${call.name}(${args.values.join(', ')})`, supported: args.supported};
        }
        unsupportedOpcodes.add(block.opcode);
        return {text: '0', supported: false};
    };

    const literalArgument = (value, metadata) => {
        if (metadata.valueType === 'number') {
            const number = Number(value);
            if (Number.isFinite(number)) return String(number);
        }
        if (metadata.valueType === 'boolean') return String(value).toLowerCase() === 'true' ? 'true' : 'false';
        return quote(value);
    };

    const inputOrField = (block, metadata, guard) => {
        if (metadata.role === 'list' || metadata.role === 'variable') {
            const field = block.fields && block.fields[metadata.field];
            const type = metadata.role === 'list' ? 'list' : '';
            const name = field && (variableNames.get(field.id) || variableNames.get(`${type}:${field.value}`));
            return {
                text: name || sanitizeIdentifier(field && field.value, metadata.role === 'list' ? 'unknown_list' : 'unknown_variable'),
                supported: Boolean(name)
            };
        }
        if (metadata.role === 'field' || metadata.role === 'broadcast-field') {
            return {text: literalArgument(fieldValue(block, metadata.field), metadata), supported: true};
        }
        const child = activeInputBlock(target, block, metadata.input);
        if (metadata.role === 'menu' || metadata.role === 'broadcast') {
            const fieldName = metadata.role === 'broadcast' ? 'BROADCAST_OPTION' : metadata.menuField;
            const fallback = Object.prototype.hasOwnProperty.call(metadata, 'defaultValue') ? metadata.defaultValue : '';
            if (child && child.shadow) return {
                text: literalArgument(fieldValue(child, fieldName, fallback), metadata),
                supported: true
            };
        }
        if (child && child.shadow && metadata.shadowField) {
            const fallback = Object.prototype.hasOwnProperty.call(metadata, 'defaultValue') ? metadata.defaultValue : '';
            return {
                text: literalArgument(fieldValue(child, metadata.shadowField, fallback), metadata),
                supported: true
            };
        }
        return expression(child, guard);
    };

    function decompileArguments (block, metadata, guard) {
        const values = [];
        let supported = true;
        (metadata.arguments || []).forEach(argumentMetadata => {
            const result = inputOrField(block, argumentMetadata, guard);
            values.push(result.text);
            supported = supported && result.supported;
        });
        return {values, supported};
    }

    const sequence = (startId, indent, visited = new Set()) => {
        const lines = [];
        let supported = true;
        let block = getBlock(target, startId);
        const prefix = ' '.repeat(indent);
        while (block && !visited.has(block.id)) {
            visited.add(block.id);
            let line = null;
            let nested = [];
            let alternate = [];
            let extraBranches = [];
            let blockSupported = true;

            if (block.opcode === 'data_setvariableto' || block.opcode === 'data_changevariableby') {
                const field = block.fields && block.fields.VARIABLE;
                const name = field && (variableNames.get(field.id) || variableNames.get(`:${field.value}`));
                const value = expression(activeInputBlock(target, block, 'VALUE'));
                line = `${prefix}${name || sanitizeIdentifier(field && field.value, 'unknown_value')} ${
                    block.opcode === 'data_setvariableto' ? '=' : '+='
                } ${value.text}`;
                blockSupported = Boolean(name) && value.supported;
            } else if (['control_repeat', 'control_repeat_until', 'control_while'].includes(block.opcode)) {
                const input = block.opcode === 'control_repeat' ? 'TIMES' : 'CONDITION';
                const value = expression(activeInputBlock(target, block, input));
                const name = block.opcode === 'control_repeat' ? 'repeat' :
                    block.opcode === 'control_while' ? 'while' : 'repeat_until';
                line = `${prefix}${name}(${value.text}):`;
                nested = sequence(block.inputs.SUBSTACK && block.inputs.SUBSTACK.block, indent + 4, visited);
                blockSupported = value.supported && nested.supported;
            } else if (block.opcode === 'control_forever') {
                line = `${prefix}forever:`;
                nested = sequence(block.inputs.SUBSTACK && block.inputs.SUBSTACK.block, indent + 4, visited);
                blockSupported = nested.supported;
            } else if (block.opcode === 'control_if' || block.opcode === 'control_if_else') {
                const value = expression(activeInputBlock(target, block, 'CONDITION'));
                line = `${prefix}if ${value.text}:`;
                nested = sequence(block.inputs.SUBSTACK && block.inputs.SUBSTACK.block, indent + 4, visited);
                if (block.opcode === 'control_if_else') {
                    alternate = sequence(block.inputs.SUBSTACK2 && block.inputs.SUBSTACK2.block, indent + 4, visited);
                }
                blockSupported = value.supported && nested.supported && (!alternate.length || alternate.supported);
            } else if (block.opcode === 'procedures_return') {
                const value = expression(activeInputBlock(target, block, 'VALUE'));
                line = `${prefix}return ${value.text}`;
                blockSupported = value.supported;
            } else if (block.opcode === 'procedures_call') {
                const procedure = procedureByCode.get(block.mutation && block.mutation.proccode);
                if (procedure) {
                    const values = procedure.parameters.map(parameter =>
                        expression(activeInputBlock(target, block, parameter.id))
                    );
                    line = `${prefix}${procedure.name}(${values.map(item => item.text).join(', ')})`;
                    blockSupported = values.every(item => item.supported);
                }
            } else if (block.opcode === 'control_stop') {
                const option = fieldValue(block, 'STOP_OPTION');
                const name = option === 'this script' ? 'stop_this_script' :
                    option === 'other scripts in sprite' ? 'stop_other_scripts' : 'stop_all';
                line = `${prefix}${name}()`;
            } else {
                const registered = reverseCore[block.opcode];
                const extension = extensionForBlock(block);
                const call = registered || (extension ? {name: extension.canonicalName, metadata: extension} : null);
                if (call && call.metadata.kind === 'command') {
                    const args = decompileArguments(block, call.metadata, new Set());
                    line = `${prefix}${call.name}(${args.values.join(', ')})`;
                    blockSupported = args.supported;
                } else if (call && ['conditional', 'loop'].includes(call.metadata.kind)) {
                    const args = decompileArguments(block, call.metadata, new Set());
                    line = `${prefix}${call.name}(${args.values.join(', ')}):`;
                    const branchCount = Math.max(1, Number(call.metadata.branchCount) || 1);
                    nested = sequence(block.inputs.SUBSTACK && block.inputs.SUBSTACK.block, indent + 4, visited);
                    extraBranches = Array.from({length: Math.max(0, branchCount - 1)}, (_, index) => {
                        const branchNumber = index + 2;
                        const inputName = `SUBSTACK${branchNumber}`;
                        return {
                            index: branchNumber,
                            body: sequence(block.inputs[inputName] && block.inputs[inputName].block, indent + 4, visited)
                        };
                    });
                    blockSupported = args.supported && nested.supported && extraBranches.every(branch => branch.body.supported);
                }
            }

            if (!line) {
                unsupportedOpcodes.add(block.opcode);
                line = `${prefix}pass # bloco indisponível: ${block.opcode}`;
                blockSupported = false;
            }
            lines.push({text: line, block});
            if (Array.isArray(nested)) lines.push(...nested);
            else lines.push(...nested.lines);
            if (block.opcode === 'control_if_else') {
                lines.push({text: `${prefix}else:`, block: null});
                if (Array.isArray(alternate)) lines.push(...alternate);
                else lines.push(...alternate.lines);
            }
            extraBranches.forEach(branch => {
                lines.push({text: `${prefix}branch ${branch.index}:`, block: null});
                lines.push(...branch.body.lines);
            });
            supported = supported && blockSupported;
            block = getBlock(target, block.next);
        }
        lines.lines = lines;
        lines.supported = supported;
        return lines;
    };

    const eventHeader = block => {
        if (block.opcode === 'event_whengreaterthan') {
            const value = expression(activeInputBlock(target, block, 'VALUE'));
            const menu = fieldValue(block, 'WHENGREATERTHANMENU');
            return {text: `on ${menu === 'TIMER' ? 'timer' : 'loudness'}_greater_than(${value.text}):`, supported: value.supported};
        }
        const registered = eventByOpcode[block.opcode];
        const extension = extensionForBlock(block);
        const event = registered || (extension && ['hat', 'event'].includes(extension.kind) ? {
            name: extension.canonicalName,
            metadata: extension
        } : null);
        if (!event) return null;
        const args = decompileArguments(block, event.metadata, new Set());
        return {text: `on ${event.name}${args.values.length ? `(${args.values.join(', ')})` : ''}:`, supported: args.supported};
    };

    emit(target.isStage ? 'stage' : `actor ${target.getName ? target.getName() : target.sprite && target.sprite.name || 'Actor'}`);
    const variables = targetVariables;
    if (variables.length) emit('');
    variables.forEach(variable => {
        const name = variableNames.get(variable.id);
        const prefix = target.isStage ? 'global ' : '';
        if (variable.type === 'list') emit(`${prefix}list ${name} = ${JSON.stringify(variable.value || [])}`);
        else emit(`${prefix}variable ${name} = ${typeof variable.value === 'number' ? variable.value : quote(variable.value)}`);
    });

    const topBlocks = allBlocks.filter(block => block.topLevel && !block.shadow).sort((left, right) =>
        (Number(left.y) || 0) - (Number(right.y) || 0) || (Number(left.x) || 0) - (Number(right.x) || 0)
    );
    topBlocks.forEach(root => {
        if (root.opcode === 'procedures_definition') {
            const procedure = Array.from(procedureByCode.values()).find(item => item.definition.id === root.id);
            if (!procedure) {
                unsupportedRootIds.push(root.id);
                return;
            }
            emit('');
            const parameters = procedure.parameters.map(item =>
                `${item.name}${item.valueType === 'any' ? '' : `: ${item.valueType}`}`
            ).join(', ');
            const modifiers = `${procedure.returnType ? ` -> ${procedure.returnType}` : ''}${procedure.warp ? ' warp' : ''}`;
            emit(`procedure ${procedure.name}(${parameters})${modifiers}:`, root);
            const body = sequence(root.next, 4);
            if (body.lines.length) body.lines.forEach(item => emit(item.text, item.block));
            else emit('    pass');
            if (body.supported) importedRootIds.push(root.id);
            else unsupportedRootIds.push(root.id);
            return;
        }
        const header = eventHeader(root);
        if (!header) {
            unsupportedOpcodes.add(root.opcode);
            emit('');
            emit(`# Stack não importado: bloco indisponível ${root.opcode}`, root);
            unsupportedRootIds.push(root.id);
            return;
        }
        emit('');
        emit(header.text, root);
        const body = sequence(root.next, 4);
        if (body.lines.length) body.lines.forEach(item => emit(item.text, item.block));
        else emit('    pass');
        if (header.supported && body.supported) importedRootIds.push(root.id);
        else unsupportedRootIds.push(root.id);
    });

    return {
        source: output.join('\n'),
        sourceMap,
        importedRootIds,
        unsupportedRootIds,
        unsupportedOpcodes: Array.from(unsupportedOpcodes).sort(),
        success: unsupportedRootIds.length === 0
    };
};

module.exports = {
    decompileTarget,
    sanitizeIdentifier
};
