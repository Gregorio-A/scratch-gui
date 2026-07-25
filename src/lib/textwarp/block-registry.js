'use strict';

const numberInput = (name, input, shadowOpcode = 'math_number', shadowField = 'NUM') => Object.freeze({
    name,
    role: 'input',
    valueType: 'number',
    input,
    shadowOpcode,
    shadowField
});

const textInput = (name, input) => Object.freeze({
    name,
    role: 'input',
    valueType: 'string',
    input,
    shadowOpcode: 'text',
    shadowField: 'TEXT'
});

const valueInput = (name, input) => Object.freeze({
    name,
    role: 'input',
    valueType: 'any',
    input,
    shadowOpcode: 'text',
    shadowField: 'TEXT'
});

const booleanInput = (name, input) => Object.freeze({
    name,
    role: 'input',
    valueType: 'boolean',
    input,
    defaultValue: false
});

const colorInput = (name, input, defaultValue = '#ff0000') => Object.freeze({
    name,
    role: 'input',
    valueType: 'string',
    input,
    shadowOpcode: 'colour_picker',
    shadowField: 'COLOUR',
    defaultValue
});

const fieldInput = (name, field, defaultValue = '') => Object.freeze({
    name,
    role: 'field',
    valueType: 'string',
    field,
    defaultValue
});

const variableInput = (name = 'variable', field = 'VARIABLE') => Object.freeze({
    name,
    role: 'variable',
    field
});

const listInput = (name = 'list', field = 'LIST') => Object.freeze({
    name,
    role: 'list',
    field
});

const indexInput = (name = 'index', input = 'INDEX') => Object.freeze({
    name,
    role: 'input',
    valueType: 'any',
    input,
    shadowOpcode: 'math_integer',
    shadowField: 'NUM',
    defaultValue: 1
});

const menuInput = (name, input, menuOpcode, menuField, defaultValue) => Object.freeze({
    name,
    role: 'menu',
    valueType: 'string',
    input,
    menuOpcode,
    menuField,
    defaultValue
});

