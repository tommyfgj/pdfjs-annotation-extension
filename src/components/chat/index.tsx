import './index.scss'
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from 'antd'
import { SendOutlined, DeleteOutlined } from '@ant-design/icons'

const { TextArea } = Input

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
}

export interface CustomChatRef {
    insertText: (text: string) => void
    clear: () => void
}

interface CustomChatProps {
    apiEndpoint?: string
}

const CustomChat = forwardRef<CustomChatRef, CustomChatProps>((props, ref) => {
    const { t } = useTranslation()
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const messagesEndRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)

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

    const sendMessage = async () => {
        if (!input.trim() || isLoading) return

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input,
            timestamp: Date.now()
        }

        setMessages(prev => [...prev, userMessage])
        setInput('')
        setIsLoading(true)

        try {
            // 调用父窗口的API
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
                })
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
                            // 忽略解析错误
                            console.error('Parse error:', e, 'Line:', line)
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Chat error:', error)
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: t('chat.error'),
                timestamp: Date.now()
            }
            setMessages(prev => [...prev, errorMessage])
        } finally {
            setIsLoading(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    const clearChat = () => {
        setMessages([])
        setInput('')
    }

    return (
        <div className="CustomChat">
            <div className="CustomChat-header">
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

            <div className="CustomChat-messages">
                {messages.length === 0 ? (
                    <div className="CustomChat-empty">
                        <p>{t('chat.emptyHint')}</p>
                    </div>
                ) : (
                    messages.map((message) => (
                        <div
                            key={message.id}
                            className={`CustomChat-message ${message.role === 'user' ? 'user' : 'assistant'}`}
                        >
                            <div className="message-content">
                                {message.content}
                            </div>
                        </div>
                    ))
                )}
                {isLoading && (
                    <div className="CustomChat-message assistant">
                        <div className="message-content loading">
                            <span className="dot"></span>
                            <span className="dot"></span>
                            <span className="dot"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="CustomChat-input">
                <TextArea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('chat.inputPlaceholder')}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    disabled={isLoading}
                />
                <Button
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={sendMessage}
                    disabled={!input.trim() || isLoading}
                    loading={isLoading}
                >
                    {t('chat.send')}
                </Button>
            </div>
        </div>
    )
})

CustomChat.displayName = 'CustomChat'

export { CustomChat }
