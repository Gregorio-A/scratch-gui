# IDE TextWarp

O editor TextWarp é uma IDE integrada ao projeto TurboWarp. Cada palco ou ator é tratado como um módulo `.tw`, mas a fonte continua ligada ao alvo real da `scratch-vm`, aos blocos, às variáveis e aos recursos do projeto.

## Editor de código

O Monaco fornece destaque de sintaxe, linhas numeradas, indentação e fechamento automáticos, múltiplos cursores, histórico de desfazer/refazer, minimapa e busca/substituição no arquivo. O painel **Buscar** opera em todos os scripts editáveis e só confirma uma substituição global depois de validar todos os módulos.

Use **Editor duplo** para abrir dois módulos independentes. O seletor do segundo painel nunca repete o alvo principal:
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
- assinatura e parâmetros durante uma chamada;
- documentação e tipo ao passar o mouse;
- símbolos do arquivo, ir para definição e encontrar referências;
- renomeação segura de variáveis, listas e procedimentos;
- renomeação de variáveis globais em todos os módulos carregados;
- formatação do documento e snippets pesquisáveis na paleta de comandos;
- destaque semântico, destaque de referências, regiões dobráveis, seleção estrutural e nomes de parâmetros em
  chamadas.

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

Abas recentes, busca/substituição global, símbolos do arquivo e a hierarquia palco/atores/recursos permitem navegar pelo projeto sem tratar artefatos compilados como fonte editável.

## Integração com o software principal

Alterações válidas são compiladas após 300 ms e atualizam somente as unidades modificadas. Alterações feitas nos blocos voltam para o texto, com mesclagem por unidade e resolução explícita de conflitos. O modo **Dividido** mantém o editor textual e o editor visual juntos para pré-visualização imediata.

A seleção de alvos é compartilhada com o TurboWarp, eventos são filtrados por tipo de alvo, valores vivos aparecem no depurador e referências persistem por IDs. Esse ciclo funciona como hot reload: uma unidade válida muda na VM sem reconstruir ou reiniciar todo o projeto.

## Execução e console

**Executar** valida, compila e inicia o projeto pela bandeira verde. **Parar** interrompe todas as threads e **Reiniciar** para, recompila e inicia de forma previsível. `Ctrl+Shift+Enter` executa o evento selecionado, o evento da linha atual ou um procedimento sem parâmetros; procedimentos com parâmetros continuam sendo chamados pelo código.

O console registra início, término, parada, falhas, perguntas e mensagens de `say`/`think`. A entrada interativa continua no palco, como no Scratch/TurboWarp. O status inferior mostra `executando`, `pausado` ou `parado`.

## Depuração

Clique na margem de uma linha para alternar um breakpoint. A IDE destaca as linhas atuais e permite pausar, continuar, entrar, passar ou sair de chamadas no interpretador. Threads JIT preservam seu estado e oferecem passo por frame quando uma pausa global exige isso.

O painel de depuração mostra:

- todas as threads e o ator de cada uma;
- linha, bloco e modo JIT/interpretador;
- pilha de chamadas navegável;
- variáveis locais/globais e estado vivo do alvo;
- expressões **Watch** avaliadas sem executar chamadas ou efeitos colaterais;
- erros de runtime com stack e caminho de blocos/linhas.

## Produtividade e recuperação

A paleta **Comandos** reúne as ações do Monaco e do TextWarp. **Atalhos** permite alterar e persistir as teclas de compilar, executar, executar seleção, parar, reiniciar e formatar. **Modelos** insere estruturas iniciais para palco de jogo, movimento e animação.

A fonte é salva imediatamente no projeto e recebe snapshots locais após a edição. O painel **Histórico** restaura até 30 versões por módulo mesmo sem Git e continua disponível após fechar inesperadamente a aplicação. As abas recentes também são restauradas localmente.

O tamanho do texto do Monaco é persistido por dispositivo. Ele pode ser alterado em **Preferências**, pelo controle
deslizante na barra inferior ou por `Ctrl++`/`Ctrl+-`; `Ctrl+0` restaura 15 px.

Atalhos aceitam letras, números, teclas de função, setas, navegação, espaço, Tab, Escape, Backspace e Delete.
Configurações inválidas ou duplicadas mostram um erro e mantêm o atalho padrão. Breakpoints usam decorações
rastreáveis: inserir ou remover linhas move também a posição persistida do breakpoint.

## Layout responsivo e painéis

**Problemas**, **Console**, **Depuração** e **Extensões** dividem a área inferior por abas e só a ferramenta ativa
ocupa espaço. Divisores arrastáveis redimensionam a barra do projeto, a área inferior e a proporção dos modos
**Dividido** e **Editor duplo**; os valores ficam salvos localmente.

Em telas compactas, as ações secundárias ficam em **Ferramentas**, a barra do projeto vira uma sobreposição e os
dois editores são empilhados. Em largura de celular, o palco e a lista de atores ficam abaixo da IDE, sem cobrir o
editor nem sair da viewport. Os links opcionais da barra superior são ocultados antes dos comandos de arquivo e
edição.

## Editores externos

Abra **Ferramentas → Editor externo → Conectar arquivo** para associar o módulo atual a um arquivo `.tw`. Depois de
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
os diagnósticos e as ações de compilar/executar, mantém detalhes técnicos sob demanda e oferece uma ação de nova
tentativa.

## Usabilidade e acessibilidade

Salvar, compilar, executar, pausar e parar sempre atualizam o status visível. Painéis vazios explicam o próximo passo, recursos avançados ficam em abas ou painéis progressivos e ações principais permanecem nos mesmos lugares. Controles usam elementos semânticos, rótulos acessíveis, foco visível, navegação por teclado, regiões `aria-live` e as cores do tema claro/escuro do TurboWarp.

## Atalhos padrão

| Ação | Atalho |
| --- | --- |
| Salvar projeto | `Ctrl+S` |
| Salvar como | `Ctrl+Shift+S` |
| Explorador | `Ctrl+Shift+E` |
| Busca no projeto | `Ctrl+Shift+F` |
| Paleta de comandos | `F1` |
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
