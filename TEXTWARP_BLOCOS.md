# Referência completa de blocos TextWarp

> Arquivo gerado por `npm run docs:textwarp`. Não edite as tabelas manualmente; altere o catálogo e regenere.

Esta referência enumera toda forma textual suportada pelo runtime incluído neste fork. A auditoria automática
cobre **140 primitivas** e **9 hats** nativos: 128 opcodes usam nomes do catálogo, 9 usam sintaxe própria da
linguagem e 3 são sombras de menu representadas dentro dos argumentos. Nenhum bloco disponível é escrito como
`raw.*` pelo decompilador.

Argumentos `field` e menus usam os valores internos mostrados nas descrições. Nomes, strings, cores e opções de
menu são escritos entre aspas; números e condições podem receber qualquer expressão compatível.

## Chamadas nativas

### Movimento

| Sintaxe | Opcode Scratch | Tipo | Uso |
| --- | --- | --- | --- |
| `move(steps)` | `motion_movesteps` | command | move(steps) — move o ator. |
| `turn_right(degrees)` | `motion_turnright` | command | turn_right(degrees) — gira no sentido horário. |
| `turn_left(degrees)` | `motion_turnleft` | command | turn_left(degrees) — gira no sentido anti-horário. |
| `point_in_direction(direction)` | `motion_pointindirection` | command | point_in_direction(direction) — aponta o ator para uma direção. |
| `point_towards(target)` | `motion_pointtowards` | command | point_towards(target) — aponta para um ator, "_mouse_" ou "_random_". |
| `go_to(x, y)` | `motion_gotoxy` | command | go_to(x, y) — posiciona o ator. |
| `go_to_target(target)` | `motion_goto` | command | go_to_target(target) — vai para um ator, "_mouse_" ou "_random_". |
| `glide_to(seconds, x, y)` | `motion_glidesecstoxy` | command | glide_to(seconds, x, y) — desliza até uma posição. |
| `glide_to_target(seconds, target)` | `motion_glideto` | command | glide_to_target(seconds, target) — desliza até um ator, "_mouse_" ou "_random_". |
| `change_x(amount)` | `motion_changexby` | command | change_x(amount) — altera x. |
| `set_x(value)` | `motion_setx` | command | set_x(value) — define x. |
| `change_y(amount)` | `motion_changeyby` | command | change_y(amount) — altera y. |
| `set_y(value)` | `motion_sety` | command | set_y(value) — define y. |
| `if_on_edge_bounce()` | `motion_ifonedgebounce` | command | if_on_edge_bounce() — rebate o ator quando ele toca a borda. |
| `set_rotation_style(style)` | `motion_setrotationstyle` | command | set_rotation_style(style) — usa "all around", "left-right" ou "don't rotate". |
| `scroll_right(distance)` | `motion_scroll_right` | command | scroll_right(distance) — preserva o bloco legado de rolagem horizontal (sem efeito no Scratch 3). |
| `scroll_up(distance)` | `motion_scroll_up` | command | scroll_up(distance) — preserva o bloco legado de rolagem vertical (sem efeito no Scratch 3). |
| `align_scene(alignment)` | `motion_align_scene` | command | align_scene(alignment) — preserva o alinhamento legado: "bottom-left", "bottom-right", "middle", "top-left" ou "top-right". |
| `x_scroll()` | `motion_xscroll` | reporter | x_scroll() — repórter legado da rolagem horizontal (retorna 0 no Scratch 3). |
| `y_scroll()` | `motion_yscroll` | reporter | y_scroll() — repórter legado da rolagem vertical (retorna 0 no Scratch 3). |
| `x_position()` | `motion_xposition` | reporter | x_position() — retorna a coordenada x do ator. |
| `y_position()` | `motion_yposition` | reporter | y_position() — retorna a coordenada y do ator. |
| `direction()` | `motion_direction` | reporter | direction() — retorna a direção atual do ator em graus. |

### Aparência