const blockRegistry = Object.freeze({
    move: Object.freeze({
        opcode: 'motion_movesteps', kind: 'command', allowStage: false,
        arguments: [numberInput('steps', 'STEPS')],
        documentation: 'move(steps) — move o ator.'
    }),
    turn_right: Object.freeze({
        opcode: 'motion_turnright', kind: 'command', allowStage: false,
        arguments: [numberInput('degrees', 'DEGREES')],
        documentation: 'turn_right(degrees) — gira no sentido horário.'
    }),
    turn_left: Object.freeze({
        opcode: 'motion_turnleft', kind: 'command', allowStage: false,
        arguments: [numberInput('degrees', 'DEGREES')],
        documentation: 'turn_left(degrees) — gira no sentido anti-horário.'
    }),
    point_in_direction: Object.freeze({
        opcode: 'motion_pointindirection', kind: 'command', allowStage: false,
        arguments: [numberInput('direction', 'DIRECTION', 'math_angle')],
        documentation: 'point_in_direction(direction) — aponta o ator para uma direção.'
    }),
    point_towards: Object.freeze({
        opcode: 'motion_pointtowards', kind: 'command', allowStage: false,
        arguments: [menuInput('target', 'TOWARDS', 'motion_pointtowards_menu', 'TOWARDS', '_mouse_')],
        documentation: 'point_towards(target) — aponta para um ator, "_mouse_" ou "_random_".'
    }),
    go_to: Object.freeze({
        opcode: 'motion_gotoxy', kind: 'command', allowStage: false,
        arguments: [numberInput('x', 'X'), numberInput('y', 'Y')],
        documentation: 'go_to(x, y) — posiciona o ator.'
    }),
    go_to_target: Object.freeze({
        opcode: 'motion_goto', kind: 'command', allowStage: false,
        arguments: [menuInput('target', 'TO', 'motion_goto_menu', 'TO', '_random_')],
        documentation: 'go_to_target(target) — vai para um ator, "_mouse_" ou "_random_".'
    }),
    glide_to: Object.freeze({
        opcode: 'motion_glidesecstoxy', kind: 'command', allowStage: false,
        arguments: [
            numberInput('seconds', 'SECS'),
            numberInput('x', 'X'),
            numberInput('y', 'Y')
        ],
        documentation: 'glide_to(seconds, x, y) — desliza até uma posição.'
    }),
    glide_to_target: Object.freeze({
        opcode: 'motion_glideto', kind: 'command', allowStage: false,
        arguments: [
            numberInput('seconds', 'SECS'),
            menuInput('target', 'TO', 'motion_glideto_menu', 'TO', '_random_')
        ],
        documentation: 'glide_to_target(seconds, target) — desliza até um ator, "_mouse_" ou "_random_".'
    }),
    change_x: Object.freeze({
        opcode: 'motion_changexby', kind: 'command', allowStage: false,
        arguments: [numberInput('amount', 'DX')],
        documentation: 'change_x(amount) — altera x.'
    }),
    set_x: Object.freeze({
        opcode: 'motion_setx', kind: 'command', allowStage: false,
        arguments: [numberInput('value', 'X')],
        documentation: 'set_x(value) — define x.'
    }),
    change_y: Object.freeze({
        opcode: 'motion_changeyby', kind: 'command', allowStage: false,
        arguments: [numberInput('amount', 'DY')],
        documentation: 'change_y(amount) — altera y.'
    }),
    set_y: Object.freeze({
        opcode: 'motion_sety', kind: 'command', allowStage: false,
        arguments: [numberInput('value', 'Y')],
        documentation: 'set_y(value) — define y.'
    }),
    if_on_edge_bounce: Object.freeze({
        opcode: 'motion_ifonedgebounce', kind: 'command', allowStage: false, arguments: [],
        documentation: 'if_on_edge_bounce() — rebate o ator quando ele toca a borda.'
    }),
    set_rotation_style: Object.freeze({
        opcode: 'motion_setrotationstyle', kind: 'command', allowStage: false,
        arguments: [Object.freeze({
            name: 'style', role: 'field', valueType: 'string', field: 'STYLE', defaultValue: 'all around'
        })],
        documentation: 'set_rotation_style(style) — usa "all around", "left-right" ou "don\'t rotate".'
    }),
    scroll_right: Object.freeze({
        opcode: 'motion_scroll_right', kind: 'command', allowStage: true,
        arguments: [numberInput('distance', 'DISTANCE')],
        documentation: 'scroll_right(distance) — preserva o bloco legado de rolagem horizontal (sem efeito no Scratch 3).'
    }),
    scroll_up: Object.freeze({
        opcode: 'motion_scroll_up', kind: 'command', allowStage: true,
        arguments: [numberInput('distance', 'DISTANCE')],
        documentation: 'scroll_up(distance) — preserva o bloco legado de rolagem vertical (sem efeito no Scratch 3).'
    }),
    align_scene: Object.freeze({
        opcode: 'motion_align_scene', kind: 'command', allowStage: true,
        arguments: [fieldInput('alignment', 'ALIGNMENT', 'middle')],
        documentation: 'align_scene(alignment) — preserva o alinhamento legado: "bottom-left", "bottom-right", "middle", "top-left" ou "top-right".'
    }),
    x_scroll: Object.freeze({
        opcode: 'motion_xscroll', kind: 'reporter', allowStage: true, arguments: [], valueType: 'number',
        documentation: 'x_scroll() — repórter legado da rolagem horizontal (retorna 0 no Scratch 3).'
    }),
    y_scroll: Object.freeze({
        opcode: 'motion_yscroll', kind: 'reporter', allowStage: true, arguments: [], valueType: 'number',
        documentation: 'y_scroll() — repórter legado da rolagem vertical (retorna 0 no Scratch 3).'
    }),
    wait: Object.freeze({
        opcode: 'control_wait', kind: 'command', allowStage: true,
        arguments: [numberInput('seconds', 'DURATION', 'math_positive_number')],
        documentation: 'wait(seconds) — pausa só esta thread.'
    }),
    say: Object.freeze({
        opcode: 'looks_say', kind: 'command', allowStage: false,
        arguments: [textInput('message', 'MESSAGE')],
        documentation: 'say(message) — mostra um balão de fala.'
    }),
    say_for: Object.freeze({
        opcode: 'looks_sayforsecs', kind: 'command', allowStage: false,
        arguments: [textInput('message', 'MESSAGE'), numberInput('seconds', 'SECS', 'math_positive_number')],
        documentation: 'say_for(message, seconds) — fala por um período.'
    }),
    think: Object.freeze({
        opcode: 'looks_think', kind: 'command', allowStage: false,
        arguments: [textInput('message', 'MESSAGE')],
        documentation: 'think(message) — mostra um balão de pensamento.'
    }),
    show: Object.freeze({
        opcode: 'looks_show', kind: 'command', allowStage: false, arguments: [],
        documentation: 'show() — mostra o ator.'
    }),
    hide: Object.freeze({
        opcode: 'looks_hide', kind: 'command', allowStage: false, arguments: [],
        documentation: 'hide() — esconde o ator.'
    }),
    think_for: Object.freeze({
        opcode: 'looks_thinkforsecs', kind: 'command', allowStage: false,
        arguments: [textInput('message', 'MESSAGE'), numberInput('seconds', 'SECS', 'math_positive_number')],
        documentation: 'think_for(message, seconds) — pensa por um período.'
    }),
    switch_costume: Object.freeze({
        opcode: 'looks_switchcostumeto', kind: 'command', allowStage: false,
        arguments: [menuInput('costume', 'COSTUME', 'looks_costume', 'COSTUME', 'costume1')],
        documentation: 'switch_costume(costume) — muda a fantasia por nome ou número.'
    }),
    next_costume: Object.freeze({
        opcode: 'looks_nextcostume', kind: 'command', allowStage: false, arguments: [],
        documentation: 'next_costume() — muda para a próxima fantasia.'
    }),
    switch_backdrop: Object.freeze({
        opcode: 'looks_switchbackdropto', kind: 'command', allowStage: true,
        arguments: [menuInput('backdrop', 'BACKDROP', 'looks_backdrops', 'BACKDROP', 'backdrop1')],
        documentation: 'switch_backdrop(backdrop) — muda o cenário por nome ou número.'
    }),
    switch_backdrop_wait: Object.freeze({
        opcode: 'looks_switchbackdroptoandwait', kind: 'command', allowStage: true,
        arguments: [menuInput('backdrop', 'BACKDROP', 'looks_backdrops', 'BACKDROP', 'backdrop1')],
        documentation: 'switch_backdrop_wait(backdrop) — muda o cenário e aguarda os eventos iniciados.'
    }),
    next_backdrop: Object.freeze({
        opcode: 'looks_nextbackdrop', kind: 'command', allowStage: true, arguments: [],
        documentation: 'next_backdrop() — muda para o próximo cenário.'
    }),
    change_looks_effect: Object.freeze({
        opcode: 'looks_changeeffectby', kind: 'command', allowStage: true,
        arguments: [fieldInput('effect', 'EFFECT', 'COLOR'), numberInput('amount', 'CHANGE')],
        documentation: 'change_looks_effect(effect, amount) — altera um efeito gráfico.'
    }),
    set_looks_effect: Object.freeze({
        opcode: 'looks_seteffectto', kind: 'command', allowStage: true,
        arguments: [fieldInput('effect', 'EFFECT', 'COLOR'), numberInput('value', 'VALUE')],
        documentation: 'set_looks_effect(effect, value) — define um efeito gráfico.'
    }),
    clear_looks_effects: Object.freeze({
        opcode: 'looks_cleargraphiceffects', kind: 'command', allowStage: true, arguments: [],
        documentation: 'clear_looks_effects() — remove todos os efeitos gráficos.'
    }),
    change_size: Object.freeze({
        opcode: 'looks_changesizeby', kind: 'command', allowStage: false,
        arguments: [numberInput('amount', 'CHANGE')], documentation: 'change_size(amount) — altera o tamanho do ator.'
    }),
    set_size: Object.freeze({
        opcode: 'looks_setsizeto', kind: 'command', allowStage: false,
        arguments: [numberInput('percent', 'SIZE')], documentation: 'set_size(percent) — define o tamanho do ator em porcentagem.'
    }),
    go_to_layer: Object.freeze({
        opcode: 'looks_gotofrontback', kind: 'command', allowStage: false,
        arguments: [fieldInput('layer', 'FRONT_BACK', 'front')],
        documentation: 'go_to_layer(layer) — move o ator para a camada "front" ou "back".'
    }),
    move_layers: Object.freeze({
        opcode: 'looks_goforwardbackwardlayers', kind: 'command', allowStage: false,
        arguments: [fieldInput('direction', 'FORWARD_BACKWARD', 'forward'), numberInput('count', 'NUM')],
        documentation: 'move_layers(direction, count) — move camadas em "forward" ou "backward".'
    }),
    costume_number_name: Object.freeze({
        opcode: 'looks_costumenumbername', kind: 'reporter', allowStage: false, valueType: 'any',
        arguments: [fieldInput('property', 'NUMBER_NAME', 'number')],
        documentation: 'costume_number_name(property) — retorna "number" ou "name" da fantasia atual.'
    }),
    backdrop_number_name: Object.freeze({
        opcode: 'looks_backdropnumbername', kind: 'reporter', allowStage: true, valueType: 'any',
        arguments: [fieldInput('property', 'NUMBER_NAME', 'number')],
        documentation: 'backdrop_number_name(property) — retorna "number" ou "name" do cenário atual.'
    }),
    size: Object.freeze({
        opcode: 'looks_size', kind: 'reporter', allowStage: false, valueType: 'number', arguments: [],
        documentation: 'size() — retorna o tamanho do ator em porcentagem.'
    }),
    change_stretch: Object.freeze({
        opcode: 'looks_changestretchby', kind: 'command', allowStage: false,
        arguments: [numberInput('amount', 'CHANGE')],
        documentation: 'change_stretch(amount) — preserva o bloco legado de esticar (sem efeito no Scratch 3).'
    }),
    set_stretch: Object.freeze({
        opcode: 'looks_setstretchto', kind: 'command', allowStage: false,
        arguments: [numberInput('percent', 'STRETCH')],
        documentation: 'set_stretch(percent) — preserva o bloco legado de esticar (sem efeito no Scratch 3).'
    }),
    hide_all_sprites: Object.freeze({
        opcode: 'looks_hideallsprites', kind: 'command', allowStage: true, arguments: [],
        documentation: 'hide_all_sprites() — preserva o bloco legado de esconder atores (sem efeito no Scratch 3).'
    }),
    play_sound: Object.freeze({
        opcode: 'sound_play', kind: 'command', allowStage: true,
        arguments: [menuInput('sound', 'SOUND_MENU', 'sound_sounds_menu', 'SOUND_MENU', '')],
        documentation: 'play_sound(sound) — inicia um som sem esperar seu término.'
    }),
    play_sound_until_done: Object.freeze({
        opcode: 'sound_playuntildone', kind: 'command', allowStage: true,
        arguments: [menuInput('sound', 'SOUND_MENU', 'sound_sounds_menu', 'SOUND_MENU', '')],
        documentation: 'play_sound_until_done(sound) — toca um som e aguarda seu término.'
    }),
    stop_all_sounds: Object.freeze({
        opcode: 'sound_stopallsounds', kind: 'command', allowStage: true, arguments: [],
        documentation: 'stop_all_sounds() — interrompe todos os sons.'
    }),
    change_sound_effect: Object.freeze({
        opcode: 'sound_changeeffectby', kind: 'command', allowStage: true,
        arguments: [fieldInput('effect', 'EFFECT', 'PITCH'), numberInput('amount', 'VALUE')],
        documentation: 'change_sound_effect(effect, amount) — altera "PITCH" ou "PAN".'
    }),
    set_sound_effect: Object.freeze({
        opcode: 'sound_seteffectto', kind: 'command', allowStage: true,
        arguments: [fieldInput('effect', 'EFFECT', 'PITCH'), numberInput('value', 'VALUE')],
        documentation: 'set_sound_effect(effect, value) — define "PITCH" ou "PAN".'
    }),
    clear_sound_effects: Object.freeze({
        opcode: 'sound_cleareffects', kind: 'command', allowStage: true, arguments: [],
        documentation: 'clear_sound_effects() — remove os efeitos de áudio.'
    }),
    change_volume: Object.freeze({
        opcode: 'sound_changevolumeby', kind: 'command', allowStage: true,
        arguments: [numberInput('amount', 'VOLUME')], documentation: 'change_volume(amount) — altera o volume.'
    }),
    set_volume: Object.freeze({
        opcode: 'sound_setvolumeto', kind: 'command', allowStage: true,
        arguments: [numberInput('percent', 'VOLUME')], documentation: 'set_volume(percent) — define o volume em porcentagem.'
    }),
    volume: Object.freeze({
        opcode: 'sound_volume', kind: 'reporter', allowStage: true, valueType: 'number', arguments: [],
        documentation: 'volume() — retorna o volume em porcentagem.'
    }),
    broadcast: Object.freeze({
        opcode: 'event_broadcast', kind: 'command', allowStage: true,
        arguments: [Object.freeze({name: 'message', role: 'broadcast', input: 'BROADCAST_INPUT'})],
        documentation: 'broadcast(message) — envia uma transmissão.'
    }),
    broadcast_wait: Object.freeze({
        opcode: 'event_broadcastandwait', kind: 'command', allowStage: true,
        arguments: [Object.freeze({name: 'message', role: 'broadcast', input: 'BROADCAST_INPUT'})],
        documentation: 'broadcast_wait(message) — transmite e aguarda os receptores.'
    }),
    create_clone: Object.freeze({
        opcode: 'control_create_clone_of', kind: 'command', allowStage: false,
        arguments: [Object.freeze({
            name: 'actor', role: 'menu', valueType: 'string', input: 'CLONE_OPTION',
            menuOpcode: 'control_create_clone_of_menu', menuField: 'CLONE_OPTION', defaultValue: '_myself_'
        })],
        documentation: 'create_clone(actor) — cria um clone; use "_myself_" para o próprio ator.'
    }),
    delete_clone: Object.freeze({
        opcode: 'control_delete_this_clone', kind: 'command', allowStage: false, arguments: [], terminal: true,
        documentation: 'delete_clone() — remove o clone atual.'
    }),
    stop_all: Object.freeze({
        opcode: 'control_stop', kind: 'command', allowStage: true, arguments: [], terminal: true,
        staticFields: {STOP_OPTION: 'all'},
        mutation: {tagName: 'mutation', children: [], hasnext: 'false'},
        documentation: 'stop_all() — encerra todas as threads.'
    }),
    stop_this_script: Object.freeze({
        opcode: 'control_stop', kind: 'command', allowStage: true, arguments: [], terminal: true,
        staticFields: {STOP_OPTION: 'this script'},
        mutation: {tagName: 'mutation', children: [], hasnext: 'false'},
        documentation: 'stop_this_script() — encerra somente o script atual.'
    }),
    stop_other_scripts: Object.freeze({
        opcode: 'control_stop', kind: 'command', allowStage: true, arguments: [],
        staticFields: {STOP_OPTION: 'other scripts in sprite'},
        mutation: {tagName: 'mutation', children: [], hasnext: 'true'},
        documentation: 'stop_other_scripts() — encerra os outros scripts deste ator e continua o atual.'
    }),
    wait_until: Object.freeze({
        opcode: 'control_wait_until', kind: 'command', allowStage: true,
        arguments: [booleanInput('condition', 'CONDITION')],
        documentation: 'wait_until(condition) — espera até a condição ser verdadeira.'
    }),
    for_each: Object.freeze({
        opcode: 'control_for_each', kind: 'loop', allowStage: true, branchCount: 1,
        arguments: [variableInput(), numberInput('value', 'VALUE')],
        documentation: 'for_each(variable, value): — executa o corpo com a variável de 1 até value.'
    }),
    all_at_once: Object.freeze({
        opcode: 'control_all_at_once', kind: 'loop', allowStage: true, branchCount: 1, arguments: [],
        documentation: 'all_at_once(): — preserva o bloco legado que executa seu corpo em sequência normal.'
    }),
    counter: Object.freeze({
        opcode: 'control_get_counter', kind: 'reporter', allowStage: true, valueType: 'number', arguments: [],
        documentation: 'counter() — retorna o contador legado global da VM.'
    }),
    increment_counter: Object.freeze({
        opcode: 'control_incr_counter', kind: 'command', allowStage: true, arguments: [],
        documentation: 'increment_counter() — incrementa o contador legado.'
    }),
    clear_counter: Object.freeze({
        opcode: 'control_clear_counter', kind: 'command', allowStage: true, arguments: [],
        documentation: 'clear_counter() — zera o contador legado.'
    }),
    show_variable: Object.freeze({
        opcode: 'data_showvariable', kind: 'command', allowStage: true,
        arguments: [variableInput()], documentation: 'show_variable(variable) — mostra o monitor da variável.'
    }),
    hide_variable: Object.freeze({
        opcode: 'data_hidevariable', kind: 'command', allowStage: true,
        arguments: [variableInput()], documentation: 'hide_variable(variable) — esconde o monitor da variável.'
    }),
    show_list: Object.freeze({
        opcode: 'data_showlist', kind: 'command', allowStage: true,
        arguments: [listInput()], documentation: 'show_list(list) — mostra o monitor da lista.'
    }),
    hide_list: Object.freeze({
        opcode: 'data_hidelist', kind: 'command', allowStage: true,
        arguments: [listInput()], documentation: 'hide_list(list) — esconde o monitor da lista.'
    }),
    list_add: Object.freeze({
        opcode: 'data_addtolist', kind: 'command', allowStage: true,
        arguments: [listInput(), valueInput('value', 'ITEM')],
        documentation: 'list_add(list, value) — adiciona ao final da lista.'
    }),
    list_delete: Object.freeze({
        opcode: 'data_deleteoflist', kind: 'command', allowStage: true,
        arguments: [listInput(), indexInput()],
        documentation: 'list_delete(list, index) — remove um item; index aceita número, "last", "random" ou "all".'
    }),
    list_clear: Object.freeze({
        opcode: 'data_deletealloflist', kind: 'command', allowStage: true,
        arguments: [listInput()],
        documentation: 'list_clear(list) — esvazia a lista.'
    }),
    list_insert: Object.freeze({
        opcode: 'data_insertatlist', kind: 'command', allowStage: true,
        arguments: [
            listInput(),
            indexInput(),
            valueInput('value', 'ITEM')
        ],
        documentation: 'list_insert(list, index, value) — insere um item.'
    }),
    list_replace: Object.freeze({
        opcode: 'data_replaceitemoflist', kind: 'command', allowStage: true,
        arguments: [
            listInput(),
            indexInput(),
            valueInput('value', 'ITEM')
        ],
        documentation: 'list_replace(list, index, value) — substitui um item.'
    }),

    x_position: Object.freeze({
        opcode: 'motion_xposition', kind: 'reporter', allowStage: false, arguments: [],
        documentation: 'x_position() — retorna a coordenada x do ator.'
    }),
    y_position: Object.freeze({
        opcode: 'motion_yposition', kind: 'reporter', allowStage: false, arguments: [],
        documentation: 'y_position() — retorna a coordenada y do ator.'
    }),
    direction: Object.freeze({
        opcode: 'motion_direction', kind: 'reporter', allowStage: false, arguments: [],
        documentation: 'direction() — retorna a direção atual do ator em graus.'
    }),
    key_pressed: Object.freeze({
        opcode: 'sensing_keypressed', kind: 'boolean', allowStage: true,
        arguments: [menuInput('key', 'KEY_OPTION', 'sensing_keyoptions', 'KEY_OPTION', 'space')],
        documentation: 'key_pressed(key) — informa se uma tecla está pressionada.'
    }),
    touching: Object.freeze({
        opcode: 'sensing_touchingobject', kind: 'boolean', allowStage: false,
        arguments: [menuInput('object', 'TOUCHINGOBJECTMENU', 'sensing_touchingobjectmenu', 'TOUCHINGOBJECTMENU', '_edge_')],
        documentation: 'touching(object) — testa contato com ator, mouse ou borda.'
    }),
    mouse_down: Object.freeze({
        opcode: 'sensing_mousedown', kind: 'boolean', allowStage: true, arguments: [],
        documentation: 'mouse_down() — informa se o botão principal do mouse está pressionado.'
    }),
    timer: Object.freeze({
        opcode: 'sensing_timer', kind: 'reporter', allowStage: true, arguments: [],
        documentation: 'timer() — retorna os segundos desde o início ou o último reset_timer().'
    }),
    answer: Object.freeze({
        opcode: 'sensing_answer', kind: 'reporter', allowStage: true, arguments: [],
        documentation: 'answer() — retorna a última resposta fornecida a ask(question).'
    }),
    ask: Object.freeze({
        opcode: 'sensing_askandwait', kind: 'command', allowStage: true,
        arguments: [textInput('question', 'QUESTION')], documentation: 'ask(question) — pergunta e espera a resposta.'
    }),
    touching_color: Object.freeze({
        opcode: 'sensing_touchingcolor', kind: 'boolean', allowStage: false,
        arguments: [colorInput('color', 'COLOR')], documentation: 'touching_color(color) — testa contato com uma cor hexadecimal.'
    }),
    color_touching_color: Object.freeze({
        opcode: 'sensing_coloristouchingcolor', kind: 'boolean', allowStage: false,
        arguments: [colorInput('color', 'COLOR'), colorInput('target_color', 'COLOR2')],
        documentation: 'color_touching_color(color, target_color) — testa se uma cor do ator toca outra cor.'
    }),
    distance_to: Object.freeze({
        opcode: 'sensing_distanceto', kind: 'reporter', allowStage: false, valueType: 'number',
        arguments: [menuInput('object', 'DISTANCETOMENU', 'sensing_distancetomenu', 'DISTANCETOMENU', '_mouse_')],
        documentation: 'distance_to(object) — retorna a distância até um ator ou "_mouse_".'
    }),
    mouse_x: Object.freeze({
        opcode: 'sensing_mousex', kind: 'reporter', allowStage: true, valueType: 'number', arguments: [],
        documentation: 'mouse_x() — retorna a coordenada x do mouse.'
    }),
    mouse_y: Object.freeze({
        opcode: 'sensing_mousey', kind: 'reporter', allowStage: true, valueType: 'number', arguments: [],
        documentation: 'mouse_y() — retorna a coordenada y do mouse.'
    }),
    set_drag_mode: Object.freeze({
        opcode: 'sensing_setdragmode', kind: 'command', allowStage: false,
        arguments: [fieldInput('mode', 'DRAG_MODE', 'draggable')],
        documentation: 'set_drag_mode(mode) — usa "draggable" ou "not draggable".'
    }),
    loudness: Object.freeze({
        opcode: 'sensing_loudness', kind: 'reporter', allowStage: true, valueType: 'number', arguments: [],
        documentation: 'loudness() — retorna o volume captado pelo microfone.'
    }),
    loud: Object.freeze({
        opcode: 'sensing_loud', kind: 'boolean', allowStage: true, arguments: [],
        documentation: 'loud() — informa se o volume do microfone é maior que 10.'
    }),
    reset_timer: Object.freeze({
        opcode: 'sensing_resettimer', kind: 'command', allowStage: true, arguments: [],
        documentation: 'reset_timer() — zera o cronômetro do projeto.'
    }),
    property_of: Object.freeze({
        opcode: 'sensing_of', kind: 'reporter', allowStage: true, valueType: 'any',
        arguments: [
            fieldInput('property', 'PROPERTY', 'x position'),
            menuInput('object', 'OBJECT', 'sensing_of_object_menu', 'OBJECT', '_stage_')
        ],
        documentation: 'property_of(property, object) — retorna uma propriedade do palco ou de um ator.'
    }),
    current: Object.freeze({
        opcode: 'sensing_current', kind: 'reporter', allowStage: true, valueType: 'number',
        arguments: [fieldInput('unit', 'CURRENTMENU', 'YEAR')],
        documentation: 'current(unit) — retorna YEAR, MONTH, DATE, DAYOFWEEK, HOUR, MINUTE ou SECOND.'
    }),
    days_since_2000: Object.freeze({
        opcode: 'sensing_dayssince2000', kind: 'reporter', allowStage: true, valueType: 'number', arguments: [],
        documentation: 'days_since_2000() — retorna os dias decorridos desde 1 de janeiro de 2000.'
    }),
    username: Object.freeze({
        opcode: 'sensing_username', kind: 'reporter', allowStage: true, valueType: 'string', arguments: [],
        documentation: 'username() — retorna o nome do usuário conectado.'
    }),
    user_id: Object.freeze({
        opcode: 'sensing_userid', kind: 'reporter', allowStage: true, valueType: 'number', arguments: [],
        documentation: 'user_id() — preserva o repórter legado de ID do usuário (sem valor no Scratch 3).'
    }),
    online: Object.freeze({
        opcode: 'sensing_online', kind: 'boolean', allowStage: true, arguments: [],
        documentation: 'online() — informa se o runtime considera que há conexão.'
    }),
    random: Object.freeze({
        opcode: 'operator_random', kind: 'reporter', allowStage: true,
        arguments: [numberInput('from', 'FROM'), numberInput('to', 'TO')],
        documentation: 'random(from, to) — escolhe um número aleatório entre os limites.'
    }),
    round: Object.freeze({
        opcode: 'operator_round', kind: 'reporter', allowStage: true,
        arguments: [numberInput('value', 'NUM')], documentation: 'round(value) — arredonda para o inteiro mais próximo.'
    }),
    math: Object.freeze({
        opcode: 'operator_mathop', kind: 'reporter', allowStage: true, valueType: 'number',
        arguments: [fieldInput('operation', 'OPERATOR', 'abs'), numberInput('value', 'NUM')],
        documentation: 'math(operation, value) — aplica abs, floor, ceiling, sqrt, sin, cos, tan, asin, acos, atan, ln, log, "e ^" ou "10 ^".'
    }),
    join: Object.freeze({
        opcode: 'operator_join', kind: 'reporter', allowStage: true,
        arguments: [valueInput('left', 'STRING1'), valueInput('right', 'STRING2')],
        documentation: 'join(left, right) — concatena os dois valores como texto.'
    }),
    letter: Object.freeze({
        opcode: 'operator_letter_of', kind: 'reporter', allowStage: true,
        arguments: [numberInput('index', 'LETTER', 'math_whole_number'), valueInput('text', 'STRING')],
        documentation: 'letter(index, text) — retorna o caractere na posição indicada, começando em 1.'
    }),
    length: Object.freeze({
        opcode: 'operator_length', kind: 'reporter', allowStage: true,
        arguments: [valueInput('text', 'STRING')], documentation: 'length(text) — retorna o tamanho textual do valor.'
    }),
    contains: Object.freeze({
        opcode: 'operator_contains', kind: 'boolean', allowStage: true,
        arguments: [valueInput('text', 'STRING1'), valueInput('part', 'STRING2')],
        documentation: 'contains(text, part) — informa se text contém part sem diferenciar maiúsculas e minúsculas.'
    }),
    list_item: Object.freeze({
        opcode: 'data_itemoflist', kind: 'reporter', allowStage: true,
        arguments: [listInput(), indexInput()],
        documentation: 'list_item(list, index) — retorna o item na posição indicada; aceita número, "last" ou "random".'
    }),
    list_index: Object.freeze({
        opcode: 'data_itemnumoflist', kind: 'reporter', allowStage: true,
        arguments: [listInput(), valueInput('value', 'ITEM')],
        documentation: 'list_index(list, value) — retorna a primeira posição do valor ou 0.'
    }),
    list_length: Object.freeze({
        opcode: 'data_lengthoflist', kind: 'reporter', allowStage: true,
        arguments: [listInput()], documentation: 'list_length(list) — retorna a quantidade de itens.'
    }),
    list_contains: Object.freeze({
        opcode: 'data_listcontainsitem', kind: 'boolean', allowStage: true,
        arguments: [listInput(), valueInput('value', 'ITEM')],
        documentation: 'list_contains(list, value) — informa se a lista contém o valor.'
    })
});

