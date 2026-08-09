# IDE TextWarp

O editor TextWarp é uma IDE integrada ao projeto TurboWarp. Cada palco ou ator é tratado como um módulo `.tw`, mas a fonte continua ligada ao alvo real da `scratch-vm`, aos blocos, às variáveis e aos recursos do projeto.

## Editor de código

O Monaco fornece destaque de sintaxe, linhas numeradas, indentação e fechamento automáticos, múltiplos cursores, histórico de desfazer/refazer, minimapa e busca/substituição no arquivo. O painel **Buscar** opera em todos os scripts editáveis e só confirma uma substituição global depois de validar todos os módulos.

Use **Dividir editor** para abrir dois módulos independentes. O seletor do segundo painel nunca repete o alvo principal:
é possível editar, por exemplo, `Sprite1.tw` e `stage.tw` simultaneamente, cada um com sua própria fonte,
diagnósticos, modelo Monaco, compilação e sincronização com blocos. Use as abas de arquivos e o explorador para
alternar entre os demais módulos sem perder a posição e o histórico dos modelos já abertos.

Cada modelo usa uma URI compartilhada entre criação, definição, referências e renomeação. A identidade do projeto
e a instância do editor fazem parte do namespace, portanto trocar de projeto ou usar os editores principal e
secundário nunca reutiliza um modelo de outro contexto. Todos os módulos editáveis do workspace são carregados no
namespace do editor correspondente; uma refatoração entre arquivos aponta sempre para um modelo real, verifica sua
versão e propaga a alteração de volta à `scratch-vm`. Atualizações externas não substituem um modelo marcado como
modificado, e modelos removidos do projeto liberam contexto, inscrições e memória.

## Inteligência da linguagem

A análise léxica, o parser e a análise semântica alimentam um índice por versão de cada módulo. O índice preserva a
identidade, o escopo, o alvo proprietário e a visibilidade de cada símbolo; por isso um parâmetro, uma variável
local e uma variável global com o mesmo nome não são tratados como se fossem o mesmo item. O resultado é
reutilizado durante a digitação e invalidado somente quando a fonte ou o contexto do projeto muda.

Os diagnósticos são analisados depois de uma pausa curta na digitação, associados à versão atual e descartados
quando ficam obsoletos. Eles aparecem junto ao código e no painel **Problemas**, com intervalo válido, linha,
coluna, código estável, sugestão localizada, ação rápida, navegação direta e botão **Ajuda** ligado à documentação
integrada. A compilação/aplicação na VM continua separada dessa análise para não bloquear cada tecla.

O Monaco oferece:

- sugestões de comandos, eventos, procedimentos, variáveis, listas e extensões;
- sugestões contextuais de atores, fantasias, cenários, sons e mensagens existentes;
- opções válidas de menus de blocos, incluindo teclas, modos, efeitos, operações matemáticas e menus de extensões;
- amostras hexadecimais selecionáveis, com o tipo visual de cor do Monaco, nos argumentos de cor;
- assinatura e parâmetros durante uma chamada;
- documentação e tipo ao passar o mouse;
- símbolos do arquivo, ir para definição e encontrar referências;
- renomeação segura de variáveis, listas e procedimentos;
- renomeação de variáveis globais em todos os módulos carregados;
- formatação do documento e snippets pesquisáveis na paleta de comandos;
- destaque semântico, destaque de referências, regiões dobráveis, seleção estrutural e nomes de parâmetros em
  chamadas.

O realce léxico usa o mesmo registro semântico da tradução: palavras-chave, controles, eventos e chamadas ficam
coloridos tanto em inglês quanto em português, inclusive aliases com acentos como `variável`, `senão` e `não`.
Trocar o idioma do código não reduz a fonte a texto sem classificação. O pacote português cobre todo o registro
canônico usado pelo catálogo: comandos, eventos, argumentos, opções, controles, operadores, literais e tipos.

