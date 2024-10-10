import { minify as htmlMinify } from 'html-minifier-terser';
import { promises as fs } from 'fs';
import { cache, render } from 'ejs';
import { resolve } from 'path';
import isCI from 'is-ci';
import MFH from 'make-fetch-happen';
import pako from 'pako';

const fetch = MFH.defaults({
    cacheManager: '.cache',
    cache: 'force-cache'
});

const htmlMinifyOptions = {
    collapseWhitespace: true,
    removeAttributeQuotes: true,
    removeComments: true
};

const ignoredPackages = [
    // Installation fails IIRC
    '☃',
    '0.1.0'
];

const ignoredDescriptions = [
    'A short description of your package',
    'A short description of your syntax theme',
    'A short description of your theme',
    'A short description of your UI theme',
];

async function saveData(fileName, packages) {
    if (/^[\w-]+.json$/.test(fileName)) {
        console.error(`Skipping invalid filename: ${fileName}.json`);
        return;
    }

    packages.sort((a, b) => (a.name > b.name) ? 1 : -1);

    const packagesJson = JSON.stringify(packages);
    await fs.writeFile(`public/${fileName}.json`, packagesJson);

    const gzJson = pako.gzip(packagesJson);
    await fs.writeFile(`public/${fileName}.json.gz`, gzJson);
}

(async () => {
    try {
        await fs.mkdir('public');
        console.log('Output folder created');
    } catch(err) {
        console.log('Output folder already exists');
    }

    let rawPackages = [];
    let upperLimit = isCI ? Infinity : 6;

    for (let page = 1; page < upperLimit; page++) {
        console.log(`Downloading https://api.pulsar-edit.dev/api/packages?page=${page}`);

        const response = await fetch(`https://api.pulsar-edit.dev/api/packages?page=${page}`);
        const json = await response.json();

        if (!json?.length) break;

        rawPackages = [
            ...rawPackages,
            ...json
        ];
    }

    if (!rawPackages?.length) {
        throw Error('Could not retrieve packages');
    } else if (rawPackages.length <= 414) {
        throw Error('Package retrieval incomplete');
    }

    const packages = (await Promise.all(rawPackages.map(async item => {
        if (ignoredPackages.includes(item.name) || item.name.match(/[^a-z0-9-_]/) || item.name.match(/\b(slot|casino)\b/)) {
            console.log(`Ignoring package ${item.name}`);

            if (!ignoredPackages.includes(item.name)) {
                ignoredPackages.push(item.name);
            }

            return;
        }

        return {
            name: item.name,
            description: item.metadata?.description
                ? !ignoredDescriptions.includes(item.metadata.description.trim())
                    ? item.metadata.description
                    : undefined
                : undefined,
            version: item.metadata?.version,
            downloads: Number(item.downloads),
            stars: Number(item.stargazers_count),
            theme: item.metadata?.theme || undefined
        }
    }))).filter(item => item);

    await saveData('all', packages);

    let groupedPackages = {};

    packages.map(item => {
        let firstLetter = item.name.charAt(0).toLowerCase();

        if (!Number.isInteger(firstLetter)) {
            firstLetter = '0-9';
        }

        if (item.name === '-vimes45-syntax') {
            firstLetter = 'v';
        }

        if (!groupedPackages[firstLetter]) {
            groupedPackages[firstLetter] = [];
        }

        groupedPackages[firstLetter].push(item);
    });

    await Promise.all(Object.keys(groupedPackages).map(async item => await saveData(item, groupedPackages[item])));

    const html = await fs.readFile(resolve('./src/template.ejs'), { encoding: 'utf8' });
    const htmlMinified = await htmlMinify(render(html, {
        total: packages.length,
        ignored: ignoredPackages.length,
        lastUpdated: new Date().toLocaleString('en-GB', { timeZone: 'UTC' })
    }), htmlMinifyOptions);

    const favicon = await fs.readFile(resolve('./src/favicon.svg'), { encoding: 'utf8' });
    const faviconMinified = await htmlMinify(favicon, {
        ...htmlMinifyOptions,
        removeAttributeQuotes: false
    })

    await fs.writeFile('public/favicon.svg', faviconMinified);
    await fs.writeFile('public/index.html', htmlMinified);
})();
