import './scss/app.scss'

import { EventBus, PDFPageView, PDFViewerApplication } from 'pdfjs'
import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { initializeI18n } from './locale/index'
import { SyncOutlined } from '@ant-design/icons';
import i18n, { t } from 'i18next'
import { CustomPopbar, CustomPopbarRef } from './components/popbar'
import { CustomToolbar, CustomToolbarRef } from './components/toolbar'
import { annotationDefinitions, HASH_PARAMS_DEFAULT_EDITOR_ACTIVE, HASH_PARAMS_DEFAULT_SIDEBAR_OPEN, HASH_PARAMS_GET_URL, HASH_PARAMS_POST_URL, HASH_PARAMS_USERNAME, AnnotationType } from './const/definitions'
import { Painter } from './painter'
import { CustomComment, CustomCommentRef } from './components/comment'
import { CustomChatSidebar, CustomChatSidebarRef } from './components/chatSidebar'
import { ChatPopup, ChatPopupRef } from './components/chatPopup'
import { once, parseQueryString, hashArrayOfObjects } from './utils/utils'
import { defaultOptions } from './const/default_options'
import { exportAnnotationsToExcel, exportAnnotationsToPdf } from './annot'
import { Modal, Space, message } from 'antd'
import { CustomAnnotationMenu, CustomAnnotationMenuRef } from './components/menu'
import { ConnectorLine } from './painter/connectorLine'
import Konva from 'konva'
import { createDocumentIcon } from './utils/documentIcon'
import { EditorNote } from './painter/editor/editor_note'
import { PDFParse } from 'pdf-parse'

interface AppOptions {
    [key: string]: string;
}

class PdfjsAnnotationExtension {
    PDFJS_PDFViewerApplication: PDFViewerApplication // PDF.js 的 PDFViewerApplication 对象
    
    private async extractPageText(pageNumber: number): Promise<string> {
        try {
            // 使用 pdf-parse 提取文本
            const pdfDoc = this.PDFJS_PDFViewerApplication?.pdfDocument
            if (!pdfDoc) return ''

            // 获取 PDF 数据
            const pdfData = await pdfDoc.getData()
            
            // 创建 PDFParse 实例
            const parser = new PDFParse({ data: pdfData })
            
            try {
                // 仅提取指定页面的文本
                const result = await parser.getText({ partial: [pageNumber] })
                
                // 返回该页面的文本
                if (result.pages && result.pages.length > 0) {
                    return result.pages[0].text.trim()
                }
                return ''
            } finally {
                // 重要：释放资源
                await parser.destroy()
            }
        } catch (e) {
            console.warn('[Index] extractPageText with pdf-parse failed:', e)
            
            // 回退方案：使用原来的 PDF.js 方法
            try {
                const pdfDoc = this.PDFJS_PDFViewerApplication?.pdfDocument
                if (!pdfDoc) return ''
                const page = await pdfDoc.getPage(pageNumber)
                const textContent = await page.getTextContent({ includeMarkedContent: true })
                const items = (textContent.items || []) as any[]

                const lines: string[] = []
                let currentLine: string[] = []
                for (const item of items) {
                    const str = typeof item.str === 'string' ? item.str : ''
                    if (!str) continue
                    currentLine.push(str)
                    if (item.hasEOL) {
                        lines.push(currentLine.join(' ').trim())
                        currentLine = []
                    }
                }
                if (currentLine.length > 0) {
                    lines.push(currentLine.join(' ').trim())
                }
                return lines.join('\n')
            } catch (fallbackError) {
                console.warn('[Index] Fallback extractPageText also failed:', fallbackError)
                return ''
            }
        }
    }
    PDFJS_EventBus: EventBus // PDF.js 的 EventBus 对象
    $PDFJS_outerContainer: HTMLDivElement
    $PDFJS_mainContainer: HTMLDivElement
    $PDFJS_sidebarContainer: HTMLDivElement // PDF.js 侧边栏容器
    $PDFJS_toolbar_container: HTMLDivElement // PDF.js 工具栏容器
    $PDFJS_viewerContainer: HTMLDivElement // PDF.js 页面视图容器
    customToolbarRef: React.RefObject<CustomToolbarRef> // 自定义工具栏的引用
    customPopbarRef: React.RefObject<CustomPopbarRef>
    customerAnnotationMenuRef: React.RefObject<CustomAnnotationMenuRef> // 自定义批注菜单的引用
    customCommentRef: React.RefObject<CustomCommentRef> // 批注侧边栏的引用
    customChatSidebarRef: React.RefObject<CustomChatSidebarRef> // AI聊天侧边栏的引用
    chatPopupRef: React.RefObject<ChatPopupRef> // AI聊天悬浮框的引用
    painter: Painter // 画笔实例
    appOptions: AppOptions
    loadEnd: Boolean
    initialDataHash: number
    _connectorLine: ConnectorLine | null = null
    lastSelectionRange: Range | null = null
    _lastCreatedAnnotationId: string | null = null
    _pendingTranscript: string | null = null
    _pendingSelectedText: string | null = null
    _pendingCreationToken: string | null = null
    isChatPopupOpen: boolean = false
    // 恢复流程保护
    private isRestoring: boolean = false
    private restoringFingerprint: string | null = null
    // 自动保存
    private autoSaveTimer: NodeJS.Timeout | null = null
    private autoSaveDelay: number = 2000 // 2秒防抖延迟

