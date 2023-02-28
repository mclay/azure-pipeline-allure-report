import tl = require('azure-pipelines-task-lib/task');
import dashify = require('dashify');
import { JSDOM } from 'jsdom';
import { dirname, extname, resolve, sep } from 'path';
import { minify } from 'uglify-js';
import fs = require('fs')
import LZString = require('lz-string');

const scripts = [ "sinon-9.2.4.js", "lz-string.js", "jquery-3.6.3.slim.min.js", "fake-server.js"] 

const aboluteUrlScheme = [
    'http://',
    'https://',
];

const fileExtensionToContentType = new Map<string, string>([
    ["svg", "image/svg"],
    ["txt", "text/plain;charset=UTF-8"],
    ["js", "application/javascript"],
    ["json", "application/json"],
    ["csv", "text/csv"],
    ["css", "text/css"],
    ["html", "text/html"],
    ["xml", "text/xml"],
    ["htm", "text/html"],
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["jpg", "image/jpg"],
    ["gif", "image/gif"],
    ["mp4", "video/mp4"],
    ["avi", "video/avi"],
    ["webm", "video/webm"]
])

const base64Map = new Map<string, string>([
    ["svg", 'image/svg+xml'],
    ["png", 'image/png'],
    ["jpg", 'image/jpeg'],
    ["jpeg", 'image/jpeg'],
    ["gif", 'image/jpeg']
]);

function createScriptFile(baseDirectory: string = '.', ignoredFiles = ["./complete.html", "./allure-results", "./server.js", "./fake-server.js", "./.gitignore", "./sinon-9.2.4.js", "./styles.css", "./app.js", "./package-lock.json", "./azure-pipelines.yml"]) {
    let script = `var _s = sinon.fakeServer.create();
    const _G = "GET";
    const _c = 'Content-Type';
    const _d = function (path, content) {
        console.log("load "+path);
        return LZString.decompressFromBase64(content);
    };
    const imageMap = new Map();
    const attachmentUrl = new RegExp("^data/attachments/.*\\.png$", "i");
    $(document).on('DOMNodeInserted', function(e) { 
        const attachment = $(e.target).find('img.attachment__media').first()
        if (attachment && attachmentUrl.test($(attachment).attr('src')) ) {
            const base64 = LZString.decompressFromBase64(imageMap.get($(attachment).attr('src')));
            $(attachment).attr('src', 'data:image/png;base64,' + base64)
        } 	
        const link = $(e.target).find("a[href^='data/attachments/']").first()	
        if ($(link).attr('href')) {
            $(link).click(function (e) {
                if (!$(e.target).attr('href')) {
                    return false;
                }
                var win = window.open();
                var base64 = LZString.decompressFromBase64(imageMap.get($(e.target).attr('href')));
                win.document.write('<iframe src="data:image/png;base64,' + base64 + '" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>');
                return false;
            });
        }
    });
    `
    for (let entry of fileExtensionToContentType.entries()) {
        script += `var _${entry[0]} = '${entry[1]}';\n`
    }
    processDirectory(baseDirectory, (filePath: string) => {
        if (ignoredFiles.includes(filePath.replace(baseDirectory, "."))) {
            return;
        }
        const fileExtension = extname(filePath).slice(1)
        if ('csv' === fileExtension) {
            return;
        }
        console.log(`inline ${filePath.replace(baseDirectory+"/", "")}`);
        const fileContentBuffer = fs.readFileSync(filePath)
        const compressedFileContent = 'png' === fileExtension ? 
            LZString.compressToBase64(fileContentBuffer.toString('base64')) :
            LZString.compressToBase64(fileContentBuffer.toString());
        const url = filePath.replace(baseDirectory+"/", "")
        if ('png' === fileExtension) {
            script += `imageMap.set("${url}", "${compressedFileContent}");\n`
            return;
        }
        let content = `_d("${url}", "${compressedFileContent}")`
        script += `_s.respondWith(_G, "${url}", [200, {_c:'${fileExtensionToContentType.has(fileExtension) ? '_' + fileExtension : 'application/octet-stream'}' }, ${content}]);\n`
    })
    script += `_s.autoRespond = true;`
    return script
}

function processDirectory(folder: string = '.', callback: (file: string) => void) {
    if (folder.startsWith('previous_run') || folder.endsWith('src') ||  folder.endsWith('.git') || folder.endsWith('node_modules')) {
        return
    }
    const files = fs.readdirSync(folder);
    files.forEach(file => {
        if (isDirectory(`${folder}/${file}`)) {
            processDirectory(`${folder}/${file}`, callback)
        } else {
            callback(`${folder}/${file}`)
        }
    });
}

function isDirectory(filePath: string) {
    try {
        return fs.lstatSync(filePath).isDirectory()
    } catch (error) {
        console.error(error)
    }
    return false
}


function resolvePath(src: string): string {
    return resolve(process.cwd(), src.trim())
}

function resolveDirPath(src: string): string {
    return `${reportDir}/${src}`
}

function getFile(src: string, format?: BufferEncoding) {
    return Promise.resolve(fs.readFileSync(resolvePath(src)).toString(format))
}