Um clique simples em literais cujo argumento possui metadados visuais abre um pequeno editor contextual: booleanos
oferecem **Verdadeiro/Falso**, cores usam o seletor nativo, menus finitos usam uma lista e números oferecem incremento,
decremento e entrada direta. O controle reutiliza os mesmos tipos e opções do catálogo de blocos, substitui somente o
intervalo do literal e participa do desfazer/refazer do Monaco. Comentários, texto comum e argumentos sem um controle
útil não abrem a caixa; a edição tradicional pelo teclado continua disponível em todos os casos.

Existe um único provedor de autocompletar. Ele combina catálogo nativo, controles, eventos, operadores, extensões,
procedimentos, parâmetros, variáveis, listas e recursos sem entradas duplicadas. As sugestões respeitam o prefixo,
o escopo, palco/ator e a posição sintática; comentários não recebem código e strings recebem apenas recursos
válidos para o argumento atual. O intervalo substituído inclui corretamente palavras ou strings parciais, e
snippets preservam a indentação do bloco.

Chamadas incompletas são analisadas com uma pilha de delimitadores que ignora comentários e strings. Assim, ajuda
de assinatura e sugestões de recursos continuam corretas em chamadas aninhadas e durante a edição em várias
linhas, mesmo antes de o código voltar a compilar.

Referências de recursos guardam o identificador estável e o proprietário no registro TextWarp. `Ctrl`/`Cmd` +
clique resolve o argumento e o ID real em vez de navegar por uma coincidência textual. Se um ator, som, fantasia
ou cenário mudar de nome, a fonte ligada é atualizada sem depender apenas do nome antigo; nomes repetidos em
atores diferentes continuam distintos.

## Recursos específicos do software

O catálogo combina a API interna de blocos nativos, eventos, operadores e extensões carregadas com o estado vivo do projeto. As sugestões respeitam palco/ator e mostram somente recursos adequados ao argumento atual. Referências removidas ou digitadas incorretamente são diagnosticadas antes da execução.

## Organização do projeto

O painel **Projeto** separa scripts editáveis, recursos e artefatos gerados somente para leitura. Clicar em um ator ou palco muda também a seleção do TurboWarp. `Ctrl` ou `Cmd` + clique sobre uma referência no código abre o recurso correspondente; o botão `＋` do explorador insere o nome correto no cursor.

Abas recentes, busca/substituição global, símbolos do arquivo e a hierarquia palco/atores/recursos permitem navegar
pelo projeto sem tratar artefatos compilados como fonte editável. **Abertura rápida** (`Ctrl+P`) filtra atores e o
palco por nome amigável ou nome de arquivo sem sair do editor.

## Integração com o software principal

Alterações no texto incrementam a versão do `SourceDocument` e executam apenas análise e diagnósticos. Elas não
alteram a VM durante a digitação. **Executar**, **Compilar**, abrir **Blocos** ou abrir **Dividido** criam uma
compilação controlada; **Dividido** mantém os blocos como prévia derivada somente leitura. Alterações visuais só
voltam para o texto pelo comando explícito **Blocos para texto**.

Um ator vazio recebe somente um pequeno script inicial de movimento, já emitido no `Code Language` persistido.
Valores semânticos como `right_arrow`/`seta_direita` são convertidos para o valor canônico do Scratch somente na
representação interna. O palco também começa no idioma de código escolhido (`stage` ou `palco`).

A seleção de alvos é compartilhada com o TurboWarp, eventos são filtrados por tipo de alvo, valores vivos aparecem no depurador e referências persistem por IDs. Esse ciclo funciona como hot reload: uma unidade válida muda na VM sem reconstruir ou reiniciar todo o projeto.

Nomes de variáveis e listas do Scratch que contêm espaços, acentos ou símbolos recebem um identificador TextWarp
estável, como `Gear Speed °/s` → `Gear_Speed_s`. O ID e o nome original continuam gravados nos campos dos blocos;
por isso a conversão nos dois sentidos não cria outra variável nem perde a ligação entre ator e palco. Colisões entre
nomes normalizados recebem sufixos determinísticos.

Ramos vazios são escritos como `pass`, inclusive em `if/else`, e voltam a ser braços vazios no editor visual. Pilhas
de comandos desconectadas de um evento usam `stack:`, enquanto repórteres soltos usam `reporter expressão`. Esses
formatos preservam blocos válidos que existem no workspace sem alterar quando eles executam. Opcodes desconhecidos
usam `opaque.*`: permanecem estruturais e editáveis, são identificados no plano da conversão e nunca executam uma
primitiva ausente.

