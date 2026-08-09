'use strict';

const ENGLISH_MESSAGES = Object.freeze({
    'actor-name-mismatch': 'The actor declaration does not match the selected actor.',
    'conversion-depth-limit': 'The source exceeds the safe nesting or complexity limit.',
    'conversion-internal-error': 'Compilation failed in a controlled way.',
    'command-not-allowed-on-sprite': 'This command is not available for actors.',
    'command-not-allowed-on-stage': 'This command is not available for the stage.',
    'command-used-as-expression': 'A command cannot be used where a value is required.',
    'duplicate-branch': 'The same extension branch was declared more than once.',
    'duplicate-named-argument': 'The same named argument was supplied more than once.',
    'duplicate-parameter': 'The same procedure parameter was declared more than once.',
    'duplicate-procedure': 'The same procedure was declared more than once.',
    'duplicate-variable': 'The same variable or list name was declared more than once.',
    'empty-block': 'This block is empty and will be preserved without commands.',
    'extension-branch-out-of-range': 'This branch exceeds the number supported by the extension block.',
    'extension-flow-requires-body': 'This extension flow block requires a nested body.',
    'expected-list-name': 'Expected a declared list name.',
    'expected-variable-name': 'Expected a declared variable name.',
    'field-requires-literal': 'This argument must be a constant number or string.',
    'global-declaration-outside-stage': 'Global resources must be declared in the stage module.',
    'indent-tabs': 'Use spaces for indentation; tabs are not allowed.',
    'invalid-arity': 'The function received the wrong number of arguments.',
    'invalid-branch-index': 'Additional extension branches start at branch 2.',
    'invalid-event': 'Expected a valid event after the on keyword.',
    'invalid-expression': 'Expected a value, variable, or function call.',
    'invalid-expression-character': 'The expression contains an unexpected character.',
    'invalid-indent': 'Invalid indentation. Use blocks of four spaces.',
    'invalid-list-initializer': 'A list declaration must use a list literal.',
    'invalid-named-argument': 'The function does not define this named argument.',
    'invalid-parameter': 'The procedure parameter declaration is invalid.',
    'invalid-procedure-argument-type': 'The procedure argument does not match the declared parameter type.',
    'invalid-procedure-arity': 'The procedure received the wrong number of arguments.',
    'invalid-procedure-modifiers': 'Procedure modifiers must use a return type and/or warp.',
    'invalid-procedure-named-argument': 'The procedure does not define this named argument.',
    'invalid-raw-payload': 'The compatibility payload is invalid.',
    'invalid-return-type': 'The returned value does not match the procedure return type.',
    'invalid-statement': 'Expected an assignment, control statement, or function call.',
    'invalid-string': 'Expected a valid string value.',
    'invalid-symbol-type': 'This project symbol has an incompatible type.',
    'list-literal-in-expression': 'List literals can only be used in declarations.',
    'missing-call-parenthesis': 'Expected ")" after the function arguments.',
    'missing-list-bracket': 'Expected "]" to close the list.',
    'missing-parenthesis': 'Expected ")" to close the expression.',
    'missing-project-resource': 'The referenced project resource does not exist.',
    'non-constant-list-item': 'Initial list items must be constant values.',
    'non-constant-variable-initializer': 'The initial variable value must be constant.',
    'non-flow-block-with-body': 'This block cannot own nested branches.',
    'positional-after-named': 'Positional arguments must come before named arguments.',
    'procedure-reporter-used-as-command': 'A value-returning procedure must be used in an expression.',
    'procedure-used-as-expression': 'This procedure does not return a value.',
    'raw-primitive-unavailable': 'This compatibility primitive is not available in the current runtime.',
    'reporter-used-as-command': 'A reporter block must be used in an expression.',
    'return-in-command-procedure': 'A command procedure cannot return a value.',
    'return-outside-procedure': 'Return can only be used inside a procedure.',
    'scratch-coercion': 'The argument type differs from the declared Scratch input type.',
    'target-kind-mismatch': 'The module declaration does not match the selected stage or actor.',
    'top-level-indent': 'Declarations, events, and procedures must start without indentation.',
    'turbowarp-only-return-procedure': 'Reporter procedures require TurboWarp and are not compatible with Scratch.',
    'unknown-call': 'This function does not exist in the loaded semantic registry.',
    'unknown-event': 'This event does not exist in the loaded semantic registry.',
    'unknown-operator': 'This operator is not supported.',
    'unknown-top-level': 'Unknown top-level declaration.',
    'unknown-variable': 'This variable or list has not been declared.',
    'unsupported-expression': 'This expression is not supported.',
    'unsupported-node': 'This statement is not supported.',
    'unterminated-string': 'Unterminated string.'
});

const localizeDiagnostic = (diagnostic, codeLanguage) => {
    const id = diagnostic.id || `diagnostic.${diagnostic.code || 'unknown'}`;
    const defaultMessage = diagnostic.defaultMessage || diagnostic.message || '';
    return Object.assign({}, diagnostic, {
        id,
        values: diagnostic.values || {},
        defaultMessage,
        message: codeLanguage === 'en-US' && ENGLISH_MESSAGES[diagnostic.code] || defaultMessage
    });
};

const localizeDiagnostics = (diagnostics, codeLanguage) =>
    (diagnostics || []).map(diagnostic => localizeDiagnostic(diagnostic, codeLanguage));

module.exports = {ENGLISH_MESSAGES, localizeDiagnostic, localizeDiagnostics};