const loadAndAddScripts = (src: string) => {
    return getFile(src).then((content) => {
        const dom = new JSDOM(content);
        const document = dom.window.document;
        const scriptElements = document.querySelectorAll('script')
        for (let index = 0; index < scriptElements.length; index++) {
            const element = scriptElements.item(index);
            if (!element?.getAttribute("src")?.match(/.*app.js/)) {
               continue
            }
            scripts.forEach((scriptFile) =>
             element?.parentElement?.insertBefore(
                createElement(document, 'script', new Map([ ["src", scriptFile] ])), element)
            )
            break
        }
        return dom;
    }
    )
}

function createElement(document: Document, name: string, attributes: Map<string, string>) {
    const element = document.createElement(name);
    attributes.forEach((value, key) => {
        element.setAttribute(key, value)
    })
    return element
}

const resolveTag = (document : Document, tagName: string , minify = false) => Promise.all(
    Array.from(document.getElementsByTagName(tagName.trim()))
        .map((element: Element) => resolveElement(element, tagName, minify)),
);

const isExternalUrl = (src: string) => aboluteUrlScheme
    .some((ignoreString) => src.startsWith(ignoreString));


const resolveExternalScript = (element: Element, minifyScript = false) => {
    if (!element.getAttribute('src')) return Promise.resolve();
    if (isExternalUrl(element.getAttribute('src') as string)) return Promise.resolve();
    return getFile(resolveDirPath(element.getAttribute('src') as string)).then((file) => {
        element.innerHTML = minifyScript ? minify(file).code : file;
        element.removeAttribute('src');
    });
};

const resolveExternalIcon = async (element: Element, minify = false) => {
    if (!element.getAttribute('href')) return Promise.resolve();
    if (isExternalUrl(element.getAttribute('href') as string)) return Promise.resolve();
    return resolveImageToBase64(element, 'href');
};

const resolveImageToBase64 = (element: Element, srcAttributeName = 'src') => {
    const src = element.getAttribute(srcAttributeName);
    if (!src || src.startsWith('http')) return Promise.resolve();
    return getFile(resolveDirPath(src), 'base64').then((base64String) => {
        element.setAttribute(srcAttributeName, `data:${base64Map.get(extname(src).slice(1)) || 'image'};base64, ${base64String}`);
    });
};

const resolveExternalStyleSheet = (element: Element, minify = false) => {
    const href = element.getAttribute('href');
    const parentElement = element.parentElement;
    if (!href) return Promise.resolve();
    if (isExternalUrl(element.getAttribute('href') as string)) return Promise.resolve();
    const styleSheetPath = resolveDirPath(href);
    return getFile(styleSheetPath).then((file) => {
        const style = element.ownerDocument.createElement('style');
        style.innerHTML = file;
        parentElement!.replaceChild(style, element);
    });
};

const resolveExternalLink = (element: Element) => {
    switch (element.getAttribute('rel')) {
        case 'stylesheet':
            return resolveExternalStyleSheet(element);

        case 'icon':
            return resolveExternalIcon(element);
        default:
            return Promise.resolve();
    }
};

const resolveElement = (element: Element, tagName: string, minify = false) => {
    try {
        switch (tagName) {
            case 'script':
                return resolveExternalScript(element, minify);
            case 'link':
                return resolveExternalLink(element);
            case 'img':
                return resolveImageToBase64(element);
            default:
                return Promise.resolve();
        }
    } catch (error) {
        console.error(error)
    }
};


export const htmlInlineExternal = (dom: JSDOM, tags = ['script', 'link', 'img'], minify = false) => {
    return Promise.all(tags.map((tag) => resolveTag(dom.window.document, tag, minify))).then(() => {
        return Promise.resolve(dom.serialize());
    });
};


const reportDir = resolve(tl.getPathInput('reportDir', true, true))


try {
    const reportFile = `${reportDir}/index.html`
    const outputFile = `${reportDir}/allure.html`;
    const fakeServerScript = createScriptFile(reportDir)
    const jobName = dashify(tl.getVariable('Agent.JobName') || "empty")
    const stageName = dashify(tl.getVariable('System.StageDisplayName') || "empty")
    const stageAttempt = tl.getVariable('System.StageAttempt') || "empty"
    const tabName = tl.getInput('tabName', false ) || 'Allure-Report'
    fs.writeFileSync(`${dirname(__dirname)}${sep}fake-server.js`,fakeServerScript)
    scripts.forEach((scriptFile:string) => {
        fs.writeFileSync(`${reportDir}/${scriptFile}`, fs.readFileSync(`${dirname(__dirname)}${sep}${scriptFile}`))
    })
    loadAndAddScripts(reportFile).then((dom) => {
        htmlInlineExternal(dom,  ['script', 'link'], true).then((resolvedDom) => {
            fs.writeFileSync(outputFile, resolvedDom);
        }).then(() => {
            scripts.forEach((scriptFile:string) => {
                fs.unlinkSync(`${reportDir}/${scriptFile}`)
            })
        }).then(() => {
            console.debug(`finished writing ${outputFile}`)
            tl.addAttachment('allure-report', `${tabName}.${jobName}.${stageName}.${stageAttempt}`, outputFile)  
        })
    })
    
} catch (error) {
    tl.setResult(tl.TaskResult.SucceededWithIssues, error.message);
} 
