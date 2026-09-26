const defaultsDeep = require('lodash.defaultsdeep');
const path = require('path');
const webpack = require('webpack');

// Plugins
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// PostCss
const autoprefixer = require('autoprefixer');
const postcssVars = require('postcss-simple-vars');
const postcssImport = require('postcss-import');

const STATIC_PATH = process.env.STATIC_PATH || '/static';
const {APP_NAME} = require('./src/lib/brand');

const root = process.env.ROOT || '';
if (root.length > 0 && !root.endsWith('/')) {
    throw new Error('If ROOT is defined, it must have a trailing slash.');
}

const htmlWebpackPluginCommon = {
    root: root,
    meta: JSON.parse(process.env.EXTRA_META || '{}'),
    APP_NAME
};

// When this changes, the path for all JS files will change, bypassing any HTTP caches
const CACHE_EPOCH = 'pentapod';

const base = {
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devtool: process.env.SOURCEMAP || (process.env.NODE_ENV === 'production' ? false : 'cheap-module-source-map'),
    devServer: {
        contentBase: path.resolve(__dirname, 'build'),
        host: '0.0.0.0',
        disableHostCheck: true,
        compress: true,
        port: process.env.PORT || 8601,
        // tw: exported players must not try to connect back to the dev server
        injectClient: compilerConfig => !String(compilerConfig.name).startsWith('standalone'),
        // allows ROUTING_STYLE=wildcard to work properly
        historyApiFallback: {
            rewrites: [
                {from: /^\/\d+\/?$/, to: '/index.html'},
                {from: /^\/\d+\/fullscreen\/?$/, to: '/fullscreen.html'},
                {from: /^\/\d+\/editor\/?$/, to: '/editor.html'},
                {from: /^\/\d+\/embed\/?$/, to: '/embed.html'},
                {from: /^\/addons\/?$/, to: '/addons.html'}
            ]
        }
    },
    output: {
        library: 'GUI',
        filename: (
            process.env.NODE_ENV === 'production' ? `js/${CACHE_EPOCH}/[name].[contenthash].js` : 'js/[name].js'
        ),
        chunkFilename: (
            process.env.NODE_ENV === 'production' ? `js/${CACHE_EPOCH}/[name].[contenthash].js` : 'js/[name].js'
        ),
        publicPath: root
    },
    resolve: {
        symlinks: false,
        alias: {
            'text-encoding$': path.resolve(__dirname, 'src/lib/tw-text-encoder'),
            'scratch-render-fonts$': path.resolve(__dirname, 'src/lib/tw-scratch-render-fonts')
        }
    },
    module: {
        rules: [{
            test: /\.jsx?$/,
            loader: 'babel-loader',
            include: [
                path.resolve(__dirname, 'src'),
                /node_modules[\\/]scratch-[^\\/]+[\\/]src/,
                /node_modules[\\/]pify/,
                /node_modules[\\/]@vernier[\\/]godirect/
            ],
            options: {
                // Explicitly disable babelrc so we don't catch various config
                // in much lower dependencies.
                babelrc: false,
                plugins: [
                    ['react-intl', {
                        messagesDir: './translations/messages/'
                    }]],
                presets: ['@babel/preset-env', '@babel/preset-react']
            }
        },
        {
            // three.js uses class static blocks, which webpack 4 can't parse
            test: /\.js$/,
            loader: 'babel-loader',
            include: /node_modules[\\/]three[\\/]/,
            options: {
                babelrc: false,
                compact: false,
                plugins: [
                    '@babel/plugin-proposal-class-static-block',
                    '@babel/plugin-proposal-class-properties'
                ]
            }
        },
        {
            test: /\.css$/,
            use: [{
                loader: 'style-loader'
            }, {
                loader: 'css-loader',
                options: {
                    modules: true,
                    importLoaders: 1,
                    localIdentName: '[name]_[local]_[hash:base64:5]',
                    camelCase: true
                }
            }, {
                loader: 'postcss-loader',
                options: {
                    ident: 'postcss',
                    plugins: function () {
                        return [
                            postcssImport,
                            postcssVars,
                            autoprefixer
                        ];
                    }
                }
            }]
        }]
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'node_modules/scratch-blocks/media',
                    to: 'static/blocks-media/default'
                },
                {
                    from: 'node_modules/scratch-blocks/media',
                    to: 'static/blocks-media/high-contrast'
                },
                {
                    from: 'src/lib/themes/blocks/high-contrast-media/blocks-media',
                    to: 'static/blocks-media/high-contrast',
                    force: true
                }
            ]
        })
    ]
};

