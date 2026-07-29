# TextWarp 0.3

TextWarp é uma linguagem textual por ator sobre a `scratch-vm` do TurboWarp. O Monaco Editor é a fonte principal,
mas o workspace Blockly continua disponível em modo editável e sincronizado. A mesma interface de palco, atores,
fantasias, sons, monitores e extensões é usada no navegador e no aplicativo Desktop.

O compilador gera blocos Scratch reais. Dessa forma, concorrência, esperas, transmissões, clones, coerções e procedimentos continuam sendo executados pela `scratch-vm`, em vez de uma tradução direta e incompatível para JavaScript.

## Instalar e executar

Use Node.js 22 quando possível. A versão 26 também foi usada durante o desenvolvimento desta árvore, mas não é a versão recomendada pelo upstream.

```bash
npm ci --include=dev
npm run test:textwarp
npm run build:textwarp:web
```

O `.npmrc` local permite dependências Git, necessárias para os pacotes do TurboWarp. Os avisos de pacotes antigos
durante `npm ci` vêm da árvore upstream; o erro que impede a instalação é aquele que termina com `npm error`, não
os avisos `deprecated`.

Durante o desenvolvimento web:

```bash
npm start
```

Para usar esta árvore no aplicativo Desktop:

```bash
npm link
cd ../TextWarp-Turbowarp
npm link --no-save scratch-gui
npm run webpack:compile
npm run electron:start
```

Validação automatizada:

```bash
npm run test:textwarp
npm run docs:textwarp:check
npm run build:textwarp:web
```

A lista de sintaxe e uso de cada bloco está em [TEXTWARP_BLOCOS.md](TEXTWARP_BLOCOS.md). Ela é gerada do mesmo
catálogo usado pelo compilador e pode ser conferida com `npm run docs:textwarp:check`.
Os recursos completos da IDE e seus atalhos estão em [TEXTWARP_IDE.md](TEXTWARP_IDE.md).

## Fluxo no editor

1. Selecione o palco ou um ator.
2. Edite `stage.tw` ou o arquivo virtual do ator.
3. Aguarde o debounce de 300 ms ou clique em **Compilar**.
4. Clique em **Executar** ou use a bandeira verde normal.
5. Use **Blocos** para editar visualmente ou **Dividido** para manter texto e blocos lado a lado.
6. Abra **Documentação** para consultar o manual, a referência de todos os blocos, as prioridades atuais e as
   extensões carregadas sem sair do editor. A guia possui índice lateral, busca e cópia dos exemplos.
7. Use **Projeto** para abrir módulos, recursos, busca global, símbolos e histórico local.
8. Clique na margem de uma linha para criar um breakpoint e abra **Depurar** para acompanhar threads, pilhas,
   variáveis e expressões Watch.

Alterações válidas no texto são compiladas para o workspace quando **Sincronização automática** está ativa.
Desativar essa opção interrompe os dois sentidos: digitar apenas analisa e salva a fonte, e editar blocos marca a
divergência até uma conversão explícita. Alterações no Blockly são decompiladas e mescladas por unidade. Comentários
dentro de uma unidade alterada produzem conflito em vez de serem descartados. A comparação mostra unidades
adicionadas, removidas e alteradas, raízes afetadas e opcodes opacos. Cada aplicação automática ou manual guarda
um snapshot completo para **Desfazer**.

A ação **Blocos para texto** também faz uma conversão explícita do alvo. Todos os opcodes carregados no runtime têm
sintaxe nativa, especial ou gerada de `getInfo()`. Se um `.sb3` contiver um opcode cuja extensão não está carregada,
o decompilador escreve uma forma segura `opaque.*` que preserva opcode, campos, entradas, shadows, mutation, braços
e sequência sem executar uma primitiva desconhecida. A raiz inteira é adotada uma única vez, portanto comandos
suportados ao redor do bloco opaco não são duplicados. O parser ainda lê `raw.*` de arquivos TextWarp antigos somente
para compatibilidade de migração.

Para projetos `.sb3` com muitos atores, use **Converter → Blocos para texto — projeto inteiro**. A IDE decompila
palco e atores originais em uma única operação, valida todos os módulos antes de alterar o projeto e cria um snapshot
único para **Desfazer**. Se qualquer módulo falhar, mudar durante o processamento ou já contiver uma fonte TextWarp
diferente, nenhum alvo é alterado. Cada alvo continua sendo um arquivo `.tw` separado no explorador.

