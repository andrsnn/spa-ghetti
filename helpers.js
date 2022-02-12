const { parse } = require('url');
const fs = require('fs');
const cheerio = require('cheerio');
const { relative } = require('path');

const promisify = (fn) => {
	return (...args) => {
		return new Promise((resolve, reject) => {
			args.push((err, ...cbArgs) => {
				if (err) {
					return reject(err);
				}
				return resolve(...cbArgs);
			});
			return fn(...args);
		});
	}
}

const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

async function doesFileExist(path) {
	try {
		await access(path);
		return true;
	}
	catch (e) {
		return false;
	}
}

async function mkdirp(path) {
	path = path.split('/').filter(Boolean);
	let fullPath = '';

	for (const currPath of path) {
		fullPath += currPath + '/';
		if (!(await doesFileExist(fullPath))) {
			try {
				await mkdir(fullPath);
			}
			catch(e) {
				//swallow errors as mkdir may error due to async operations creating the same folder paths
			}
		}
	}
}

function getResourcePath(url, basePath='') {
	let { host, path } = parse(url);

	path = path.split('/').filter(Boolean);
	const fileName = path[path.length - 1];
	path = path.slice(0, path.length - 1);

	let folderPath = [host, ...path];
	folderPath = folderPath.join('/');
	folderPath = basePath ? (basePath + '/' + folderPath) : folderPath;

	let filePath = folderPath + '/' + fileName;

	return {folderPath, filePath};
}

async function upsertFileByUrl(url, basePath = '', fileData, contentType) {
	let { folderPath, filePath } = getResourcePath(url, basePath);

	if (contentType.includes('html')) {
		filePath = filePath + '.html';
	}

	await mkdirp(folderPath);

	await writeFile(filePath, fileData);
}

function getLinks(html, domain) {
	const $ = cheerio.load(html);

	const links = {};

	$('a').each((i, el) => {
		let href = $(el).attr('href');

		if (href) {
			const { hostname } = parse(href);

			// we don't care about deep linking
			href = href.replace(/(#.*)/g, '').trim();
	
			// relative in this case
			if (!hostname) {
				if (href[0] !== '/') {
					href += '/' + href;
				}
				href = `https://${domain}${href}`;
			}
			// only grab links within the target domain
			else if(hostname !== domain) {
				return;
			}
			
			if (href) {
				links[href] = true;
			}
		}
	});
	
	return Object.keys(links);
}

function rewriteRelativeImports(html, origPath, domain) {
	const iterator = (attr, el) => {
		const href = $(el).attr(attr);
	
		if (!href) {
			return;
		}
	
		const { hostname } = parse(href);
		
		// if no hostname its a relative import
		if (!hostname) {
			if (href.indexOf('//') === 0) {
				const newHref = href.replace('//', 'https://');
				$(el).attr(attr, newHref);
				return;
			}
			//relative expects folder pathing, not file pathing
			let hrefWithoutFile = href.split('/');
			const fileName = hrefWithoutFile[hrefWithoutFile.length - 1];
			hrefWithoutFile = hrefWithoutFile.slice(0, hrefWithoutFile.length - 1);
			hrefWithoutFile = hrefWithoutFile.join('/');
			let newHref = relative(origPath, hrefWithoutFile);
			newHref = domain + '/' + newHref + '/' + fileName;
			$(el).attr(attr, newHref);
		}
	}
	
	const $ = cheerio.load(html);
	
	$('link').each((i, el) => iterator('href', el));
	$('script').each((i, el) => iterator('src', el));
	$('img').each((i, el) => iterator('src', el));

	return $.html();
}

function uniq(arr) {
	return Object.keys(arr.reduce((acc, e) => {
		if (acc[e]) {
			return acc;
		}
		acc[e] = true;
		return acc;
	}, {}));
}

function remove(arr, obj) {
	return arr.filter(e => !e[obj]);
}

module.exports = {
	upsertFileByUrl,
	mkdirp,
	doesFileExist,
	promisify,
	rewriteRelativeImports,
	getLinks,
	uniq,
	writeFile,
	remove,
	getResourcePath
}