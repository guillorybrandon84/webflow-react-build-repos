import cheerio from 'cheerio';
import HTMLtoJSX from 'htmltojsx';
import path from 'path';
import statuses from 'statuses';
import uglify from 'uglify-js';
import { fs, mkdirp } from '../libs';
import raw from '../raw';
import Writer from './writer';

const writingFiles = [];

// Attempt at supporting windows by monkey patching path.relative to prevent backslashes.
// const orPathRel = path.relative;
// path.relative = (from, to) => orPathRel(from, to).replace(/\\/gi, '/');

import {
    escape,
    freeLint,
    freeScope,
    freeText,
    Internal,
    splitWords,
    upperFirst,
} from '../utils';

const _ = Symbol('_ViewWriter');
const htmltojsx = new HTMLtoJSX({ createClass: false });

// const flattenChildren = (children = [], flatten = []) => {
//   children.forEach(child => {
//     flattenChildren(child[_].children, flatten);
//   });

//   flatten.push(...children);

//   return flatten;
// };

// Replace anchor link roots to relative.
// html.replace(
//     /<a.+?href="(.+?)".+?(?!target="_blank").+?>/g,
//     (match, href) => {
//         return match.replace(href, '/' + href);
//     }
// );

// // Replace image roots to relative.
// html.replace(/<img.+?src="(.+?)".+?>/g, (match, src) => {
//     return match.replace(src, '/' + src);
// });

const adjustImagesToRoot = html => {
    return html.replace(/<img.+?src="(.+?)".+?>/g, (match, src) => {
        return match.replace(src, '/' + src);
    });
};

const removeHtmlFromLinks = html => {
    return adjustImagesToRoot(
        html
            .replace('index.html', '')
            .replace(/\.html/gi, '')
            .replace(
                /<a.+?href="(.+?)".+?(?!target="_blank").+?>/g,
                (match, href) => {
                    return match.replace(href, '/' + href);
                }
            )
    );
};

