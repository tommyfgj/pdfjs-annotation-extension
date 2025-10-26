import './index.scss'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { MarkdownContent } from '../common/MarkdownContent'
import { useTranslation } from 'react-i18next'
import { Button, Input, Popover } from 'antd'
import { SendOutlined, DeleteOutlined, CloseOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons'

const { TextArea } = Input

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string // 实际发送给 API 的内容（包含附件）
    displayContent?: string // 用于界面显示的内容（不包含附件）
    attachmentPages?: number[] // 附件页码列表
    timestamp: number
}

export interface ChatPopupRef {
    open: (selectedText: string, attachment: { text: string, pageNumber?: number }, position: { x: number, y: number }) => void
    close: () => void
}

interface ChatPopupProps {
    onAddToAnnotation?: (transcript: string, selectedText: string) => void
    onClose?: () => void
    getPageText?: (pageNumber: number) => Promise<string>
    getCurrentPageNumber?: () => number
}

const ChatPopup = forwardRef<ChatPopupRef, ChatPopupProps>((props, ref) => {
    const { t } = useTranslation()
    const [show, setShow] = useState(false)
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const [selectedText, setSelectedText] = useState('')
    const [isDragging, setIsDragging] = useState(false)
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    // 附件（当前页文本）
    type AttachmentItem = { pageNumber: number, text: string }
    const attachmentsRef = useRef<AttachmentItem[]>([])

    // 可调整下半部分高度（输入区容器）
    const [bottomHeight, setBottomHeight] = useState(80)
    const [isResizing, setIsResizing] = useState(false)
    const resizeStartYRef = useRef(0)
    const resizeStartHeightRef = useRef(0)

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    const adjustPositionWithinViewport = useCallback((targetX: number, targetY: number) => {
        if (!containerRef.current) {
            return { x: targetX, y: targetY }
        }

        const rect = containerRef.current.getBoundingClientRect()
        const popupWidth = rect.width || 400
        const popupHeight = rect.height || 500

        const padding = 12
        const minX = padding
        const maxX = window.innerWidth - popupWidth - padding
        const minY = padding
        const maxY = window.innerHeight - popupHeight - padding

        const adjustedX = Math.min(Math.max(targetX, minX), Math.max(maxX, minX))
        const adjustedY = Math.min(Math.max(targetY, minY), Math.max(maxY, minY))

        return { x: adjustedX, y: adjustedY }
    }, [])

    useImperativeHandle(ref, () => ({
        open: (text: string, attachment: { text: string, pageNumber?: number }, pos: { x: number, y: number }) => {
            setSelectedText(text)
            attachmentsRef.current = []
            if (attachment?.text && attachment?.pageNumber) {
                attachmentsRef.current.push({ pageNumber: attachment.pageNumber, text: attachment.text })
            }
            // 打开时清空输入框
            setInput('')
            setMessages([])
            setShow(true)

            setTimeout(() => {
                const rect = containerRef.current?.getBoundingClientRect()

                let targetX = pos.x
                let targetY = pos.y

                if (rect) {
                    const exceedsBottom = pos.y + rect.height > window.innerHeight
                    const exceedsRight = pos.x + rect.width > window.innerWidth

                    if (exceedsBottom) {
                        targetY = pos.y - rect.height - 10
                    }
                    if (exceedsRight) {
                        targetX = pos.x - rect.width - 10
                    }
                }

                const correctedPos = adjustPositionWithinViewport(targetX, targetY)
                setPosition(correctedPos)
                // 不自动聚焦输入框，避免打断页面的文字选中状态
            }, 0)
        },
        close: () => {
            // 关闭时中止可能仍在进行的请求，避免流回调继续写入导致异常
            abortRef.current?.abort()
            setIsLoading(false)
            abortRef.current = null
            setShow(false)
            setMessages([])
            setInput('')
            setSelectedText('')
            props.onClose?.()
        }
    }))

    const sendMessage = async () => {
        if (isLoading) return

        // 构造最终 prompt：以下是原始PDF内容：第xx页：xxxx，第yy页：yyyy，最后是用户的输入prompt。
        const userInput = input.trim()
        const hasAttachments = attachmentsRef.current.length > 0
        if (!userInput && !hasAttachments) return

        const attachmentsText = attachmentsRef.current
            .map(att => `第${att.pageNumber}页：\n${att.text}`)
            .join('\n\n')
        const finalPrompt = hasAttachments
            ? `以下是原始PDF内容：\n${attachmentsText}\n\n${userInput}`
            : userInput

        // 在用户输入前插入附件标签(用于保存到批注)
        const attachmentTag = hasAttachments 
            ? `[ATTACHMENT:${attachmentsRef.current.map(a => a.pageNumber).join(',')}]`
            : ''
        const displayWithAttachment = attachmentTag ? `${attachmentTag}\n${userInput}` : userInput

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: finalPrompt, // 发送给 API 的完整内容
            displayContent: displayWithAttachment, // 完整内容（包含附件标签，用于保存到批注）
            attachmentPages: hasAttachments ? attachmentsRef.current.map(a => a.pageNumber) : undefined,
            timestamp: Date.now()
        }

        setMessages(prev => [...prev, userMessage])
        setInput('')
        // 清空附件,避免下一轮对话自动带上
        attachmentsRef.current = []
        forceRerender() // 触发界面更新,移除附件标签显示
        setIsLoading(true)

        try {
            abortRef.current = new AbortController()
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [...messages, userMessage].map(m => ({
                        role: m.role,
                        content: m.content
                    }))
                }),
                signal: abortRef.current.signal
            })

            if (!response.ok) {
                throw new Error('API request failed')
            }

            const reader = response.body?.getReader()
            const decoder = new TextDecoder()
            let assistantContent = ''

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: '',
                timestamp: Date.now()
            }

            setMessages(prev => [...prev, assistantMessage])

            while (reader) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value)
                const lines = chunk.split('\n')

                for (const line of lines) {
                    if (line.startsWith('0:')) {
                        try {
                            const jsonStr = line.substring(2)
                            const text = JSON.parse(jsonStr)
                            assistantContent += text
                            setMessages(prev => {
                                const newMessages = [...prev]
                                const lastMessage = newMessages[newMessages.length - 1]
                                if (lastMessage && lastMessage.role === 'assistant') {
                                    lastMessage.content = assistantContent
                                }
                                return newMessages
                            })
                        } catch (e) {
                            console.error('Parse error:', e, 'Line:', line)
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error('Chat error:', error)
            // 如果是用户主动停止(AbortError),不显示错误消息
            if (error?.name !== 'AbortError') {
                const errorMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: t('chat.error'),
                    timestamp: Date.now()
                }
                setMessages(prev => [...prev, errorMessage])
            }
        } finally {
            setIsLoading(false)
            abortRef.current = null
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    const clearChat = () => {
        abortRef.current?.abort()
        setIsLoading(false)
        setMessages([])
        setInput('')
        abortRef.current = null
    }

    const handleAddToAnnotation = () => {
        if (!props.onAddToAnnotation) return
        // 将全部对话原样转录（使用 displayContent，包含附件标签）
        const transcript = messages
            .filter(m => (m.displayContent || m.content) && (m.displayContent || m.content).trim().length > 0)
            .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.displayContent || m.content}`)
            .join('\n\n')
        
        console.log('[ChatPopup] addToAnnotation payload:', { 
            transcriptLen: transcript.length, 
            selectedTextLen: selectedText?.length
        })
        // 不再传递 attachmentPages，因为附件信息已经在 transcript 的标签中
        props.onAddToAnnotation(transcript, selectedText)
    }

    const handleDragStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) {
            return
        }

        const rect = containerRef.current.getBoundingClientRect()
        setDragOffset({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        })
        setIsDragging(true)
    }, [])

    const handleDragMove = useCallback((event: MouseEvent) => {
        if (!isDragging) {
            return
        }

        event.preventDefault()
        const targetX = event.clientX - dragOffset.x
        const targetY = event.clientY - dragOffset.y
        const adjustedPos = adjustPositionWithinViewport(targetX, targetY)
        setPosition(adjustedPos)
    }, [adjustPositionWithinViewport, dragOffset, isDragging])

    const handleDragEnd = useCallback(() => {
        setIsDragging(false)
    }, [])

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleDragMove)
            window.addEventListener('mouseup', handleDragEnd)
        } else {
            window.removeEventListener('mousemove', handleDragMove)
            window.removeEventListener('mouseup', handleDragEnd)
        }

        return () => {
            window.removeEventListener('mousemove', handleDragMove)
            window.removeEventListener('mouseup', handleDragEnd)
        }
    }, [handleDragEnd, handleDragMove, isDragging])

    const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        setIsResizing(true)
        resizeStartYRef.current = event.clientY
        resizeStartHeightRef.current = bottomHeight
    }, [bottomHeight])

    const handleResizeMove = useCallback((event: MouseEvent) => {
        if (!isResizing) return
        event.preventDefault()
        const deltaY = event.clientY - resizeStartYRef.current
        // 向上拖动（deltaY 为负）=> bottomHeight 变大；向下拖动（deltaY 为正）=> bottomHeight 变小
        const next = Math.min(Math.max(resizeStartHeightRef.current - deltaY, 56), Math.max(56, (containerRef.current?.getBoundingClientRect().height || 600) - 56))
        setBottomHeight(next)
    }, [isResizing])

    const handleResizeEnd = useCallback(() => {
        setIsResizing(false)
    }, [])

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleResizeMove)
            window.addEventListener('mouseup', handleResizeEnd)
        } else {
            window.removeEventListener('mousemove', handleResizeMove)
            window.removeEventListener('mouseup', handleResizeEnd)
        }
        return () => {
            window.removeEventListener('mousemove', handleResizeMove)
            window.removeEventListener('mouseup', handleResizeEnd)
        }
    }, [handleResizeEnd, handleResizeMove, isResizing])

    const [, setTick] = useState(0)
    const forceRerender = () => setTick(t => t + 1)

    function mergeAttachments(current: AttachmentItem[], next: AttachmentItem[]): AttachmentItem[] {
        const map = new Map<number, string>()
        for (const att of current) map.set(att.pageNumber, att.text)
        for (const att of next) map.set(att.pageNumber, att.text)
        return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([pageNumber, text]) => ({ pageNumber, text }))
    }
    function rangeToPages(start: number, end: number): number[] { return Array.from({ length: end - start + 1 }, (_, i) => start + i) }
    function compressContinuousPages(list: AttachmentItem[]): Array<{ type: 'range', start: number, end: number } | { type: 'single', page: number }> {
        const pages = list.map(a => a.pageNumber).sort((a, b) => a - b)
        const res: Array<{ type: 'range', start: number, end: number } | { type: 'single', page: number }> = []
        let i = 0
        while (i < pages.length) {
            const start = pages[i]
            let end = start
            while (i + 1 < pages.length && pages[i + 1] === end + 1) { i++; end++ }
            if (start === end) res.push({ type: 'single', page: start })
            else res.push({ type: 'range', start, end })
            i++
        }
        return res
    }

    if (!show) return null

    return (
        <div 
            className={`ChatPopup${isDragging ? ' ChatPopup--dragging' : ''}`} 
            ref={containerRef}
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`
            }}
        >
            <div 
                className="ChatPopup-header"
                onMouseDown={handleDragStart}
                onDoubleClick={(event) => event.stopPropagation()}
            >
                <h3>{t('chat.title')}</h3>
                <div 
                    className="ChatPopup-actions" 
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <Button
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={clearChat}
                        disabled={messages.length === 0}
                        title={t('chat.clear')}
                    />
                    <Button
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={() => { 
                            abortRef.current?.abort()
                            setIsLoading(false)
                            abortRef.current = null
                            setShow(false); 
                            props.onClose?.() 
                        }}
                        title={t('normal.cancel')}
                    />
                </div>
            </div>

            <div className="ChatPopup-messages">
                {/* 此处只显示消息，不再放附件 */}

                {messages.length === 0 ? (
                    <div className="ChatPopup-empty">
                        <p>{t('chat.emptyHint')}</p>
                    </div>
                ) : (
                    messages.map((message) => (
                        <div
                            key={message.id}
                            className={`ChatPopup-message ${message.role === 'user' ? 'user' : 'assistant'}`}
                        >
                            {message.attachmentPages && message.attachmentPages.length > 0 && (
                                <div className="message-attachments">
                                    <Popover
                                        content={
                                            <div style={{ maxWidth: 400, maxHeight: 300, overflow: 'auto' }}>
                                                <MarkdownContent text={message.content} />
                                            </div>
                                        }
                                        title="完整内容（含原文）"
                                        trigger="click"
                                        getPopupContainer={(trigger) => trigger.parentElement || document.body}
                                        overlayStyle={{ zIndex: 10001 }}
                                    >
                                        <span className="attachment-badge">
                                            📎 附件: {compressContinuousPages(message.attachmentPages.map(p => ({ pageNumber: p, text: '' }))).map((item, idx) => (
                                                <span key={idx}>
                                                    {idx > 0 && ', '}
                                                    {item.type === 'range' ? `第${item.start}–${item.end}页` : `第${item.page}页`}
                                                </span>
                                            ))}
                                        </span>
                                    </Popover>
                                </div>
                            )}
                            <div className="message-content">
                                <MarkdownContent text={
                                    // 移除附件标签及其后的换行符用于界面显示
                                    (message.displayContent || message.content).replace(/\[ATTACHMENT:[^\]]+\]\n*/g, '')
                                } />
                            </div>
                        </div>
                    ))
                )}
                {isLoading && (
                    <div className="ChatPopup-message assistant">
                        <div className="message-content loading">
                            <span className="dot"></span>
                            <span className="dot"></span>
                            <span className="dot"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="ChatPopup-resizer" onMouseDown={(e) => { e.stopPropagation(); handleResizeStart(e) }} />

            <div className="ChatPopup-footer" style={{ height: bottomHeight, position: 'relative' }}>
                {messages.some(m => m.role === 'assistant') && (
                    <Button
                        type="default"
                        icon={<PlusOutlined />}
                        onClick={handleAddToAnnotation}
                        size="small"
                        className="add-to-annotation-btn"
                    >
                        {t('chat.addToAnnotation')}
                    </Button>
                )}
                {/* 分隔条下、输入框上方的附件框 */}
                <div className="ChatPopup-attachments">
                    <div className="attachment-toolbar">
                        <span>附件页：</span>
                        <Button size="small" onClick={async () => {
                            const page = props.getCurrentPageNumber?.() || 1
                            const text = await props.getPageText?.(page)
                            if (!text) return
                            attachmentsRef.current = mergeAttachments(attachmentsRef.current, [{ pageNumber: page, text }])
                            console.log('[ChatPopup] 附件预览:', attachmentsRef.current.map(a => `第${a.pageNumber}页：\n${a.text}`).join('\n\n'))
                            forceRerender()
                        }}>当前页面</Button>
                        <Button size="small" onClick={async () => {
                            const page = Math.max((props.getCurrentPageNumber?.() || 1) - 1, 1)
                            const text = await props.getPageText?.(page)
                            if (!text) return
                            attachmentsRef.current = mergeAttachments(attachmentsRef.current, [{ pageNumber: page, text }])
                            console.log('[ChatPopup] 附件预览:', attachmentsRef.current.map(a => `第${a.pageNumber}页：\n${a.text}`).join('\n\n'))
                            forceRerender()
                        }}>上一页</Button>
                        <Button size="small" onClick={async () => {
                            const start = Math.max((props.getCurrentPageNumber?.() || 1) - 2, 1)
                            const pages = [start, start + 1, start + 2]
                            const results: AttachmentItem[] = []
                            for (const p of pages) {
                                const text = await props.getPageText?.(p)
                                if (text) results.push({ pageNumber: p, text })
                            }
                            attachmentsRef.current = mergeAttachments(attachmentsRef.current, results)
                            console.log('[ChatPopup] 附件预览:', attachmentsRef.current.map(a => `第${a.pageNumber}页：\n${a.text}`).join('\n\n'))
                            forceRerender()
                        }}>前3页</Button>
                    </div>
                    <div className="attachment-box">
                        <div className="attachment-tags">
                            {compressContinuousPages(attachmentsRef.current).map((item, idx) => (
                                <span key={idx} className="attachment-tag">
                                    {item.type === 'range' ? `第${item.start}–${item.end}页` : `第${item.page}页`}
                                    <Button size="small" type="link" onClick={() => {
                                        // 删除对应页或范围（展开为页再删除）
                                        const toRemove = item.type === 'range' ? rangeToPages(item.start, item.end) : [item.page]
                                        attachmentsRef.current = attachmentsRef.current.filter(att => !toRemove.includes(att.pageNumber))
                                        forceRerender()
                                    }}>删除</Button>
                                </span>
                            ))}
                        </div>

                    </div>
                </div>

                <div 
                    className="ChatPopup-input" 
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <TextArea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('chat.inputPlaceholder')}
                        autoSize={false}
                        disabled={isLoading}
                        style={{ height: '100%' }}
                    />
                    <Button
                        type="primary"
                        icon={isLoading ? <StopOutlined /> : <SendOutlined />}
                        onClick={() => {
                            if (isLoading) {
                                abortRef.current?.abort()
                                setIsLoading(false)
                            } else {
                                sendMessage()
                            }
                        }}
                        disabled={!isLoading && !input.trim()}
                        loading={false}
                    >
                        {isLoading ? t('chat.stop') : t('chat.send')}
                    </Button>
                </div>
            </div>
        </div>
    )
})

ChatPopup.displayName = 'ChatPopup'

export { ChatPopup }
