import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {blockRegistry, controlRegistry, eventRegistry, operatorRegistry} =
    require('../src/lib/textwarp/block-registry');
const {specialSyntax, syntaxComponents} = require('../src/lib/textwarp/block-coverage');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'TEXTWARP_BLOCOS.md');
const escapeTable = value => String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
const argumentList = metadata => (metadata.arguments || []).map(argument => argument.name).join(', ');
const call = (name, metadata) => `${name}(${argumentList(metadata)})${
    ['conditional', 'loop'].includes(metadata.kind) ? ':' : ''
}`;
const description = metadata => escapeTable(metadata.documentation || 'Bloco coberto pelo catálogo TextWarp.');

const categoryNames = Object.freeze({
    motion: 'Movimento',
    looks: 'Aparência',
    sound: 'Som',
    event: 'Eventos e transmissões',
    control: 'Controle',
    sensing: 'Sensores',
    operator: 'Operadores em forma de função',
    data: 'Dados'
});

const grouped = Object.entries(blockRegistry).reduce((result, entry) => {
    const prefix = entry[1].opcode.split('_')[0];
    if (!result[prefix]) result[prefix] = [];
    result[prefix].push(entry);
    return result;
}, {});

const lines = [
    '# Referência completa de blocos TextWarp',
    '',
    '> Arquivo gerado por `npm run docs:textwarp`. Não edite as tabelas manualmente; altere o catálogo e regenere.',
    '',
    'Esta referência enumera toda forma textual suportada pelo runtime incluído neste fork. A auditoria automática',
    'cobre **140 primitivas** e **9 hats** nativos: 128 opcodes usam nomes do catálogo, 9 usam sintaxe própria da',
    'linguagem e 3 são sombras de menu representadas dentro dos argumentos. Nenhum bloco disponível é escrito como',
    '`raw.*` pelo decompilador.',
    '',
    'Argumentos `field` e menus usam os valores internos mostrados nas descrições. Nomes, strings, cores e opções de',
    'menu são escritos entre aspas; números e condições podem receber qualquer expressão compatível.',
    '',
    '## Chamadas nativas',
    ''
];

Object.keys(categoryNames).forEach(prefix => {
    const entries = grouped[prefix] || [];
    if (!entries.length) return;
    lines.push(`### ${categoryNames[prefix]}`, '', '| Sintaxe | Opcode Scratch | Tipo | Uso |', '| --- | --- | --- | --- |');
    entries.forEach(([name, metadata]) => {
        lines.push(`| \`${escapeTable(call(name, metadata))}\` | \`${metadata.opcode}\` | ${metadata.kind} | ${description(metadata)} |`);
    });
    lines.push('');
});

const controlSyntax = Object.freeze({
    repeat: 'repeat(times):',
    forever: 'forever:',
    if: 'if condition:',
    if_else: 'if condition: … else:',
    repeat_until: 'repeat_until(condition):',
    while: 'while(condition):'
});
lines.push(
    '## Controles estruturais',
    '',
    '| Sintaxe | Opcode Scratch | Uso |',
    '| --- | --- | --- |'
);
Object.entries(controlRegistry).forEach(([name, metadata]) => {
    lines.push(`| \`${controlSyntax[name]}\` | \`${metadata.opcode}\` | ${description(metadata)} |`);
});
lines.push('');

lines.push('## Eventos', '', '| Sintaxe | Opcode Scratch | Uso |', '| --- | --- | --- |');
Object.entries(eventRegistry).forEach(([name, metadata]) => {
    const args = argumentList(metadata);
    const syntax = `on ${name}${args ? `(${args})` : ''}:`;
    const opcode = metadata.stageOpcode ? `${metadata.opcode} / ${metadata.stageOpcode}` : metadata.opcode;
    lines.push(`| \`${escapeTable(syntax)}\` | \`${opcode}\` | ${description(metadata)} |`);
});
lines.push('');