| Sintaxe | Opcode Scratch | Tipo | Uso |
| --- | --- | --- | --- |
| `say(message)` | `looks_say` | command | say(message) — mostra um balão de fala. |
| `say_for(message, seconds)` | `looks_sayforsecs` | command | say_for(message, seconds) — fala por um período. |
| `think(message)` | `looks_think` | command | think(message) — mostra um balão de pensamento. |
| `show()` | `looks_show` | command | show() — mostra o ator. |
| `hide()` | `looks_hide` | command | hide() — esconde o ator. |
| `think_for(message, seconds)` | `looks_thinkforsecs` | command | think_for(message, seconds) — pensa por um período. |
| `switch_costume(costume)` | `looks_switchcostumeto` | command | switch_costume(costume) — muda a fantasia por nome ou número. |
| `next_costume()` | `looks_nextcostume` | command | next_costume() — muda para a próxima fantasia. |
| `switch_backdrop(backdrop)` | `looks_switchbackdropto` | command | switch_backdrop(backdrop) — muda o cenário por nome ou número. |
| `switch_backdrop_wait(backdrop)` | `looks_switchbackdroptoandwait` | command | switch_backdrop_wait(backdrop) — muda o cenário e aguarda os eventos iniciados. |
| `next_backdrop()` | `looks_nextbackdrop` | command | next_backdrop() — muda para o próximo cenário. |
| `change_looks_effect(effect, amount)` | `looks_changeeffectby` | command | change_looks_effect(effect, amount) — altera um efeito gráfico. |
| `set_looks_effect(effect, value)` | `looks_seteffectto` | command | set_looks_effect(effect, value) — define um efeito gráfico. |
| `clear_looks_effects()` | `looks_cleargraphiceffects` | command | clear_looks_effects() — remove todos os efeitos gráficos. |
| `change_size(amount)` | `looks_changesizeby` | command | change_size(amount) — altera o tamanho do ator. |
| `set_size(percent)` | `looks_setsizeto` | command | set_size(percent) — define o tamanho do ator em porcentagem. |
| `go_to_layer(layer)` | `looks_gotofrontback` | command | go_to_layer(layer) — move o ator para a camada "front" ou "back". |
| `move_layers(direction, count)` | `looks_goforwardbackwardlayers` | command | move_layers(direction, count) — move camadas em "forward" ou "backward". |
| `costume_number_name(property)` | `looks_costumenumbername` | reporter | costume_number_name(property) — retorna "number" ou "name" da fantasia atual. |
| `backdrop_number_name(property)` | `looks_backdropnumbername` | reporter | backdrop_number_name(property) — retorna "number" ou "name" do cenário atual. |
| `size()` | `looks_size` | reporter | size() — retorna o tamanho do ator em porcentagem. |
| `change_stretch(amount)` | `looks_changestretchby` | command | change_stretch(amount) — preserva o bloco legado de esticar (sem efeito no Scratch 3). |
| `set_stretch(percent)` | `looks_setstretchto` | command | set_stretch(percent) — preserva o bloco legado de esticar (sem efeito no Scratch 3). |
| `hide_all_sprites()` | `looks_hideallsprites` | command | hide_all_sprites() — preserva o bloco legado de esconder atores (sem efeito no Scratch 3). |

### Som

| Sintaxe | Opcode Scratch | Tipo | Uso |
| --- | --- | --- | --- |
| `play_sound(sound)` | `sound_play` | command | play_sound(sound) — inicia um som sem esperar seu término. |
| `play_sound_until_done(sound)` | `sound_playuntildone` | command | play_sound_until_done(sound) — toca um som e aguarda seu término. |
| `stop_all_sounds()` | `sound_stopallsounds` | command | stop_all_sounds() — interrompe todos os sons. |
| `change_sound_effect(effect, amount)` | `sound_changeeffectby` | command | change_sound_effect(effect, amount) — altera "PITCH" ou "PAN". |
| `set_sound_effect(effect, value)` | `sound_seteffectto` | command | set_sound_effect(effect, value) — define "PITCH" ou "PAN". |
| `clear_sound_effects()` | `sound_cleareffects` | command | clear_sound_effects() — remove os efeitos de áudio. |
| `change_volume(amount)` | `sound_changevolumeby` | command | change_volume(amount) — altera o volume. |
| `set_volume(percent)` | `sound_setvolumeto` | command | set_volume(percent) — define o volume em porcentagem. |
| `volume()` | `sound_volume` | reporter | volume() — retorna o volume em porcentagem. |