    constructor() {
        this.loadEnd = false
        this.initialDataHash = null
        // 初始化 PDF.js 对象和相关属性
        this.PDFJS_PDFViewerApplication = (window as any).PDFViewerApplication
        this.PDFJS_EventBus = this.PDFJS_PDFViewerApplication.eventBus
        this.$PDFJS_sidebarContainer = this.PDFJS_PDFViewerApplication.appConfig.sidebar.sidebarContainer
        this.$PDFJS_toolbar_container = this.PDFJS_PDFViewerApplication.appConfig.toolbar.container
        this.$PDFJS_viewerContainer = this.PDFJS_PDFViewerApplication.appConfig.viewerContainer
        this.$PDFJS_mainContainer = this.PDFJS_PDFViewerApplication.appConfig.mainContainer
        this.$PDFJS_outerContainer = this.PDFJS_PDFViewerApplication.appConfig.sidebar.outerContainer
        // 使用 createRef 方法创建 React 引用
        this.customToolbarRef = createRef<CustomToolbarRef>()
        this.customPopbarRef = createRef<CustomPopbarRef>()
        this.customerAnnotationMenuRef = createRef<CustomAnnotationMenuRef>()
        this.customCommentRef = createRef<CustomCommentRef>()
        this.customChatSidebarRef = createRef<CustomChatSidebarRef>()
        this.chatPopupRef = createRef<ChatPopupRef>()
        // 加载多语言
        initializeI18n(this.PDFJS_PDFViewerApplication.l10n.getLanguage())
        console.log('[BuildTag] pdfjs-annotation-extension src/index.tsx token-fix v2')
        
        // 配置 pdf-parse worker
        try {
            // Worker 文件会被 webpack 复制到输出目录
            const workerPath = '/pdfjs-annotation-extension/pdf.worker.mjs'
            PDFParse.setWorker(workerPath)
            console.log('[Index] pdf-parse worker configured:', workerPath)
        } catch (e) {
            console.warn('[Index] Failed to configure pdf-parse worker:', e)
        }
        this.appOptions = {
            [HASH_PARAMS_USERNAME]: i18n.t('normal.unknownUser'), // 默认用户名,
            [HASH_PARAMS_GET_URL]: defaultOptions.setting.HASH_PARAMS_GET_URL, // 默认 GET URL
            [HASH_PARAMS_POST_URL]: defaultOptions.setting.HASH_PARAMS_POST_URL, // 默认 POST URL
            [HASH_PARAMS_DEFAULT_EDITOR_ACTIVE]: defaultOptions.setting.HASH_PARAMS_DEFAULT_EDITOR_ACTIVE,
            [HASH_PARAMS_DEFAULT_SIDEBAR_OPEN]: defaultOptions.setting.HASH_PARAMS_DEFAULT_SIDEBAR_OPEN,
        };

        // 提前读取 last-document 并设置恢复标志，避免样例文档覆盖
        try {
            const savedInfoRaw = localStorage.getItem('pdfjs-annotation-extension-last-document')
            if (savedInfoRaw) {
                const savedInfo = JSON.parse(savedInfoRaw)
                if (savedInfo?.fingerprint) {
                    this.isRestoring = true
                    this.restoringFingerprint = savedInfo.fingerprint
                    console.log('[AE] Pre-mark restoring for fingerprint:', this.restoringFingerprint)
                }
            }
        } catch (e) {
            console.warn('[AE] Failed to pre-read last document info:', e)
        }

        // 处理地址栏参数
        this.parseHashParams()
        // 创建画笔实例
        this.painter = new Painter({
            userName: this.getOption(HASH_PARAMS_USERNAME),
            PDFViewerApplication: this.PDFJS_PDFViewerApplication,
            PDFJS_EventBus: this.PDFJS_EventBus,
            setDefaultMode: () => {
                this.customToolbarRef.current.activeAnnotation(annotationDefinitions[0])
            },
            onWebSelectionSelected: range => {
                console.log('[Index] onWebSelectionSelected', { hasRange: !!range, isChatPopupOpen: this.isChatPopupOpen })
                // 在聊天弹窗打开期间，不要把 lastSelectionRange 清空
                if (range) {
                    this.lastSelectionRange = range
                } else if (!this.isChatPopupOpen) {
                    this.lastSelectionRange = null
                }
                console.log('[Index] lastSelectionRange set', { hasLast: !!this.lastSelectionRange })
                this.customPopbarRef.current.open(range)
            },
            onStoreAdd: (annotation, isOriginal, currentAnnotation) => {
                this.customCommentRef.current?.addAnnotation(annotation)
                if (isOriginal) return
                
                // 触发自动保存(新增批注)
                this.triggerAutoSave()
                const prevLast = this._lastCreatedAnnotationId
                // 仅当存在当前的创建令牌时，才认为是“本次从聊天创建”的新批注
                if (this._pendingCreationToken) {
                    this._lastCreatedAnnotationId = annotation.id
                    console.log('[Index] onStoreAdd set _lastCreatedAnnotationId', { prevLast, newLast: this._lastCreatedAnnotationId, type: annotation.type, token: this._pendingCreationToken, hasPendingTranscript: !!this._pendingTranscript })
                } else {
                    console.log('[Index] onStoreAdd ignored for lastId set (no pendingCreationToken)')
                }
                // 如果刚创建的是高亮，且当前存在创建令牌与待写入内容，实时合并写入
                if (annotation.type === AnnotationType.HIGHLIGHT && this._pendingCreationToken) {
                    console.log('[Index] onStoreAdd HIGHLIGHT (with token):', {
                        id: annotation.id,
                        contentsBefore: annotation.contentsObj?.text,
                        pendingLen: this._pendingTranscript?.length,
                        pendingSelected: this._pendingSelectedText,
                        token: this._pendingCreationToken
                    })
                    if (this._pendingTranscript) {
                        // 从 _pendingTranscript 中提取 displayText（去掉"原文："部分）
                        const fullText = this._pendingTranscript
                        let displayText = fullText
                        if (fullText.startsWith('原文：\n')) {
                            const parts = fullText.split('\n\n')
                            if (parts.length > 1) {
                                displayText = parts.slice(1).join('\n\n')
                            }
                        }
                        
                        ;(this.painter as any).updateStore(annotation.id, {
                            title: this.getOption(HASH_PARAMS_USERNAME),
                            contentsObj: { 
                                text: fullText,
                                displayText: displayText,
                                selectedText: this._pendingSelectedText || undefined
                            }
                        })
                        const updated = (this.painter as any).store.annotation(annotation.id)
                        console.log('[Index] updateStore transcript applied, store.contentsLen:', updated?.contentsObj?.text?.length)
                        this._pendingTranscript = null
                        this._pendingSelectedText = null
                        this._pendingCreationToken = null
                    }
                }
                if (currentAnnotation.isOnce) {
                    this.painter.selectAnnotation(annotation.id)
                }
                if (this.isCommentOpen()) {
                    this.customCommentRef.current?.selectedAnnotation(annotation, true)
                }
            },
            onStoreDelete: (id) => {
                this.customCommentRef.current?.delAnnotation(id)
            },
            onAnnotationSelected: (annotation, isClick, selectorRect) => {
                this.customerAnnotationMenuRef.current.open(annotation, selectorRect)
                if (isClick && this.isCommentOpen()) {
                    // 如果是点击事件并且评论栏已打开，则选中批注
                    this.customCommentRef.current?.selectedAnnotation(annotation, isClick)
                }

                this.connectorLine?.drawConnection(annotation, selectorRect)
            },
            onAnnotationChange: (annotation) => {
                console.log('[Index] onAnnotationChange:', { id: annotation.id, textLen: annotation.contentsObj?.text?.length, preview: annotation.contentsObj?.text?.slice(0, 60) })
                this.customCommentRef.current?.updateAnnotation(annotation)
            },
            onAnnotationChanging: () => {
                this.connectorLine?.clearConnection()
                this.customerAnnotationMenuRef?.current?.close()
            },
            onAnnotationChanged: (annotation, selectorRect) => {
                console.log('annotation changed', annotation)
                this.connectorLine?.drawConnection(annotation, selectorRect)
                this.customerAnnotationMenuRef?.current?.open(annotation, selectorRect)
            },
        })
        // 初始化操作
        this.init()
    }