## Execução e console

**Executar** valida, compila e inicia o projeto pela bandeira verde. **Parar** interrompe todas as threads e **Reiniciar** para, recompila e inicia de forma previsível. `Ctrl+Shift+Enter` executa o evento selecionado, o evento da linha atual ou um procedimento sem parâmetros; procedimentos com parâmetros continuam sendo chamados pelo código.

O console registra início, término, parada, falhas, perguntas e mensagens de `say`/`think`. A entrada interativa continua no palco, como no Scratch/TurboWarp. O status inferior mostra `executando`, `pausado` ou `parado`.

## Depuração

Clique na margem de glifos ou pressione `F9` para alternar um breakpoint na linha do cursor; clicar no número da linha
apenas move o cursor. A IDE destaca as linhas atuais e permite pausar, continuar, entrar, passar ou sair de chamadas
no interpretador. Threads JIT preservam seu estado e oferecem passo por frame quando uma pausa global exige isso.

O painel de depuração mostra:

- todas as threads e o ator de cada uma;
- linha, bloco e modo JIT/interpretador;
- pilha de chamadas navegável;
- variáveis locais/globais e estado vivo do alvo;
- expressões **Watch** avaliadas sem executar chamadas ou efeitos colaterais;
- erros de runtime com stack e caminho de blocos/linhas.

## Produtividade e recuperação

A barra lateral **Comandos** apresenta o catálogo textual por Movimento, Aparência, Som, Eventos, Controle,
Sensores, Operadores, Variáveis, Funções e Extensões. A busca aceita o nome canônico ou traduzido; clicar em um item
insere no Monaco o mesmo snippet localizado usado pelo autocomplete, com campos editáveis. Cada comando também
possui uma caixa de contexto expansível com exemplo, parâmetros, tipos e valores aceitos. A **Paleta de comandos**
continua reunindo ações do Monaco e do TextWarp. **Atalhos** permite alterar e persistir as teclas de compilar,
executar, executar seleção, parar, reiniciar e formatar.

A caixa **Projeto** da barra superior mantém juntos o nome do projeto, o idioma da interface e o idioma da sintaxe
TextWarp. A troca de sintaxe passa pela mesma validação e persistência das Preferências; em barras compactas, o
código do idioma da interface continua visível para que a configuração não desapareça.

A fonte é salva imediatamente no projeto e recebe snapshots locais após a edição. Antes de cada aplicação manual,
um snapshot completo do alvo é criado e a faixa **Conversão realizada** oferece **Desfazer** e
**Ver diferenças**. O painel
**Histórico** restaura até 30 versões por módulo mesmo sem Git e continua disponível após fechar inesperadamente
a aplicação. As abas recentes também são restauradas localmente.

O tamanho do texto do Monaco é persistido por dispositivo. Ele pode ser alterado em **Preferências**, pelo controle
deslizante na barra inferior ou por `Ctrl++`/`Ctrl+-`; `Ctrl+0` restaura 15 px.
**Interface compacta** reduz barras, abas e controles em telas maiores. A escolha também fica salva no navegador.

Atalhos aceitam letras, números, teclas de função, setas, navegação, espaço, Tab, Escape, Backspace e Delete.
As alterações ficam em rascunho até escolher **Aplicar atalhos**, duplicatas são rejeitadas e um campo vazio
desativa intencionalmente o comando. Breakpoints usam decorações rastreáveis: inserir ou remover linhas move também
a posição persistida do breakpoint.

## Layout responsivo e painéis

**Problemas**, **Console**, **Depurador**, **Saída** e **Mochila** dividem a área inferior por abas e só a ferramenta
ativa ocupa espaço. Uma única barra de atividades global alterna **Programação**, **Fantasias**, **Sons** e dá
acesso direto a **Arquivos**, **Comandos**, **Atores**, **Extensões**, **Símbolos**, **Histórico**,
**Documentação**, **Depurador**, **Pesquisa** e **Configurações**. A mesma navegação contextual fica visível no
topo da barra lateral de Programação. A barra superior compacta contém o contexto do projeto, a entrada da paleta
de comandos, o botão alternável **Run/Stop**, tela cheia da prévia e quatro controles de layout. Esses ícones
mostram ou escondem a barra de atividades, a lateral esquerda, o painel inferior e a lateral direita; o estado
ativo fica visível e as preferências persistentes de cada região continuam sendo respeitadas.