const operatorRegistry = Object.freeze({
    '+': Object.freeze({opcode: 'operator_add', kind: 'reporter', arguments: [numberInput('left', 'NUM1'), numberInput('right', 'NUM2')]}),
    '-': Object.freeze({opcode: 'operator_subtract', kind: 'reporter', arguments: [numberInput('left', 'NUM1'), numberInput('right', 'NUM2')]}),
    '*': Object.freeze({opcode: 'operator_multiply', kind: 'reporter', arguments: [numberInput('left', 'NUM1'), numberInput('right', 'NUM2')]}),
    '/': Object.freeze({opcode: 'operator_divide', kind: 'reporter', arguments: [numberInput('left', 'NUM1'), numberInput('right', 'NUM2')]}),
    '%': Object.freeze({opcode: 'operator_mod', kind: 'reporter', arguments: [numberInput('left', 'NUM1'), numberInput('right', 'NUM2')]}),
    '<': Object.freeze({opcode: 'operator_lt', kind: 'boolean', arguments: [valueInput('left', 'OPERAND1'), valueInput('right', 'OPERAND2')]}),
    '==': Object.freeze({opcode: 'operator_equals', kind: 'boolean', arguments: [valueInput('left', 'OPERAND1'), valueInput('right', 'OPERAND2')]}),
    '>': Object.freeze({opcode: 'operator_gt', kind: 'boolean', arguments: [valueInput('left', 'OPERAND1'), valueInput('right', 'OPERAND2')]}),
    and: Object.freeze({opcode: 'operator_and', kind: 'boolean', arguments: [valueInput('left', 'OPERAND1'), valueInput('right', 'OPERAND2')]}),
    or: Object.freeze({opcode: 'operator_or', kind: 'boolean', arguments: [valueInput('left', 'OPERAND1'), valueInput('right', 'OPERAND2')]}),
    not: Object.freeze({opcode: 'operator_not', kind: 'boolean', arguments: [valueInput('value', 'OPERAND')]})
});

