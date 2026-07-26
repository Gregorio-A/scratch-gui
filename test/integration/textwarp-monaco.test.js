import fs from 'fs';
import http from 'http';
import path from 'path';
import chromedriver from 'chromedriver';
import webdriver from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';

import SeleniumHelper from '../helpers/selenium-helper';

const {By, until} = webdriver;
const {
    getDriver,
    Key
} = new SeleniumHelper();

const buildRoot = path.resolve(__dirname, '../../build');
const driverExecutable = process.env.CHROMEDRIVER_PATH ||
    (fs.existsSync(chromedriver.path) ? chromedriver.path : '/usr/bin/chromedriver');
const interfaceLayoutBaseline = require('../fixtures/textwarp-interface-layout-baseline.json');

let driver;
let server;
let uri;

describe('TextWarp Monaco editor', () => {
    beforeAll(async () => {
        server = http.createServer((request, response) => {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            if (!pathname.startsWith('/textwarp/')) {
                response.writeHead(404).end();
                return;
            }
            const relativePath = pathname.slice('/textwarp/'.length) || 'index.html';
            const filePath = path.resolve(buildRoot, relativePath);
            if (!filePath.startsWith(`${buildRoot}${path.sep}`)) {
                response.writeHead(403).end();
                return;
            }
            fs.readFile(filePath, (error, contents) => {
                if (error) {
                    response.writeHead(404).end();
                    return;
                }
                const contentTypes = {
                    '.css': 'text/css',
                    '.html': 'text/html',
                    '.js': 'application/javascript',
                    '.json': 'application/json',
                    '.svg': 'image/svg+xml',
                    '.wasm': 'application/wasm'
                };
                response.writeHead(200, {
                    'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream'
                });
                response.end(contents);
            });
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        uri = `http://127.0.0.1:${server.address().port}/textwarp/`;
        chrome.setDefaultService(new chrome.ServiceBuilder(driverExecutable).build());
        driver = getDriver();
    });

    afterAll(async () => {
        if (driver) await driver.quit();
        if (server) await new Promise(resolve => server.close(resolve));
    });

    test('loads the production Monaco asset and offers real completions', async () => {
        await driver.get(uri);
        await driver.manage()
            .window()
            .setSize(1024, 768);
        const input = await driver.wait(
            until.elementLocated(By.css(
                '.monaco-editor .native-edit-context[role="textbox"]'
            )),
            20000
        );
        await driver.wait(() => driver.executeScript(
            'return Boolean(window.monaco && window.monaco.editor.getModels().length);'
        ), 20000);
        const modelUris = await driver.executeScript(
            'return window.monaco.editor.getModels().map(function (model) { return model.uri.toString(); });'
        );
        expect(modelUris.some(modelUri =>
            /^inmemory:\/\/textwarp\/primary%3A.+\/.+\.tw$/.test(modelUri)
        )).toBe(true);

        const cmdCtrl = process.platform.includes('darwin') ? Key.COMMAND : Key.CONTROL;
        await driver.executeScript('arguments[0].focus();', input);
        await input.sendKeys(Key.chord(cmdCtrl, 'a'));
        await input.sendKeys('stage\n\non green_flag:\n    wa');
        await driver.wait(() => driver.executeScript(
            'return window.monaco.editor.getModels().some(function (model) {' +
            'return model.getValue().indexOf("on green_flag:") !== -1 && /\\bwa$/.test(model.getValue());' +
            '});'
        ), 10000);
        await input.sendKeys(Key.chord(cmdCtrl, Key.SPACE));
        const suggestions = await driver.wait(
            until.elementLocated(By.css('.suggest-widget.visible')),
            10000
        );
        await driver.wait(until.elementTextContains(suggestions, 'wait'), 10000);
    });

    test('matches the responsive interface layout and accessibility baseline', async () => {
        await driver.get(uri);
        await driver.manage()
            .window()
            .setSize(1440, 1000);
        await driver.wait(until.elementLocated(By.css('[data-tabs="textwarp"]')), 20000);

        for (const width of [320, 600, 768, 1024, 1440]) {
            const actual = await driver.executeAsyncScript(`
                const done = arguments[arguments.length - 1];
                const width = arguments[0];
                const root = document.querySelector('[data-tabs="textwarp"]');
                root.style.position = 'fixed';
                root.style.inset = '0 auto auto 0';
                root.style.zIndex = '9999';
                root.style.width = width + 'px';
                root.style.height = '900px';
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    const toolbar = root.querySelector('[role="toolbar"]');
                    const buttons = Array.from(toolbar.querySelectorAll('button'));
                    const columns = getComputedStyle(toolbar).gridTemplateColumns
                        .split(' ')
                        .filter(Boolean)
                        .length;
                    const rootRect = root.getBoundingClientRect();
                    done({
                        actionColumns: columns,
                        allPrimaryActionsVisible: buttons.length === 6 &&
                            buttons.every(button => button.getClientRects().length > 0),
                        minimumControlHeight: Math.min(...buttons.map(button =>
                            Math.round(button.getBoundingClientRect().height)
                        )),
                        rootHasHorizontalOverflow: root.scrollWidth > root.clientWidth + 1,
                        overflowingElements: Array.from(root.querySelectorAll('*'))
                            .filter(element => element.getBoundingClientRect().right > rootRect.right + 1)
                            .slice(0, 10)
                            .map(element => ({
                                className: String(element.className),
                                right: Math.round(element.getBoundingClientRect().right),
                                tagName: element.tagName
                            }))
                    });
                }));
            `, width);
            expect(actual.actionColumns).toBe(interfaceLayoutBaseline[width].actionColumns);
            expect(actual.allPrimaryActionsVisible).toBe(true);
            expect(actual.minimumControlHeight).toBeGreaterThanOrEqual(
                interfaceLayoutBaseline[width].minimumControlHeight
            );
            expect({
                overflowingElements: actual.rootHasHorizontalOverflow ? actual.overflowingElements : [],
                width
            }).toEqual({
                overflowingElements: [],
                width
            });
            const alternateLayouts = await driver.executeAsyncScript(`
                const done = arguments[arguments.length - 1];
                const root = document.querySelector('[data-tabs="textwarp"]');
                const projects = root.querySelector('[aria-controls="textwarp-projects-sidebar"]');
                const code = root.querySelector('#textwarp-view-tab-code');
                const dual = root.querySelector('#textwarp-view-tab-dual');
                const afterLayout = callback => requestAnimationFrame(() =>
                    requestAnimationFrame(callback)
                );
                projects.click();
                afterLayout(() => {
                    const withoutSidebarOverflow = root.scrollWidth > root.clientWidth + 1;
                    projects.click();
                    afterLayout(() => {
                        dual.click();
                        afterLayout(() => {
                            const dualEditorOverflow = root.scrollWidth > root.clientWidth + 1;
                            code.click();
                            afterLayout(() => done({dualEditorOverflow, withoutSidebarOverflow}));
                        });
                    });
                });
            `);
            expect(alternateLayouts).toEqual({
                dualEditorOverflow: false,
                withoutSidebarOverflow: false
            });
        }

        const projects = await driver.findElement(By.xpath(
            '//*[@data-tabs="textwarp"]//*[@role="toolbar"]//button[normalize-space()="Projects"]'
        ));
        await projects.click();
        expect(await projects.getAttribute('aria-expanded')).toBe('false');
        await projects.click();
        expect(await projects.getAttribute('aria-expanded')).toBe('true');
        await driver.executeAsyncScript(`
            const root = document.querySelector('[data-tabs="textwarp"]');
            const done = arguments[arguments.length - 1];
            root.style.width = '320px';
            requestAnimationFrame(() => requestAnimationFrame(done));
        `);
        await projects.click();
        await projects.click();
        await driver.wait(() => driver.executeScript(`
            const sidebar = document.querySelector('#textwarp-projects-sidebar');
            return sidebar && sidebar.contains(document.activeElement);
        `), 5000);
        expect(await driver.executeScript(`
            return document.querySelector('#textwarp-projects-sidebar').getAttribute('aria-modal');
        `)).toBe('true');
        await driver.actions()
            .sendKeys(Key.chord(Key.SHIFT, Key.TAB))
            .perform();
        expect(await driver.executeScript(`
            return document.querySelector('#textwarp-projects-sidebar').contains(document.activeElement);
        `)).toBe(true);
        await driver.actions()
            .sendKeys(Key.ESCAPE)
            .perform();
        expect(await projects.getAttribute('aria-expanded')).toBe('false');
        expect(await driver.switchTo().activeElement().getText()).toContain('Projects');
        await driver.executeAsyncScript(`
            const root = document.querySelector('[data-tabs="textwarp"]');
            const done = arguments[arguments.length - 1];
            root.style.width = '1440px';
            requestAnimationFrame(() => requestAnimationFrame(done));
        `);

        const templates = await driver.findElement(By.xpath(
            '//*[@data-tabs="textwarp"]//*[@role="toolbar"]//button[normalize-space()="Templates"]'
        ));
        await templates.click();
        const dialog = await driver.wait(
            until.elementLocated(By.css('#textwarp-templates-panel[role="dialog"]')),
            5000
        );
        expect(await dialog.getAttribute('aria-modal')).toBe('false');
        await driver.actions()
            .sendKeys(Key.ESCAPE)
            .perform();
        await driver.wait(until.stalenessOf(dialog), 5000);
        expect(await driver.switchTo().activeElement().getText()).toContain('Templates');
    });
});