A coluna direita segue a ordem **Prévia do palco**, **Inspetor**, **Palco e cenários** e **Atores**. Cenários e
atores têm regiões e ações de adição distintas, com rótulos explícitos, sem dois botões visualmente iguais
sobrepostos. O cartão do palco agrupa miniatura, identidade e quantidade de cenários; **Adicionar cenário** fica
na mesma linha como ação própria. Executar, tamanho da visualização, tela cheia e recolhimento não são repetidos
dentro desse dock. A prévia mede a largura realmente disponível, reduz o palco preservando a proporção e centraliza o
canvas; o Inspetor reorganiza posição, aparência e direção em linhas ou colunas conforme a largura, sem cortar os
controles. A coluna fica limitada à altura disponível: palco e cabeçalhos não crescem com as listas, e atores,
explorador, comandos, fantasias e sons rolam apenas dentro de sua própria região. As barras de rolagem têm 6 px,
ficam discretas em repouso e ganham contraste ao passar o mouse ou mover o foco. As barras laterais de Fantasias e Sons compartilham cabeçalho,
adição, seleção, reordenação e ações por item; podem ser redimensionadas. O editor de som mostra régua, intervalo
selecionado, taxa de amostragem, transporte e efeitos agrupados por velocidade, volume, fade e transformação.
Divisores arrastáveis redimensionam a barra lateral, o painel inferior, o palco e a proporção de **Dividido**; os
valores ficam salvos localmente.

O painel **Problemas** oferece **Copiar relatório técnico** e **Baixar relatório técnico** mesmo quando não há
diagnósticos. O relatório reúne estado do editor, falha de carregamento do Monaco, resultado Blocos → Texto, opcodes
indisponíveis, variáveis/listas com IDs e nomes originais, erros de runtime, console e a fonte atual. Revise o arquivo
antes de compartilhá-lo, pois ele inclui o código completo do módulo.

O cabeçalho local do arquivo reúne, na mesma linha compacta, as abas abertas, os modos **Texto**, **Blocos**,
**Dividido** e **Documentação**, o estado de sincronização, **Converter** e **Mais ações**. Isso elimina a barra
horizontal duplicada que antes separava os modos do arquivo ativo.
O explorador organiza o projeto em Atores e Palco, enquanto o Outline agrupa Variáveis, Procedimentos e Eventos.
Cada arquivo aberto aparece como uma aba comum, com indicador de alteração, fechamento, reordenação e menu de contexto.
**Converter** reúne Texto → Blocos, Blocos → Texto, Blocos → Texto para o projeto inteiro e comparação. Digitar não
altera a VM; a conversão do projeto inteiro processa palco e atores originais como módulos separados, só aplica
depois de validar todos e pode ser desfeita em uma ação. **Mais ações** concentra Paleta de comandos, Formatar,
Abertura rápida, alternar breakpoint, navegar em Problemas, Dividir editor, Documentação, Editor externo e
Preferências; o antigo botão Modelos não ocupa mais a interface. No editor duplo, esses comandos seguem o painel
focado por último.
Em telas estreitas, a barra lateral vira uma sobreposição fechável por Escape e o palco começa recolhido. Em telas
maiores, o palco pode ser arrastado, recolhido e restaurado; sua largura e a densidade compacta são persistidas no
navegador. O campo permanente **Localizar** fica oculto; `Ctrl+F` abre a busca do Monaco sobre o editor.

Quando texto e blocos divergem, a própria IDE oferece **Comparar alterações**, **Usar texto**, **Usar blocos** e
**Cancelar**; não há confirmação isolada do navegador nem substituição silenciosa. Os itens de **Problemas** exibem
arquivo, linha e coluna e navegam para a localização correspondente. `F8` e `Shift+F8` avançam e voltam pelos
problemas do painel de editor que está focado.