    get connectorLine(): ConnectorLine | null {
        if (defaultOptions.connectorLine.ENABLED) {
            this._connectorLine = new ConnectorLine({})
        }
        return this._connectorLine
    }

    /**
     * @description 初始化 PdfjsAnnotationExtension 类
     */
    private init(): void {
        this.addCustomStyle()
        this.bindPdfjsEvents()
        this.renderToolbar()
        this.renderPopBar()
        this.renderAnnotationMenu()
        this.renderComment()
        this.renderChatSidebar()
        this.renderChatPopup()
        
        // 立即尝试恢复上次打开的文档，在默认文档加载之前
        this.restoreLastDocument()
    }

    /**
     * @description 处理地址栏参数
     * @returns 
     */
    private parseHashParams() {
        const hash = document.location.hash.substring(1);
        if (!hash) {
            console.warn(`HASH_PARAMS is undefined`);
            return;
        }
        const params = parseQueryString(hash);
        if (params.has(HASH_PARAMS_USERNAME)) {
            this.setOption(HASH_PARAMS_USERNAME, params.get(HASH_PARAMS_USERNAME))
        } else {
            console.warn(`${HASH_PARAMS_USERNAME} is undefined`);
        }
        if (params.has(HASH_PARAMS_GET_URL)) {
            this.setOption(HASH_PARAMS_GET_URL, params.get(HASH_PARAMS_GET_URL))
        } else {
            console.warn(`${HASH_PARAMS_GET_URL} is undefined`);
        }
        if (params.has(HASH_PARAMS_POST_URL)) {
            this.setOption(HASH_PARAMS_POST_URL, params.get(HASH_PARAMS_POST_URL))
        } else {
            console.warn(`${HASH_PARAMS_POST_URL} is undefined`);
        }
        if (params.has(HASH_PARAMS_DEFAULT_EDITOR_ACTIVE)) {
            const value = params.get(HASH_PARAMS_DEFAULT_EDITOR_ACTIVE);
            if (value === 'true') {
                this.setOption(HASH_PARAMS_DEFAULT_EDITOR_ACTIVE, 'select')
            } else {
                this.setOption(HASH_PARAMS_DEFAULT_EDITOR_ACTIVE, value || 'null')
            }
        } else {
            console.warn(`${HASH_PARAMS_DEFAULT_EDITOR_ACTIVE} is undefined`);
        }

        if (params.has(HASH_PARAMS_DEFAULT_SIDEBAR_OPEN)) {
            const value = params.get(HASH_PARAMS_DEFAULT_SIDEBAR_OPEN);
            this.setOption(HASH_PARAMS_DEFAULT_SIDEBAR_OPEN, value || 'true')
        } else {
            console.warn(`${HASH_PARAMS_DEFAULT_SIDEBAR_OPEN} is undefined`);
        }

    }

    private setOption(name: string, value: string) {
        this.appOptions[name] = value
    }

    private getOption(name: string) {
        return this.appOptions[name]
    }

    /**
     * @description 添加自定义样式
     */
    private addCustomStyle(): void {
        document.body.classList.add('PdfjsAnnotationExtension')
        this.toggleComment(this.getOption(HASH_PARAMS_DEFAULT_SIDEBAR_OPEN) === 'true')
        this.toggleChatSidebar(false) // 默认隐藏AI聊天侧边栏
    }

    /**
     * @description 切换评论栏的显示状态
     * @param open 
     */
    private toggleComment(open: boolean): void {
        console.log('🔵 toggleComment called, open:', open)
        console.log('🔵 Before - body classes:', document.body.className)
        
        if (open) {
            // 打开批注
            document.body.classList.remove('PdfjsAnnotationExtension_Comment_hidden')
            // 关闭AI聊天侧边栏
            document.body.classList.add('PdfjsAnnotationExtension_ChatSidebar_hidden')
            // 同步更新工具栏按钮状态 - 关闭AI助手按钮
            console.log('🔵 Opening Comment, closing ChatSidebar')
            this.customToolbarRef.current?.toggleChatSidebarBtn(false)
        } else {
            // 关闭批注
            document.body.classList.add('PdfjsAnnotationExtension_Comment_hidden')
            console.log('🔵 Closing Comment')
        }
        
        console.log('🔵 After - body classes:', document.body.className)
    }

    /**
     * @description 检查评论栏是否打开
     * @returns 
     */
    private isCommentOpen(): boolean {
        return !document.body.classList.contains('PdfjsAnnotationExtension_Comment_hidden')
    }