@Internal(_)
class ViewWriter extends Writer {
    static async writeAll(
        viewWriters,
        pagesDir,
        componentDir,
        metaDir,
        layoutDir,
        ctrlsDir
    ) {
        // Create the directories if they do not exist.
        await mkdirp(pagesDir);
        await mkdirp(componentDir);
        await mkdirp(layoutDir);
        await mkdirp(metaDir);

        // Declare file paths for index, helpers and routes.
        const indexFilePath = `${pagesDir}/index.js`;
        const helpersFilePath = `${pagesDir}/../helpers.js`;
        const routesFilePath = `${pagesDir}/../routes.js`;
        const childFilePaths = [indexFilePath, helpersFilePath, routesFilePath];

        // Get the relative controls dir.
        ctrlsDir = path.relative(pagesDir, ctrlsDir);

        // Prepare the "routes.js" template.
        const routes = `	
            import React from 'react';	
            import { Route, BrowserRouter } from 'react-router-dom';	
            import * as Views from './views';

            ${viewWriters
                .map(viewWriter => {
                    return `export const ${viewWriter.className
                        .replace(/view/gi, '')
                        .toUpperCase()} = '${
                        viewWriter.parent ? `/${viewWriter.parent}` : ''
                    }/${viewWriter.className
                        .replace(/home/gi, '')
                        .replace(/view/gi, '')
                        .split(/(?=[A-Z])/)
                        .slice(-1)[0]
                        .toLowerCase()}';`;
                })
                .join('\n  ')}
        
            const Router = () => (
                <BrowserRouter>
                ${viewWriters
                    .map(
                        viewWriter =>
                            `<Route key="${viewWriter.className.replace(
                                /view/gi,
                                ''
                            )}" path={ ${viewWriter.className
                                .replace(/view/gi, '')
                                .toUpperCase()} } component={Views.${
                                viewWriter.className
                            }.Controller} exact />`
                    )
                    .join('\n')}
                </BrowserRouter>
            );
            
            export default Router;`;

        // Prepare the views "index.js" template.
        const index = viewWriters
            .map(viewWriter => {
                return `export { default as ${viewWriter.className} } from './${viewWriter.className}'`;
            })
            .join('\n');

        const leanViewWriters = [];
        // viewWriters = flattenChildren(viewWriters);

        for (const viewWriter of viewWriters) {
            if (
                !leanViewWriters.find(
                    vw => vw.className === viewWriter.className
                )
            ) {
                leanViewWriters.push(viewWriter);
            }
        }
        leanViewWriters.forEach(async viewWriter => {
            const filePaths = await viewWriter.write(
                pagesDir,
                componentDir,
                metaDir,
                ctrlsDir,
                layoutDir
            );
            childFilePaths.push(...filePaths);
        });

        const writtingRoutes = fs.writeFile(routesFilePath, freeLint(routes));
        const writingIndex = fs.writeFile(indexFilePath, freeLint(index));
        const writingHelpers = fs.writeFile(helpersFilePath, raw.viewHelpers);

        await Promise.all([writingIndex, writingHelpers, writtingRoutes]);
        return childFilePaths;
    }

    get baseUrl() {
        return this[_].baseUrl;
    }

    set baseUrl(baseUrl) {
        this[_].baseUrl = String(baseUrl);
    }

    set isComponent(comp) {
        this[_].isComponent = comp;
    }

    get isComponent() {
        return this[_].isComponent;
    }

    get children() {
        return this[_].children.slice();
    }

    set name(name) {
        if (!isNaN(Number(name))) {
            name = statuses[name];
        }

        const words = splitWords(name);
        Object.assign(this[_], {
            ctrlClassName: words.map(upperFirst).join(''),
            metaClassName: words
                .concat('meta')
                .map(upperFirst)
                .join(''),
            className: words
                // .concat('view')
                .map(upperFirst)
                .join(''),
            elName: words.map(word => word.toLowerCase()).join('-'),
            name: words
                .concat('view')
                .map(word => word.toLowerCase())
                .join('-'),
        });
    }

    get name() {
        return this[_].name;
    }

    get ctrlClassName() {
        return this[_].ctrlClassName;
    }

    get metaClassName() {
        return this[_].metaClassName;
    }

    get className() {
        return this[_].className;
    }

    get elName() {
        return this[_].elName;
    }

    set html(html) {
        if (!html) {
            this[_].html = '';
            this[_].children = [];
            return;
        }

        const children = (this[_].children = []);
        const $ = cheerio.load(html);

        // console.log(this[_].className, ($("[wfr-c]") || []).length)

        let el = $('[wfr-c]')[0];
        while (el) {
            const $el = $(el);
            const elName = $el.attr('wfr-c');
            const $afEl = $(`<af-${elName}></af-${elName}>`);
            // const sock = $el.attr("wfr-d");
            // $afEl.attr("wfr-d", $el.attr("wfr-d"));
            $el.attr('wfr-c', null);
            $el.attr('wfr-props', 'binder');
            // $el.attr("wfr-d", null);
            $afEl.insertAfter($el);
            // if (sock !== null && sock !== undefined) {
            //   $el.prepend(`<span wfr-d="${sock}">`);
            //   $el.append('</span>');
            // }
            $el.remove();

            const child = new ViewWriter({
                name: elName,
                html: $.html($el),
                baseUrl: this.baseUrl,
                styles: this.styles,
                isComponent: true,
            });

            children.push(child);
            el = $('[wfr-c]')[0];
        }

        // Apply ignore rules AFTER child elements were plucked
        $('[wfr-ignore]').remove();

        // Empty inner HTML
        $('[wfr-empty]')
            .html('')
            .attr('wfr-empty', null);

        // Add rel="noopener noreferrer" to target="_blank" links.
        // $('[target="_blank]').each(function() {
        //     if (!$(this).is('[rel="noopener noreferrer"]')) {
        //         $(this).attr('rel', 'noopener noreferrer');
        //     }
        // });

        // // Function to replace tags.
        // $.fn.replaceTagName = function(f) {
        //     var g = [],
        //         h = this.length;
        //     while (h--) {
        //         var k = document.createElement(f),
        //             b = this[h],
        //             d = b.attributes;
        //         for (var c = d.length - 1; c >= 0; c--) {
        //             var j = d[c];
        //             k.setAttribute(j.name, j.value);
        //         }
        //         k.innerHTML = b.innerHTML;
        //         $(b)
        //             .after(k)
        //             .remove();
        //         g[h - 1] = k;
        //     }
        //     return $(g);
        // };

        // // Replace # anchors with buttons.
        // $('a').each(function() {
        //     if ($(this).is('[href="#"]') || !$(this).is('[href]')) {
        //         $(this)
        //             .removeAttr('href')
        //             .replaceTagName('button');
        //     }
        // });

        // Default actions for forms.
        $('form').each(function() {
            if (!$(this).is('[action]')) {
                $(this).attr('action', '/');
            }
        });

        this[_].scripts = [];

        // Set inline scripts. Will be loaded once component has been mounted
        $('script').each((i, script) => {
            const $script = $(script);
            const src = $script.attr('src');
            const type = $script.attr('type');

            // We're only interested in JavaScript script tags
            if (type && !/javascript/i.test(type)) return;

            if (src) {
                this[_].scripts.push({
                    type: 'src',
                    body: src,
                });
            } else {
                this[_].scripts.push({
                    type: 'code',
                    body: $script.html(),
                });
            }

            $script.remove();
        });

        const $body = $('body');

        html = $body.html();

        this[_].html = html;

        const sockets = (this[_].sockets = []);

        // Find root sockets
        $('[wfr-d]').each((i, el) => {
            const $el = $(el);
            const socketName = $el.attr('wfr-d');
            sockets.push(socketName);

            $el.attr('wfr-d', null);
            // Workaround would help identify the closing tag
            el.tagName += `-wfr-d-${socketName}`;
        });

        // Refetch modified html
        html = $body.html();

        // Transforming HTML into JSX
        let jsx = htmltojsx.convert(removeHtmlFromLinks(html)).trim();

        // Bind controller to view
        this[_].jsx = bindJSX(this, jsx, children);
    }

    get scripts() {
        return this[_].scripts ? this[_].scripts.slice() : [];
    }

    get styles() {
        return this[_].styles.slice();
    }

    get html() {
        return this[_].html;
    }

    get jsx() {
        return this[_].jsx;
    }

    get sockets() {
        return this[_].sockets && [...this[_].sockets];
    }

    get source() {
        return this[_].source;
    }

    set source(source) {
        this[_].source = String(source);
    }

    constructor(options) {
        super();

        this[_].children = [];
        this[_].styles = options.styles || [];

        this.name = options.name;
        this.parent = options.parent;
        this.isComponent = options.isComponent;
        this.html = options.html;
        this.source = options.source;
    }

    async write(pagesDir, componentDir, metaDir, ctrlsDir, layoutDir = null) {
        // Check if the artefact is a "page" or "component".
        const isComponent = pagesDir === componentDir;
        const fileName = this.className;

        // Set the file path.
        const filePath = `${pagesDir}/${fileName}/index.js`;

        // Set children file paths.
        const childFilePaths = [filePath];

        // Set children writer.
        const writingChildren = this[_].children.map(async child => {
            if (!writingFiles.includes(child.className)) {
                writingFiles.push(child.className);
                const filePaths = await child.write(
                    componentDir,
                    componentDir,
                    metaDir,
                    ctrlsDir
                );
                childFilePaths.push(...filePaths);
            }
        });

        // Write the files.
        let writingSelf;
        if (!writingFiles.includes(`${fileName}/index.js`)) {
            try {
                await mkdirp(pagesDir + '/' + this.className);
                await fs.readFile(`${pagesDir}/${fileName}/index.js`);
            } catch (e) {
                writingSelf = fs.writeFile(
                    `${pagesDir}/${fileName}/index.js`,
                    this[_].compose(
                        path.relative(pagesDir, componentDir),
                        path.relative(pagesDir, metaDir),
                        ctrlsDir,
                        !isComponent
                    )
                );
            }
        }

        try {
            await Promise.all([...writingChildren, writingSelf]);
        } catch (e) {
            console.log(e);
        }

        // Create the <App /> component inside the layout folder.
        if (layoutDir) {
            try {
                await mkdirp(layoutDir + '/App');
                await fs.readFile(`${layoutDir}/App/index.js`);
            } catch (e) {
                writingSelf = fs.writeFile(
                    `${layoutDir}/App/index.js`,
                    this[_].composeApp()
                );
            }
        }

        // Create the <Page /> component inside the layout folder.
        if (layoutDir) {
            try {
                await mkdirp(layoutDir + '/Page');
                await fs.readFile(`${layoutDir}/Page/index.js`);
            } catch (e) {
                writingSelf = fs.writeFile(
                    `${layoutDir}/Page/index.js`,
                    this[_].composePage()
                );
            }
        }

        return childFilePaths;
    }

    async setStyle(href, content, viewsDir) {
        let type;
        let body;

        if (href) {
            type = 'href';
            body = /^\w+:\/\//.test(href) ? href : path.resolve('/', href);
        } else {
            type = 'sheet';
            body = content;
        }

        const exists = this[_].styles.some(style => {
            return style.body == body;
        });

        if (!exists) {
            this[_].styles.push({ type, body });
        }

        const sheets = this[_].styles
            .map(({ type, body }) => {
                return type == 'sheet' && body;
            })
            .filter(Boolean);

        let css = '';

        // css += hrefs.map((href) => {
        //   return `@import url(${href});`
        // }).join('\n')

        css += '\n\n';

        css += sheets
            .map(sheet => {
                return sheet;
            })
            .join('\n\n');
        if (!viewsDir || !css.length) return true;
        try {
            await mkdirp(viewsDir + '/' + this.className + '/styles');
            await fs.writeFile(
                `${viewsDir}/${this.className}/styles/index.css`,
                escape(css.trim())
            );
        } catch (e) {
            console.log(e);
        }
    }

    _compose(compDir, metaDir, ctrlsDir, shouldHaveStyles = true) {
        // Adjust the controllers directory.
        ctrlsDir = '../' + ctrlsDir;
        if (this[_].isComponent) {
            ctrlsDir += '/components';
        } else {
            ctrlsDir += '/views';
        }

        // Return the composed template.
        return freeLint(`
            import React from 'react'

            ${
                // Add helpers if the component has data sockets.
                this[_].sockets.length
                    ? `import { map, transformProxies } from '../../helpers'`
                    : ''
            }

            ${
                // Add CSS imports if the page has styles.
                shouldHaveStyles ? `import "./styles/index.css"\n` : '\n'
            }

            ==>${this[_].composeChildImports(compDir)}<==

            let Controller

            class ${this.className} extends React.Component {
                static get Controller() {
                if (Controller) return Controller

                try {
                    Controller = require('${ctrlsDir}/${this.ctrlClassName}')
                    Controller = Controller.default || Controller

                    return Controller
                }
                catch (e) {
                    if (e.code === 'MODULE_NOT_FOUND') {
                    Controller = ${this.className}

                    return Controller
                    }

                    throw e
                }
            }

            render() {

                ${
                    // Render the proxies if the component has data sockets.
                    this[_].sockets.length
                        ? `const proxies = Controller !== ${
                              this.className
                          } ? transformProxies(this.props) : {
                    ==>${this[_].composeProxiesDefault()}<==
                }`
                        : ''
                }

                ${
                    // Render metadata if this is a page.
                    this[_].isComponent
                        ? ''
                        : `
                            let Metadata
                            try {
                                // eslint-disable-next-line
                                Metadata = require("${metaDir}/${this.metaClassName}")
                                Metadata = Metadata.default || Metadata
                            } catch (e) {
                                // pass
                                Metadata = null;
                            }
                            try {
                                // eslint-disable-next-line
                                Metadata = require("${metaDir}/defaultMeta")
                                Metadata = Metadata.default || Metadata
                            } catch (e) {
                                // pass
                                Metadata = null;
                            }
                        `
                }

                return (
                    
                        ${
                            // Render metadata if this is a page.
                            !this[_].isComponent
                                ? `
                                <React.Fragment>
                                    {Metadata ? <Metadata {...this.props} /> : null}
                                    ==>${this.jsx}<==
                                </React.Fragment>`
                                : `
                                ==>${this.jsx}<==
                            `
                        }
                        
                    
                )
            }
        }

        export default ${this.className}
    `);
    }

    _composeApp() {
        return freeLint(`
            import React from 'react';
            import Router from '../../routes.js';

            import './styles';
            import './scripts';

            const App = () => <Router />;

            export default App;
        `);
    }

    _composePage() {
        return freeLint(`
            import React from 'react';

            const Page = () => {
               return (
                   <div></div>
               );
            };

            export default Page;
        `);
    }

    _composeStyleImports() {
        // const hrefs = this[_].styles.map(({ type, body }) => {
        //   return type == 'href' && body
        // }).filter(Boolean)

        const sheets = this[_].styles
            .map(({ type, body }) => {
                return type == 'sheet' && body;
            })
            .filter(Boolean);

        let css = '';

        css += '\n\n';

        css += sheets
            .map(sheet => {
                return sheet;
            })
            .join('\n\n');

        return escape(css.trim());
    }

    _composeProxiesDefault() {
        return this[_].sockets
            .map(socket => {
                let defaultType = '[]';

                if (socket.includes('%string%')) {
                    socket = socket.replace('%string%', '');
                    defaultType = "''";
                }

                return `'${socket}': ` + defaultType + `,`;
            })
            .join('\n');
    }

    _composeChildImports(compDir) {
        if (!compDir) {
            compDir = '..';
        } else {
            compDir = '../' + compDir;
        }
        const imported = [];

        const imports = this[_].children
            .map(child => {
                if (!imported.includes(child.className)) {
                    imported.push(child.className);
                    return `import ${child.className} from '${compDir}/${child.className}'`;
                }
            })
            .filter(imp => !!imp && imp.length);

        // Line skip
        imports.push('');

        return imports.length ? imports.join('\n') : '';
    }

    _composeScriptsDeclerations() {
        return this[_].scripts
            .map(script => {
                if (script.type == 'src') {
                    return `fetch("${script.body}").then(body => body.text()),`;
                }

                const minified = uglify.minify(script.body).code;
                // Unknown script format ??? fallback to maxified version
                const code = minified || script.body;

                return `Promise.resolve("${escape(code)}"),`;
            })
            .join('\n');
    }

    _composeScriptsInvocations() {
        if (!this[_].scripts) return '';

        const invoke = freeScope('eval(arguments[0])', 'window', {
            script: null,
        });

        return freeText(`
      scripts.concat(Promise.resolve()).reduce((loaded, loading) => {
        return loaded.then((script) => {
          ==>${invoke}<==

          return loading
        })
      })
    `);
    }
}

function camelize(text) {
    return text
        .replace(/(?:^\w|[A-Z]|\b\w)/g, function(letter, index) {
            return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
        })
        .replace(/\s+/g, '');
}

function bindJSX(self, jsx, children = []) {
    // DETECT LIST
    children.forEach((child, index) => {
        const isList = new RegExp(`(<af-${child.elName} />\\s*){2,}`, '').exec(
            jsx
        );
        if (isList) {
            self[_].sockets.push(`${camelize(child.className)}List${index}`);
            jsx = jsx.replace(
                new RegExp(`(<af-${child.elName} />\\s*){2,}`, ''),
                `{map(proxies['${camelize(
                    child.className
                )}List${index}'], props => <React.Fragment ${mergeProps(
                    ''
                )}>{props.children ? props.children : null}</React.Fragment>)}`
            );
        } else {
            // Bind controllers to children.
            jsx = jsx.replace(
                new RegExp(`af-${child.elName}`, 'g'),
                `${child.className}.Controller {...this.props}`
            );

            jsx = jsx.replace(
                new RegExp(
                    `(<af-${child.elName} />\\s*)+`,
                    !self[_].isComponent ? 'g' : ''
                ),
                !self[_].isComponent
                    ? `<${child.className}.Controller {...this.props}/>`
                    : `{map(proxies['${child.className}'], props => <${
                          child.className
                      }.Controller ${mergeProps(
                          ''
                      )}>{props.children ? props.children : null}</${
                          child.className
                      }.Controller>)}`
            );
        }
    });

    // ORDER MATTERS
    // Open close
    return (
        jsx
            // Attach props
            .replace(/(wfr-props=".*?")/g, (match, base) =>
                match.replace(base, '{ ...this.props }')
            )
            // Open close
            .replace(
                /<([\w_-]+)-wfr-d-([\w_-]+)(.*?)>([^]*)<\/\1-wfr-d-\2>/g,
                (match, el, sock, attrs, children) => {
                    return /<[\w_-]+-wfr-d-[\w_-]+/.test(children)
                        ? `{map(proxies['${sock}'], props => <${el} ${mergeProps(
                              attrs
                          )}>{createScope(props.children, proxies => <React.Fragment>
                            {props.topelement ? props.topelement() : null}
                            ${bindJSX(
                                self,
                                children
                            )}</React.Fragment>)}</${el}>)}`
                        : `{map(proxies['${sock}'], props => <${el} ${mergeProps(
                              attrs
                          )}>{props.children ? props.children : <React.Fragment>${children}</React.Fragment>}</${el}>)}`;
                }
            )
            // Self closing
            .replace(
                /<([\w_-]+)-wfr-d-([\w_-]+)(.*?) \/>/g,
                (match, el, sock, attrs) =>
                    `{map(proxies['${sock}'], props => <${el} ${mergeProps(
                        attrs
                    )}>{props.children}</${el}>)}`
            )
    );
}

// Merge props along with class name
function mergeProps(attrs) {
    attrs = attrs.trim();

    if (!attrs) {
        return '{...props}';
    }

    let className = attrs.match(/className="([^"]+)"/);

    if (!className) {
        return `${attrs} {...props}`;
    }

    className = className[1];
    attrs = attrs.replace(/ ?className="[^"]+"/, '');

    return `${attrs} {...{...props, className: \`${className} $\{props.className || ''}\`}}`.trim();
}

export default ViewWriter;