### Eventos e transmissões

| Sintaxe | Opcode Scratch | Tipo | Uso |
| --- | --- | --- | --- |
| `broadcast(message)` | `event_broadcast` | command | broadcast(message) — envia uma transmissão. |
| `broadcast_wait(message)` | `event_broadcastandwait` | command | broadcast_wait(message) — transmite e aguarda os receptores. |

### Controle

| Sintaxe | Opcode Scratch | Tipo | Uso |
| --- | --- | --- | --- |
| `wait(seconds)` | `control_wait` | command | wait(seconds) — pausa só esta thread. |
| `create_clone(actor)` | `control_create_clone_of` | command | create_clone(actor) — cria um clone; use "_myself_" para o próprio ator. |
| `delete_clone()` | `control_delete_this_clone` | command | delete_clone() — remove o clone atual. |
| `stop_all()` | `control_stop` | command | stop_all() — encerra todas as threads. |
| `stop_this_script()` | `control_stop` | command | stop_this_script() — encerra somente o script atual. |
| `stop_other_scripts()` | `control_stop` | command | stop_other_scripts() — encerra os outros scripts deste ator e continua o atual. |
| `wait_until(condition)` | `control_wait_until` | command | wait_until(condition) — espera até a condição ser verdadeira. |
| `for_each(variable, value):` | `control_for_each` | loop | for_each(variable, value): — executa o corpo com a variável de 1 até value. |
| `all_at_once():` | `control_all_at_once` | loop | all_at_once(): — preserva o bloco legado que executa seu corpo em sequência normal. |
| `counter()` | `control_get_counter` | reporter | counter() — retorna o contador legado global da VM. |
| `increment_counter()` | `control_incr_counter` | command | increment_counter() — incrementa o contador legado. |
| `clear_counter()` | `control_clear_counter` | command | clear_counter() — zera o contador legado. |

### Sensores

| Sintaxe | Opcode Scratch | Tipo | Uso |
| --- | --- | --- | --- |
| `key_pressed(key)` | `sensing_keypressed` | boolean | key_pressed(key) — informa se uma tecla está pressionada. |
| `touching(object)` | `sensing_touchingobject` | boolean | touching(object) — testa contato com ator, mouse ou borda. |
| `mouse_down()` | `sensing_mousedown` | boolean | mouse_down() — informa se o botão principal do mouse está pressionado. |
| `timer()` | `sensing_timer` | reporter | timer() — retorna os segundos desde o início ou o último reset_timer(). |
| `answer()` | `sensing_answer` | reporter | answer() — retorna a última resposta fornecida a ask(question). |
| `ask(question)` | `sensing_askandwait` | command | ask(question) — pergunta e espera a resposta. |
| `touching_color(color)` | `sensing_touchingcolor` | boolean | touching_color(color) — testa contato com uma cor hexadecimal. |
| `color_touching_color(color, target_color)` | `sensing_coloristouchingcolor` | boolean | color_touching_color(color, target_color) — testa se uma cor do ator toca outra cor. |
| `distance_to(object)` | `sensing_distanceto` | reporter | distance_to(object) — retorna a distância até um ator ou "_mouse_". |
| `mouse_x()` | `sensing_mousex` | reporter | mouse_x() — retorna a coordenada x do mouse. |
| `mouse_y()` | `sensing_mousey` | reporter | mouse_y() — retorna a coordenada y do mouse. |
| `set_drag_mode(mode)` | `sensing_setdragmode` | command | set_drag_mode(mode) — usa "draggable" ou "not draggable". |
| `loudness()` | `sensing_loudness` | reporter | loudness() — retorna o volume captado pelo microfone. |
| `loud()` | `sensing_loud` | boolean | loud() — informa se o volume do microfone é maior que 10. |
| `reset_timer()` | `sensing_resettimer` | command | reset_timer() — zera o cronômetro do projeto. |
| `property_of(property, object)` | `sensing_of` | reporter | property_of(property, object) — retorna uma propriedade do palco ou de um ator. |
| `current(unit)` | `sensing_current` | reporter | current(unit) — retorna YEAR, MONTH, DATE, DAYOFWEEK, HOUR, MINUTE ou SECOND. |
| `days_since_2000()` | `sensing_dayssince2000` | reporter | days_since_2000() — retorna os dias decorridos desde 1 de janeiro de 2000. |
| `username()` | `sensing_username` | reporter | username() — retorna o nome do usuário conectado. |
| `user_id()` | `sensing_userid` | reporter | user_id() — preserva o repórter legado de ID do usuário (sem valor no Scratch 3). |
| `online()` | `sensing_online` | boolean | online() — informa se o runtime considera que há conexão. |