const operatorSyntax = Object.freeze({
    '+': 'left + right',
    '-': 'left - right',
    '*': 'left * right',
    '/': 'left / right',
    '%': 'left % right',
    '<': 'left < right',
    '==': 'left == right',
    '>': 'left > right',
    and: 'left and right',
    or: 'left or right',
    not: 'not value'
});
lines.push('## Operadores', '', '| Sintaxe | Opcode Scratch | Retorno |', '| --- | --- | --- |');
Object.entries(operatorRegistry).forEach(([name, metadata]) => {
    lines.push(`| \`${escapeTable(operatorSyntax[name])}\` | \`${metadata.opcode}\` | ${metadata.kind} |`);
});
lines.push(
    '',
    '`<=`, `>=` e `!=` também são aceitos e são compilados como a negação dos comparadores Scratch equivalentes.',
    '',
    '## Sintaxes próprias de dados e procedimentos',
    '',
    '| Opcode Scratch | Sintaxe TextWarp |',
    '| --- | --- |'
);
Object.entries(specialSyntax).forEach(([opcode, syntax]) => {
    lines.push(`| \`${opcode}\` | ${escapeTable(syntax)} |`);
});
lines.push(
    '',
    'Declarações completas:',
    '',
    '```text',
    'variable score = 0',
    'list items = []',
    'procedure command(value: any):',
    '    pass',
    'procedure reporter(value: number) -> number warp:',
    '    return value',
    '```',
    '',
    '## Sombras e menus que não são instruções isoladas',
    '',
    '| Opcode interno | Representação textual |',
    '| --- | --- |'
);
Object.entries(syntaxComponents).forEach(([opcode, syntax]) => {
    lines.push(`| \`${opcode}\` | ${escapeTable(syntax)} |`);
});
lines.push(
    '',
    'Entre os componentes acima, `sound_beats_menu`, `sound_effects_menu` e `sound_sounds_menu` também aparecem como',
    'primitivas da VM, mas no grafo continuam sendo sombras de um argumento. Seu uso já está dentro de',
    '`play_sound(sound)`, `play_sound_until_done(sound)` ou do bloco de extensão correspondente; eles não têm execução',
    'autônoma na paleta.',
    '',
    '## Extensões',
    '',
    'Cada bloco executável publicado por `getInfo()` recebe automaticamente o nome `extensionId.opcode`. Se algum',
    'segmento contiver caracteres que não cabem em um identificador TextWarp, ele é codificado de forma estável como',
    '`encoded_<pontos-de-código>`, sem depender do texto traduzido.',
    '',
    '| `blockType` | Forma textual |',
    '| --- | --- |',
    '| `command` | `extensionId.opcode(arguments)` |',
    '| `reporter` / `Boolean` | `extensionId.opcode(arguments)` dentro de uma expressão |',
    '| `hat` / `event` | `on extensionId.opcode(arguments):` |',
    '| `conditional` / `loop` | `extensionId.opcode(arguments):`, seguido de `branch 2:`, `branch 3:` quando existirem |',
    '',
    'São preservados argumentos `number`, `angle`, `note`, `color`, `Boolean`, `string`, `matrix`, `costume`, `sound`,',
    'menus fixos, menus que aceitam repórteres e campos personalizados. Argumentos `image` são decoração inline do',
    'rótulo visual e não aparecem na chamada porque a VM não os entrega à primitiva.',
    '',
    'Blocos `isDynamic` recebem uma variante `extensionId.opcode.variant_<configuração-codificada>`. Essa parte é',
    'gerada e lida pelo editor para conservar exatamente os argumentos e a mutation do exemplar visual; não é JSON',
    '`raw.*` e continua resolvendo para o opcode nomeado da extensão.',
    '',
    'Itens `button`, `label`, `separator` e `xml` continuam disponíveis no painel de extensões. Eles são ações ou',
    'elementos de paleta, não blocos executáveis, e portanto não fingem ser chamadas da linguagem.',
    '',
    '## Garantia de cobertura',
    '',
    'A suíte `test/textwarp/complete-block-coverage.test.js` falha se:',
    '',
    '- surgir uma primitiva ou um hat nativo sem classificação textual;',
    '- qualquer chamada nativa deixar de compilar, decompilar sem `raw.*` e recompilar para o mesmo opcode;',
    '- uma sintaxe especial, operador, evento ou controle perder seu round-trip;',
    '- algum tipo executável ou tipo de argumento de extensão perder a forma textual.',
    ''
);

const output = `${lines.join('\n').replace(/\n+$/, '')}\n`;
if (process.argv.includes('--check')) {
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (current !== output) {
        console.error('TEXTWARP_BLOCOS.md está desatualizado. Execute npm run docs:textwarp.');
        process.exitCode = 1;
    }
} else {
    fs.writeFileSync(outputPath, output);
}
