'use strict';

const unitHashes = compilation => new Map(
    compilation && compilation.graph ? compilation.graph.units.map(unit => [unit.unitId, unit.hash]) : []
);

const declarationSignature = compilation => JSON.stringify(
    compilation && compilation.graph ? compilation.graph.declarations.map(declaration => ({
        id: declaration.id,
        name: declaration.name,
        owner: declaration.owner,
        variableType: declaration.variableType
    })) : []
);

const unitRanges = (source, compilation) => {
    const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    const ranges = new Map();
    if (!compilation || !compilation.graph) return {lines, ranges};
    compilation.graph.units.forEach(unit => {
        const location = compilation.graph.sourceMap[unit.rootId];
        if (!location || !Number.isInteger(location.startLine)) return;
        const start = location.startLine - 1;
        let end = start;
        for (let index = start + 1; index < lines.length; index++) {
            const line = lines[index];
            const trimmed = line.trim();
            if (!trimmed) continue;
            const indent = line.match(/^[ \t]*/)[0].length;
            if (indent === 0) break;
            end = index;
        }
        ranges.set(unit.unitId, {start, end, text: lines.slice(start, end + 1).join('\n')});
    });
    return {lines, ranges};
};

const appendUnit = (source, unitText) => {
    const base = String(source).replace(/\s+$/, '');
    return `${base}${base ? '\n\n' : ''}${unitText.replace(/^\s+|\s+$/g, '')}`;
};

const patchUnits = (destinationSource, destinationCompilation, sourceSource, sourceCompilation, unitIds) => {
    const destinationParts = unitRanges(destinationSource, destinationCompilation);
    const sourceParts = unitRanges(sourceSource, sourceCompilation);
    const replacements = [];
    const additions = [];
    unitIds.forEach(unitId => {
        const destinationRange = destinationParts.ranges.get(unitId);
        const sourceRange = sourceParts.ranges.get(unitId);
        if (destinationRange) {
            replacements.push({
                start: destinationRange.start,
                end: destinationRange.end,
                lines: sourceRange ? sourceRange.text.split('\n') : []
            });
        } else if (sourceRange) {
            additions.push(sourceRange.text);
        }
    });
    const mergedLines = destinationParts.lines.slice();
    replacements.sort((left, right) => right.start - left.start).forEach(replacement => {
        mergedLines.splice(replacement.start, replacement.end - replacement.start + 1, ...replacement.lines);
    });
    let source = mergedLines.join('\n');
    additions.forEach(unitText => { source = appendUnit(source, unitText); });
    return source;
};

/**
 * Three-way semantic merge for the editable source and a Blockly decompilation.
 * Units changed only in Blockly are patched into the user's source. Formatting,
 * comments and ordering outside those units remain unchanged.
 */
const mergeVisualSource = options => {
    const {
        textSource,
        visualSource,
        baseCompilation,
        textCompilation,
        visualCompilation
    } = options;
    if (!baseCompilation || !baseCompilation.success || !textCompilation || !textCompilation.success ||
        !visualCompilation || !visualCompilation.success) {
        return {source: null, conflicts: ['module'], mergedUnits: [], canonicalFallback: false};
    }

    const baseDeclarations = declarationSignature(baseCompilation);
    const textDeclarations = declarationSignature(textCompilation);
    const visualDeclarations = declarationSignature(visualCompilation);
    const textDeclarationsChanged = textDeclarations !== baseDeclarations;
    const visualDeclarationsChanged = visualDeclarations !== baseDeclarations;
    if (visualDeclarationsChanged && textDeclarationsChanged && textDeclarations !== visualDeclarations) {
        return {source: null, conflicts: ['declarations'], mergedUnits: [], canonicalFallback: false};
    }

    const base = unitHashes(baseCompilation);
    const text = unitHashes(textCompilation);
    const visual = unitHashes(visualCompilation);
    const allUnitIds = new Set([...base.keys(), ...text.keys(), ...visual.keys()]);
    const conflicts = [];
    const visualOnly = [];
    const textOnly = [];
    allUnitIds.forEach(unitId => {
        const baseHash = base.get(unitId);
        const textHash = text.get(unitId);
        const visualHash = visual.get(unitId);
        const textChanged = textHash !== baseHash;
        const visualChanged = visualHash !== baseHash;
        if (textChanged && visualChanged && textHash !== visualHash) conflicts.push(unitId);
        else if (visualChanged && !textChanged) visualOnly.push(unitId);
        else if (textChanged && !visualChanged) textOnly.push(unitId);
    });
    if (conflicts.length) return {source: null, conflicts, mergedUnits: [], canonicalFallback: false};

    // Variable declarations do not carry block IDs/source locations. If they
    // changed visually, begin with the canonical visual module and bring over
    // independent text units. Otherwise, patch visual units into the user's
    // formatting-preserving text module.
    const canonicalFallback = visualDeclarationsChanged;
    const source = canonicalFallback ?
        patchUnits(visualSource, visualCompilation, textSource, textCompilation, textOnly) :
        patchUnits(textSource, textCompilation, visualSource, visualCompilation, visualOnly);
    return {source, conflicts: [], mergedUnits: visualOnly, canonicalFallback};
};

module.exports = {
    mergeVisualSource,
    unitRanges
};
