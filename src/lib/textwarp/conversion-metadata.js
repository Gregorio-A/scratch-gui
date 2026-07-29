'use strict';

const DIRECTIVE_MARKER = '@textwarp:';

const encodeConversionMetadata = value => {
    if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return '';
    return ` # ${DIRECTIVE_MARKER}${encodeURIComponent(JSON.stringify(value))}`;
};

const decodeConversionMetadata = rawLine => {
    const match = String(rawLine || '').match(/#\s*@textwarp:([^\s]+)/);
    if (!match) return {};
    try {
        const value = JSON.parse(decodeURIComponent(match[1]));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
        return {};
    }
};

module.exports = {
    DIRECTIVE_MARKER,
    decodeConversionMetadata,
    encodeConversionMetadata
};