## Editores externos

Abra **Mais ações → Editor externo → Conectar arquivo** para associar o módulo atual a um arquivo `.tw`. Depois de
editar no VS Code, Zed, Neovim, Sublime Text ou outro editor, use **Reler arquivo**. **Salvar fonte** grava a versão
atual do TextWarp no mesmo handle.

O navegador solicita acesso somente por uma ação explícita. Quando a File System Access API não existe, a abertura
usa upload e a gravação usa download. O Desktop fornece os mesmos handles pela ponte segura do Electron; nenhum
componente compartilhado acessa Node.js ou `EditorPreload` diretamente.

## Documentação integrada

O painel **Documentação** reúne este manual, a sintaxe, a referência gerada de todos os blocos, exemplos, prioridades e extensões carregadas. A busca funciona offline. Hover e ajuda de assinatura trazem a parte relevante para o código; cada diagnóstico oferece **Ajuda** e abre uma pesquisa contextual sem sair da IDE.

## Segurança e estabilidade

Código TextWarp executa dentro da `scratch-vm`, separado da interface React/Monaco. A VM agenda loops de forma cooperativa e o botão **Parar** permanece como interrupção global. Erros de compilação nunca substituem a última versão executável; falhas de primitivas são capturadas no console e no depurador.

No navegador, o acesso a arquivos usa a File System Access API quando disponível e upload/download como fallback.
No Desktop, a mesma interface recebe handles da ponte segura do Electron. Extensões continuam sujeitas às
permissões e ao isolamento fornecidos pela plataforma. O pacote `.textwarp` separa fontes editáveis, projeto
compilado, recursos e lock de extensões.

O carregador do Monaco deduplica solicitações concorrentes, valida a API AMD carregada e permite tentar novamente
depois de uma falha transitória. O caminho dos arquivos parte de `document.baseURI`, inclusive quando a aplicação
é publicada em um subdiretório. Se o carregamento não for possível, o editor básico preserva a fonte, mostra
os diagnósticos, mantém detalhes técnicos sob demanda, permite copiar ou baixar o relatório técnico e oferece uma
ação de nova tentativa.

## Usabilidade e acessibilidade

Salvar, compilar, executar, pausar e parar sempre atualizam o status visível. Painéis vazios explicam o próximo passo, recursos avançados ficam em abas ou painéis progressivos e ações principais permanecem nos mesmos lugares. Controles usam elementos semânticos, rótulos acessíveis, foco visível, navegação por teclado, regiões `aria-live` e as cores do tema claro/escuro do TurboWarp.

## Atalhos padrão

| Ação | Atalho |
| --- | --- |
| Salvar projeto | `Ctrl+S` |
| Salvar como | `Ctrl+Shift+S` |
| Executar | `F5` |
| Parar | `Shift+F5` |
| Explorador | `Ctrl+Shift+E` |
| Busca no projeto | `Ctrl+Shift+F` |
| Abertura rápida | `Ctrl+P` |
| Paleta de comandos | `Ctrl+Shift+P` |
| Mover o cursor por palavras | `Ctrl+←` / `Ctrl+→` |
| Selecionar por palavras | `Ctrl+Shift+←` / `Ctrl+Shift+→` |
| Próximo problema | `F8` |
| Problema anterior | `Shift+F8` |
| Alternar breakpoint no cursor | `F9` |
| Alternar barra lateral | `Ctrl+B` |
| Alternar painel inferior | `Ctrl+J` |
| Compilar | `F7` |
| Executar projeto | `Ctrl+Enter` |
| Executar seleção/unidade | `Ctrl+Shift+Enter` |
| Parar | `Shift+F5` |
| Reiniciar | `Ctrl+Shift+F5` |
| Formatar | `Ctrl+Shift+I` |
| Renomear símbolo | `F2` |
| Ir para definição | `F12` |
| Encontrar referências | `Shift+F12` |
| Aumentar texto | `Ctrl++` |
| Diminuir texto | `Ctrl+-` |
| Restaurar texto | `Ctrl+0` |