Antes de **Texto para blocos** em um alvo com raízes visuais sem proprietário, a interface exige escolher entre
substituir raízes correspondentes, adicionar novas raízes ou cancelar. Conversões são transacionais e ficam
enfileiradas enquanto o projeto executa; uma falha restaura o alvo completo.

`Ctrl+S` salva no arquivo `.textwarp` aberto e `Ctrl+Shift+S` escolhe outro arquivo. **Salvar como…** faz a mesma exportação editável; **Abrir .textwarp** abre o pacote. O fluxo padrão do TurboWarp continua disponível para gerar `.sb3` como artefato compilado.

## Sintaxe

A indentação usa exatamente quatro espaços. Comentários começam com `#`.

### Variáveis, listas e expressões

```text
actor Player

variable speed = 5
variable health = 100
list hits = []

on green_flag:
    health = 100
    speed += 2
    list_add(hits, health)

    if health > 0 and not key_pressed("space"):
        change_x(speed * 2)
    else:
        say(join("vida: ", health))
```

O palco declara dados globais:

```text
stage

global variable score = 0
global list enemies = ["Enemy", "Boss"]
```

Variáveis e listas globais declaradas no palco podem ser lidas e alteradas diretamente pelos atores. Ao importar blocos de um ator, o decompilador consulta o palco para preservar essas referências sem criar declarações locais duplicadas.

Nomes do Scratch que não são identificadores TextWarp recebem um alias estável. Por exemplo, `Gear Speed °/s`
aparece como `Gear_Speed_s` no código, mas os blocos continuam guardando o nome original e o mesmo ID. Se dois nomes
produzirem o mesmo alias, o próximo recebe um sufixo como `_2`.

Inicializadores precisam ser constantes. Variáveis aceitam número ou string; listas aceitam uma lista literal de números e strings.

Operadores disponíveis:

```text
+  -  *  /  %
<  <=  ==  !=  >=  >
and  or  not
```

Atribuições disponíveis:

```text
score = 0
score += 1
score -= damage
```

Funções de lista:

```text
list_add(items, value)
list_delete(items, index)
list_clear(items)
list_insert(items, index, value)
list_replace(items, index, value)

list_item(items, index)
list_index(items, value)
list_length(items)
list_contains(items, value)
```

### Condições e laços

```text
if touching("Enemy"):
    say("atingido")
else:
    move(10)

repeat(10):
    move(2)

repeat_until(touching("_edge_")):
    move(2)

while health > 0:
    wait(0)

forever:
    wait(0)
```

`while condition` preserva o opcode legado `control_while`; não é convertido em outro bloco visual.

Corpos visualmente vazios usam `pass`. Um `if/else` mantém os dois braços mesmo quando ambos estão vazios.
Blocos desconectados de um evento também permanecem editáveis:

```text
stack:
    go_to(10, 20)

reporter (Gear_X * 2)
```

`stack:` representa uma pilha de comandos que não executa até ser ligada a um evento. `reporter` representa um
bloco de valor solto no workspace.

### Procedimentos e parâmetros

```text
procedure take_damage(amount):
    health -= amount

    if health <= 0:
        broadcast("player-died")
        delete_clone()

on green_flag:
    take_damage(10)
```

Parâmetros podem ser `any`, `number`, `string` ou `boolean`. Os três primeiros usam o encaixe `%s` da VM; booleanos usam `%b` e o bloco hexagonal correto.

```text
procedure twice(value: number) -> number warp:
    return value * 2

procedure can_move(enabled: boolean) -> boolean:
    if enabled:
        return not touching("_edge_")
    return false

on green_flag:
    if can_move(true):
        change_x(twice(3))
```

`-> number`, `-> string` e `-> any` criam uma chamada repórter redonda; `-> boolean` cria uma chamada booleana. `return` gera `procedures_return`. O modificador `warp` ativa o modo sem atualização de tela do procedimento. Procedimentos são locais ao ator e podem ser chamados antes ou depois da declaração textual.

### Eventos, transmissões e clones

