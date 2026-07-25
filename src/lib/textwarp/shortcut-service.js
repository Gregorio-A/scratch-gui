'use strict';

const KEY_ALIASES = Object.freeze({
    backspace: 'Backspace',
    delete: 'Delete',
    down: 'DownArrow',
    end: 'End',
    enter: 'Enter',
    escape: 'Escape',
    home: 'Home',
    insert: 'Insert',
    left: 'LeftArrow',
    pagedown: 'PageDown',
    pageup: 'PageUp',
    pause: 'PauseBreak',
    right: 'RightArrow',
    space: 'Space',
    tab: 'Tab',
    up: 'UpArrow',
    ';': 'Semicolon',
    semicolon: 'Semicolon',
    '+': 'Equal',
    plus: 'Equal',
    '=': 'Equal',
    equal: 'Equal',
    ',': 'Comma',
    comma: 'Comma',
    '-': 'Minus',
    minus: 'Minus',
    '.': 'Period',
    period: 'Period',
    '/': 'Slash',
    slash: 'Slash',
    '`': 'Backquote',
    backquote: 'Backquote',
    '[': 'BracketLeft',
    bracketleft: 'BracketLeft',
    '\\': 'Backslash',
    backslash: 'Backslash',
    ']': 'BracketRight',
    bracketright: 'BracketRight',
    "'": 'Quote',
    quote: 'Quote'
});

const shortcutParts = value => {
    let source = String(value || '').trim().toLowerCase();
    if (source.endsWith('++')) source = `${source.slice(0, -1)}plus`;
    return source.split('+').map(part => part.trim()).filter(Boolean);
};

const parseKeybinding = (monaco, value, fallback, onInvalid) => {
    const parts = shortcutParts(value);
    let binding = 0;
    let keyCount = 0;
    let invalid = parts.length === 0;
    parts.forEach(part => {
        if (['ctrl', 'cmd', 'command', 'meta', 'mod', 'ctrlcmd'].includes(part)) {
            binding |= monaco.KeyMod.CtrlCmd;
        } else if (part === 'shift') {
            binding |= monaco.KeyMod.Shift;
        } else if (part === 'alt' || part === 'option') {
            binding |= monaco.KeyMod.Alt;
        } else {
            const keyName = /^[a-z]$/.test(part) ? `Key${part.toUpperCase()}` :
                /^[0-9]$/.test(part) ? `Digit${part}` :
                    /^f(?:[1-9]|1[0-9]|2[0-4])$/.test(part) ? part.toUpperCase() :
                        KEY_ALIASES[part];
            const keyCode = keyName && monaco.KeyCode[keyName];
            if (keyCount || !keyCode) invalid = true;
            else {
                binding |= keyCode;
                keyCount++;
            }
        }
    });
    if (!keyCount) invalid = true;
    if (invalid && value) {
        if (typeof console !== 'undefined') {
            console.warn(`Invalid TextWarp shortcut "${value}"; using the default binding.`);
        }
        if (onInvalid) onInvalid(value);
    }
    return invalid ? fallback : binding;
};

module.exports = {
    KEY_ALIASES,
    parseKeybinding,
    shortcutParts
};
