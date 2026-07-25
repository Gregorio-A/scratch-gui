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
const fallbackDriver = process.env.CHROMEDRIVER_PATH || '/usr/bin/chromedriver';
const driverExecutable = fs.existsSync(chromedriver.path) ? chromedriver.path : fallbackDriver;

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
});
