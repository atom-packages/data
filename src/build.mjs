import { minify as htmlMinify } from 'html-minifier-terser';
import { promises as fs } from 'fs';
import { render } from 'ejs';
import { resolve } from 'path';
import brotli from 'brotli';
import isCI from 'is-ci';
import MFH from 'make-fetch-happen';
import pako from 'pako';

const fetch = MFH.defaults({
    cacheManager: '.cache'
});

const htmlMinifyOptions = {
    collapseWhitespace: true,
    removeAttributeQuotes: true,
    removeComments: true
};

const ignoredPackages = [
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
    packages.sort((a, b) => (a.name > b.name) ? 1 : -1);

    const packagesJson = JSON.stringify(packages);
    await fs.writeFile(`public/${fileName}.json`, packagesJson);

    const gzJson = pako.gzip(packagesJson);
    await fs.writeFile(`public/${fileName}.json.gz`, gzJson);

    const brJson = brotli.compress(Buffer.from(packagesJson));
    await fs.writeFile(`public/${fileName}.json.br`, brJson);
}

(async () => {
    try {
        fs.mkdir('public');
        console.log('Output folder created');
    } catch(err) {
        console.log('Output folder already exists');
    }

    let rawPackages = [];
    let upperLimit = isCI ? Infinity : 6;

    for (let page = 1; page < upperLimit; page++) {
        console.log(`Downloading https://atom.io/api/packages?page=${page}`);

        const response = await fetch(`https://atom.io/api/packages?page=${page}`);
        const json = await response.json();
        
        if (!json?.length) break;
            
        rawPackages = [
            ...rawPackages,
            ...json
        ];
    }

    if (!rawPackages?.length) {
        throw Error('Could not retrieve packages');
    }

    const packages = (await Promise.all(rawPackages.map(async item => {
        if (ignoredPackages.includes(item.name)) {
            console.log(`Ignoring package ${item.name}`);
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
            downloads: item.downloads || undefined,
            stars: item.stargazers_count || undefined,
            theme: item.metadata?.theme || undefined
        }
    }))).filter(item => item);

    await saveData('all', packages);

    let groupedPackages = {};

    packages.map(item => {
        let firstLetter = item.name.charAt(0).toLowerCase();
        
        if (!isNaN(firstLetter)) {
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