```text
on green_flag:
    broadcast("start-game")

on clicked:
    broadcast_wait("clicked")

on key_pressed("space"):
    create_clone("_myself_")

on receive("start-game"):
    show()

on backdrop_switches("level-2"):
    say("fase 2")

on loudness_greater_than(10):
    hide()

on timer_greater_than(5):
    say("tempo")

on clone_started:
    forever:
        change_y(-8)
        if touching("_edge_"):
            delete_clone()
```

`clone_started` só é válido em atores. O evento `clicked` escolhe automaticamente `event_whenstageclicked` ou `event_whenthisspriteclicked` conforme o alvo.

### Catálogo completo de blocos

A referência [TEXTWARP_BLOCOS.md](TEXTWARP_BLOCOS.md) documenta individualmente Movimento, Aparência, Som,
Eventos, Controle, Sensores, Operadores, Dados, procedimentos e os blocos legados ainda reconhecidos pela VM.
Ela inclui os valores internos de menus, o opcode Scratch correspondente, o tipo do bloco e o uso de cada chamada.

O catálogo desta versão contém 111 chamadas nativas nomeadas, 6 controles estruturais, 9 formas de evento, 11
operadores e 9 opcodes cobertos por sintaxe própria de variáveis, listas e procedimentos. A auditoria considera ainda
as sombras visuais e menus: eles são documentados como componentes do argumento, não como instruções fictícias.

## Extensões

O catálogo é reconstruído automaticamente dos metadados que a VM obteve por `getInfo()`. O identificador canônico não depende do texto traduzido:

```text
extensionId.opcode
```

Exemplo com uma extensão carregada:

```text
on green_flag:
    physics.setGravity(9.8)

    if physics.isGrounded():
        say("no chão")
```

Comandos, repórteres, booleanos, hats e eventos entram no autocomplete do Monaco. Argumentos e menus usam os nomes internos publicados pela extensão. Condicionais e loops usam `:` para o primeiro braço e `branch N:` para os demais:

```text
on green_flag:
    flow.choose(2):
        say("primeiro braço")
    branch 2:
        say("segundo braço")
    branch 3:
        say("terceiro braço")
```

O painel **Extensões** lista também botões, labels, separadores e XML publicados por `getInfo()`. Botões próprios da
extensão podem ser acionados no painel, e itens XML oferecem **Inserir blocos**, que os adiciona ao workspace oficial
e abre a visualização dividida. Labels e separadores continuam sendo elementos de apresentação, não comandos
fictícios da linguagem. Cada bloco executável inserido por XML usa seu catálogo carregado; um opcode indisponível
permanece no workspace e não é adotado como texto.

O TextWarp não muda o modelo de segurança: extensões sandboxed continuam isoladas e extensões unsandboxed continuam executando com privilégios elevados.

## Formato `.textwarp`

`.textwarp` é um ZIP editável e versionável separado do artefato Scratch. Sua estrutura é:

```text
project.textwarp
├── manifest.json
├── sources/
│   ├── stage-<moduleId>.tw
│   └── player-<moduleId>.tw
├── state/
│   ├── stage-<moduleId>.json
│   └── player-<moduleId>.json
├── project/
│   └── project.json
├── assets/
├── extensions/
│   └── lock.json
└── compiled/
    └── project.sb3
```

As fontes em `sources/` são canônicas e `state/` conserva o mapa de propriedade das raízes. Isso permite exportar
um Scratch comum, sem marcadores TextWarp, e reabri-lo sem duplicar stacks. A exportação é recusada quando texto e
blocos divergem ou a fonte contém erros, em vez de empacotar duas versões conflitantes. Ao importar, o `targetId`
salvo é tentado antes de qualquer migração por nome ou ordem.

Antes de desserializar o SB3, o importador restaura as dependências registradas em `extensions/lock.json`. Extensões
internas são carregadas pelo identificador e extensões por URL passam pelo mesmo pedido de permissão e pelo mesmo
sandbox do TurboWarp. URL ausente, permissão negada ou uma URL que registre outro identificador interrompem a
abertura com uma mensagem explícita; o projeto não segue silenciosamente com blocos de terceiros inertes.

O handle de `.textwarp` é mantido separado do handle de `.sb3`, evitando sobrescrever um formato com o outro. `Ctrl+S` grava o pacote editável atual; `Ctrl+Shift+S` e **Salvar como…** escolhem outro destino. A exportação padrão do TurboWarp continua produzindo `.sb3`.