const controlRegistry = Object.freeze({
    repeat: Object.freeze({
        opcode: 'control_repeat', argumentInput: 'TIMES', substack: 'SUBSTACK',
        documentation: 'repeat(times): — repete o corpo.'
    }),
    forever: Object.freeze({
        opcode: 'control_forever', substack: 'SUBSTACK', documentation: 'forever: — repete para sempre.'
    }),
    if: Object.freeze({
        opcode: 'control_if', argumentInput: 'CONDITION', substack: 'SUBSTACK',
        documentation: 'if condition: — executa o corpo quando a condição é verdadeira.'
    }),
    if_else: Object.freeze({
        opcode: 'control_if_else', argumentInput: 'CONDITION', substack: 'SUBSTACK', alternateSubstack: 'SUBSTACK2',
        documentation: 'if condition: … else: — escolhe exatamente um dos dois corpos.'
    }),
    repeat_until: Object.freeze({
        opcode: 'control_repeat_until', argumentInput: 'CONDITION', substack: 'SUBSTACK',
        documentation: 'repeat_until(condition): — repete até a condição ser verdadeira.'
    }),
    while: Object.freeze({
        opcode: 'control_while', argumentInput: 'CONDITION', substack: 'SUBSTACK',
        documentation: 'while(condition): — executa o bloco legado enquanto a condição for verdadeira.'
    })
});

