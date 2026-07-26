import reducer, {
    requestTextwarpUiCommand,
    TEXTWARP_UI_COMMANDS,
    twInitialState
} from '../../../src/reducers/tw';

describe('TextWarp UI commands', () => {
    test('keeps repeated menu commands observable by the editor', () => {
        const firstState = reducer(
            twInitialState,
            requestTextwarpUiCommand(TEXTWARP_UI_COMMANDS.SAVE)
        );
        const secondState = reducer(
            firstState,
            requestTextwarpUiCommand(TEXTWARP_UI_COMMANDS.SAVE)
        );

        expect(firstState.textwarpUiCommand).toEqual({
            id: 1,
            name: TEXTWARP_UI_COMMANDS.SAVE
        });
        expect(secondState.textwarpUiCommand).toEqual({
            id: 2,
            name: TEXTWARP_UI_COMMANDS.SAVE
        });
    });
});
