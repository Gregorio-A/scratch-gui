'use strict';

const ARGUMENT_TYPES_KEY = 'textwarp_argument_types';
const RETURN_TYPE_KEY = 'textwarp_return_type';
const TYPE_METADATA_VERSION_KEY = 'textwarp_type_metadata';
const TYPE_METADATA_VERSION = '1';
const VALUE_TYPES = new Set(['any', 'number', 'string', 'boolean']);
const TYPE_ID_SUFFIX = '_twtype_';

const normalizeType = (value, fallback = 'any') => VALUE_TYPES.has(value) ? value : fallback;

const encodeProcedureTypes = (mutation, procedure, includeReturn = true) => {
    mutation[TYPE_METADATA_VERSION_KEY] = TYPE_METADATA_VERSION;
    mutation[ARGUMENT_TYPES_KEY] = JSON.stringify((procedure.parameters || []).map(parameter =>
        normalizeType(parameter.valueType)
    ));
    if (includeReturn && procedure.returnType) {
        mutation[RETURN_TYPE_KEY] = normalizeType(procedure.returnType);
    }
    return mutation;
};

const decodeArgumentTypes = (mutation, fallbackTypes = []) => {
    if (!mutation || typeof mutation[ARGUMENT_TYPES_KEY] !== 'string') return fallbackTypes.slice();
    try {
        const parsed = JSON.parse(mutation[ARGUMENT_TYPES_KEY]);
        if (!Array.isArray(parsed)) return fallbackTypes.slice();
        const length = Math.max(parsed.length, fallbackTypes.length);
        return Array.from({length}, (_, index) => normalizeType(parsed[index], fallbackTypes[index] || 'any'));
    } catch (error) {
        return fallbackTypes.slice();
    }
};

const decodeReturnType = mutation => {
    if (!mutation || !Object.prototype.hasOwnProperty.call(mutation, RETURN_TYPE_KEY)) return null;
    return normalizeType(mutation[RETURN_TYPE_KEY], null);
};

const encodeParameterId = (id, valueType) => `${id}${TYPE_ID_SUFFIX}${normalizeType(valueType)}`;

const decodeParameterIdType = id => {
    const match = String(id || '').match(/_twtype_(any|number|string|boolean)$/);
    return match ? match[1] : null;
};

module.exports = {
    ARGUMENT_TYPES_KEY,
    RETURN_TYPE_KEY,
    TYPE_METADATA_VERSION_KEY,
    decodeArgumentTypes,
    decodeParameterIdType,
    decodeReturnType,
    encodeParameterId,
    encodeProcedureTypes
};