## Importação de blocos

O decompilador reconhece todos os eventos, controles, dados, procedimentos com retorno, expressões e extensões
presentes no catálogo da versão atual. Ele:

- cria declarações para variáveis e listas do alvo;
- reconstrói procedimentos e parâmetros;
- gera fonte com quatro espaços;
- produz um source map novo;
- representa condicionais de extensão com qualquer `branchCount`;
- nunca escreve `raw.*` para representar um bloco;
- adota todos os stacks que puder reconstruir sem perda estrutural;
- escreve blocos indisponíveis como `opaque.command`, `opaque.reporter`, `opaque.hat` ou `opaque.stack`, preservando
  toda a carga estrutural sem executar código desconhecido.

Nomes Scratch que não são identificadores válidos são normalizados. Identificadores de extensão incompatíveis com a
gramática são codificados de forma estável como `encoded_<pontos-de-código>`. `raw.*` é aceito apenas ao abrir fontes
antigas e não aparece no autocomplete, na documentação de escrita nem na saída do decompilador.

## Edição visual sincronizada

As abas **Blocos** e **Dividido** montam o workspace oficial de `scratch-gui`, ligado ao mesmo `vm.blockListener` usado pelo TurboWarp. Não existe uma segunda cópia do grafo: texto e Blockly alteram os blocos reais do alvo.

O sincronizador compara versões independentes do texto e do grafo. A opção automática vale nos dois sentidos; com
ela desligada, o indicador continua mostrando blocos divergentes. **Comparar versões** decompila o alvo novamente e
calcula diferenças por unidade. Uma mesclagem semântica de três vias preserva edições independentes e transforma a
perda potencial de comentários internos em conflito explícito.

Arrastar stacks no workspace não reordena unidades que o sincronizador consegue associar pela identidade. Uma mudança dentro de um stack substitui somente a unidade correspondente; comentários e formatação de outras unidades ficam intactos. Hats duplicados do mesmo tipo continuam sendo associados pela ocorrência, e uma troca de posição entre eles pode exigir a ordem canônica. Alterações estruturais nas declarações de variáveis, que não possuem IDs de linha no Scratch, também usam a forma canônica do módulo.

## Depurador concorrente

Clique na margem do Monaco para alternar um breakpoint. O painel **Depurar** mostra cada thread com ator, linha e estado, e oferece:

- pausar todas na próxima fronteira segura: bloco no interpretador ou frame no JIT;
- continuar todas;
- continuar uma thread;
- executar um passo de uma thread;
- destacar simultaneamente todas as linhas ativas;
- relacionar erros de primitivas com o source map.

Abrir o painel apenas para observar threads mantém o JIT ligado e usa snapshots periódicos da VM. Um breakpoint faz somente as novas threads do ator correspondente nascerem no interpretador; os outros atores continuam usando o JIT. **Pausar threads** congela uma thread já compilada na próxima fronteira de frame, sem reiniciar seu gerador, e desativa o compilador globalmente apenas para threads criadas enquanto a pausa estiver ativa. Uma thread JIT usa **Passo de frame**; uma thread interpretada continua avançando por bloco mapeado. Assim que nenhuma pausa global for necessária, a configuração anterior do compilador é restaurada.

## Compilação incremental

Cada evento e procedimento é uma unidade com identidade e hash próprios. Em uma recompilação:

1. unidades com o mesmo hash e os mesmos IDs permanecem na VM;
2. somente unidades alteradas são removidas e recriadas;
3. unidades removidas têm apenas seus stacks gerados apagados;
4. threads que estão executando blocos substituídos são encerradas;
5. stacks manuais e unidades não afetadas continuam intactos.

Após um `.sb3` otimizar IDs, o adaptador alinha cada unidade pela ordem estrutural e pelos opcodes, remapeia o source map e continua preservando unidades não alteradas mesmo com os novos identificadores.

## Arquitetura

```text
Fonte .tw
    ↓
Lexer de expressões + parser por indentação
    ↓
AST independente da VM
    ↓
Análise semântica + catálogo de blocos/extensões
    ↓
TextWarp IR por unidade
    ↓
Grafo Scratch + source map
    ↓
Adaptador incremental
    ↓
scratch-vm
```

