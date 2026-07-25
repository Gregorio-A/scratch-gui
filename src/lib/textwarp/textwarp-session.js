'use strict';

// The Scratch GUI owns an SB3 file handle. TextWarp keeps its editable source
// package in a separate session so saving one format can never overwrite the
// other by accident.
let textwarpHandle = null;
let suggestedName = 'project.textwarp';

const normalizeName = name => {
    const value = String(name || 'project.textwarp');
    return value.toLowerCase().endsWith('.textwarp') ? value : `${value}.textwarp`;
};

const setTextwarpHandle = (handle, name = null) => {
    textwarpHandle = handle || null;
    suggestedName = normalizeName(name || handle && handle.name || suggestedName);
    return textwarpHandle;
};

const clearTextwarpHandle = (name = 'project.textwarp') => {
    textwarpHandle = null;
    suggestedName = normalizeName(name);
};

const getTextwarpHandle = () => textwarpHandle;
const getTextwarpSuggestedName = () => suggestedName;

module.exports = {
    clearTextwarpHandle,
    getTextwarpHandle,
    getTextwarpSuggestedName,
    setTextwarpHandle
};
