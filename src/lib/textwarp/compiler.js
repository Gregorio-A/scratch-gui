'use strict';

const {
    blockRegistry,
    controlRegistry,
    eventRegistry,
    operatorRegistry
} = require('./block-registry');
const {resolveDynamicMetadata} = require('./extension-catalog');
const {parseText} = require('./parser');
const {encodeParameterId, encodeProcedureTypes} = require('./procedure-metadata');

const semanticDiagnostic = (message, location, code, severity = 'error') => ({
    message,
    line: location.line,
    column: location.column,
    endLine: location.line,
    endColumn: location.column + Math.max(1, location.content.length),
    severity,
    code
});

const hasErrors = diagnostics => diagnostics.some(item => item.severity === 'error');

const fnv1a = (value, seed) => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const stableId = (targetId, path) => {
    const value = `${targetId}:${path}`;
    return `tw_${fnv1a(value, 0x811c9dc5)}${fnv1a(value, 0x9e3779b9)}`;
};

const stableHash = value => `${fnv1a(value, 0x811c9dc5)}${fnv1a(value, 0x9e3779b9)}`;

const literal = (value, valueType, location) => ({type: 'Literal', value, valueType, location});

const metadataForNot = () => operatorRegistry.not;

const stripForHash = value => {
    if (Array.isArray(value)) return value.map(stripForHash);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).sort().forEach(key => {
        if (['location', 'documentation', 'func', 'color1', 'color2', 'color3'].includes(key)) return;
        result[key] = stripForHash(value[key]);
    });
    return result;
};

const unitHash = value => stableHash(JSON.stringify(stripForHash(value)));