if (!process.env.CI) {
    base.plugins.push(new webpack.ProgressPlugin());
}

/**
 * @param {string} file file name in src/lib/tw-standalone
 * @returns {string} absolute path
 */
const standaloneModule = file => path.resolve(__dirname, 'src/lib/tw-standalone', file);

/**
 * tw: config for a script that is copied into exported projects.
 * Always minified, even from the dev server, because it ends up inside every exported project.
 * Unlike the configs below, these options must win over base, so base comes last.
 * @param {string} name output name, also the name used by --config-name
 * @param {string} entry entry file
 * @param {object} alias extra resolve.alias entries
 * @param {object[]} plugins webpack plugins
 * @returns {object} webpack config
 */
const standaloneConfig = (name, entry, alias, plugins) => Object.assign(defaultsDeep({
    name,
    mode: 'production',
    devtool: false,
    entry: {
        [name]: entry
    },
    output: {
        path: path.resolve(__dirname, 'build'),
        filename: 'js/[name].js',
        chunkFilename: `js/${name}-[name].js`
    },
    resolve: {
        alias
    },
    module: {
        rules: base.module.rules.concat([
            {
                test: /\.(svg|png|wav|mp3|gif|jpg|woff2|hex)$/,
                loader: 'url-loader',
                options: {
                    // Always inline
                    limit: true,
                    esModule: false
                }
            }
        ])
    }
}, base), {
    // Set after defaultsDeep, which would merge these with base.plugins element by element.
    // base.plugins is not used: these scripts don't need the copied editor files.
    plugins: plugins.concat([
        new webpack.optimize.LimitChunkCountPlugin({
            maxChunks: 1
        })
    ])
});