### Operadores em forma de função

| Sintaxe | Opcode Scratch | Tipo | Uso |
| --- | --- | --- | --- |
| `random(from, to)` | `operator_random` | reporter | random(from, to) — escolhe um número aleatório entre os limites. |
| `round(value)` | `operator_round` | reporter | round(value) — arredonda para o inteiro mais próximo. |
| `math(operation, value)` | `operator_mathop` | reporter | math(operation, value) — aplica abs, floor, ceiling, sqrt, sin, cos, tan, asin, acos, atan, ln, log, "e ^" ou "10 ^". |
| `join(left, right)` | `operator_join` | reporter | join(left, right) — concatena os dois valores como texto. |
| `letter(index, text)` | `operator_letter_of` | reporter | letter(index, text) — retorna o caractere na posição indicada, começando em 1. |
| `length(text)` | `operator_length` | reporter | length(text) — retorna o tamanho textual do valor. |
| `contains(text, part)` | `operator_contains` | boolean | contains(text, part) — informa se text contém part sem diferenciar maiúsculas e minúsculas. |

### Dados

| Sintaxe | Opcode Scratch | Tipo | Uso |
| --- | --- | --- | --- |
| `show_variable(variable)` | `data_showvariable` | command | show_variable(variable) — mostra o monitor da variável. |
| `hide_variable(variable)` | `data_hidevariable` | command | hide_variable(variable) — esconde o monitor da variável. |
| `show_list(list)` | `data_showlist` | command | show_list(list) — mostra o monitor da lista. |
| `hide_list(list)` | `data_hidelist` | command | hide_list(list) — esconde o monitor da lista. |
| `list_add(list, value)` | `data_addtolist` | command | list_add(list, value) — adiciona ao final da lista. |
| `list_delete(list, index)` | `data_deleteoflist` | command | list_delete(list, index) — remove um item; index aceita número, "last", "random" ou "all". |
| `list_clear(list)` | `data_deletealloflist` | command | list_clear(list) — esvazia a lista. |
| `list_insert(list, index, value)` | `data_insertatlist` | command | list_insert(list, index, value) — insere um item. |
| `list_replace(list, index, value)` | `data_replaceitemoflist` | command | list_replace(list, index, value) — substitui um item. |
| `list_item(list, index)` | `data_itemoflist` | reporter | list_item(list, index) — retorna o item na posição indicada; aceita número, "last" ou "random". |
| `list_index(list, value)` | `data_itemnumoflist` | reporter | list_index(list, value) — retorna a primeira posição do valor ou 0. |
| `list_length(list)` | `data_lengthoflist` | reporter | list_length(list) — retorna a quantidade de itens. |
| `list_contains(list, value)` | `data_listcontainsitem` | boolean | list_contains(list, value) — informa se a lista contém o valor. |

## Controles estruturais

