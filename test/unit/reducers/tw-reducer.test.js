import reducer, {
    requestTextwarpUiCommand,
    setTextwarpUiOperation,
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

    test('shares file-operation busy and result feedback with the File menu', () => {
        const workingState = reducer(
            twInitialState,
            setTextwarpUiOperation(TEXTWARP_UI_COMMANDS.OPEN, 'working', 'Opening…')
        );
        const resultState = reducer(
            workingState,
            setTextwarpUiOperation(TEXTWARP_UI_COMMANDS.OPEN, 'success', 'Opened.')
        );

        expect(workingState.textwarpUiOperation).toEqual({
            command: TEXTWARP_UI_COMMANDS.OPEN,
            message: 'Opening…',
            state: 'working'
        });
        expect(resultState.textwarpUiOperation).toEqual({
            command: TEXTWARP_UI_COMMANDS.OPEN,
            message: 'Opened.',
            state: 'success'
        });
    });
});
