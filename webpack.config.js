const path = require('path')
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const environment = require('./configuration/environment')

module.exports = {
    entry: {
        'pdfjs-annotation-extension': path.resolve(environment.paths.source, 'index.tsx')
    },
    output: {
        filename: '[name].js',
        path: environment.paths.output,
        library: {
            name: 'PdfjsAnnotationExtension',
            type: 'umd'
        },
        clean: true
    },
    resolve: {
        extensions: ['.js', '.jsx', '.ts', '.tsx']
    },
    module: {
        rules: [
            {
                test: /\.otf$/i,
                resourceQuery: /arraybuffer/,
                type: 'asset/source' // 直接作为原始内容导入
            },
            {
                test: /\.((c|sa|sc)ss)$/i,
                use: ['style-loader', 'css-loader', 'postcss-loader', 'sass-loader']
            },
            {
                test: /\.(j|t)sx?$/,
                use: ['babel-loader'],
                exclude: {
                    and: [/node_modules/],
                    not: [/unfetch/, /d3-array|d3-scale/, /@hapi[\\/]joi-date/]
                }
            },
            {
                test: /\.(png|jpeg|jpg|gif|svg)$/i,
                type: 'asset',
                generator: {
                    filename: 'images/[name].[hash:6][ext]'
                }
            },
            {
                test: /\.(eot|ttf|woff|woff2)$/,
                type: 'asset',
                parser: {
                    dataUrlCondition: {
                        maxSize: 8192
                    }
                },
                generator: {
                    filename: 'font/[name].[hash:6][ext]'
                }
            }
        ]
    },
    optimization: {
        minimizer: [
            '...'
            // Disabled ImageMinimizerPlugin to avoid build errors
            // new ImageMinimizerPlugin({
            //     minimizer: {
            //         implementation: ImageMinimizerPlugin.imageminMinify,
            //         options: {
            //             plugins: [
            //                 [
            //                     'imagemin-svgo',
            //                     {
            //                         plugins: [{ name: 'removeViewBox', active: false }]
            //                     }
            //                 ]
            //             ]
            //         }
            //     }
            // })
        ]
    },
    cache: {
        type: 'filesystem'
    },
    plugins: [
        new CleanWebpackPlugin({
            verbose: true
        }),
        // 复制 pdf-parse worker 文件
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, '../node_modules/pdf-parse/dist/pdf-parse/web/pdf.worker.mjs'),
                    to: path.resolve(environment.paths.output, 'pdf.worker.mjs')
                }
            ]
        }),
        // 编译完成后自动复制到 Next.js public 目录
        {
            apply: (compiler) => {
                compiler.hooks.afterEmit.tap('CopyToPublic', (compilation) => {
                    const fs = require('fs')
                    const path = require('path')
                    
                    const sourceDir = environment.paths.output
                    const targetDir = environment.paths.publicOutput
                    
                    // 递归复制目录
                    function copyDir(src, dest) {
                        if (!fs.existsSync(dest)) {
                            fs.mkdirSync(dest, { recursive: true })
                        }
                        
                        const entries = fs.readdirSync(src, { withFileTypes: true })
                        
                        for (let entry of entries) {
                            const srcPath = path.join(src, entry.name)
                            const destPath = path.join(dest, entry.name)
                            
                            if (entry.isDirectory()) {
                                copyDir(srcPath, destPath)
                            } else {
                                fs.copyFileSync(srcPath, destPath)
                            }
                        }
                    }
                    
                    try {
                        copyDir(sourceDir, targetDir)
                        console.log(`✅ 已复制编译产物到: ${targetDir}`)
                    } catch (err) {
                        console.error('❌ 复制文件失败:', err)
                    }
                })
            }
        }
    ],
    target: 'web'
}