| Sintaxe | Opcode Scratch | Uso |
| --- | --- | --- |
| `repeat(times):` | `control_repeat` | repeat(times): — repete o corpo. |
| `forever:` | `control_forever` | forever: — repete para sempre. |
| `if condition:` | `control_if` | if condition: — executa o corpo quando a condição é verdadeira. |
| `if condition: … else:` | `control_if_else` | if condition: … else: — escolhe exatamente um dos dois corpos. |
| `repeat_until(condition):` | `control_repeat_until` | repeat_until(condition): — repete até a condição ser verdadeira. |
| `while(condition):` | `control_while` | while(condition): — executa o bloco legado enquanto a condição for verdadeira. |

## Eventos

| Sintaxe | Opcode Scratch | Uso |
| --- | --- | --- |
| `on green_flag:` | `event_whenflagclicked` | on green_flag: — inicia quando a bandeira verde é acionada. |
| `on clicked:` | `event_whenthisspriteclicked / event_whenstageclicked` | on clicked: — inicia ao clicar no ator ou no palco atual. |
| `on key_pressed(key):` | `event_whenkeypressed` | on key_pressed(key): — inicia quando a tecla indicada é pressionada. |
| `on receive(message):` | `event_whenbroadcastreceived` | on receive(message): — inicia ao receber a transmissão indicada. |
| `on backdrop_switches(backdrop):` | `event_whenbackdropswitchesto` | on backdrop_switches(backdrop): — inicia quando o cenário indicado se torna ativo. |
| `on loudness_greater_than(value):` | `event_whengreaterthan` | on loudness_greater_than(value): — inicia quando o volume do microfone ultrapassa value. |
| `on timer_greater_than(value):` | `event_whengreaterthan` | on timer_greater_than(value): — inicia quando o cronômetro ultrapassa value. |
| `on clone_started:` | `control_start_as_clone` | on clone_started: — inicia no instante em que este clone é criado. |
| `on touching_object(object):` | `event_whentouchingobject` | on touching_object(object): — inicia quando o ator começa a tocar um objeto. |

## Operadores

| Sintaxe | Opcode Scratch | Retorno |
| --- | --- | --- |
| `left + right` | `operator_add` | reporter |
| `left - right` | `operator_subtract` | reporter |
| `left * right` | `operator_multiply` | reporter |
| `left / right` | `operator_divide` | reporter |
| `left % right` | `operator_mod` | reporter |
| `left < right` | `operator_lt` | boolean |
| `left == right` | `operator_equals` | boolean |
| `left > right` | `operator_gt` | boolean |
| `left and right` | `operator_and` | boolean |
| `left or right` | `operator_or` | boolean |
| `not value` | `operator_not` | boolean |

`<=`, `>=` e `!=` também são aceitos e são compilados como a negação dos comparadores Scratch equivalentes.

## Sintaxes próprias de dados e procedimentos

| Opcode Scratch | Sintaxe TextWarp |
| --- | --- |
| `argument_reporter_boolean` | parâmetro booleano dentro de procedure |
| `argument_reporter_string_number` | parâmetro any, number ou string dentro de procedure |
| `data_changevariableby` | atribuição variable += value ou variable -= value |
| `data_listcontents` | nome da lista usado como expressão |
| `data_setvariableto` | atribuição variable = value |
| `data_variable` | nome da variável usado como expressão |
| `procedures_call` | chamada pelo nome declarado em procedure |
| `procedures_definition` | procedure name(arguments): |
| `procedures_return` | return value |

Declarações completas:

```text
variable score = 0
list items = []
procedure command(value: any):
    pass
procedure reporter(value: number) -> number warp:
    return value
```

## Sombras e menus que não são instruções isoladas