Módulos principais em `src/lib/textwarp/`:

- `parser.js`: linhas, indentação e parser de expressões;
- `block-registry.js`: catálogo canônico dos blocos principais;
- `block-coverage.js`: auditoria exaustiva de primitivas, hats e componentes de sintaxe;
- `extension-catalog.js`: adaptação automática de `getInfo()`;
- `compiler.js`: semântica, IR, unidades, hashes, source map e grafo;
- `vm-adapter.js`: atualização incremental, dados e persistência;
- `decompiler.js`: blocos existentes para texto;
- `procedure-metadata.js`: tipos exatos de parâmetros e retornos persistidos em mutations;
- `source-merge.js`: mesclagem semântica de três vias por unidade;
- `textwarp-package.js`: importação/exportação `.textwarp`;
- `debug-controller.js`: breakpoints e threads concorrentes;
- `../../containers/textwarp-editor.jsx`: integração da interface;
- `textwarp-session.js`: handle separado e salvamento seguro de `.textwarp`;
- `monaco-loader.js`: realce, snippets e autocomplete.

`src/components/gui/gui.jsx` monta o `TextWarpEditor`, que incorpora o container visual de blocos quando o usuário
seleciona **Blocos** ou **Dividido**. Nenhum pacote dentro de `node_modules` é editado diretamente.

## Persistência no `.sb3`

Fonte, breakpoints, hashes e metadados compactos por unidade ficam em comentários internos minimizados. O fingerprint
é um hash curto, source map e propriedade compartilham a mesma tabela compacta, e rascunhos não reescrevem o registro
inteiro a cada tecla. Marcadores ligados às raízes sobrevivem à compactação de IDs feita pelo serializador.

Os tipos `number`, `string`, `any` e `boolean` dos parâmetros, além do tipo de retorno, também são gravados diretamente na mutation do procedimento (`textwarp_argument_types` e `textwarp_return_type`). O tipo de cada parâmetro é codificado redundantemente em seu ID opaco. Por isso, o decompilador reconstrói os tipos exatos mesmo quando o comentário com a fonte TextWarp não existe no `.sb3`, e ainda recupera parâmetros se um editor conservar os IDs mas remover atributos de mutation desconhecidos.

Variáveis e listas declaradas recebem IDs determinísticos. Blocos manuais não marcados como gerados não são removidos pelo adaptador.

## Limites atuais

A classificação canônica e o histórico dos riscos altos corrigidos estão em [TEXTWARP_PRIORIDADES.md](TEXTWARP_PRIORIDADES.md).

- comentários e espaços que não podem ser reconstruídos de uma unidade visual alterada exigem uma decisão explícita;
- duas alterações semanticamente diferentes no mesmo evento, procedimento ou conjunto de declarações ainda exigem escolher **Manter texto** ou **Usar blocos**; unidades independentes são mescladas automaticamente;
- um `.sb3` avulso que perdeu a URL da extensão ainda preserva seus blocos em `opaque.*`, mas não pode executar o
  código de terceiros sem que a extensão seja carregada e autorizada;
- compilação, descompilação e comparação interativas usam um Worker cancelável; somente a aplicação transacional
  final toca a VM na thread principal;
- a conversão automática é limitada a 100.000 caracteres ou 10.000 blocos; módulos maiores continuam convertíveis
  por comando explícito, evitando bloquear a digitação e eventos visuais;
- atores com breakpoint usam o interpretador e ficam mais lentos; atores sem breakpoint continuam no JIT. Uma thread JIT pausada preserva o gerador e avança por frame, enquanto o passo por bloco exige o interpretador;
- procedimentos com retorno são um recurso do TurboWarp e geram aviso de compatibilidade. Para publicar no site oficial do Scratch, use procedimentos de comando sem `-> tipo` e sem `return`, pois o Scratch oficial não implementa `procedures_return` nem chamadas de procedimento como repórter;
- se uma ferramenta externa remover os atributos TextWarp e também regenerar os IDs dos parâmetros, os encaixes `%s` voltam ao tipo seguro `any`; retornos redondos também voltam a `any` se `textwarp_return_type` for removido, pois o formato Scratch distingue apenas retorno redondo e booleano.
