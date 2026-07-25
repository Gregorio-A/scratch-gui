# Complete TextWarp block reference

This reference groups the canonical text forms used by Scratch/TurboWarp primitives. Function names remain the
same in every UI language so projects are portable.

## Native calls

### Motion

```textwarp
move(steps)
turn_right(degrees)
turn_left(degrees)
go_to(x, y)
go_to_target(target)
glide_to(seconds, x, y)
glide_to_target(seconds, target)
point_in_direction(direction)
point_towards(target)
change_x(amount)
set_x(value)
change_y(amount)
set_y(value)
if_on_edge_bounce()
set_rotation_style(style)
```

These forms cover `motion_movesteps`, turns, position, glide, direction, edge bounce and rotation style.

### Looks

```textwarp
say(message)
say_for(message, seconds)
think(message)
think_for(message, seconds)
show()
hide()
switch_costume(costume)
next_costume()
switch_backdrop(backdrop)
next_backdrop()
change_size(amount)
set_size(value)
change_effect(effect, amount)
set_effect(effect, value)
clear_graphic_effects()
go_to_front_back(layer)
go_forward_backward_layers(direction, amount)
```

Reporters include costume/backdrop number or name and current size.

### Sound

```textwarp
play_sound(sound)
play_sound_until_done(sound)
stop_all_sounds()
change_sound_effect(effect, amount)
set_sound_effect(effect, value)
clear_sound_effects()
change_volume(amount)
set_volume(value)
```

Music extension blocks receive names from their extension catalog.

### Events and broadcasts

```textwarp
broadcast(message)
broadcast_and_wait(message)

on green_flag:
on key_pressed(key):
on this_sprite_clicked:
on stage_clicked:
on backdrop_switches_to(backdrop):
on greater_than(sensor, value):
on receive(message):
```

These forms cover the native `event_*` hats and broadcast commands.

### Control

```textwarp
wait(seconds)
stop(option)
create_clone(target)
delete_this_clone()
wait_until(condition)
repeat_until(condition):
repeat(count):
forever:
if condition:
else:
```

`control_start_as_clone`, `control_while`, `control_for_each`, `control_all_at_once` and extension conditional
mutations are also represented by structured forms and generated metadata.

### Sensing

```textwarp
touching(target)
touching_color(color)
color_touching_color(first, second)
distance_to(target)
ask_and_wait(question)
key_pressed(key)
mouse_down()
set_drag_mode(mode)
reset_timer()
of(property, target)
current(part)
days_since_2000()
username()
logged_in()
```

Reporters such as answer, mouse position, loudness and timer use their canonical catalog names.

### Operators as functions

```textwarp
pick_random(from, to)
join(first, second)
letter_of(index, text)
length(text)
contains(text, search)
mod(left, right)
round(value)
math_op(operation, value)
```

Infix syntax also represents `operator_add`, `operator_subtract`, `operator_multiply`, `operator_divide`,
`operator_equals`, `operator_lt`, `operator_gt`, `operator_and`, `operator_or` and `operator_not`.

### Data

```textwarp
variable score = 0
global variable score = 0
list items = []
global list items = []

score = 10
score += 1
score -= 1
list_add(items, value)
list_delete(items, index)
list_delete_all(items)
list_insert(items, index, value)
list_replace(items, index, value)
show_variable(score)
hide_variable(score)
show_list(items)
hide_list(items)
```

Variable and list reporters compile to `data_variable`, `data_listcontents`, `data_itemoflist`,
`data_itemnumoflist`, `data_lengthoflist` and `data_listcontainsitem`.

## Structural controls

Indented bodies are used for `control_repeat`, `control_forever`, `control_if`, `control_if_else`,
`control_repeat_until`, extension loops and extension conditionals. `pass` represents an intentionally empty
body.

## Events

Every executable hat is represented by `on ...:`. Dynamic extension hats use
`on extensionId.opcode(arguments):`.

## Operators

Arithmetic, comparison and boolean operators preserve Scratch coercion rules. Parentheses can make evaluation
order explicit.

## Data and procedure-specific syntax

```textwarp
procedure command_name(value: any):
    pass

procedure reporter_name(value: number) -> number:
    return value
```

Procedure prototypes, argument reporters, internal return blocks and visual parameter editors are generated
components; they are not standalone source statements.

## Shadows and menus that are not standalone instructions

Number, angle, color, note, costume, sound, broadcast, clone and list-index shadows are serialized as arguments
of their owning block. Menu opcodes and internal procedure prototypes therefore do not appear as isolated calls.

## Extensions

For a loaded extension:

```textwarp
extensionId.command(argument)
value = extensionId.reporter(argument)
if extensionId.boolean(argument):
    pass
on extensionId.hat(argument):
    pass
```

Buttons, labels, separators and XML palette entries remain visible in the extension panel but are not executable
language syntax.

## Coverage guarantee

The TextWarp coverage tests enumerate VM primitives, native block definitions, shadows, menus, procedure
components and loaded extension block kinds. Native executable blocks must compile, decompile without unsafe raw
syntax and recompile to the same opcode.
