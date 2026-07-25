# Problemas e prioridades do TextWarp

Estado revisado em 24 de julho de 2026. Este arquivo é a lista canônica de riscos e limitações; a referência completa de uso continua em [TEXTWARP.md](TEXTWARP.md).

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

## Média prioridade

| Problema aberto ou limite | Impacto atual | Mitigação existente | Próxima melhoria possível |
| --- | --- | --- | --- |
| Texto e blocos alteram semanticamente o mesmo evento, procedimento ou declarações. | Não existe uma ordem semanticamente correta que possa ser inferida em todos os casos. | O editor não sobrescreve silenciosamente: mostra o conflito e exige **Manter texto** ou **Usar blocos**. Unidades independentes já são mescladas. | Fazer uma mesclagem por instrução dentro da unidade e continuar pedindo escolha somente quando a mesma instrução mudar nos dois lados. |
| Uma unidade alterada visualmente perde comentários e espaçamento internos. | O grafo Scratch não armazena esses tokens; apenas a unidade realmente alterada volta à forma canônica. | Todo o restante do arquivo conserva conteúdo e ordem textual. | Associar comentários a IDs de blocos em metadados TextWarp opcionais. |
| Um `.sb3` avulso perdeu a URL da extensão, ou a permissão para carregar código de terceiros foi negada. | Sem carregar `getInfo()` e a primitiva não existe como código executável no runtime. | `.textwarp` conserva identificador e URL no lock, passa pelo sandbox e pela autorização atuais do TurboWarp e falha explicitamente ao restaurar uma dependência inválida. Em um SB3 avulso, o stack desconhecido permanece visual e não é adotado nem sobrescrito pelo texto. | Oferecer uma tela para o usuário localizar novamente uma URL perdida, sem contornar a decisão de segurança. |
| Procedimentos com retorno não funcionam no site oficial do Scratch. | O Scratch oficial não implementa `procedures_return` nem chamada de procedimento como repórter. | Cada declaração `-> tipo` gera aviso de compatibilidade no editor. Projetos destinados ao Scratch devem usar procedimentos de comando. | Criar um verificador/exportador de compatibilidade que proponha transformações quando uma equivalência por variável for segura. |
| Breakpoints exatos exigem o interpretador para as novas threads do ator afetado. | Esse ator fica mais lento enquanto o breakpoint estiver ativo. | Atores sem breakpoint continuam no JIT. Threads JIT alcançadas por pausa global permanecem compiladas e usam passo de frame. | Instrumentação opcional do compilador para breakpoints JIT com granularidade de bloco. |

## Baixa prioridade

| Limite | Motivo da prioridade baixa | Comportamento seguro |
| --- | --- | --- |
| Uma ferramenta externa remove atributos TextWarp e também regenera IDs dos parâmetros. | São duas remoções destrutivas fora do editor; não há informação restante que distinga `number`, `string` e `any`. | O decompilador usa `any`, o tipo mais seguro. Retornos redondos também voltam a `any`; booleanos continuam distinguíveis pelo formato Scratch. |
| Hats duplicados do mesmo tipo são reordenados por uma ferramenta visual. | O Scratch não registra uma identidade textual de ocorrência independente da estrutura dos blocos. | O sincronizador associa pela ocorrência e usa ordem canônica somente quando a troca não pode ser distinguida. |
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

Resultado desta revisão: **57/57 testes passaram**; a auditoria cobre primitivas, hats e componentes visuais
nativos; a referência gerada estava sincronizada; o bundle web de produção foi criado; e `git diff --check` não
encontrou erros. O Webpack manteve avisos de tamanho dos bundles, Browserslist e Tapable.
