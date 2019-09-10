import cheerio from 'cheerio';
import path from 'path';
// import git from './legacy/git';
import { fs, ncp, reread } from './libs';
import { ViewWriter, ScriptWriter, StyleWriter } from './writers';

const defaultPublicSubFolders = ['css', 'fonts', 'images', 'js'];

export const transpile = async config => {
    let inputFiles;
    let outputFiles = [];

    try {
        await Promise.all([
            fs.readdir(config.input).then(files => {
                inputFiles = files;
            }),
            // git.removeWFRFiles(config).then(files => {
            //     outputFiles.push(...files);
            // }),
        ]);
    } catch (e) {
        console.log(e);
    }

    const folders = inputFiles.filter(
        file =>
            !path.extname(file).length &&
            !defaultPublicSubFolders.includes(file)
    );

    let htmlFiles;

    // Get the public directories for "css", "fonts", "images", "js".
    const publicSubDirs = inputFiles.filter(
        file => !path.extname(file) && defaultPublicSubFolders.includes(file)
    );

    // Map the directory files.
    folders.map(folder =>
        fs
            // Read the directories.
            .readdir(`${config.input}/${folder}`)

            // Map the input files.
            .then(files => {
                inputFiles = [
                    ...(inputFiles || []),
                    ...(files || []).map(file => `${folder}/${file}`),
                ];
            })

            // Filter only HTML files.
            .then(() => {
                htmlFiles = inputFiles.filter(
                    file => path.extname(file) == '.html'
                );
            })

            // Execute the writers.
            .then(async () => {
                const scriptWriter = new ScriptWriter({
                    baseUrl: config.input,
                    prefetch: config.prefetch,
                });

                const styleWriter = new StyleWriter({
                    baseUrl: config.input,
                    prefetch: config.prefetch,
                    source: config.srouce,
                });

                const transpilingHTMLFiles = htmlFiles.map(htmlFile => {
                    return transpileHTMLFile(
                        config,
                        htmlFile,
                        scriptWriter,
                        styleWriter
                    );
                });

                const viewWriters = await Promise.all(transpilingHTMLFiles);

                const writingFiles = await Promise.all([
                    ViewWriter.writeAll(
                        viewWriters,
                        config.output.src.views,
                        config.output.src.components,
                        config.output.src.meta,
                        config.output.src.layout,
                        config.output.src.controllers
                    ).then(paths => outputFiles.push(...paths)),
                    scriptWriter
                        .write(config.output.src.layout + '/App/scripts')
                        .then(paths => outputFiles.push(...paths)),
                    styleWriter
                        .write(config.output.src.layout + '/App/styles')
                        .then(paths => outputFiles.push(...paths)),
                ]);

                const makingPublicDir = makePublicDir(
                    config,
                    publicSubDirs
                ).then(paths => outputFiles.push(...paths));

                try {
                    await Promise.all([writingFiles, makingPublicDir]);
                } catch (e) {
                    console.log(e);
                }

                // TODO: Enable Git?
                // return git.add(outputFiles, config).then(files => {
                //     return git.commit(files, 'Updated');
                // });
            })
    );
};

const transpileHTMLFile = async (
    config,
    htmlFile,
    scriptWriter,
    styleWriter
) => {
    const html = (await fs.readFile(`${config.input}/${htmlFile}`)).toString();
    const $ = cheerio.load(html);
    const $head = $('head');

    if (htmlFile == 'index.html') {
        htmlFile = 'home.html';
    }

    if (!!scriptWriter && !!styleWriter) {
        // pass
    }

    const $body = $('body');

    const viewWriter = new ViewWriter({
        name: htmlFile
            .replace('.html', '')
            .split('/')
            .map(segment => {
                return segment.charAt(0).toUpperCase() + segment.slice(1);
            })
            .join(''),
        baseUrl: config.baseUrl,
        parent:
            htmlFile.split('/')[0] === htmlFile ? null : htmlFile.split('/')[0],
        isComponent: false,
        source: config.source,
    });

    setScripts(scriptWriter, $head, $, $body);
    setStyles(viewWriter, styleWriter, $head, $, config.output.src.views);
    setHTML(viewWriter, $body, $);

    return viewWriter;
};

const makePublicDir = async (config, publicSubDirs) => {
    const publicDir = config.output.public;
    await Promise.all(
        publicSubDirs.map(publicSubDir => {
            return ncp(
                `${config.input}/${publicSubDir}`,
                `${publicDir}/${publicSubDir}`
            );
        })
    );

    // Resolving relative paths
    const filePaths = await reread(config.input);

    const relativePaths = filePaths.map(filePath => {
        const relativePath = path.relative(config.input, filePath);

        return `${publicDir}/${relativePath}`;
    });

    return relativePaths;
};

const setScripts = (scriptWriter, $head, $, $body) => {
    const $scripts = {
        head: $head.find('script[type="text/javascript"]'),
        body: $body.find('script[type="text/javascript"]'),
    };

    if ($scripts.head.length) {
        $scripts.head.each((i, script) => {
            const $script = $head.find(script);
            scriptWriter.setScript($script.attr('src'), $script.html());
        });
    }

    if ($scripts.body.length) {
        $scripts.body.each((i, script) => {
            const $script = $body.find(script);
            scriptWriter.setScript($script.attr('src'), $script.html());
        });
    }
};

const setStyles = (viewWriter, styleWriter, $head, _, viewsDir) => {
    let $styles;

    $styles = $head.find('link[rel="stylesheet"][type="text/css"]');

    $styles.each((i, style) => {
        const $style = $head.find(style);

        viewWriter.setStyle($style.attr('href'), $style.html(), viewsDir);
        styleWriter.setStyle($style.attr('href'), $style.html());
    });

    $styles = $head.find('style');

    $styles.each((i, style) => {
        const $style = $head.find(style);

        viewWriter.setStyle($style.attr('href'), $style.html(), viewsDir);
        styleWriter.setStyle($style.attr('href'), $style.html());
    });
};

const setHTML = (viewWriter, $body, $) => {
    // Create a wrap around $body so we can inherit its style without actually
    // using a <body> tag
    const $div = $('<div>');
    $div.html($body.html());
    $div.attr($body.attr());
    viewWriter.html = $.html($div);
};
