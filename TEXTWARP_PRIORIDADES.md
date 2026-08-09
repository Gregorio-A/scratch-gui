# Problemas e prioridades do TextWarp

Estado revisado em 7 de agosto de 2026. Este arquivo é a lista canônica de riscos e limitações; a referência completa de uso continua em [TEXTWARP.md](TEXTWARP.md).

A arquitetura 0.4 torna cada `.tw` a fonte versionada de verdade. Digitar só atualiza análise e diagnósticos;
blocos são derivados por compilação explícita, e **Executar** valida e aplica um snapshot de todos os módulos em uma
única transação antes de iniciar a VM.

## Critério de prioridade

- **Alta:** pode perder código silenciosamente, abrir um projeto sem restaurar o necessário para executá-lo ou quebrar o estado de uma thread durante a depuração.
- **Média:** afeta fidelidade, compatibilidade ou fluxo de edição, mas é detectada, explícita e recuperável sem perder o projeto.
- **Baixa:** depende de uma ação destrutiva de ferramenta externa, é uma limitação visual pequena ou é um custo opt-in com alternativa segura.

## Alta prioridade

**Não há pendências abertas de alta prioridade.** Os riscos que pertenciam a esta categoria foram corrigidos e permanecem cobertos por testes.

| Problema corrigido | Solução atual | Evidência |
| --- | --- | --- |
| Um `.sb3` sem a fonte TextWarp confundia parâmetros `number`, `string` e `any` porque todos usam `%s`. | Os tipos são persistidos na mutation e, redundantemente, nos IDs opacos dos parâmetros. O retorno também grava `textwarp_return_type`. | Teste salva e reabre um SB3 real depois de remover o comentário-fonte. |
| Aceitar blocos podia substituir a fonte inteira e normalizar unidades não alteradas. | A mesclagem de três vias compara hashes por evento e procedimento e substitui somente as unidades visuais alteradas. | Testes preservam comentários, espaços e ordem fora da unidade alterada e mesclam edições independentes. |
| Um `.textwarp` podia carregar blocos `raw.*` antes das extensões de que dependiam. | O lock restaura extensões internas ou URLs autorizadas antes de carregar o SB3 e interrompe a abertura com erro claro se a dependência não puder ser restaurada. | Testes cobrem restauração, URL ausente e lock do pacote. |
| **Pausar threads** não suspendia uma thread que já estava no JIT. | O depurador congela o gerador compilado na próxima fronteira de frame, preserva seu estado e permite avançar um frame ou retomá-lo. | Teste unitário do controlador e teste integrado com uma thread JIT real. |
| Famílias inteiras de blocos não tinham sintaxe e eram decompiladas como `raw.*`. | Todas as 140 primitivas e os 9 hats nativos possuem chamada nomeada, controle, evento ou sintaxe própria. Blocos carregados por extensão recebem sintaxe de `getInfo()`; o decompilador não escreve mais `raw.*`. | A auditoria falha para qualquer opcode sem cobertura e testa o round-trip de cada chamada, evento, controle, operador, sintaxe especial e tipo de bloco de extensão. |
| Um bloco desconhecido dentro de um stack podia duplicar os comandos suportados ao redor. | `opaque.*` preserva a raiz completa, incluindo inputs, shadows, mutation e sequência, e a raiz visual é adotada antes da aplicação. | Regressões cobrem opcode desconhecido aninhado e round-trip exato de três opcodes sem aumentar a contagem de raízes. |
| Aplicação e desfazer podiam deixar um alvo parcial ou repetir a conversão. | A aplicação valida antes de remover, restaura snapshot completo em qualquer exceção e **Desfazer** recupera blocos, comentários, variáveis, monitores e fonte. | Testes injetam falha de criação e comparam o alvo completo antes/depois; snapshots também são testados diretamente. |
| Exportar um Scratch comum como `.textwarp` duplicava stacks ao reabrir. | O pacote inclui estado de propriedade por módulo, remapeia IDs otimizados e vincula primeiro por `targetId`; exportação divergente é recusada. | Round-trip com VM real parte de um SB3 sem marcadores e conserva uma única raiz. |
| Coerções válidas do Scratch eram rejeitadas por causa do shadow preferido. | Tipo coercível e formato do shadow são tratados separadamente; a conexão ativa e o shadow substituído sobrevivem. | Testes verificam número em `say` e texto em `move`, incluindo ambos os blocos de entrada. |

