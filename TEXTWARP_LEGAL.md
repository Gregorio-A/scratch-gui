# Licenças, marcas e compatibilidade do TextWarp

Este documento registra a política adotada pelo projeto. Ele não substitui aconselhamento jurídico profissional.

## Código do editor

O TextWarp é uma versão modificada do TurboWarp e do Scratch GUI. As modificações distribuídas neste repositório
continuam sob GNU GPL versão 3, conforme `LICENSE`.

Ao distribuir o site, o pacote JavaScript ou o aplicativo Desktop:

- mantenha avisos de copyright, licença e ausência de garantia;
- identifique de forma visível que o software foi modificado;
- disponibilize o código-fonte correspondente e os scripts necessários para gerar a distribuição;
- mantenha a licença GPLv3 para o trabalho derivado;
- preserve os avisos e licenças específicas de componentes de terceiros.

O texto da licença BSD original do Scratch GUI permanece no `README.md`, como exigido por essa licença.

## Extensões

As extensões do catálogo TurboWarp podem continuar disponíveis, mas não devem ser tratadas como se possuíssem uma
licença coletiva. Cada arquivo de extensão declara sua própria licença; historicamente há extensões MIT, MPL-2.0,
Apache-2.0, BSD e arquivos que combinam mais de uma licença.

Política do TextWarp:

1. Extensões carregadas remotamente continuam apontando para o catálogo original e exibem a autoria fornecida pelo
   catálogo.
2. Extensões incluídas em uma distribuição offline devem conservar o cabeçalho de licença do arquivo e ter seus
   avisos acessíveis na tela de créditos/licenças.
3. Uma extensão sem licença clara não deve ser copiada para um pacote próprio do TextWarp até que sua permissão seja
   confirmada.
4. Extensões sandboxed continuam sandboxed. Extensões unsandboxed exigem consentimento explícito e continuam sendo
   código de terceiros com acesso elevado.
5. Compatibilidade é verificada pelo `getInfo()` carregado na `scratch-vm`. Comandos, repórteres, booleanos, hats,
   menus e blocos condicionais podem ser adaptados automaticamente; interfaces próprias, APIs exclusivas do
   navegador ou acesso ao sistema podem exigir adaptação.

## Addons e modificações

Os addons integrados são derivados do Scratch Addons e recebem patches mantidos pelo TurboWarp. Eles podem permanecer
desde que a GPLv3, os créditos e os avisos de origem sejam preservados. Links de suporte do TextWarp devem apontar
primeiro para o projeto TextWarp; solicitações que pertencem inequivocamente ao addon original podem ser encaminhadas
ao upstream.

## Marcas

Licenças de software não concedem automaticamente direitos sobre marcas. O nome, logotipo, personagens e demais
marcas do Scratch pertencem aos respectivos titulares e não devem ser usados para sugerir que o TextWarp é oficial,
patrocinado ou endossado por eles.

O TextWarp:

- usa identidade, nome, páginas, links de suporte e ícones próprios;
- mantém referências a Scratch e TurboWarp quando necessárias para atribuição, compatibilidade ou interoperabilidade;
- exibe de forma visível que não é afiliado ao Scratch, Scratch Team, MIT, Scratch Foundation ou TurboWarp;
- não remove créditos nem reatribui trabalho de terceiros ao TextWarp.

## Matriz de compatibilidade

| Componente | Pode permanecer? | Condição |
| --- | --- | --- |
| Runtime, GUI e editor de blocos derivados | Sim | GPLv3, fonte correspondente, avisos e identificação da modificação |
| Addons integrados | Sim | GPLv3 e créditos do Scratch Addons/TurboWarp preservados |
| Extensões carregadas do catálogo | Sim | Licença e autoria por extensão, permissões e sandbox preservados |
| Extensões empacotadas offline | Depende | Verificar e distribuir a licença individual de cada arquivo |
| APIs e links do Scratch | Sim, quando funcionais | Não apresentar o TextWarp como produto oficial |
| APIs, Packager e galeria TurboWarp | Sim, como serviços externos | Identificar o fornecedor e aplicar a política de privacidade correspondente |
| Logos e personagens do Scratch/TurboWarp | Não como identidade do TextWarp | Usar somente quando houver permissão ou necessidade legítima de atribuição |

## Responsabilidade por compatibilidade

O TextWarp garante a compatibilidade coberta por testes do compilador e pelo catálogo carregado em runtime. Ele não
garante que toda extensão de terceiros funcione sem adaptação. As causas mais comuns são:

- uso direto de DOM, câmera, microfone, rede, clipboard ou File System Access API;
- dependência de uma URL, CSP ou cabeçalho CORS específico;
- execução exclusivamente unsandboxed;
- blocos com interface visual própria ou mutações não descritas por `getInfo()`;
- dependência de APIs privadas de uma versão específica da `scratch-vm`.

Essas limitações devem resultar em diagnóstico explícito, sem substituir silenciosamente blocos ou fontes.
