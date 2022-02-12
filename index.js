const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const parse = require('url').parse;
const http = require('http');
const https = require('https');
const fs = require('fs');
const argv = require('yargs').argv;
const { remove, getResourcePath, writeFile, uniq, upsertFileByUrl, rewriteRelativeImports, getLinks } = require('./helpers');

const ARG_URL = argv.url;

if (!ARG_URL) {
    console.error('--url must be provided!');
    process.exit(1);
}
if (!parse(ARG_URL).hostname) {
    console.error('--url must be a valid url!');
    process.exit(1);
}
const ARG_OUT_PATH = argv.out || argv.o;
const ARG_DOMAIN = argv.domain;
const ARG_PATH = argv.path;
const ARG_STATUS_FILE = argv.statusFile;

let PAGES_TO_VISIT = [ARG_URL];
const VISITED_PAGES = {};
let TOTAL_PAGES_TO_VISIT = PAGES_TO_VISIT.length;

async function open(browser, url) {
    if (VISITED_PAGES[url]) {
        return;
    }

    const { hostname: requestingHostname } = parse(url);

    const page = await browser.newPage();

    VISITED_PAGES[url] = true;

    await page.setRequestInterception(true);

    page.on('response', async(res) => {
        const headers = res.headers();
        const url = res._url;

        const { hostname, path } = parse(url);

        if (res._status >= 300 && res._status <= 399) {
            const headers = res.headers();
            const loc = headers['location'];
            if (loc && parse(loc).hostname === requestingHostname) {
                console.log(`${res._status} redirect ${res._url} to ${headers['location']}`);
                PAGES_TO_VISIT.push(headers['location']);
                TOTAL_PAGES_TO_VISIT = PAGES_TO_VISIT.length;
            }
            return;
        }

        const contentType = (headers["content-type"] || '').split("/").pop();

        try {
            if (ARG_DOMAIN && hostname !== ARG_DOMAIN) {
                return;
            }
            let content = await res.buffer();

            if (contentType.includes('html')) {
                const html = content.toString('utf8');
                content = rewriteRelativeImports(html, path, hostname);
                const links = getLinks(html, hostname);
                links.forEach(link => {
                    const pLink = parse(link);
                    if (ARG_PATH) {
                        if (pLink.path && pLink.path.indexOf(ARG_PATH) === 0) {
                            PAGES_TO_VISIT.push(link);
                        }
                    } else {
                        PAGES_TO_VISIT.push(link);
                    }
                });
                PAGES_TO_VISIT = remove(uniq(PAGES_TO_VISIT), VISITED_PAGES);
                TOTAL_PAGES_TO_VISIT = PAGES_TO_VISIT.length;

                // doesn't work right now
                // if (ARG_STATUS_FILE) {
                //     await writeFile(ARG_STATUS_FILE, JSON.stringify({
                //         VISITED_PAGES,
                //         PAGES_TO_VISIT
                //     }, null, 4))
                // }
            }
            await upsertFileByUrl(url, ARG_OUT_PATH, content, contentType);
        } catch (e) {
            console.error('An exception occurred...', e, e.stack);
            process.exit(1);
        }
    });

    page.on('request', req => {
        req.continue();
    });

    await page.goto(url, { waitUntil: 'networkidle0' });

    const data = await page.content();

    const { folderPath, filePath } = getResourcePath(url, ARG_OUT_PATH);
    const screenshotPath = filePath + '.png';

    await page.screenshot({ path: screenshotPath, fullPage: true });

    return page;
}

(async() => {
    const browser = await puppeteer.launch();

    let i = 0;

    while (true) {
        const pageToVisit = PAGES_TO_VISIT.shift();
        if (!pageToVisit) {
            break;
        }
        i++;
        console.log(`Downloading ${pageToVisit} - ${i}/${TOTAL_PAGES_TO_VISIT}`);
        await open(browser, pageToVisit);
    }

    await browser.close();
})();