| Opcode interno | Representação textual |
| --- | --- |
| `argument_editor_boolean` | editor interno de um parâmetro booleano em procedure |
| `argument_editor_string_number` | editor interno de um parâmetro any, number ou string em procedure |
| `colour_picker` | literal de cor escrito como "#rrggbb" |
| `control_create_clone_of_menu` | argumento actor de create_clone(actor) |
| `data_listindexall` | argumento index que aceita número, "last" ou "all" |
| `data_listindexrandom` | argumento index que aceita número, "last" ou "random" |
| `event_broadcast_menu` | argumento message de broadcast(message) e broadcast_wait(message) |
| `event_touchingobjectmenu` | argumento object de on touching_object(object) |
| `looks_backdrops` | argumento backdrop de switch_backdrop e switch_backdrop_wait |
| `looks_costume` | argumento costume de switch_costume ou de uma extensão |
| `math_angle` | literal numérico usado em entradas de ângulo |
| `math_integer` | literal numérico inteiro |
| `math_number` | literal numérico geral |
| `math_positive_number` | literal numérico positivo |
| `math_whole_number` | literal numérico inteiro não negativo |
| `matrix` | literal string de uma matriz de LEDs |
| `motion_glideto_menu` | argumento target de glide_to_target |
| `motion_goto_menu` | argumento target de go_to_target |
| `motion_pointtowards_menu` | argumento target de point_towards |
| `note` | literal numérico de nota MIDI |
| `procedures_declaration` | editor visual interno da assinatura de procedure |
| `procedures_prototype` | protótipo visual interno gerado por procedure |
| `sensing_distancetomenu` | argumento object de distance_to(object) |
| `sensing_keyoptions` | argumento key de key_pressed(key) |
| `sensing_of_object_menu` | argumento object de property_of(property, object) |
| `sensing_touchingobjectmenu` | argumento object de touching(object) |
| `sound_beats_menu` | argumento numérico de duração em batidas |
| `sound_effects_menu` | argumento de menu de efeito sonoro |
| `sound_sounds_menu` | argumento sound de play_sound/play_sound_until_done |
| `text` | literal de texto escrito entre aspas |

Entre os componentes acima, `sound_beats_menu`, `sound_effects_menu` e `sound_sounds_menu` também aparecem como
primitivas da VM, mas no grafo continuam sendo sombras de um argumento. Seu uso já está dentro de
`play_sound(sound)`, `play_sound_until_done(sound)` ou do bloco de extensão correspondente; eles não têm execução
autônoma na paleta.

## Extensões

Cada bloco executável publicado por `getInfo()` recebe automaticamente o nome `extensionId.opcode`. Se algum
segmento contiver caracteres que não cabem em um identificador TextWarp, ele é codificado de forma estável como
`encoded_<pontos-de-código>`, sem depender do texto traduzido.

| `blockType` | Forma textual |
| --- | --- |
| `command` | `extensionId.opcode(arguments)` |
| `reporter` / `Boolean` | `extensionId.opcode(arguments)` dentro de uma expressão |
| `hat` / `event` | `on extensionId.opcode(arguments):` |
| `conditional` / `loop` | `extensionId.opcode(arguments):`, seguido de `branch 2:`, `branch 3:` quando existirem |

São preservados argumentos `number`, `angle`, `note`, `color`, `Boolean`, `string`, `matrix`, `costume`, `sound`,
menus fixos, menus que aceitam repórteres e campos personalizados. Argumentos `image` são decoração inline do
rótulo visual e não aparecem na chamada porque a VM não os entrega à primitiva.

Blocos `isDynamic` recebem uma variante `extensionId.opcode.variant_<configuração-codificada>`. Essa parte é
gerada e lida pelo editor para conservar exatamente os argumentos e a mutation do exemplar visual; não é JSON
`raw.*` e continua resolvendo para o opcode nomeado da extensão.

Itens `button`, `label`, `separator` e `xml` continuam disponíveis no painel de extensões. Eles são ações ou
elementos de paleta, não blocos executáveis, e portanto não fingem ser chamadas da linguagem.

## Garantia de cobertura

A suíte `test/textwarp/complete-block-coverage.test.js` falha se:

- surgir uma primitiva ou um hat nativo sem classificação textual;
- qualquer chamada nativa deixar de compilar, decompilar sem `raw.*` e recompilar para o mesmo opcode;
- uma sintaxe especial, operador, evento ou controle perder seu round-trip;
- algum tipo executável ou tipo de argumento de extensão perder a forma textual.