const analyzeAndBuildIR = (ast, options = {}) => {
    const diagnostics = [];
    const isStage = Boolean(options.isStage);
    const targetName = options.targetName || (isStage ? 'Stage' : 'Actor');
    const targetId = options.targetId || targetName;
    const stageId = options.stageId || (isStage ? targetId : 'stage');
    const extensionCatalog = options.extensionCatalog || {};
    const availableOpcodes = options.availableOpcodes ? new Set(options.availableOpcodes) : null;
    const externalVariables = Array.isArray(options.variables) ? options.variables : [];
    const externalBroadcasts = Array.isArray(options.broadcasts) ? options.broadcasts : [];
    const projectResources = Array.isArray(options.resources) ? options.resources : null;
    const declarations = [];
    const symbols = new Map();
    const broadcasts = new Map();
    const resourceBindings = [];

    if (ast.declaration) {
        if (ast.declaration.type === 'StageDeclaration' && !isStage) {
            diagnostics.push(semanticDiagnostic(
                'Este arquivo declara stage, mas o alvo selecionado é um ator.',
                ast.declaration.location,
                'target-kind-mismatch'
            ));
        } else if (ast.declaration.type === 'ActorDeclaration' && isStage) {
            diagnostics.push(semanticDiagnostic(
                'Este arquivo declara actor, mas o alvo selecionado é o palco.',
                ast.declaration.location,
                'target-kind-mismatch'
            ));
        } else if (ast.declaration.type === 'ActorDeclaration' && ast.declaration.name !== targetName) {
            diagnostics.push(semanticDiagnostic(
                `O ator selecionado se chama "${targetName}"; a declaração ainda usa "${ast.declaration.name}".`,
                ast.declaration.location,
                'actor-name-mismatch',
                'warning'
            ));
        }
    }

    const addSymbol = symbol => {
        if (!symbols.has(symbol.name)) symbols.set(symbol.name, symbol);
    };
    externalVariables.forEach(variable => addSymbol(Object.assign({generated: false}, variable)));

    const constantValue = (expression, expectedList, location) => {
        if (expectedList) {
            if (!expression || expression.type !== 'ListLiteral') {
                diagnostics.push(semanticDiagnostic(
                    'Uma lista deve ser inicializada com [...].', location, 'invalid-list-initializer'
                ));
                return [];
            }
            const values = [];
            expression.elements.forEach(element => {
                if (element.type !== 'Literal' || element.valueType === 'boolean') {
                    diagnostics.push(semanticDiagnostic(
                        'A inicialização de lista aceita apenas números e strings constantes.',
                        location,
                        'non-constant-list-item'
                    ));
                } else {
                    values.push(element.value);
                }
            });
            return values;
        }
        if (!expression || expression.type !== 'Literal' || expression.valueType === 'boolean') {
            diagnostics.push(semanticDiagnostic(
                'A variável deve ter um valor inicial constante (número ou string).',
                location,
                'non-constant-variable-initializer'
            ));
            return 0;
        }
        return expression.value;
    };

    ast.declarations.forEach(node => {
        const variableType = node.type === 'ListDeclaration' ? 'list' : '';
        if (node.global && !isStage) diagnostics.push(semanticDiagnostic(
            'Declare variáveis globais em stage.tw para manter uma única fonte canônica.',
            node.location,
            'global-declaration-outside-stage'
        ));
        if (declarations.some(item => item.name === node.name)) {
            diagnostics.push(semanticDiagnostic(`O nome "${node.name}" já foi declarado.`, node.location, 'duplicate-variable'));
            return;
        }
        const owner = isStage || node.global ? 'stage' : 'target';
        const existing = externalVariables.find(variable =>
            variable.name === node.name && variable.variableType === variableType &&
            (owner !== 'target' || variable.owner !== 'stage')
        );
        const symbol = {
            id: existing ? existing.id : stableId(owner === 'stage' ? stageId : targetId, `variable:${variableType}:${node.name}`),
            name: node.name,
            variableType,
            owner,
            generated: existing ? Boolean(existing.generated) : true,
            initialValue: constantValue(node.initialValue, variableType === 'list', node.location),
            location: node.location
        };
        declarations.push(symbol);
        symbols.set(node.name, symbol);
    });

    const proceduresByName = new Map();
    ast.procedures.forEach(node => {
        if (proceduresByName.has(node.name)) {
            diagnostics.push(semanticDiagnostic(`O procedimento "${node.name}" foi declarado duas vezes.`, node.location, 'duplicate-procedure'));
            return;
        }
        const parameterNames = node.parameters.map(parameter => parameter.name);
        const duplicateParameter = parameterNames.find((name, index) => parameterNames.indexOf(name) !== index);
        if (duplicateParameter) diagnostics.push(semanticDiagnostic(
            `O parâmetro "${duplicateParameter}" está duplicado.`, node.location, 'duplicate-parameter'
        ));
        if (node.returnType) diagnostics.push(semanticDiagnostic(
            `O procedimento "${node.name}" retorna um valor e usa procedures_return, disponível no TurboWarp mas não no Scratch oficial.`,
            node.location,
            'turbowarp-only-return-procedure',
            'warning'
        ));
        const parameters = node.parameters.map(parameter => ({
            id: encodeParameterId(
                stableId(targetId, `procedure:${node.name}/parameter:${parameter.name}`),
                parameter.valueType || 'any'
            ),
            name: parameter.name,
            valueType: parameter.valueType || 'any'
        }));
        const proccode = [node.name].concat(parameters.map(parameter => parameter.valueType === 'boolean' ? '%b' : '%s')).join(' ');
        proceduresByName.set(node.name, {
            name: node.name,
            parameters,
            proccode,
            returnType: node.returnType || null,
            warp: Boolean(node.warp),
            location: node.location,
            ast: node
        });
    });

    const suggestSymbol = name => {
        let best = null;
        let bestDistance = Infinity;
        const distance = (left, right) => {
            const rows = Array.from({length: left.length + 1}, (_, row) => [row]);
            for (let column = 1; column <= right.length; column++) rows[0][column] = column;
            for (let row = 1; row <= left.length; row++) {
                for (let column = 1; column <= right.length; column++) {
                    rows[row][column] = Math.min(
                        rows[row - 1][column] + 1,
                        rows[row][column - 1] + 1,
                        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
                    );
                }
            }
            return rows[left.length][right.length];
        };
        symbols.forEach((_, candidate) => {
            const candidateDistance = distance(name, candidate);
            if (candidateDistance < bestDistance) {
                best = candidate;
                bestDistance = candidateDistance;
            }
        });
        return bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
    };

    const lookupSymbol = (name, parameters, location, expectedType = null) => {
        const parameter = parameters && parameters.get(name);
        if (parameter && !expectedType) return {type: 'argument', symbol: parameter};
        const symbol = symbols.get(name);
        if (!symbol) {
            const suggestion = suggestSymbol(name);
            diagnostics.push(semanticDiagnostic(
                `A variável ou lista "${name}" não existe.${suggestion ? ` Talvez você queira usar "${suggestion}".` : ''}`,
                location,
                'unknown-variable'
            ));
            return null;
        }
        if (expectedType !== null && symbol.variableType !== expectedType) diagnostics.push(semanticDiagnostic(
            expectedType === 'list' ? `"${name}" não é uma lista.` : `"${name}" é uma lista, não uma variável simples.`,
            location,
            'invalid-symbol-type'
        ));
        return {type: symbol.variableType === 'list' ? 'list' : 'variable', symbol};
    };

    const registerBroadcast = (value, location) => {
        if (!value || value.type !== 'Literal' || value.valueType !== 'string') return;
        const name = value.value;
        const existing = externalBroadcasts.find(item => item.name === name);
        if (!broadcasts.has(name)) broadcasts.set(name, {
            id: existing ? existing.id : stableId(stageId, `broadcast:${name}`),
            name,
            variableType: 'broadcast_msg',
            owner: 'stage',
            generated: existing ? Boolean(existing.generated) : true,
            initialValue: name,
            location
        });
    };

    const resolveMetadata = name => blockRegistry[name] || extensionCatalog[name] ||
        resolveDynamicMetadata(name, extensionCatalog) || null;

    const decodeRawPayload = (call, location, kind) => {
        if (call.arguments.length !== 1 || call.arguments[0].type !== 'Literal' || call.arguments[0].valueType !== 'string') {
            diagnostics.push(semanticDiagnostic(
                `A sintaxe legada "raw.${kind}" recebe exatamente o payload JSON de uma fonte TextWarp antiga.`,
                location,
                'invalid-raw-payload'
            ));
            return {opcode: 'textwarp_invalid_raw', fields: {}, inputs: {}};
        }
        try {
            const payload = JSON.parse(call.arguments[0].value);
            if (!payload || typeof payload.opcode !== 'string' || !payload.opcode) throw new Error('opcode ausente');
            if (availableOpcodes && !availableOpcodes.has(payload.opcode)) diagnostics.push(semanticDiagnostic(
                `A primitiva "${payload.opcode}" da sintaxe legada raw.${kind} não está carregada; o bloco será preservado, mas não executará até que sua extensão seja autorizada e carregada.`,
                location,
                'raw-primitive-unavailable',
                'warning'
            ));
            return payload;
        } catch (error) {
            diagnostics.push(semanticDiagnostic(
                `Payload de raw.${kind} inválido: ${error.message}.`,
                location,
                'invalid-raw-payload'
            ));
            return {opcode: 'textwarp_invalid_raw', fields: {}, inputs: {}};
        }
    };

    const validateAvailability = (name, metadata, location) => {
        if (isStage && metadata.allowStage === false) diagnostics.push(semanticDiagnostic(
            `"${name}" só pode ser usado em atores.`, location, 'command-not-allowed-on-stage'
        ));
        if (!isStage && metadata.allowSprite === false) diagnostics.push(semanticDiagnostic(
            `"${name}" só pode ser usado no palco.`, location, 'command-not-allowed-on-sprite'
        ));
    };

    let convertExpression;
    const knownValueType = expression => {
        if (!expression) return 'any';
        if (expression.type === 'Literal' || expression.type === 'Argument') return expression.valueType ||
            expression.symbol && expression.symbol.valueType || 'any';
        if (expression.type === 'ProcedureReporter') return expression.procedure.returnType || 'any';
        if (expression.type === 'Reporter') return expression.metadata.kind === 'boolean' ? 'boolean' :
            expression.metadata.valueType || 'any';
        return 'any';
    };
    const convertArguments = (name, metadata, argumentNodes, parameters, location) => {
        const expected = metadata.arguments || [];
        if (argumentNodes.length !== expected.length) diagnostics.push(semanticDiagnostic(
            `"${name}" recebe ${expected.length} argumento(s), mas recebeu ${argumentNodes.length}.`,
            location,
            'invalid-arity'
        ));
        return expected.map((argumentMetadata, index) => {
            const node = argumentNodes[index];
            if (!node) {
                const defaultValue = Object.prototype.hasOwnProperty.call(argumentMetadata, 'defaultValue') ?
                    argumentMetadata.defaultValue : argumentMetadata.valueType === 'boolean' ? false :
                        argumentMetadata.valueType === 'string' ? '' : 0;
                return literal(defaultValue, argumentMetadata.valueType || 'any', location);
            }
            if (argumentMetadata.role === 'list' || argumentMetadata.role === 'variable') {
                if (node.type !== 'Identifier') {
                    diagnostics.push(semanticDiagnostic(
                        `O argumento "${argumentMetadata.name}" deve ser o nome de ${
                            argumentMetadata.role === 'list' ? 'uma lista' : 'uma variável'
                        }.`,
                        location,
                        argumentMetadata.role === 'list' ? 'expected-list-name' : 'expected-variable-name'
                    ));
                    return {
                        type: argumentMetadata.role === 'list' ? 'ListReference' : 'VariableReference',
                        symbol: {id: '', name: '', variableType: argumentMetadata.role === 'list' ? 'list' : ''},
                        location
                    };
                }
                const expectedType = argumentMetadata.role === 'list' ? 'list' : '';
                const found = lookupSymbol(node.name, parameters, location, expectedType);
                return {
                    type: argumentMetadata.role === 'list' ? 'ListReference' : 'VariableReference',
                    symbol: found ? found.symbol : {id: '', name: node.name, variableType: expectedType},
                    location
                };
            }
            const converted = convertExpression(node, parameters);
            if (
                argumentMetadata.valueType &&
                argumentMetadata.valueType !== 'any' &&
                converted && converted.type === 'Literal' &&
                converted.valueType !== argumentMetadata.valueType
            ) {
                diagnostics.push(semanticDiagnostic(
                    `O argumento "${argumentMetadata.name}" de "${name}" deve ser ${
                        argumentMetadata.valueType === 'number' ? 'um número' :
                            argumentMetadata.valueType === 'boolean' ? 'uma condição' : 'uma string'
                    }.`,
                    location,
                    'invalid-argument-type'
                ));
            }
            if (argumentMetadata.role === 'field' || argumentMetadata.role === 'broadcast-field') {
                if (!converted || converted.type !== 'Literal' || converted.valueType === 'boolean') diagnostics.push(semanticDiagnostic(
                    `O argumento "${argumentMetadata.name}" precisa ser um número ou string constante.`,
                    location,
                    'field-requires-literal'
                ));
            }
            if (argumentMetadata.role === 'broadcast' || argumentMetadata.role === 'broadcast-field') {
                registerBroadcast(converted, location);
            }
            if (projectResources && converted && converted.type === 'Literal' && typeof converted.value === 'string') {
                const argumentName = String(argumentMetadata.name || '').toLowerCase();
                const expectedKinds = /sound/.test(argumentName) ? ['sound'] :
                    /costume|backdrop/.test(argumentName) ? ['costume'] :
                        /actor|target|object/.test(argumentName) ? ['actor', 'stage'] : [];
                const specialValues = new Set([
                    '_mouse_', '_random_', '_stage_', '_myself_', '_edge_', 'mouse-pointer', 'random position',
                    'myself', 'Stage', 'next backdrop', 'previous backdrop', 'random backdrop'
                ]);
                const matchedResource = projectResources.find(resource =>
                    expectedKinds.includes(resource.kind) && resource.name === converted.value && (
                        ['actor', 'stage'].includes(resource.kind) || (
                            /backdrop/.test(argumentName) ? resource.ownerId === stageId : resource.ownerId === targetId
                        )
                    )
                );
                if (
                    expectedKinds.length && converted.value && !specialValues.has(converted.value) &&
                    !matchedResource
                ) diagnostics.push(semanticDiagnostic(
                    `O recurso "${converted.value}" usado em "${name}" não existe no projeto atual.`,
                    location,
                    'missing-project-resource'
                ));
                if (matchedResource) resourceBindings.push({
                    resourceId: matchedResource.id,
                    resourceKind: matchedResource.kind,
                    ownerId: matchedResource.ownerId,
                    name: matchedResource.name,
                    call: name,
                    argument: argumentMetadata.name,
                    line: location.line
                });
            }
            return converted;
        });
    };

    const convertProcedureArguments = (procedure, argumentNodes, parameters, location) => {
        if (argumentNodes.length !== procedure.parameters.length) diagnostics.push(semanticDiagnostic(
            `"${procedure.name}" recebe ${procedure.parameters.length} parâmetro(s), mas recebeu ${argumentNodes.length}.`,
            location,
            'invalid-procedure-arity'
        ));
        return procedure.parameters.map((parameter, index) => {
            const value = convertExpression(
                argumentNodes[index] || literal(parameter.valueType === 'boolean' ? false : '', parameter.valueType, location),
                parameters
            );
            const actualType = knownValueType(value);
            if (parameter.valueType !== 'any' && actualType !== 'any' && actualType !== parameter.valueType) {
                diagnostics.push(semanticDiagnostic(
                    `O parâmetro "${parameter.name}" de "${procedure.name}" espera ${parameter.valueType}, mas recebeu ${actualType}.`,
                    location,
                    'invalid-procedure-argument-type'
                ));
            }
            return value;
        });
    };

    convertExpression = (node, parameters = new Map()) => {
        if (!node) return literal(0, 'number', {line: 1, column: 1, content: ''});
        if (node.type === 'Literal') return literal(node.value, node.valueType, node.location);
        if (node.type === 'ListLiteral') {
            diagnostics.push(semanticDiagnostic('Listas literais só podem ser usadas em declarações.', node.location, 'list-literal-in-expression'));
            return literal('', 'string', node.location);
        }
        if (node.type === 'Identifier') {
            const found = lookupSymbol(node.name, parameters, node.location);
            if (!found) return literal(0, 'number', node.location);
            if (found.type === 'argument') return {type: 'Argument', symbol: found.symbol, location: node.location};
            return {
                type: found.type === 'list' ? 'ListReporter' : 'VariableReporter',
                symbol: found.symbol,
                location: node.location
            };
        }
        if (node.type === 'UnaryExpression') {
            const argument = convertExpression(node.argument, parameters);
            if (node.operator === '+') return argument;
            if (node.operator === '-') return {
                type: 'Reporter', namespace: 'operator', name: '-', opcode: operatorRegistry['-'].opcode,
                metadata: operatorRegistry['-'], arguments: [literal(0, 'number', node.location), argument], location: node.location
            };
            return {
                type: 'Reporter', namespace: 'operator', name: 'not', opcode: metadataForNot().opcode,
                metadata: metadataForNot(), arguments: [argument], location: node.location
            };
        }
        if (node.type === 'BinaryExpression') {
            const left = convertExpression(node.left, parameters);
            const right = convertExpression(node.right, parameters);
            let operator = node.operator;
            let negate = false;
            if (operator === '!=') {
                operator = '==';
                negate = true;
            } else if (operator === '<=') {
                operator = '>';
                negate = true;
            } else if (operator === '>=') {
                operator = '<';
                negate = true;
            }
            const metadata = operatorRegistry[operator];
            if (!metadata) {
                diagnostics.push(semanticDiagnostic(`Operador sem suporte: ${node.operator}.`, node.location, 'unknown-operator'));
                return literal(0, 'number', node.location);
            }
            const reporter = {
                type: 'Reporter', namespace: 'operator', name: operator, opcode: metadata.opcode,
                metadata, arguments: [left, right], location: node.location
            };
            if (!negate) return reporter;
            return {
                type: 'Reporter', namespace: 'operator', name: 'not', opcode: metadataForNot().opcode,
                metadata: metadataForNot(), arguments: [reporter], location: node.location
            };
        }
        if (node.type === 'CallExpression') {
            if (node.callee === 'raw.reporter') return {
                type: 'RawReporter',
                payload: decodeRawPayload(node, node.location, 'reporter'),
                valueType: 'any',
                location: node.location
            };
            const procedure = proceduresByName.get(node.callee);
            if (procedure) {
                if (!procedure.returnType) {
                    diagnostics.push(semanticDiagnostic(
                        `O procedimento "${node.callee}" é um comando e não pode ser usado como expressão. Declare "-> tipo" para fazê-lo retornar um valor.`,
                        node.location,
                        'procedure-used-as-expression'
                    ));
                    return literal(0, 'number', node.location);
                }
                return {
                    type: 'ProcedureReporter',
                    procedure: {
                        name: procedure.name,
                        proccode: procedure.proccode,
                        parameters: procedure.parameters,
                        returnType: procedure.returnType,
                        warp: procedure.warp
                    },
                    arguments: convertProcedureArguments(procedure, node.arguments, parameters, node.location),
                    valueType: procedure.returnType,
                    location: node.location
                };
            }
            const metadata = resolveMetadata(node.callee);
            if (!metadata) {
                diagnostics.push(semanticDiagnostic(`A função "${node.callee}" não existe no catálogo.`, node.location, 'unknown-call'));
                return literal(0, 'number', node.location);
            }
            validateAvailability(node.callee, metadata, node.location);
            if (['command', 'conditional', 'loop', 'hat', 'event'].includes(metadata.kind)) {
                diagnostics.push(semanticDiagnostic(`"${node.callee}" é um comando, não uma expressão.`, node.location, 'command-used-as-expression'));
            }
            return {
                type: 'Reporter',
                namespace: metadata.extensionId ? 'extension' : 'core',
                name: node.callee,
                opcode: metadata.opcode,
                metadata,
                arguments: convertArguments(node.callee, metadata, node.arguments, parameters, node.location),
                location: node.location
            };
        }
        diagnostics.push(semanticDiagnostic(`Expressão sem suporte: ${node.type}.`, node.location, 'unsupported-expression'));
        return literal(0, 'number', node.location);
    };

    const convertStatements = (statements, parameters = new Map(), procedureContext = null) => statements.map(statement => {
        if (statement.type === 'PassStatement') return null;
        if (statement.type === 'AssignmentStatement') {
            const found = lookupSymbol(statement.name, parameters, statement.location, '');
            const symbol = found ? found.symbol : {id: '', name: statement.name, variableType: ''};
            let value = convertExpression(statement.value, parameters);
            if (statement.operator === '-=') value = {
                type: 'Reporter', namespace: 'operator', name: '-', opcode: operatorRegistry['-'].opcode,
                metadata: operatorRegistry['-'], arguments: [literal(0, 'number', statement.location), value], location: statement.location
            };
            return {
                type: 'Assignment',
                operation: statement.operator === '=' ? 'set' : 'change',
                opcode: statement.operator === '=' ? 'data_setvariableto' : 'data_changevariableby',
                symbol,
                value,
                location: statement.location
            };
        }
        if (statement.type === 'CallStatement') {
            const call = statement.expression;
            if (call.callee === 'raw.command') return {
                type: 'RawCommand',
                payload: decodeRawPayload(call, statement.location, 'command'),
                location: statement.location
            };
            const metadata = resolveMetadata(call.callee);
            if (metadata) {
                validateAvailability(call.callee, metadata, statement.location);
                if (metadata.kind === 'conditional' || metadata.kind === 'loop') diagnostics.push(semanticDiagnostic(
                    `"${call.callee}" possui braços de controle. Termine a chamada com ":" e indente o corpo.`,
                    statement.location,
                    'extension-flow-requires-body'
                ));
                else if (metadata.kind !== 'command') diagnostics.push(semanticDiagnostic(
                    `"${call.callee}" produz um valor e não pode ficar sozinho como instrução.`,
                    statement.location,
                    'reporter-used-as-command'
                ));
                return {
                    type: 'Call',
                    namespace: metadata.extensionId ? 'extension' : 'core',
                    name: call.callee,
                    opcode: metadata.opcode,
                    metadata,
                    arguments: convertArguments(call.callee, metadata, call.arguments, parameters, statement.location),
                    location: statement.location
                };
            }
            const procedure = proceduresByName.get(call.callee);
            if (!procedure) {
                diagnostics.push(semanticDiagnostic(`O comando ou procedimento "${call.callee}" não existe.`, statement.location, 'unknown-call'));
                return null;
            }
            if (procedure.returnType) {
                diagnostics.push(semanticDiagnostic(
                    `"${call.callee}" retorna um valor e precisa ser usado em uma expressão.`,
                    statement.location,
                    'procedure-reporter-used-as-command'
                ));
            }
            return {
                type: 'ProcedureCall',
                procedure: {
                    name: procedure.name,
                    proccode: procedure.proccode,
                    parameters: procedure.parameters,
                    returnType: procedure.returnType,
                    warp: procedure.warp
                },
                arguments: convertProcedureArguments(procedure, call.arguments, parameters, statement.location),
                location: statement.location
            };
        }
        if (statement.type === 'ExtensionFlowStatement') {
            const call = statement.expression;
            const metadata = resolveMetadata(call.callee);
            if (!metadata) {
                diagnostics.push(semanticDiagnostic(`O bloco de fluxo "${call.callee}" não existe no catálogo.`, statement.location, 'unknown-call'));
                return null;
            }
            validateAvailability(call.callee, metadata, statement.location);
            if (!['conditional', 'loop'].includes(metadata.kind)) {
                diagnostics.push(semanticDiagnostic(
                    `"${call.callee}" não é um bloco condicional ou loop de extensão.`,
                    statement.location,
                    'non-flow-block-with-body'
                ));
                return null;
            }
            const branchCount = Math.max(1, Number(metadata.branchCount) || 1);
            statement.branches.forEach(branch => {
                if (branch.index > branchCount) diagnostics.push(semanticDiagnostic(
                    `"${call.callee}" possui ${branchCount} braço(s); branch ${branch.index} não existe.`,
                    branch.location,
                    'extension-branch-out-of-range'
                ));
            });
            const branches = Array.from({length: branchCount}, (_, index) => {
                const branch = statement.branches.find(item => item.index === index + 1);
                return convertStatements(branch ? branch.body : [], parameters, procedureContext).filter(Boolean);
            });
            return {
                type: 'ExtensionFlow',
                namespace: metadata.extensionId ? 'extension' : 'core',
                name: call.callee,
                opcode: metadata.opcode,
                metadata,
                arguments: convertArguments(call.callee, metadata, call.arguments, parameters, statement.location),
                branches,
                location: statement.location
            };
        }
        if (statement.type === 'ReturnStatement') {
            if (!procedureContext) {
                diagnostics.push(semanticDiagnostic('return só pode ser usado dentro de um procedimento.', statement.location, 'return-outside-procedure'));
                return null;
            }
            if (!procedureContext.returnType) {
                diagnostics.push(semanticDiagnostic(
                    `O procedimento "${procedureContext.name}" não declara retorno. Use "-> any", "-> number", "-> string" ou "-> boolean".`,
                    statement.location,
                    'return-in-command-procedure'
                ));
            }
            const value = convertExpression(statement.value, parameters);
            const actualType = knownValueType(value);
            if (
                procedureContext.returnType && procedureContext.returnType !== 'any' &&
                actualType !== 'any' && actualType !== procedureContext.returnType
            ) diagnostics.push(semanticDiagnostic(
                `O retorno de "${procedureContext.name}" deve ser ${procedureContext.returnType}, mas recebeu ${actualType}.`,
                statement.location,
                'invalid-return-type'
            ));
            return {type: 'Return', opcode: 'procedures_return', value, location: statement.location};
        }
        if (statement.type === 'IfStatement') {
            return {
                type: 'Control',
                name: statement.alternate.length ? 'if_else' : 'if',
                opcode: statement.alternate.length ? controlRegistry.if_else.opcode : controlRegistry.if.opcode,
                condition: convertExpression(statement.condition, parameters),
                body: convertStatements(statement.consequent, parameters, procedureContext).filter(Boolean),
                alternate: convertStatements(statement.alternate, parameters, procedureContext).filter(Boolean),
                location: statement.location
            };
        }
        if (statement.type === 'ControlStatement') {
            const name = statement.control;
            const argument = statement.argument ? convertExpression(statement.argument, parameters) : null;
            return {
                type: 'Control',
                name,
                opcode: controlRegistry[name].opcode,
                argument,
                body: convertStatements(statement.body, parameters, procedureContext).filter(Boolean),
                alternate: [],
                location: statement.location
            };
        }
        diagnostics.push(semanticDiagnostic(`Nó sem suporte: ${statement.type}.`, statement.location, 'unsupported-node'));
        return null;
    });

    const procedures = [];
    proceduresByName.forEach(procedure => {
        const parameterMap = new Map(procedure.parameters.map(item => [item.name, item]));
        procedures.push({
            name: procedure.name,
            proccode: procedure.proccode,
            parameters: procedure.parameters,
            returnType: procedure.returnType,
            warp: procedure.warp,
            statements: convertStatements(procedure.ast.body, parameterMap, procedure).filter(Boolean),
            location: procedure.location
        });
    });

    const scripts = ast.scripts.map(script => {
        const eventName = script.event.type === 'Identifier' ? script.event.name : script.event.callee;
        const argumentNodes = script.event.type === 'CallExpression' ? script.event.arguments : [];
        if (eventName === 'raw.hat' || eventName === 'raw.stack') {
            const payload = decodeRawPayload(script.event, script.location, eventName.slice(4));
            return {
                event: {
                    name: eventName,
                    opcode: payload.opcode,
                    metadata: {kind: eventName === 'raw.hat' ? 'hat' : 'stack', arguments: []},
                    arguments: [],
                    rawPayload: payload,
                    rawKind: eventName.slice(4),
                    location: script.location
                },
                statements: convertStatements(script.body).filter(Boolean),
                location: script.location
            };
        }
        const metadata = eventRegistry[eventName] || extensionCatalog[eventName];
        if (!metadata || !['hat', 'event'].includes(metadata.kind) && !eventRegistry[eventName]) {
            diagnostics.push(semanticDiagnostic(`O evento "${eventName}" não existe no catálogo carregado.`, script.location, 'unknown-event'));
        }
        if (metadata) validateAvailability(eventName, metadata, script.location);
        const effectiveMetadata = metadata || {opcode: null, arguments: []};
        return {
            event: {
                name: eventName,
                opcode: isStage && effectiveMetadata.stageOpcode ? effectiveMetadata.stageOpcode : effectiveMetadata.opcode,
                metadata: effectiveMetadata,
                arguments: convertArguments(eventName, effectiveMetadata, argumentNodes, new Map(), script.location),
                location: script.location
            },
            statements: convertStatements(script.body).filter(Boolean),
            location: script.location
        };
    });

    const ir = {
        formatVersion: 3,
        languageVersion: '0.3',
        target: {id: targetId, name: targetName, isStage, stageId},
        declarations,
        broadcasts: Array.from(broadcasts.values()),
        resourceBindings,
        procedures,
        scripts
    };
    return {ir, diagnostics};
};

