import './index.scss'
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { MarkdownContent } from '../common/MarkdownContent'
import { useTranslation } from 'react-i18next'
import { Button, Input, Popover } from 'antd'
import { SendOutlined, DeleteOutlined, StopOutlined } from '@ant-design/icons'

const { TextArea } = Input

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string // 实际发送给 API 的内容（包含附件）
    displayContent?: string // 用于界面显示的内容（不包含附件）
    attachmentPages?: number[] // 附件页码列表
    timestamp: number
}

export interface CustomChatSidebarRef {
    insertText: (text: string) => void
    clear: () => void
}

interface CustomChatSidebarProps {
    onAddToAnnotation?: (text: string, selectedText: string) => void
    getPageText?: (pageNumber: number) => Promise<string>
    getCurrentPageNumber?: () => number
}

const CustomChatSidebar = forwardRef<CustomChatSidebarRef, CustomChatSidebarProps>((props, ref) => {
    const { t } = useTranslation()
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // 附件（当前页文本）
    type AttachmentItem = { pageNumber: number, text: string }
    const attachmentsRef = useRef<AttachmentItem[]>([])

    // 可调整下半部分高度（输入区容器）
    const [bottomHeight, setBottomHeight] = useState(100)
    const [isResizing, setIsResizing] = useState(false)
    const resizeStartYRef = useRef(0)
    const resizeStartHeightRef = useRef(0)

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages])

    // 暴露给父组件的方法
    useImperativeHandle(ref, () => ({
        insertText: (text: string) => {
            const prompt = `${t('chat.explainPrompt')}:\n\n"${text}"`
            setInput(prompt)
            textareaRef.current?.focus()
        },
        clear: () => {
            setMessages([])
            setInput('')
        }
    }))

    const [, setTick] = useState(0)
    const forceRerender = () => setTick(t => t + 1)

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
                                if (lastMessage.role === 'assistant') {
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

    useEffect(() => {
        if (!isResizing) return
        const onMove = (event: MouseEvent) => {
            const deltaY = event.clientY - resizeStartYRef.current
            // 期望：向上拖动下半部分变高，向下拖动下半部分变低（与之前相反）
            const next = Math.min(Math.max(resizeStartHeightRef.current - deltaY, 80), 400)
            setBottomHeight(next)
        }
        const onUp = () => {
            setIsResizing(false)
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    }, [isResizing])

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

    return (
        <div className="CustomChatSidebar">
            <div className="CustomChatSidebar-header">
                <h3>{t('chat.title')}</h3>
                <Button
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={clearChat}
                    disabled={messages.length === 0}
                >
                    {t('chat.clear')}
                </Button>
            </div>

            <div className="CustomChatSidebar-messages">
                {messages.length === 0 ? (
                    <div className="CustomChatSidebar-empty">
                        <p>{t('chat.emptyHint')}</p>
                    </div>
                ) : (
                    messages.map((message) => (
                        <div
                            key={message.id}
                            className={`CustomChatSidebar-message ${message.role === 'user' ? 'user' : 'assistant'}`}
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
                                    // 移除附件标签用于界面显示
                                    (message.displayContent || message.content).replace(/\[ATTACHMENT:[^\]]+\]\n*/g, '')
                                } />
                            </div>
                        </div>
                    ))
                )}
                {isLoading && (
                    <div className="CustomChatSidebar-message assistant">
                        <div className="message-content loading">
                            <span className="dot"></span>
                            <span className="dot"></span>
                            <span className="dot"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="CustomChatSidebar-resizer" onMouseDown={(event) => {
                event.stopPropagation()
                setIsResizing(true)
                resizeStartYRef.current = event.clientY
                resizeStartHeightRef.current = bottomHeight
            }} />

            <div className="CustomChatSidebar-footer" style={{ height: bottomHeight, position: 'relative' }}>
                {/* 附件框 */}
                <div className="CustomChatSidebar-attachments">
                    <div className="attachment-toolbar">
                        <span>附件页：</span>
                        <Button size="small" onClick={async () => {
                            const page = props.getCurrentPageNumber?.() || 1
                            const text = await props.getPageText?.(page)
                            if (!text) return
                            attachmentsRef.current = mergeAttachments(attachmentsRef.current, [{ pageNumber: page, text }])
                            forceRerender()
                        }}>当前页面</Button>
                        <Button size="small" onClick={async () => {
                            const page = Math.max((props.getCurrentPageNumber?.() || 1) - 1, 1)
                            const text = await props.getPageText?.(page)
                            if (!text) return
                            attachmentsRef.current = mergeAttachments(attachmentsRef.current, [{ pageNumber: page, text }])
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
                            forceRerender()
                        }}>前3页</Button>
                    </div>
                    <div className="attachment-box">
                        <div className="attachment-tags">
                            {compressContinuousPages(attachmentsRef.current).map((item, idx) => (
                                <span key={idx} className="attachment-tag">
                                    {item.type === 'range' ? `第${item.start}–${item.end}页` : `第${item.page}页`}
                                    <Button size="small" type="link" onClick={() => {
                                        const toRemove = item.type === 'range' ? rangeToPages(item.start, item.end) : [item.page]
                                        attachmentsRef.current = attachmentsRef.current.filter(att => !toRemove.includes(att.pageNumber))
                                        forceRerender()
                                    }}>删除</Button>
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="CustomChatSidebar-input">
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

CustomChatSidebar.displayName = 'CustomChatSidebar'

export { CustomChatSidebar }