    /**
     * @description 切换AI聊天侧边栏的显示状态
     * @param open 
     */
    private toggleChatSidebar(open: boolean): void {
        console.log('🟢 toggleChatSidebar called, open:', open)
        console.log('🟢 Before - body classes:', document.body.className)
        
        if (open) {
            // 打开AI聊天
            document.body.classList.remove('PdfjsAnnotationExtension_ChatSidebar_hidden')
            // 关闭批注侧边栏
            document.body.classList.add('PdfjsAnnotationExtension_Comment_hidden')
            // 同步更新工具栏按钮状态 - 关闭批注按钮
            console.log('🟢 Opening ChatSidebar, closing Comment')
            this.customToolbarRef.current?.toggleSidebarBtn(false)
        } else {
            // 关闭AI聊天
            document.body.classList.add('PdfjsAnnotationExtension_ChatSidebar_hidden')
            console.log('🟢 Closing ChatSidebar')
        }
        
        console.log('🟢 After - body classes:', document.body.className)
    }

    /**
     * @description 渲染自定义工具栏
     */
    private renderToolbar(): void {
        const toolbar = document.createElement('div')
        this.$PDFJS_toolbar_container.insertAdjacentElement('afterend', toolbar)
        createRoot(toolbar).render(
            <CustomToolbar
                ref={this.customToolbarRef}
                defaultAnnotationName={this.getOption(HASH_PARAMS_DEFAULT_EDITOR_ACTIVE)}
                defaultSidebarOpen={this.getOption(HASH_PARAMS_DEFAULT_SIDEBAR_OPEN) === 'true'}
                userName={this.getOption(HASH_PARAMS_USERNAME)}
                onChange={(currentAnnotation, dataTransfer) => {
                    this.painter.activate(currentAnnotation, dataTransfer)
                }}
                onSave={() => {
                    this.saveData()
                }}
                onExport={async (type) => {
                    if (type === 'excel') {
                        this.exportExcel()
                        return
                    }
                    if (type === 'pdf') {
                        await this.exportPdf()
                        return
                    }
                }}
                onSidebarOpen={(isOpen) => {
                    this.toggleComment(isOpen)
                    this.connectorLine.clearConnection()
                }}
                onChatSidebarOpen={(isOpen) => {
                    this.toggleChatSidebar(isOpen)
                }}
            />
        )
    }

    /**
     * @description 渲染自定义弹出工具条
     */
    private renderPopBar(): void {
        const popbar = document.createElement('div')
        this.$PDFJS_viewerContainer.insertAdjacentElement('afterend', popbar)
        createRoot(popbar).render(
            <CustomPopbar
                ref={this.customPopbarRef}
                onChange={async (currentAnnotation, range) => {
                    // 如果是"发送到AI"，则打开聊天悬浮框，并附带当前页文本
                    if (currentAnnotation && currentAnnotation.type === AnnotationType.SEND_TO_AI) {
                        const selectedText = range?.toString().trim()
                        if (selectedText && this.chatPopupRef.current) {
                            const selection = window.getSelection()
                            if (selection && selection.rangeCount > 0) {
                                const rect = selection.getRangeAt(0).getBoundingClientRect()
                                const pageNumber = this.PDFJS_PDFViewerApplication?.pdfViewer?.currentPageNumber || 1
                                const pageText = await this.extractPageText(pageNumber)
                                this.chatPopupRef.current.open(
                                    selectedText,
                                    { text: pageText, pageNumber },
                                    { x: rect.left, y: rect.bottom + 10 }
                                )
                                this.isChatPopupOpen = true
                                // 新开聊天弹窗时，强制下一次“添加到批注”走创建流程，避免覆盖上一次批注
                                console.log('[Index] open ChatPopup', { selectedTextLen: selectedText.length, pageNumber, attachmentLen: pageText?.length, pos: { x: rect.left, y: rect.bottom + 10 } })
                                this._lastCreatedAnnotationId = null
                                console.log('[Index] reset _lastCreatedAnnotationId to null')
                            }
                        }
                    } else {
                        this.painter.highlightRange(range, currentAnnotation)
                    }
                }}
            />
        )
    }

    /**
     * @description 渲染自定义弹出工具条
     */
    private renderAnnotationMenu(): void {
        const annotationMenu = document.createElement('div')
        this.$PDFJS_outerContainer.insertAdjacentElement('afterend', annotationMenu)
        createRoot(annotationMenu).render(
            <CustomAnnotationMenu
                ref={this.customerAnnotationMenuRef}
                onOpenComment={(currentAnnotation) => {
                    this.toggleComment(true)
                    this.customToolbarRef.current.toggleSidebarBtn(true)
                    setTimeout(() => {
                        this.customCommentRef.current?.selectedAnnotation(currentAnnotation, true)
                    }, 100)
                }}
                onChangeStyle={(currentAnnotation, style) => {
                    this.painter.updateAnnotationStyle(currentAnnotation, style)
                    this.customToolbarRef.current.updateStyle(currentAnnotation.type, style)
                }}
                onDelete={(currentAnnotation) => {
                    this.painter.delete(currentAnnotation.id, true)
                    // 触发自动保存
                    this.triggerAutoSave()
                }}
            />
        )
    }

    /**
     * @description 渲染批注侧边栏
     */
    private renderComment(): void {
        const comment = document.createElement('div')
        this.$PDFJS_mainContainer.insertAdjacentElement('afterend', comment)
        createRoot(comment).render(
            <CustomComment
                ref={this.customCommentRef}
                userName={this.getOption(HASH_PARAMS_USERNAME)}
                onSelected={async (annotation) => {
                    await this.painter.highlight(annotation)
                }}
                onDelete={(id) => {
                    this.painter.delete(id)
                    // 触发自动保存
                    this.triggerAutoSave()
                }}
                onUpdate={(annotation) => {
                    this.painter.update(annotation.id, {
                        title: annotation.title,
                        contentsObj: annotation.contentsObj,
                        comments: annotation.comments
                    })
                    // 触发自动保存
                    this.triggerAutoSave()
                }}
                onScroll={() => {
                    this.connectorLine?.clearConnection()
                }}
                getPageText={async (pageNumber: number) => await this.extractPageText(pageNumber)}
            />
        )
    }

