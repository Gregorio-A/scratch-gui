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
    'tw.menuBar.fullScreen': 'Visualização do jogo em tela cheia',
    'tw.menuBar.textwarpPreferences': 'Preferências do TextWarp',
    'tw.projectContext.open': 'Idiomas do projeto',
    'tw.projectContext.interfaceLanguage': 'Interface do editor',
    'tw.projectContext.syntaxLanguage': 'Sintaxe do TextWarp',
    'tw.projectContext.languageHelp': 'A interface altera os rótulos. A sintaxe converte os comandos de todos ' +
        'os arquivos TextWarp.',
    'tw.spriteInfo.appearance': 'Aparência',
    'tw.spriteInfo.position': 'Posição',
    'tw.stageDock.show': 'Mostrar palco',
    'tw.stageHeader.compact': 'Compacta',
    'tw.stageHeader.expanded': 'Palco ampliado',
    'tw.stageHeader.normal': 'Normal',
    'tw.stageHeader.view': 'Visualização',
    'tw.targetPane.actors': 'Atores',
    'tw.targetPane.backdrops': 'Cenários',
    'tw.targetPane.targets': 'Alvos',
    'tw.targetPane.inspector': 'Inspetor',
    'tw.targetPane.stageAndBackdrops': 'Palco e cenários',
    'tw.targetPane.addActor': 'Adicionar ator',
    'tw.targetPane.addBackdrop': 'Adicionar cenário',
    'tw.targetPane.backdropCount': '{count, plural, one {# cenário} other {# cenários}}',
    'tw.layout.controls': 'Controles de layout',
    'tw.layout.toggleActivityBar': 'Mostrar ou esconder barra de atividades',
    'tw.layout.toggleLeftSidebar': 'Mostrar ou esconder lateral esquerda',
    'tw.layout.toggleBottomPanel': 'Mostrar ou esconder painel inferior',
    'tw.layout.toggleRightSidebar': 'Mostrar ou esconder lateral direita',
    'tw.workspace.files': 'Arquivos',
    'tw.workspace.commands': 'Comandos',
    'tw.workspace.actors': 'Atores',
    'tw.workspace.extensions': 'Extensões',
    'tw.workspace.outline': 'Estrutura',
    'tw.workspace.history': 'Histórico',
    'tw.workspace.documentation': 'Documentação',
    'tw.workspace.debugger': 'Depuração',
    'tw.workspace.search': 'Buscar',
    'tw.workspace.settings': 'Configurações'
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