const eventRegistry = Object.freeze({
    green_flag: Object.freeze({
        opcode: 'event_whenflagclicked', arguments: [],
        documentation: 'on green_flag: — inicia quando a bandeira verde é acionada.'
    }),
    clicked: Object.freeze({
        opcode: 'event_whenthisspriteclicked', stageOpcode: 'event_whenstageclicked', arguments: [],
        documentation: 'on clicked: — inicia ao clicar no ator ou no palco atual.'
    }),
    key_pressed: Object.freeze({
        opcode: 'event_whenkeypressed', arguments: [Object.freeze({name: 'key', role: 'field', field: 'KEY_OPTION'})],
        documentation: 'on key_pressed(key): — inicia quando a tecla indicada é pressionada.'
    }),
    receive: Object.freeze({
        opcode: 'event_whenbroadcastreceived', arguments: [Object.freeze({name: 'message', role: 'broadcast-field', field: 'BROADCAST_OPTION'})],
        documentation: 'on receive(message): — inicia ao receber a transmissão indicada.'
    }),
    backdrop_switches: Object.freeze({
        opcode: 'event_whenbackdropswitchesto', arguments: [Object.freeze({name: 'backdrop', role: 'field', field: 'BACKDROP'})],
        documentation: 'on backdrop_switches(backdrop): — inicia quando o cenário indicado se torna ativo.'
    }),
    loudness_greater_than: Object.freeze({
        opcode: 'event_whengreaterthan', arguments: [numberInput('value', 'VALUE')],
        staticFields: {WHENGREATERTHANMENU: 'LOUDNESS'},
        documentation: 'on loudness_greater_than(value): — inicia quando o volume do microfone ultrapassa value.'
    }),
    timer_greater_than: Object.freeze({
        opcode: 'event_whengreaterthan', arguments: [numberInput('value', 'VALUE')],
        staticFields: {WHENGREATERTHANMENU: 'TIMER'},
        documentation: 'on timer_greater_than(value): — inicia quando o cronômetro ultrapassa value.'
    }),
    clone_started: Object.freeze({
        opcode: 'control_start_as_clone', arguments: [], allowStage: false,
        documentation: 'on clone_started: — inicia no instante em que este clone é criado.'
    }),
    touching_object: Object.freeze({
        opcode: 'event_whentouchingobject', allowStage: false,
        arguments: [menuInput('object', 'TOUCHINGOBJECTMENU', 'event_touchingobjectmenu', 'TOUCHINGOBJECTMENU', '_edge_')],
        documentation: 'on touching_object(object): — inicia quando o ator começa a tocar um objeto.'
    })
});

module.exports = {
    blockRegistry,
    booleanInput,
    colorInput,
    controlRegistry,
    eventRegistry,
    fieldInput,
    indexInput,
    listInput,
    menuInput,
    numberInput,
    operatorRegistry,
    textInput,
    valueInput,
    variableInput
};