## Média prioridade

| Problema aberto ou limite | Impacto atual | Mitigação existente | Próxima melhoria possível |
| --- | --- | --- | --- |
| Texto e blocos alteram semanticamente o mesmo evento, procedimento ou declarações. | Não existe uma ordem semanticamente correta que possa ser inferida em todos os casos. | O editor não sobrescreve silenciosamente: mostra o conflito e exige **Manter texto** ou **Usar blocos**. Unidades independentes já são mescladas. | Fazer uma mesclagem por instrução dentro da unidade e continuar pedindo escolha somente quando a mesma instrução mudar nos dois lados. |
| Uma unidade alterada visualmente contém comentários ou espaçamento que o grafo não armazena. | Não existe reconstrução visual automática desses tokens. | A mesclagem agora apresenta conflito explícito em vez de descartar comentários; o restante do arquivo conserva conteúdo e ordem. | Associar mais tokens a IDs de blocos para reduzir a frequência do conflito. |
| Um `.sb3` avulso perdeu a URL da extensão, ou a permissão para carregar código de terceiros foi negada. | Sem carregar `getInfo()` e a primitiva não existe como código executável no runtime. | `.textwarp` conserva identificador e URL no lock; um SB3 avulso ainda preserva a estrutura em `opaque.*`, sem executar a primitiva. | Oferecer uma tela para o usuário localizar novamente uma URL perdida, sem contornar a decisão de segurança. |
| Procedimentos com retorno não funcionam no site oficial do Scratch. | O Scratch oficial não implementa `procedures_return` nem chamada de procedimento como repórter. | Cada declaração `-> tipo` gera aviso de compatibilidade no editor. Projetos destinados ao Scratch devem usar procedimentos de comando. | Criar um verificador/exportador de compatibilidade que proponha transformações quando uma equivalência por variável for segura. |
| Breakpoints exatos exigem o interpretador para as novas threads do ator afetado. | Esse ator fica mais lento enquanto o breakpoint estiver ativo. | Atores sem breakpoint continuam no JIT. Threads JIT alcançadas por pausa global permanecem compiladas e usam passo de frame. | Instrumentação opcional do compilador para breakpoints JIT com granularidade de bloco. |

## Baixa prioridade

| Limite | Motivo da prioridade baixa | Comportamento seguro |
| --- | --- | --- |
| Uma ferramenta externa remove atributos TextWarp e também regenera IDs dos parâmetros. | São duas remoções destrutivas fora do editor; não há informação restante que distinga `number`, `string` e `any`. | O decompilador usa `any`, o tipo mais seguro. Retornos redondos também voltam a `any`; booleanos continuam distinguíveis pelo formato Scratch. |
| Metadados `@textwarp` são removidos por uma ferramenta externa e vários hats idênticos também são reordenados. | As duas identidades independentes foram removidas fora do editor. | Com metadados, IDs duráveis sobrevivem a inserção, remoção e reordenação; sem eles, o hash estrutural ainda reduz trocas desnecessárias. |
| Observar o depurador cria snapshots periódicos. | O custo é pequeno, opt-in e não desativa o JIT. | Fechar o painel e remover breakpoints desliga a observação; a configuração original do compilador é restaurada. |

## Regra para novas regressões

Uma nova falha entra em **alta** quando puder causar perda silenciosa, execução incorreta sem diagnóstico ou corrupção do estado do projeto/thread. Ela só sai dessa categoria depois de uma correção automatizada por teste. Avisos na interface podem reduzir um limite externo para média, mas não são suficientes para rebaixar perda de dados controlada pelo próprio TextWarp.

## Validação

As verificações obrigatórias para manter a seção de alta prioridade vazia são:

```bash
npm run test:textwarp
npm run docs:textwarp:check
npm run build:textwarp:web
git diff --check
```

Resultado desta revisão: **149/149 testes passaram**; a auditoria cobre primitivas, hats e componentes visuais
nativos; a referência gerada estava sincronizada; o bundle web de produção foi criado; e `git diff --check` não
encontrou erros. O Webpack manteve avisos de tamanho dos bundles, Browserslist e Tapable.