module.exports = [
    // to run editor examples
    defaultsDeep({}, base, {
        entry: {
            'editor': './src/playground/editor.jsx',
            'player': './src/playground/player.jsx',
            'fullscreen': './src/playground/fullscreen.jsx',
            'embed': './src/playground/embed.jsx',
            'addon-settings': './src/playground/addon-settings.jsx',
            'credits': './src/playground/credits/credits.jsx'
        },
        output: {
            path: path.resolve(__dirname, 'build')
        },
        module: {
            rules: base.module.rules.concat([
                {
                    test: /\.(svg|png|wav|mp3|gif|jpg|woff2|hex)$/,
                    loader: 'url-loader',
                    options: {
                        limit: 2048,
                        outputPath: 'static/assets/',
                        esModule: false
                    }
                }
            ])
        },
        optimization: {
            splitChunks: {
                chunks: 'all',
                minChunks: 2,
                minSize: 50000,
                maxInitialRequests: 5
            }
        },
        plugins: base.plugins.concat([
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': `"${process.env.NODE_ENV}"`,
                'process.env.DEBUG': Boolean(process.env.DEBUG),
                'process.env.ENABLE_SERVICE_WORKER': JSON.stringify(process.env.ENABLE_SERVICE_WORKER || ''),
                'process.env.ROOT': JSON.stringify(root),
                'process.env.ROUTING_STYLE': JSON.stringify(process.env.ROUTING_STYLE || 'filehash'),
                'process.env.ENABLE_WINDCHIMES': JSON.stringify(process.env.ENABLE_WINDCHIMES || '')
            }),
            new HtmlWebpackPlugin({
                chunks: ['editor'],
                template: 'src/playground/index.ejs',
                filename: 'editor.html',
                title: `${APP_NAME} - Run Scratch projects faster`,
                isEditor: true,
                ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['player'],
                template: 'src/playground/index.ejs',
                filename: 'index.html',
                title: `${APP_NAME} - Run Scratch projects faster`,
                ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['fullscreen'],
                template: 'src/playground/index.ejs',
                filename: 'fullscreen.html',
                title: `${APP_NAME} - Run Scratch projects faster`,
                ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['embed'],
                template: 'src/playground/embed.ejs',
                filename: 'embed.html',
                title: `Embedded Project - ${APP_NAME}`,
                ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['addon-settings'],
                template: 'src/playground/simple.ejs',
                filename: 'addons.html',
                title: `Addon Settings - ${APP_NAME}`,
                ...htmlWebpackPluginCommon
            }),
            new HtmlWebpackPlugin({
                chunks: ['credits'],
                template: 'src/playground/simple.ejs',
                filename: 'credits.html',
                title: `${APP_NAME} Credits`,
                ...htmlWebpackPluginCommon
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: 'static',
                        to: ''
                    }
                ]
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: 'extensions/**',
                        to: 'static',
                        context: 'src/examples'
                    }
                ]
            })
        ])
    }),
    // tw: player used by "Export as HTML/ZIP". Everything is in one file so exported projects work offline.
    // Modules in src/lib/tw-standalone replace the parts that most projects don't need. The big optional parts
    // are built into the separate scripts below, which are only exported with projects that use them.
    standaloneConfig('standalone', './src/playground/standalone.js', {
        'scratch-render-fonts$': standaloneModule('fonts.js'),
        'scratch-parser$': standaloneModule('scratch-parser.js'),
        'scratch-sb1-converter$': standaloneModule('sb1-converter.js'),
        'three$': standaloneModule('three.js'),
        'three/examples/jsm/loaders/GLTFLoader.js$': standaloneModule('three-gltf-loader.js'),
        'three/examples/jsm/utils/SkeletonUtils.js$': standaloneModule('three-skeleton-utils.js')
    }, [
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': '"production"',
            'process.env.DEBUG': Boolean(process.env.DEBUG),
            'process.env.ENABLE_SERVICE_WORKER': JSON.stringify(''),
            'process.env.ROOT': JSON.stringify(''),
            'process.env.ROUTING_STYLE': JSON.stringify('none'),
            'process.env.ENABLE_WINDCHIMES': JSON.stringify('')
        }),
        new webpack.NormalModuleReplacementPlugin(
            /scratch3_music[\\/]manifest\.js$/,
            standaloneModule('music-assets.js')
        ),
        new webpack.NormalModuleReplacementPlugin(
            /scratch-vm[\\/]src[\\/]serialization[\\/]sb2\.js$/,
            standaloneModule('sb2.js')
        ),
        // Hardware extensions need Scratch Link and bring their own Bluetooth code
        new webpack.NormalModuleReplacementPlugin(
            /^\.\.\/extensions\/scratch3_(wedo2|microbit|ev3|boost|gdx_for)$/,
            result => {
                const id = result.request.match(/scratch3_(.+)$/)[1].replace('_', '');
                result.request = `${standaloneModule('unavailable-extension.js')}?${id}`;
            }
        )
    ]),
    standaloneConfig('standalone-music', './src/playground/standalone-music.js', {}, []),
    standaloneConfig('standalone-three', './src/playground/standalone-three.js', {}, [])
].concat(
    process.env.NODE_ENV === 'production' || process.env.BUILD_MODE === 'dist' ? (
        // export as library
        defaultsDeep({}, base, {
            target: 'web',
            entry: {
                'scratch-gui': './src/index.js'
            },
            output: {
                libraryTarget: 'umd',
                filename: 'js/[name].js',
                chunkFilename: 'js/[name].js',
                path: path.resolve('dist'),
                publicPath: `${STATIC_PATH}/`
            },
            externals: {
                'react': 'react',
                'react-dom': 'react-dom'
            },
            module: {
                rules: base.module.rules.concat([
                    {
                        test: /\.(svg|png|wav|mp3|gif|jpg|woff2|hex)$/,
                        loader: 'url-loader',
                        options: {
                            limit: 2048,
                            outputPath: 'static/assets/',
                            publicPath: `${STATIC_PATH}/assets/`,
                            esModule: false
                        }
                    }
                ])
            },
            plugins: base.plugins.concat([
                new CopyWebpackPlugin({
                    patterns: [
                        {
                            from: 'extension-worker.{js,js.map}',
                            context: 'node_modules/scratch-vm/dist/web',
                            noErrorOnMissing: true
                        }
                    ]
                }),
                // Include library JSON files for scratch-desktop to use for downloading
                new CopyWebpackPlugin({
                    patterns: [
                        {
                            from: 'src/lib/libraries/*.json',
                            to: 'libraries',
                            flatten: true
                        }
                    ]
                })
            ])
        })) : []
);
