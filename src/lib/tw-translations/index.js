import twTranslations from './generated-translations.json';

const textwarpPortuguese = {
    'gui.controls.go': 'Executar',
    'gui.controls.stop': 'Parar',
    'gui.menuBar.modeMenu': 'Visualização',
    'tw.controls.pause': 'Pausar',
    'tw.controls.restart': 'Reiniciar',
    'tw.controls.resume': 'Continuar',
    'tw.controls.run': 'Executar',
    'tw.gui.programmingTab': 'Programação',
    'tw.menuBar.aboutTextwarp': 'Sobre o TextWarp',
    'tw.menuBar.documentation': 'Documentação',
    'tw.menuBar.extensions': 'Extensões e addons',
    'tw.menuBar.help': 'Ajuda',
    'tw.menuBar.openProjectPage': 'Abrir página do projeto',
    'tw.menuBar.project': 'Projeto',
    'tw.menuBar.sendFeedback': 'Enviar feedback',
    'tw.menuBar.textwarpPreferences': 'Preferências do TextWarp',
    'tw.spriteInfo.appearance': 'Aparência',
    'tw.spriteInfo.position': 'Posição',
    'tw.stageDock.show': 'Mostrar palco',
    'tw.stageHeader.compact': 'Compacta',
    'tw.stageHeader.expanded': 'Palco ampliado',
    'tw.stageHeader.normal': 'Normal',
    'tw.stageHeader.view': 'Visualização',
    'tw.targetPane.actors': 'Atores',
    'tw.targetPane.backdrops': 'Cenários'
};

const addAdditionalTranslations = editorMessages => {
    for (const locale of Object.keys(editorMessages)) {
        const toMixIn = twTranslations[locale.toLowerCase()];
        if (toMixIn) {
            Object.assign(editorMessages[locale], toMixIn);
        }
    }

    for (const locale of ['pt', 'pt-br']) {
        if (editorMessages[locale]) Object.assign(editorMessages[locale], textwarpPortuguese);
    }

    // We reuse our `es` translations for `es-419` instead of maintaining separate translations.
    Object.assign(editorMessages['es-419'], twTranslations.es);
};

export default addAdditionalTranslations;