const makeBlock = (id, opcode, parent, topLevel = false) => ({
    id,
    opcode,
    inputs: {},
    fields: {},
    next: null,
    parent,
    shadow: false,
    topLevel
});

const generateGraph = ir => {
    const blocks = {};
    const sourceMap = {};
    const rootIds = [];
    const units = [];
    const targetId = ir.target.id;
    let currentUnit = null;

    const addSourceMap = (blockId, location) => {
        sourceMap[blockId] = {
            blockId,
            actorId: targetId,
            file: ir.target.isStage ? 'stage.tw' : `${ir.target.name}.tw`,
            startLine: location.line,
            startColumn: location.column,
            endLine: location.line,
            endColumn: location.column + Math.max(1, location.content.length)
        };
    };

    const addBlock = (block, location) => {
        blocks[block.id] = block;
        if (currentUnit) currentUnit.blockIds.push(block.id);
        if (location) addSourceMap(block.id, location);
        return block;
    };

    const setField = (block, name, value, id = null, variableType = null) => {
        block.fields[name] = {name, value: String(value)};
        if (id) block.fields[name].id = id;
        if (variableType !== null) block.fields[name].variableType = variableType;
    };

    const createShadow = (parentId, path, opcode, field, value, location) => {
        const id = stableId(targetId, path);
        const shadow = makeBlock(id, opcode, parentId);
        shadow.shadow = true;
        setField(shadow, field, value);
        addBlock(shadow, location);
        return id;
    };

    let compileExpression;

    const connectInput = (block, inputName, expression, path, metadata, location) => {
        if (metadata.role === 'menu') {
            const fallback = expression && expression.type === 'Literal' ? expression.value : metadata.defaultValue;
            const shadowId = createShadow(
                block.id,
                `${path}/shadow:${inputName}`,
                metadata.menuOpcode,
                metadata.menuField,
                fallback,
                location
            );
            const expressionId = expression && expression.type !== 'Literal' ?
                compileExpression(expression, block.id, `${path}/value:${inputName}`, metadata) : shadowId;
            block.inputs[inputName] = {name: inputName, block: expressionId, shadow: shadowId};
            return;
        }
        if (metadata.role === 'broadcast') {
            const broadcastName = expression && expression.type === 'Literal' ? expression.value : '';
            const broadcast = ir.broadcasts.find(item => item.name === broadcastName);
            const shadowId = stableId(targetId, `${path}/broadcast:${inputName}`);
            const shadow = makeBlock(shadowId, 'event_broadcast_menu', block.id);
            shadow.shadow = true;
            setField(shadow, 'BROADCAST_OPTION', broadcastName, broadcast ? broadcast.id : null, 'broadcast_msg');
            addBlock(shadow, location);
            const expressionId = expression && expression.type !== 'Literal' ?
                compileExpression(expression, block.id, `${path}/value:${inputName}`, metadata) : shadowId;
            block.inputs[inputName] = {name: inputName, block: expressionId, shadow: shadowId};
            return;
        }
        const expressionId = compileExpression(expression, block.id, `${path}/input:${inputName}`, metadata);
        block.inputs[inputName] = {
            name: inputName,
            block: expressionId,
            shadow: blocks[expressionId] && blocks[expressionId].shadow ? expressionId : null
        };
    };

    const applyArguments = (block, metadata, argumentValues, path, location) => {
        if (metadata.staticFields) Object.entries(metadata.staticFields).forEach(([name, value]) => setField(block, name, value));
        if (metadata.mutation) block.mutation = JSON.parse(JSON.stringify(metadata.mutation));
        (metadata.arguments || []).forEach((argumentMetadata, index) => {
            const value = argumentValues[index];
            if (argumentMetadata.role === 'list' || argumentMetadata.role === 'variable') {
                const symbol = value && value.symbol ? value.symbol : {name: '', id: ''};
                setField(
                    block,
                    argumentMetadata.field,
                    symbol.name,
                    symbol.id,
                    argumentMetadata.role === 'list' ? 'list' : ''
                );
            } else if (argumentMetadata.role === 'field') {
                setField(block, argumentMetadata.field, value && value.type === 'Literal' ? value.value : '');
            } else if (argumentMetadata.role === 'broadcast-field') {
                const name = value && value.type === 'Literal' ? value.value : '';
                const broadcast = ir.broadcasts.find(item => item.name === name);
                setField(block, argumentMetadata.field, name, broadcast ? broadcast.id : null, 'broadcast_msg');
            } else {
                connectInput(block, argumentMetadata.input, value, path, argumentMetadata, location);
            }
        });
    };

    const procedureMutation = (procedure, includeReturn) => {
        const mutation = {
            tagName: 'mutation',
            children: [],
            proccode: procedure.proccode,
            argumentids: JSON.stringify(procedure.parameters.map(item => item.id)),
            warp: String(Boolean(procedure.warp))
        };
        if (includeReturn && procedure.returnType) mutation.return = procedure.returnType === 'boolean' ? '2' : '1';
        return encodeProcedureTypes(mutation, procedure, includeReturn);
    };

    const applyProcedureArguments = (block, procedure, argumentValues, path, location) => {
        procedure.parameters.forEach((parameter, index) => {
            const booleanParameter = parameter.valueType === 'boolean';
            const expressionId = compileExpression(
                argumentValues[index],
                block.id,
                `${path}/parameter:${parameter.id}`,
                {
                    role: 'input',
                    valueType: parameter.valueType,
                    input: parameter.id,
                    shadowOpcode: booleanParameter ? null : parameter.valueType === 'number' ? 'math_number' : 'text',
                    shadowField: booleanParameter ? null : parameter.valueType === 'number' ? 'NUM' : 'TEXT'
                }
            );
            block.inputs[parameter.id] = {
                name: parameter.id,
                block: expressionId,
                shadow: blocks[expressionId] && blocks[expressionId].shadow ? expressionId : null
            };
        });
    };

    const materializeRawBlock = (payload, parentId, path, location, topLevel = false) => {
        const safePayload = payload && typeof payload === 'object' ? payload : {opcode: 'textwarp_invalid_raw'};
        const id = stableId(targetId, path);
        const block = makeBlock(id, String(safePayload.opcode || 'textwarp_invalid_raw'), parentId, topLevel);
        block.shadow = Boolean(safePayload.shadow);
        if (topLevel) {
            block.x = Number.isFinite(safePayload.x) ? safePayload.x : 64;
            block.y = Number.isFinite(safePayload.y) ? safePayload.y : 64;
        }
        Object.entries(safePayload.fields || {}).forEach(([name, rawField]) => {
            const field = rawField && typeof rawField === 'object' ? rawField : {value: rawField};
            setField(
                block,
                name,
                Object.prototype.hasOwnProperty.call(field, 'value') ? field.value : '',
                field.id || null,
                Object.prototype.hasOwnProperty.call(field, 'variableType') ? field.variableType : null
            );
        });
        if (safePayload.mutation && typeof safePayload.mutation === 'object') {
            block.mutation = JSON.parse(JSON.stringify(safePayload.mutation));
        }
        addBlock(block, location);
        Object.entries(safePayload.inputs || {}).forEach(([name, rawInput]) => {
            const input = rawInput && typeof rawInput === 'object' ? rawInput : {};
            let blockId = null;
            let shadowId = null;
            if (input.block && typeof input.block === 'object') {
                blockId = materializeRawBlock(input.block, id, `${path}/raw-input:${name}`, location);
            }
            if (input.shadow === true) {
                shadowId = blockId;
            } else if (input.shadow && typeof input.shadow === 'object') {
                shadowId = materializeRawBlock(input.shadow, id, `${path}/raw-shadow:${name}`, location);
            }
            block.inputs[name] = {name, block: blockId, shadow: shadowId};
        });
        return id;
    };

    compileExpression = (expression, parentId, path, expectedMetadata = null) => {
        const location = expression.location;
        if (expression.type === 'Literal') {
            if (expression.valueType === 'boolean') {
                const id = stableId(targetId, `${path}/boolean`);
                const block = makeBlock(id, 'operator_equals', parentId);
                addBlock(block, location);
                const left = literal(1, 'number', location);
                const right = literal(expression.value ? 1 : 0, 'number', location);
                connectInput(block, 'OPERAND1', left, `${path}/boolean`, {role: 'input', input: 'OPERAND1', shadowOpcode: 'math_number', shadowField: 'NUM'}, location);
                connectInput(block, 'OPERAND2', right, `${path}/boolean`, {role: 'input', input: 'OPERAND2', shadowOpcode: 'math_number', shadowField: 'NUM'}, location);
                return id;
            }
            const preferNumber = expression.valueType === 'number' || expectedMetadata && expectedMetadata.valueType === 'number';
            const useExpectedShadow = expectedMetadata && expectedMetadata.shadowOpcode && expectedMetadata.valueType !== 'any';
            const opcode = useExpectedShadow ? expectedMetadata.shadowOpcode :
                (preferNumber ? 'math_number' : 'text');
            const field = useExpectedShadow ? expectedMetadata.shadowField :
                (preferNumber ? 'NUM' : 'TEXT');
            return createShadow(parentId, path, opcode, field, expression.value, location);
        }
        if (expression.type === 'VariableReporter' || expression.type === 'ListReporter') {
            const id = stableId(targetId, path);
            const opcode = expression.type === 'ListReporter' ? 'data_listcontents' : 'data_variable';
            const block = makeBlock(id, opcode, parentId);
            const field = expression.type === 'ListReporter' ? 'LIST' : 'VARIABLE';
            setField(block, field, expression.symbol.name, expression.symbol.id, expression.symbol.variableType);
            addBlock(block, location);
            return id;
        }
        if (expression.type === 'Argument') {
            const id = stableId(targetId, path);
            const block = makeBlock(
                id,
                expression.symbol.valueType === 'boolean' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
                parentId
            );
            setField(block, 'VALUE', expression.symbol.name);
            addBlock(block, location);
            return id;
        }
        if (expression.type === 'ProcedureReporter') {
            const id = stableId(targetId, path);
            const block = makeBlock(id, 'procedures_call', parentId);
            block.mutation = procedureMutation(expression.procedure, true);
            addBlock(block, location);
            applyProcedureArguments(block, expression.procedure, expression.arguments, path, location);
            return id;
        }
        if (expression.type === 'RawReporter') {
            return materializeRawBlock(expression.payload, parentId, `${path}/raw`, location);
        }
        if (expression.type === 'Reporter') {
            const id = stableId(targetId, path);
            const block = makeBlock(id, expression.opcode, parentId);
            addBlock(block, location);
            applyArguments(block, expression.metadata, expression.arguments, path, location);
            return id;
        }
        return createShadow(parentId, path, 'text', 'TEXT', '', location);
    };

    const statementKey = statement => {
        if (statement.type === 'Call') return `call:${statement.name}`;
        if (statement.type === 'ProcedureCall') return `procedure:${statement.procedure.name}`;
        if (statement.type === 'ExtensionFlow') return `extension-flow:${statement.name}`;
        if (statement.type === 'RawCommand') return `raw:${statement.payload.opcode}`;
        if (statement.type === 'Return') return 'return';
        if (statement.type === 'Assignment') return `${statement.operation}:${statement.symbol.name}`;
        return `${statement.type}:${statement.name || statement.opcode}`;
    };

    const compileSequence = (statements, physicalParentId, logicalPath) => {
        const occurrences = Object.create(null);
        let firstId = null;
        let previousId = null;
        let previousTerminal = false;

        statements.forEach(statement => {
            if (previousTerminal) return;
            const key = statementKey(statement);
            const occurrence = occurrences[key] || 0;
            occurrences[key] = occurrence + 1;
            const path = `${logicalPath}/${key}#${occurrence}`;
            const id = stableId(targetId, path);
            const parentId = previousId || physicalParentId;
            let block;

            if (statement.type === 'ProcedureCall') {
                block = makeBlock(id, 'procedures_call', parentId);
                block.mutation = procedureMutation(statement.procedure, false);
                addBlock(block, statement.location);
                applyProcedureArguments(block, statement.procedure, statement.arguments, path, statement.location);
            } else if (statement.type === 'RawCommand') {
                const rawId = materializeRawBlock(statement.payload, parentId, path, statement.location);
                block = blocks[rawId];
            } else {
                block = makeBlock(id, statement.opcode, parentId);
                addBlock(block, statement.location);
                if (statement.type === 'Call') {
                    applyArguments(block, statement.metadata, statement.arguments, path, statement.location);
                } else if (statement.type === 'Assignment') {
                    setField(block, 'VARIABLE', statement.symbol.name, statement.symbol.id, '');
                    const inputName = statement.operation === 'set' ? 'VALUE' : 'VALUE';
                    connectInput(
                        block,
                        inputName,
                        statement.value,
                        path,
                        {role: 'input', input: inputName, valueType: 'any', shadowOpcode: 'text', shadowField: 'TEXT'},
                        statement.location
                    );
                } else if (statement.type === 'Control') {
                    const metadata = controlRegistry[statement.name];
                    if (metadata.argumentInput) connectInput(
                        block,
                        metadata.argumentInput,
                        statement.condition || statement.argument,
                        path,
                        {
                            role: 'input', input: metadata.argumentInput,
                            valueType: statement.name === 'repeat' ? 'number' : 'boolean',
                            shadowOpcode: statement.name === 'repeat' ? 'math_whole_number' : 'text',
                            shadowField: statement.name === 'repeat' ? 'NUM' : 'TEXT'
                        },
                        statement.location
                    );
                    const nested = compileSequence(statement.body, id, `${path}/body`);
                    block.inputs[metadata.substack] = {name: metadata.substack, block: nested.firstId, shadow: null};
                    if (metadata.alternateSubstack) {
                        const alternate = compileSequence(statement.alternate, id, `${path}/alternate`);
                        block.inputs[metadata.alternateSubstack] = {
                            name: metadata.alternateSubstack,
                            block: alternate.firstId,
                            shadow: null
                        };
                    }
                } else if (statement.type === 'ExtensionFlow') {
                    applyArguments(block, statement.metadata, statement.arguments, path, statement.location);
                    statement.branches.forEach((branch, index) => {
                        const inputName = index === 0 ? 'SUBSTACK' : `SUBSTACK${index + 1}`;
                        const nested = compileSequence(branch, id, `${path}/branch:${index + 1}`);
                        block.inputs[inputName] = {name: inputName, block: nested.firstId, shadow: null};
                    });
                } else if (statement.type === 'Return') {
                    connectInput(
                        block,
                        'VALUE',
                        statement.value,
                        path,
                        {role: 'input', input: 'VALUE', valueType: 'any', shadowOpcode: 'text', shadowField: 'TEXT'},
                        statement.location
                    );
                }
            }

            if (previousId) blocks[previousId].next = id;
            else firstId = id;
            previousId = id;
            previousTerminal = statement.type === 'Return' || Boolean(statement.metadata && statement.metadata.terminal);
        });
        return {firstId, lastId: previousId};
    };

    const beginUnit = (unitId, kind, name, hash) => {
        currentUnit = {unitId, kind, name, hash, rootId: null, blockIds: []};
        units.push(currentUnit);
    };
    const endUnit = rootId => {
        currentUnit.rootId = rootId;
        rootIds.push(rootId);
        currentUnit = null;
    };

    const eventOccurrences = Object.create(null);
    ir.scripts.forEach((script, scriptIndex) => {
        if (!script.event.opcode) return;
        const key = script.event.name;
        const occurrence = eventOccurrences[key] || 0;
        eventOccurrences[key] = occurrence + 1;
        const unitId = `script:${key}#${occurrence}`;
        const path = `unit/${unitId}`;
        beginUnit(unitId, 'script', key, unitHash(script));
        const id = stableId(targetId, `${path}/root`);
        let eventBlock;
        if (script.event.rawPayload) {
            const rawId = materializeRawBlock(script.event.rawPayload, null, `${path}/root`, script.event.location, true);
            eventBlock = blocks[rawId];
        } else {
            eventBlock = makeBlock(id, script.event.opcode, null, true);
            eventBlock.x = 64 + ((scriptIndex % 3) * 340);
            eventBlock.y = 64 + (Math.floor(scriptIndex / 3) * 260);
            addBlock(eventBlock, script.event.location);
            applyArguments(eventBlock, script.event.metadata, script.event.arguments, path, script.event.location);
        }
        const body = compileSequence(script.statements, id, `${path}/body`);
        eventBlock.next = body.firstId;
        endUnit(id);
    });

    ir.procedures.forEach((procedure, procedureIndex) => {
        const unitId = `procedure:${procedure.name}`;
        const path = `unit/${unitId}`;
        beginUnit(unitId, 'procedure', procedure.name, unitHash(procedure));
        const definitionId = stableId(targetId, `${path}/definition`);
        const prototypeId = stableId(targetId, `${path}/prototype`);
        const definition = makeBlock(definitionId, 'procedures_definition', null, true);
        definition.x = 64 + ((procedureIndex % 3) * 340);
        definition.y = 420 + (Math.floor(procedureIndex / 3) * 260);
        addBlock(definition, procedure.location);
        const prototype = makeBlock(prototypeId, 'procedures_prototype', definitionId);
        prototype.shadow = true;
        prototype.mutation = encodeProcedureTypes({
            tagName: 'mutation',
            children: [],
            proccode: procedure.proccode,
            argumentids: JSON.stringify(procedure.parameters.map(item => item.id)),
            argumentnames: JSON.stringify(procedure.parameters.map(item => item.name)),
            argumentdefaults: JSON.stringify(procedure.parameters.map(item => item.valueType === 'boolean' ? false : '')),
            warp: String(Boolean(procedure.warp))
        }, procedure);
        addBlock(prototype, procedure.location);
        definition.inputs.custom_block = {name: 'custom_block', block: prototypeId, shadow: prototypeId};
        procedure.parameters.forEach(parameter => {
            const reporterId = stableId(targetId, `${path}/prototype/parameter:${parameter.id}`);
            const reporter = makeBlock(
                reporterId,
                parameter.valueType === 'boolean' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
                prototypeId
            );
            reporter.shadow = true;
            setField(reporter, 'VALUE', parameter.name);
            addBlock(reporter, procedure.location);
            prototype.inputs[parameter.id] = {name: parameter.id, block: reporterId, shadow: reporterId};
        });
        const body = compileSequence(procedure.statements, definitionId, `${path}/body`);
        definition.next = body.firstId;
        endUnit(definitionId);
    });

    return {
        formatVersion: 3,
        blocks,
        blockIds: Object.keys(blocks),
        rootIds,
        sourceMap,
        units,
        declarations: ir.declarations,
        broadcasts: ir.broadcasts,
        resourceBindings: ir.resourceBindings
    };
};

const compileText = (source, options = {}) => {
    const parsed = parseText(source);
    const semantic = analyzeAndBuildIR(parsed.ast, options);
    const diagnostics = parsed.diagnostics.concat(semantic.diagnostics);
    const success = !hasErrors(diagnostics);
    return {
        source,
        ast: parsed.ast,
        ir: semantic.ir,
        graph: success ? generateGraph(semantic.ir) : null,
        diagnostics,
        success
    };
};

module.exports = {
    analyzeAndBuildIR,
    compileText,
    generateGraph,
    hasErrors,
    stableHash,
    stableId,
    unitHash
};