    /**
     * @description 渲染AI聊天侧边栏
     */
    private renderChatSidebar(): void {
        const chatSidebar = document.createElement('div')
        this.$PDFJS_mainContainer.insertAdjacentElement('afterend', chatSidebar)
        createRoot(chatSidebar).render(
            <CustomChatSidebar
                ref={this.customChatSidebarRef}
                getPageText={async (pageNumber: number) => await this.extractPageText(pageNumber)}
                getCurrentPageNumber={() => this.PDFJS_PDFViewerApplication?.pdfViewer?.currentPageNumber || 1}
            />
        )
    }

    /**
     * @description 渲染AI聊天悬浮框
     */
    private renderChatPopup(): void {
        const chatPopup = document.createElement('div')
        document.body.appendChild(chatPopup)
        createRoot(chatPopup).render(
            <ChatPopup
                ref={this.chatPopupRef}
                onClose={() => { this.isChatPopupOpen = false }}
                getPageText={async (pageNumber: number) => await this.extractPageText(pageNumber)}
                getCurrentPageNumber={() => this.PDFJS_PDFViewerApplication?.pdfViewer?.currentPageNumber || 1}
                onAddToAnnotation={(transcript, selectedText) => {
                    console.log('[Index] onAddToAnnotation start', { transcriptLen: transcript?.length, selectedTextLen: selectedText?.length, hasLastRange: !!this.lastSelectionRange, lastCreatedId: this._lastCreatedAnnotationId })
                    // 如果已有“本次创建的批注”，则认为是对同一批注的更新，直接写入，不走新建
                    if (this._lastCreatedAnnotationId) {
                        const target = (this.painter as any).store.annotation(this._lastCreatedAnnotationId)
                        if (target && target.type === AnnotationType.HIGHLIGHT) {
                            ;(this.painter as any).updateStore(target.id, {
                                title: this.getOption(HASH_PARAMS_USERNAME),
                                contentsObj: { 
                                    text: selectedText ? `原文：\n${selectedText}\n\n${transcript}` : transcript,
                                    displayText: transcript,
                                    selectedText: selectedText || undefined
                                }
                            })
                            this.customCommentRef.current?.selectedAnnotation(target, true)
                            message.success(t('chat.addedToAnnotation'))
                            return
                        }
                    }

                    // 否则走新建流程：生成令牌并创建高亮
                    console.log('[Index] token before set', { token: this._pendingCreationToken })
                    this._pendingTranscript = selectedText ? `原文：\n${selectedText}\n\n${transcript}` : transcript
                    this._pendingSelectedText = selectedText
                    this._pendingCreationToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`
                    // 确保首次从弹窗添加时新建批注
                    this._lastCreatedAnnotationId = null
                    console.log('[Index] onAddToAnnotation set pendingCreationToken & reset _lastCreatedAnnotationId', { token: this._pendingCreationToken })
                    console.log('[Index] lastSelectionRange snapshot', { hasLast: !!this.lastSelectionRange })

                    if (this.lastSelectionRange) {
                        const highlightAnno = annotationDefinitions.find(def => def.type === AnnotationType.HIGHLIGHT)
                        if (highlightAnno) {
                            this.painter.highlightRange(this.lastSelectionRange, highlightAnno)
                            return
                        }
                        message.error('Highlight annotation type not found')
                        return
                    }

                    const selection = window.getSelection()
                    if (selection && selection.rangeCount > 0) {
                        this.lastSelectionRange = selection.getRangeAt(0)
                        const highlightAnno = annotationDefinitions.find(def => def.type === AnnotationType.HIGHLIGHT)
                        if (highlightAnno) {
                            this.painter.highlightRange(this.lastSelectionRange, highlightAnno)
                            return
                        }
                    }
                    message.error('未检测到选区，无法创建高亮批注')
                }}
            />
        )
    }

    /**
     * @description 隐藏 PDF.js 编辑模式按钮
     */
    private hidePdfjsEditorModeButtons(): void {
        defaultOptions.setting.HIDE_PDFJS_ELEMENT.forEach(item => {
            const element = document.querySelector(item) as HTMLElement;
            if (element) {
                element.style.display = 'none';
                const nextDiv = element.nextElementSibling as HTMLElement;
                if (nextDiv.classList.contains('horizontalToolbarSeparator')) {
                    nextDiv.style.display = 'none'
                }
            }
        });
    }

    private updatePdfjs() {
        const currentScaleValue = this.PDFJS_PDFViewerApplication.pdfViewer.currentScaleValue
        if (
            currentScaleValue === 'auto' ||
            currentScaleValue === 'page-fit' ||
            currentScaleValue === 'page-width'
        ) {
            this.PDFJS_PDFViewerApplication.pdfViewer.currentScaleValue = '0.8'
            this.PDFJS_PDFViewerApplication.pdfViewer.update()
        } else {
            this.PDFJS_PDFViewerApplication.pdfViewer.currentScaleValue = 'auto'
            this.PDFJS_PDFViewerApplication.pdfViewer.update()
        }
        this.PDFJS_PDFViewerApplication.pdfViewer.currentScaleValue = currentScaleValue
        this.PDFJS_PDFViewerApplication.pdfViewer.update()
    }

    /**
     * @description 绑定 PDF.js 相关事件
     */
    private bindPdfjsEvents(): void {
        this.hidePdfjsEditorModeButtons()
        const setLoadEnd = once(() => {
            this.loadEnd = true
        })

        // 视图更新时隐藏菜单
        this.PDFJS_EventBus._on('updateviewarea', () => {
            this.customerAnnotationMenuRef.current?.close()
            this.connectorLine?.clearConnection()
        })

        // 监听页面渲染完成事件
        this.PDFJS_EventBus._on(
            'pagerendered',
            async ({ source, cssTransform, pageNumber }: { source: PDFPageView; cssTransform: boolean; pageNumber: number }) => {
                setLoadEnd()
                this.painter.initCanvas({ pageView: source, cssTransform, pageNumber })
            }
        )

        // 监听文档加载完成事件
        this.PDFJS_EventBus._on('documentloaded', async () => {
            // 切换文档时先重置所有状态，避免重复项
            this.painter.resetForNewDocument()
            // 清空侧栏批注列表显示
            this.customCommentRef.current?.clearAnnotations()

            const currentFp = this.PDFJS_PDFViewerApplication?.pdfDocument?.fingerprints?.[0]
            const isTargetRestored = this.isRestoring && this.restoringFingerprint === currentFp

            // 非恢复阶段，或恢复到了目标文档时，才保存“当前文档”信息
            if (!this.isRestoring || isTargetRestored) {
                this.saveCurrentDocument()
            } else {
                console.log('[AE] Skip saveCurrentDocument during restore, currentFp:', currentFp, 'target:', this.restoringFingerprint)
            }

            this.painter.initWebSelection(this.$PDFJS_viewerContainer)
            const data = await this.getData()
            this.initialDataHash = hashArrayOfObjects(data)
            await this.painter.initAnnotations(data, defaultOptions.setting.LOAD_PDF_ANNOTATION)
            if (this.loadEnd) {
                this.updatePdfjs()
            }

            // 如果是恢复并且已到达目标文档，解除保护
            if (isTargetRestored) {
                console.log('[AE] Restore completed for fingerprint:', currentFp)
                this.isRestoring = false
                this.restoringFingerprint = null
            }
        })
    }

    /**
     * @description 保存当前文档信息和数据到浏览器缓存
     */
    private async saveCurrentDocument(): Promise<void> {
        try {
            const pdfDocument = this.PDFJS_PDFViewerApplication?.pdfDocument;
            if (!pdfDocument) return;

            // 获取文档 URL，优先使用应用的 URL
            let documentUrl = this.PDFJS_PDFViewerApplication?.url || pdfDocument.url || '';
            
            const documentInfo = {
                url: documentUrl,
                fingerprint: pdfDocument.fingerprints?.[0] || '',
                title: pdfDocument.title || '',
                timestamp: Date.now()
            };

            // 保存文档基本信息
            localStorage.setItem('pdfjs-annotation-extension-last-document', JSON.stringify(documentInfo));

            console.log('[AE] Saved document info:', documentInfo);
            console.log('[AE] Document URL type:', documentUrl.startsWith('blob:') ? 'blob' : 'other');

            // 尝试保存文档数据
            await this.saveDocumentData(pdfDocument, documentInfo.fingerprint);
        } catch (error) {
            console.warn('[AE] Failed to save document info:', error);
        }
    }

    /**
     * @description 保存文档数据到 IndexedDB
     */
    private async saveDocumentData(pdfDocument: any, fingerprint: string): Promise<void> {
        try {
            console.log('[AE] Attempting to save document data...');
            
            // 尝试从 PDF 文档获取原始数据
            let documentData: ArrayBuffer | null = null;
            
            // 方法1: 尝试从 pdfDocument 获取数据
            if (pdfDocument.getData) {
                console.log('[AE] Getting data from pdfDocument.getData()');
                documentData = await pdfDocument.getData();
            }
            
            // 方法2: 如果是 blob URL，从 URL 获取
            const documentUrl = this.PDFJS_PDFViewerApplication?.url || pdfDocument.url || '';
            if (!documentData && documentUrl.startsWith('blob:')) {
                console.log('[AE] Getting data from blob URL');
                const response = await fetch(documentUrl);
                documentData = await response.arrayBuffer();
            }
            
            if (documentData) {
                console.log('[AE] Document data size:', documentData.byteLength, 'bytes');
                await this.saveDataToIndexedDB(documentData, fingerprint);
            } else {
                console.log('[AE] No document data available to save');
            }
        } catch (error) {
            console.warn('[AE] Failed to save document data:', error);
        }
    }

    /**
     * @description 保存数据到 IndexedDB
     */
    private async saveDataToIndexedDB(data: ArrayBuffer, fingerprint: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                // 打开 IndexedDB，增加版本号以确保触发 onupgradeneeded
                const dbRequest = indexedDB.open('pdfjs-annotation-extension-files', 2);
                
                dbRequest.onupgradeneeded = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    console.log('[AE] Database upgrade needed, current object stores:', Array.from(db.objectStoreNames));
                    
                    // 删除旧的对象存储（如果存在）
                    if (db.objectStoreNames.contains('files')) {
                        db.deleteObjectStore('files');
                        console.log('[AE] Deleted old files object store');
                    }
                    
                    // 创建新的对象存储
                    const store = db.createObjectStore('files', { keyPath: 'fingerprint' });
                    console.log('[AE] Created new files object store');
                };

                dbRequest.onsuccess = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    console.log('[AE] Database opened successfully, object stores:', Array.from(db.objectStoreNames));
                    
                    // 检查对象存储是否存在
                    if (!db.objectStoreNames.contains('files')) {
                        console.error('[AE] Files object store still does not exist after opening');
                        reject(new Error('Files object store not found'));
                        return;
                    }
                    
                    try {
                        const transaction = db.transaction(['files'], 'readwrite');
                        const store = transaction.objectStore('files');
                        
                        const putRequest = store.put({
                            fingerprint: fingerprint,
                            data: data,
                            timestamp: Date.now()
                        });

                        putRequest.onsuccess = () => {
                            console.log('[AE] Successfully saved document data for fingerprint:', fingerprint);
                            resolve();
                        };

                        putRequest.onerror = (error) => {
                            console.warn('[AE] Failed to put data in IndexedDB:', error);
                            reject(error);
                        };
                        
                        transaction.onerror = (error) => {
                            console.warn('[AE] Transaction error:', error);
                            reject(error);
                        };
                    } catch (transactionError) {
                        console.warn('[AE] Failed to create transaction:', transactionError);
                        reject(transactionError);
                    }
                };

                dbRequest.onerror = (event) => {
                    console.warn('[AE] Failed to open IndexedDB for saving:', event);
                    reject(event);
                };
            } catch (error) {
                console.warn('[AE] Failed to save document data:', error);
                reject(error);
            }
        });
    }

    /**
     * @description 从缓存恢复上次打开的文档
     */
    private async restoreLastDocument(): Promise<boolean> {
        try {
            const savedInfo = localStorage.getItem('pdfjs-annotation-extension-last-document');
            if (!savedInfo) return false;

            const documentInfo = JSON.parse(savedInfo);
            if (!documentInfo.fingerprint) return false;

            console.log('[AE] Restoring last document:', documentInfo);

            // 如果当前已是该文档，跳过
            const currentFingerprint = this.PDFJS_PDFViewerApplication?.pdfDocument?.fingerprints?.[0];
            if (currentFingerprint && currentFingerprint === documentInfo.fingerprint) {
                console.log('[AE] Document already loaded, skipping restore');
                return false;
            }

            // 优先从 IndexedDB 读取数据
            console.log('[AE] Trying to get data from IndexedDB for fingerprint:', documentInfo.fingerprint);
            const data = await this.getDataFromIndexedDB(documentInfo.fingerprint);
            
            if (data) {
                // 标记处于恢复过程，记录目标指纹
                this.isRestoring = true
                this.restoringFingerprint = documentInfo.fingerprint

                // 在打开新文档前，尽量中止当前加载或关闭当前文档，避免 Transport destroyed
                try {
                    if ((this.PDFJS_PDFViewerApplication as any).pdfLoadingTask?.destroy) {
                        console.log('[AE] Destroying existing pdfLoadingTask before restore');
                        await (this.PDFJS_PDFViewerApplication as any).pdfLoadingTask.destroy();
                    }
                } catch (e) {
                    console.warn('[AE] Failed to destroy existing loading task:', e);
                }
                try {
                    if ((this.PDFJS_PDFViewerApplication as any).close) {
                        console.log('[AE] Closing current document before restore');
                        await (this.PDFJS_PDFViewerApplication as any).close();
                    }
                } catch (e) {
                    console.warn('[AE] Failed to close current document:', e);
                }

                console.log('[AE] Opening document from binary data');
                // 使用 data 方式打开，避免 url 参数校验错误
                const uint8 = new Uint8Array(data);
                // 等待一个微任务，降低与内部清理的竞争
                await Promise.resolve();
                await this.PDFJS_PDFViewerApplication.open({ data: uint8 });
                console.log('[AE] Restored document from data cache');
                return true;
            }

            // 回退：尝试使用原始 URL（非 blob）
            if (documentInfo.url && !documentInfo.url.startsWith('blob:')) {
                try {
                    if ((this.PDFJS_PDFViewerApplication as any).pdfLoadingTask?.destroy) {
                        console.log('[AE] Destroying existing pdfLoadingTask before URL restore');
                        await (this.PDFJS_PDFViewerApplication as any).pdfLoadingTask.destroy();
                    }
                } catch (e) {
                    console.warn('[AE] Failed to destroy existing loading task (URL):', e);
                }
                try {
                    if ((this.PDFJS_PDFViewerApplication as any).close) {
                        console.log('[AE] Closing current document before URL restore');
                        await (this.PDFJS_PDFViewerApplication as any).close();
                    }
                } catch (e) {
                    console.warn('[AE] Failed to close current document (URL):', e);
                }

                await this.PDFJS_PDFViewerApplication.open(documentInfo.url);
                console.log('[AE] Restored document from URL fallback');
                return true;
            }

            console.log('[AE] No valid document data to restore');
            return false;
        } catch (error) {
            console.warn('[AE] Failed to restore last document:', error);
            return false;
        }
    }

    /**
     * @description 从 IndexedDB 获取文档数据
     */
    private async getDataFromIndexedDB(fingerprint: string): Promise<ArrayBuffer | null> {
        return new Promise((resolve) => {
            try {
                const dbRequest = indexedDB.open('pdfjs-annotation-extension-files', 2);
                
                dbRequest.onupgradeneeded = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    console.log('[AE] Database upgrade needed during read, current object stores:', Array.from(db.objectStoreNames));
                    
                    // 删除旧的对象存储（如果存在）
                    if (db.objectStoreNames.contains('files')) {
                        db.deleteObjectStore('files');
                        console.log('[AE] Deleted old files object store during read');
                    }
                    
                    // 创建新的对象存储
                    const store = db.createObjectStore('files', { keyPath: 'fingerprint' });
                    console.log('[AE] Created new files object store during read');
                };
                
                dbRequest.onsuccess = (event) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    console.log('[AE] Database opened for read, object stores:', Array.from(db.objectStoreNames));
                    
                    // 检查对象存储是否存在
                    if (!db.objectStoreNames.contains('files')) {
                        console.log('[AE] Files object store does not exist');
                        resolve(null);
                        return;
                    }
                    
                    try {
                        const transaction = db.transaction(['files'], 'readonly');
                        const store = transaction.objectStore('files');
                        const getRequest = store.get(fingerprint);
                        
                        getRequest.onsuccess = () => {
                            const result = getRequest.result;
                            if (result && result.data) {
                                console.log('[AE] Found document data for fingerprint:', fingerprint);
                                resolve(result.data);
                            } else if (result && result.blob) {
                                // 兼容旧格式
                                console.log('[AE] Found blob data for fingerprint:', fingerprint);
                                result.blob.arrayBuffer().then(resolve).catch(() => resolve(null));
                            } else {
                                console.log('[AE] No document data found for fingerprint:', fingerprint);
                                resolve(null);
                            }
                        };
                        
                        getRequest.onerror = () => {
                            console.warn('[AE] Error getting data from IndexedDB');
                            resolve(null);
                        };
                        
                        transaction.onerror = () => {
                            console.warn('[AE] Transaction error during read');
                            resolve(null);
                        };
                    } catch (transactionError) {
                        console.warn('[AE] Failed to create read transaction:', transactionError);
                        resolve(null);
                    }
                };
                
                dbRequest.onerror = () => {
                    console.warn('[AE] Error opening IndexedDB for read');
                    resolve(null);
                };
            } catch (error) {
                console.warn('[AE] Failed to get data from IndexedDB:', error);
                resolve(null);
            }
        });
    }

    /**
     * @description 获取外部批注数据
     * @returns 
     */
    private async getData(): Promise<any[]> {
        const getUrl = this.getOption(HASH_PARAMS_GET_URL);
        if (!getUrl) {
            return [];
        }
        try {
            message.open({
                type: 'loading',
                content: t('normal.processing'),
                duration: 0,
            });
            const fingerprint = this.PDFJS_PDFViewerApplication?.pdfDocument?.fingerprints?.[0];
            const username = this.getOption(HASH_PARAMS_USERNAME);
            const url = getUrl + (getUrl.includes('?') ? '&' : '?') + `docId=${encodeURIComponent(fingerprint || 'default')}&username=${encodeURIComponent(username || 'unknown')}`;
            console.log('[AE] GET annotations', { fingerprint, username, url });
            const response = await fetch(url, { method: 'GET' });

            if (!response.ok) {
                const errorMessage = `HTTP Error ${response.status}: ${response.statusText || 'Unknown Status'}`;
                throw new Error(errorMessage);
            }
            return await response.json();
        } catch (error) {
            Modal.error({
                content: t('load.fail', { value: error?.message }),
                closable: false,
                okButtonProps: {
                    loading: false
                },
                okText: t('normal.ok')
            })
            console.error('Fetch error:', error);
            return [];
        } finally {
            message.destroy();
        }
    }

    /**
     * @description 保存批注数据
     * @returns 
     */
    private async saveData(): Promise<void> {
        const dataToSave = this.painter.getData();
        console.log('%c [ dataToSave ]', 'font-size:13px; background:#d10d00; color:#ff5144;', dataToSave)
        const postUrl = this.getOption(HASH_PARAMS_POST_URL);
        if (!postUrl) {
            message.error({
                content: t('save.noPostUrl', { value: HASH_PARAMS_POST_URL }),
                key: 'save',
            });
            return;
        }
        const modal = Modal.info({
            content: <Space><SyncOutlined spin />{t('save.start')}</Space>,
            closable: false,
            okButtonProps: {
                loading: true
            },
            okText: t('normal.ok')
        })
        try {
            const fingerprint = this.PDFJS_PDFViewerApplication?.pdfDocument?.fingerprints?.[0];
            const username = this.getOption(HASH_PARAMS_USERNAME);
            const url = postUrl + (postUrl.includes('?') ? '&' : '?') + `docId=${encodeURIComponent(fingerprint || 'default')}&username=${encodeURIComponent(username || 'unknown')}`;
            console.log('[AE] POST annotations', { fingerprint, username, url, count: Array.isArray(dataToSave) ? dataToSave.length : 1 });
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSave),
            });
            if (!response.ok) {
                throw new Error(`Failed to save PDF. Status: ${response.status} ${response.statusText}`);
            }
            const result = await response.json();
            // {"status": "ok", "message": "POST received!"}
            this.initialDataHash = hashArrayOfObjects(dataToSave)
            modal.destroy()
            message.success({
                content: t('save.success'),
                key: 'save',
            });
            console.log('Saved successfully:', result);
        } catch (error) {
            modal.update({
                type: 'error',
                content: t('save.fail', { value: error?.message }),
                closable: true,
                okButtonProps: {
                    loading: false
                },
            })
            console.error('Error while saving data:', error);
        }
    }

    /**
     * @description 触发自动保存(带防抖)
     */
    private triggerAutoSave(): void {
        // 清除之前的定时器
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer)
        }
        
        // 设置新的定时器
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveNow()
        }, this.autoSaveDelay)
    }

    /**
     * @description 立即执行自动保存(静默保存,不显示弹窗)
     */
    private async autoSaveNow(): Promise<void> {
        const dataToSave = this.painter.getData();
        const postUrl = this.getOption(HASH_PARAMS_POST_URL);
        
        if (!postUrl) {
            console.log('[AutoSave] No POST URL configured, skipping auto-save');
            return;
        }

        try {
            const fingerprint = this.PDFJS_PDFViewerApplication?.pdfDocument?.fingerprints?.[0];
            const username = this.getOption(HASH_PARAMS_USERNAME);
            const url = postUrl + (postUrl.includes('?') ? '&' : '?') + `docId=${encodeURIComponent(fingerprint || 'default')}&username=${encodeURIComponent(username || 'unknown')}`;
            
            console.log('[AutoSave] Saving annotations...', { count: Array.isArray(dataToSave) ? dataToSave.length : 1 });
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSave),
            });
            
            if (!response.ok) {
                throw new Error(`Auto-save failed. Status: ${response.status}`);
            }
            
            const result = await response.json();
            this.initialDataHash = hashArrayOfObjects(dataToSave);
            console.log('[AutoSave] Saved successfully:', result);
        } catch (error) {
            console.error('[AutoSave] Error while auto-saving:', error);
        }
    }

    private async exportPdf() {
        const dataToSave = this.painter.getData();
        const modal = Modal.info({
            title: t('normal.export'),
            content: <Space><SyncOutlined spin />{t('normal.processing')}</Space>,
            closable: false,
            okButtonProps: {
                loading: true
            },
            okText: t('normal.ok')
        })
        await exportAnnotationsToPdf(this.PDFJS_PDFViewerApplication, dataToSave)
        modal.update({
            type: 'success',
            title: t('normal.export'),
            content: t('pdf.generationSuccess'),
            closable: true,
            okButtonProps: {
                loading: false
            },
        })
    }

    private async exportExcel() {
        const annotations = this.painter.getData()
        await exportAnnotationsToExcel(this.PDFJS_PDFViewerApplication, annotations)
        Modal.info({
            type: 'success',
            title: t('normal.export'),
            content: t('pdf.generationSuccess'),
            closable: true,
            okButtonProps: {
                loading: false
            },
        })
    }

    public hasUnsavedChanges(): boolean {
        return hashArrayOfObjects(this.painter.getData()) !== this.initialDataHash
    }

}

declare global {
    interface Window {
        pdfjsAnnotationExtensionInstance: PdfjsAnnotationExtension
    }
}

window.pdfjsAnnotationExtensionInstance = new PdfjsAnnotationExtension()