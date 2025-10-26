import './index.scss'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { CommentStatus, IAnnotationComment, IAnnotationStore, PdfjsAnnotationSubtype } from '../../const/definitions'
import { useTranslation } from 'react-i18next'
import { formatPDFDate, formatTimestamp, generateUUID } from '../../utils/utils'
import { Button, Checkbox, Dropdown, Input, Popover, Space, Typography } from 'antd'
import { CheckCircleOutlined, DislikeOutlined, FilterOutlined, LikeOutlined, MinusCircleOutlined, MinusSquareOutlined, MoreOutlined, StopOutlined } from '@ant-design/icons'
import {
    CircleIcon,
    FreehandIcon,
    FreeHighlightIcon,
    FreetextIcon,
    HighlightIcon,
    RectangleIcon,
    StampIcon,
    StrikeoutIcon,
    UnderlineIcon,
    SignatureIcon,
    NoteIcon,
    ExportIcon,
    ArrowIcon,
    CloudIcon
} from '../../const/icon'
import Paragraph from 'antd/es/typography/Paragraph'
import { MarkdownContent } from '../common/MarkdownContent'

interface StatusOption {
    labelKey: string; // i18n key
    icon: React.ReactNode;
}

const { Text } = Typography

const iconMapping: Record<PdfjsAnnotationSubtype, React.ReactNode> = {
    Circle: <CircleIcon />,
    FreeText: <FreetextIcon />,
    Ink: <FreehandIcon />,
    Highlight: <HighlightIcon />,
    Underline: <UnderlineIcon />,
    Squiggly: <FreeHighlightIcon />,
    StrikeOut: <StrikeoutIcon />,
    Stamp: <StampIcon />,
    Line: <FreehandIcon />,
    Square: <RectangleIcon />,
    Polygon: <FreehandIcon />,
    PolyLine: <CloudIcon />,
    Caret: <SignatureIcon />,
    Link: <FreehandIcon />,
    Text: <NoteIcon />,
    FileAttachment: <ExportIcon />,
    Popup: <FreehandIcon />,
    Widget: <FreehandIcon />,
    Note: <NoteIcon />,
    Arrow: <ArrowIcon />
}

const commentStatusOptions: Record<CommentStatus, StatusOption> = {
    [CommentStatus.Accepted]: {
        labelKey: 'comment.status.accepted',
        icon: <LikeOutlined />,
    },
    [CommentStatus.Rejected]: {
        labelKey: 'comment.status.rejected',
        icon: <DislikeOutlined />,
    },
    [CommentStatus.Cancelled]: {
        labelKey: 'comment.status.cancelled',
        icon: <MinusCircleOutlined />,
    },
    [CommentStatus.Completed]: {
        labelKey: 'comment.status.completed',
        icon: <CheckCircleOutlined />,
    },
    [CommentStatus.Closed]: {
        labelKey: 'comment.status.closed',
        icon: <StopOutlined />,
    },
    [CommentStatus.None]: {
        labelKey: 'comment.status.none',
        icon: <MinusSquareOutlined />,
    }
};

const getIconBySubtype = (subtype: PdfjsAnnotationSubtype): React.ReactNode => {
    return iconMapping[subtype] || null
}

const AnnotationIcon: React.FC<{ subtype: PdfjsAnnotationSubtype }> = ({ subtype }) => {
    const Icon = getIconBySubtype(subtype)
    return Icon ? <span className="annotation-icon">{Icon}</span> : null
}

const { TextArea } = Input

interface CustomCommentProps {
    userName: string
    onSelected: (annotation: IAnnotationStore) => void
    onUpdate: (annotation: IAnnotationStore) => void
    onDelete: (id: string) => void
    onScroll?: () => void
    getPageText?: (pageNumber: number) => Promise<string>
}

export interface CustomCommentRef {
    addAnnotation(annotation: IAnnotationStore): void
    delAnnotation(id: string): void
    updateAnnotation(annotation: IAnnotationStore): void
    selectedAnnotation(annotation: IAnnotationStore, isClick: boolean): void
    clearAnnotations(): void
}

/**
 * @description CustomComment
 */
const CustomComment = forwardRef<CustomCommentRef, CustomCommentProps>(function CustomComment(props, ref) {
    const [annotations, setAnnotations] = useState<IAnnotationStore[]>([])
    const [currentAnnotation, setCurrentAnnotation] = useState<IAnnotationStore | null>(null)
    const [replyAnnotation, setReplyAnnotation] = useState<IAnnotationStore | null>(null)
    const [currentReply, setCurrentReply] = useState<IAnnotationComment | null>(null)
    const [editAnnotation, setEditAnnotation] = useState<IAnnotationStore | null>(null)
    const [selectedUsers, setSelectedUsers] = useState<string[]>([])
    const [selectedTypes, setSelectedTypes] = useState<PdfjsAnnotationSubtype[]>([])
    const { t } = useTranslation()

    const annotationRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const [expandedCommentIds, setExpandedCommentIds] = useState<Record<string, boolean>>({})
    const [expandedReplyIds, setExpandedReplyIds] = useState<Record<string, boolean>>({})

    useImperativeHandle(ref, () => ({
        addAnnotation,
        delAnnotation,
        selectedAnnotation,
        updateAnnotation,
        clearAnnotations
    }))

    const addAnnotation = (annotation: IAnnotationStore) => {
        setAnnotations(prevAnnotations => [...prevAnnotations, annotation])
        setCurrentAnnotation(null)
    }

    const delAnnotation = (id: string) => {
        setAnnotations(prevAnnotations => prevAnnotations.filter(annotation => annotation.id !== id))
        if (currentAnnotation?.id === id) {
            setCurrentAnnotation(null)
        }
        if (replyAnnotation?.id === id) {
            setReplyAnnotation(null)
        }
        setCurrentReply(null)
    }

    const clearAnnotations = () => {
        setAnnotations([])
        setCurrentAnnotation(null)
        setReplyAnnotation(null)
        setCurrentReply(null)
        setExpandedCommentIds({})
        setExpandedReplyIds({})
    }

    const selectedAnnotation = (annotation: IAnnotationStore, isClick: boolean) => {
        setCurrentAnnotation(annotation)

        if (!isClick) return

        const isOwn = annotation.title === props.userName
        const isEmptyComment = (annotation.contentsObj?.text || '') === ''

        // 👇 根据批注归属与内容决定打开评论或回复
        if (isOwn && isEmptyComment) {
            setEditAnnotation(annotation)
        } else {
            setReplyAnnotation(annotation)
        }

        // 👇 滚动至目标批注 DOM 元素
        const element = annotationRefs.current[annotation.id]
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    }

    const updateAnnotation = (updatedAnnotation: IAnnotationStore) => {
        setAnnotations(prevAnnotations =>
            prevAnnotations.map(annotation => {
                if (annotation.id === updatedAnnotation.id) {
                    // 合并所有可能被更新的字段，确保文本与评论不会被丢弃
                    const merged = {
                        ...annotation,
                        title: updatedAnnotation.title ?? annotation.title,
                        contentsObj: updatedAnnotation.contentsObj ?? annotation.contentsObj,
                        comments: updatedAnnotation.comments ?? annotation.comments,
                        color: updatedAnnotation.color ?? annotation.color,
                        konvaClientRect: updatedAnnotation.konvaClientRect ?? annotation.konvaClientRect,
                        date: formatTimestamp(Date.now()) // 更新最后修改时间
                    }
                    console.log('[Comment] updateAnnotation merged:', { id: merged.id, textLen: merged.contentsObj?.text?.length })
                    return merged
                }
                return annotation
            })
        )

        // 清除当前编辑的批注
        setEditAnnotation(null)
    }

    const allUsers = useMemo(() => {
        const map = new Map<string, number>()
        annotations.forEach(a => {
            map.set(a.title, (map.get(a.title) || 0) + 1)
        })
        return Array.from(map.entries()) // [title, count]
    }, [annotations])

    const allTypes = useMemo(() => {
        const types = new Map<PdfjsAnnotationSubtype, number>()
        annotations.forEach(a => {
            types.set(a.subtype, (types.get(a.subtype) || 0) + 1)
        })
        return Array.from(types.entries()) // [subtype, count]
    }, [annotations])

    // ✅ 初始化默认选中所有 username/type
    useEffect(() => {
        setSelectedUsers(allUsers.map(([u]) => u))
    }, [allUsers])

    useEffect(() => {
        setSelectedTypes(allTypes.map(([t]) => t))
    }, [allTypes])

    const filteredAnnotations = useMemo(() => {
        if (selectedUsers.length === 0 || selectedTypes.length === 0) return []
        return annotations.filter(a => selectedUsers.includes(a.title) && selectedTypes.includes(a.subtype))
    }, [annotations, selectedUsers, selectedTypes])

    const groupedAnnotations = useMemo(() => {
        return filteredAnnotations.reduce(
            (acc, annotation) => {
                if (!acc[annotation.pageNumber]) {
                    acc[annotation.pageNumber] = []
                }
                acc[annotation.pageNumber].push(annotation)
                return acc
            },
            {} as Record<number, IAnnotationStore[]>
        )
    }, [filteredAnnotations])

    const handleUserToggle = (username: string) => {
        setSelectedUsers(prev => (prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]))
    }

    const handleTypeToggle = (type: PdfjsAnnotationSubtype) => {
        setSelectedTypes(prev => (prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]))
    }

    const filterContent = (
        <div className="CustomComment_filterContent">
            <div className="title">{t('normal.author')}</div>
            <ul>
                {allUsers.map(([user, count]) => (
                    <li key={user}>
                        <Checkbox checked={selectedUsers.includes(user)} onChange={() => handleUserToggle(user)}>
                            <Space>
                                <Text ellipsis style={{ maxWidth: 200 }}>
                                    {user}
                                </Text>
                                <Text type="secondary">({count})</Text>
                            </Space>
                        </Checkbox>
                    </li>
                ))}
            </ul>
            <div className="title">{t('normal.type')}</div>
            <ul>
                {allTypes.map(([type, count]) => (
                    <li key={type}>
                        <Checkbox checked={selectedTypes.includes(type)} onChange={() => handleTypeToggle(type)}>
                            <Space>
                                <AnnotationIcon subtype={type} />
                                <Text type="secondary">({count})</Text>
                            </Space>
                        </Checkbox>
                    </li>
                ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Button
                    type="link"
                    onClick={() => {
                        setSelectedUsers(allUsers.map(([u]) => u))
                        setSelectedTypes(allTypes.map(([t]) => t))
                    }}
                >
                    {t('normal.selectAll')}
                </Button>
                <Button
                    type="link"
                    onClick={() => {
                        setSelectedUsers([])
                        setSelectedTypes([])
                    }}
                >
                    {t('normal.clear')}
                </Button>
            </div>
        </div>
    )

    const getLastStatusIcon = (annotation: IAnnotationStore): React.ReactNode => {
        const lastWithStatus = [...(annotation.comments || [])]
            .reverse()
            .find(c => c.status !== undefined && c.status !== null)

        const status = lastWithStatus?.status ?? CommentStatus.None
        return commentStatusOptions[status]?.icon ?? commentStatusOptions[CommentStatus.None].icon
    }

    const handleAnnotationClick = (annotation: IAnnotationStore) => {
        setCurrentAnnotation(annotation)
        props.onSelected(annotation)
    }

    const updateComment = (annotation: IAnnotationStore, comment: string) => {
        const prev = annotation.contentsObj?.text || ''
        annotation.contentsObj = { ...(annotation.contentsObj || {}), text: comment }
        console.log('[Comment] updateComment:', { id: annotation.id, prevLen: prev?.length, newLen: comment?.length })
        props.onUpdate(annotation)
    }

    const addReply = (annotation: IAnnotationStore, comment: string, status?: CommentStatus) => {
        const newReply = {
            id: generateUUID(),
            title: props.userName,
            date: formatTimestamp(Date.now()),
            content: comment,
            status
        }

        setAnnotations(prevAnnotations =>
            prevAnnotations.map(a => {
                if (a.id === annotation.id) {
                    const updatedAnnotation = {
                        ...a,
                        comments: [...(a.comments || []), newReply],
                        date: formatTimestamp(Date.now())
                    }
                    props.onUpdate(updatedAnnotation)
                    return updatedAnnotation
                }
                return a
            })
        )

        setReplyAnnotation(null)
    }


    const updateReply = (annotation: IAnnotationStore, reply: IAnnotationComment, comment: string) => {
        reply.date = formatTimestamp(Date.now())
        reply.content = comment
        reply.title = props.userName
        props.onUpdate(annotation)
    }

    const deleteAnnotation = (annotation: IAnnotationStore) => {
        setAnnotations(prevAnnotations => prevAnnotations.filter(item => item.id !== annotation.id))
        if (currentAnnotation?.id === annotation.id) {
            setCurrentAnnotation(null)
        }
        if (replyAnnotation?.id === annotation.id) {
            setReplyAnnotation(null)
        }
        setCurrentReply(null)
        props.onDelete(annotation.id)
    }

    const deleteReply = (annotation: IAnnotationStore, reply: IAnnotationComment) => {
        let updatedAnnotation: IAnnotationStore | null = null

        setAnnotations(prevAnnotations =>
            prevAnnotations.map(item => {
                if (item.id === annotation.id) {
                    const updatedComments = item.comments.filter(comment => comment.id !== reply.id)
                    updatedAnnotation = { ...item, comments: updatedComments }
                    return updatedAnnotation
                }
                return item
            })
        )
        if (currentReply?.id === reply.id) {
            setCurrentReply(null)
        }
        if (updatedAnnotation) {
            props.onUpdate(updatedAnnotation)
        }
    }

    // Comment 编辑框
    const commentInput = useCallback(
        (annotation: IAnnotationStore) => {
            let comment = ''
            if (editAnnotation && currentAnnotation?.id === annotation.id) {
                const handleSubmit = () => {
                    updateComment(annotation, comment)
                    setEditAnnotation(null)
                }
                return (
                    <>
                        <TextArea
                            defaultValue={annotation.contentsObj?.text || ''}
                            autoFocus
                            rows={4}
                            style={{ marginBottom: '8px', marginTop: '8px' }}
                            onBlur={() => setEditAnnotation(null)}
                            onChange={e => (comment = e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleSubmit()
                                }
                            }}
                        />
                        <Button
                            type="primary"
                            block
                            onMouseDown={handleSubmit}
                        >
                            {t('normal.confirm')}
                        </Button>
                    </>
                )
            }
            const rawText = annotation.contentsObj?.text || ''
            const displayText = annotation.contentsObj?.displayText || rawText
            const lineCount = displayText.split(/\r?\n/).length
            const isLong = (lineCount > 10)
            const isExpanded = !!expandedCommentIds[annotation.id]
            
            // 压缩连续页码的辅助函数
            const compressContinuousPages = (pages: number[]): Array<{ type: 'range', start: number, end: number } | { type: 'single', page: number }> => {
                const sorted = [...pages].sort((a, b) => a - b)
                const res: Array<{ type: 'range', start: number, end: number } | { type: 'single', page: number }> = []
                let i = 0
                while (i < sorted.length) {
                    const start = sorted[i]
                    let end = start
                    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) { i++; end++ }
                    if (start === end) res.push({ type: 'single', page: start })
                    else res.push({ type: 'range', start, end })
                    i++
                }
                return res
            }
            
            // 附件内容加载组件
            const AttachmentPopoverContent: React.FC<{ pages: number[] }> = ({ pages }) => {
                const [loading, setLoading] = useState(true)
                const [content, setContent] = useState<string>('')
                
                useEffect(() => {
                    const loadContent = async () => {
                        if (!props.getPageText) {
                            setContent('无法获取页面文本')
                            setLoading(false)
                            return
                        }
                        
                        setLoading(true)
                        try {
                            const texts: string[] = []
                            for (const page of pages) {
                                const text = await props.getPageText(page)
                                texts.push(`第${page}页：\n${text}`)
                            }
                            setContent(texts.join('\n\n---\n\n'))
                        } catch (error) {
                            console.error('Failed to load page text:', error)
                            setContent('加载失败')
                        } finally {
                            setLoading(false)
                        }
                    }
                    
                    loadContent()
                }, [pages])
                
                if (loading) {
                    return <div style={{ padding: '20px', textAlign: 'center' }}>加载中...</div>
                }
                
                return (
                    <div style={{ maxWidth: 500, maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                        {content}
                    </div>
                )
            }
            
            // 解析文本中的附件标签并渲染
            const parseAndRenderContent = (text: string) => {
                // 匹配 [ATTACHMENT:1,2,3] 格式的标签
                const attachmentRegex = /\[ATTACHMENT:([\d,]+)\]/g
                const parts: React.ReactNode[] = []
                let lastIndex = 0
                let match: RegExpExecArray | null
                
                while ((match = attachmentRegex.exec(text)) !== null) {
                    // 添加标签前的文本
                    if (match.index > lastIndex) {
                        const textBefore = text.substring(lastIndex, match.index)
                        parts.push(<MarkdownContent key={`text-${lastIndex}`} text={textBefore} />)
                    }
                    
                    // 解析页码
                    const pagesStr = match[1]
                    const pages = pagesStr.split(',').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p))
                    
                    // 添加附件徽章
                    if (pages.length > 0) {
                        parts.push(
                            <div 
                                key={`attachment-${match.index}`} 
                                style={{ marginBottom: '8px', marginTop: '8px' }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                            >
                                <Popover
                                    content={<AttachmentPopoverContent pages={pages} />}
                                    title="附件页面内容"
                                    trigger="click"
                                >
                                    <span style={{
                                        display: 'inline-block',
                                        padding: '4px 8px',
                                        background: '#e6f7ff',
                                        border: '1px solid #91d5ff',
                                        borderRadius: '4px',
                                        color: '#0958d9',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = '#bae7ff'
                                        e.currentTarget.style.borderColor = '#69c0ff'
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = '#e6f7ff'
                                        e.currentTarget.style.borderColor = '#91d5ff'
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    >
                                        📎 附件: {compressContinuousPages(pages).map((item, idx) => (
                                            <span key={idx}>
                                                {idx > 0 && ', '}
                                                {item.type === 'range' ? `第${item.start}–${item.end}页` : `第${item.page}页`}
                                            </span>
                                        ))}
                                    </span>
                                </Popover>
                            </div>
                        )
                    }
                    
                    lastIndex = attachmentRegex.lastIndex
                }
                
                // 添加最后剩余的文本
                if (lastIndex < text.length) {
                    const textAfter = text.substring(lastIndex)
                    parts.push(<MarkdownContent key={`text-${lastIndex}`} text={textAfter} />)
                }
                
                return parts.length > 0 ? parts : <MarkdownContent text={text} />
            }
            
            return <div style={{ margin: '8px 0 8px 15px'}}>
                <div className={`comment-content ${isExpanded ? 'expanded' : 'collapsed'}`} onMouseDown={(e) => { e.stopPropagation(); console.log('[Comment] toggleMain via content', { id: annotation.id, from: isExpanded, to: !isExpanded }); setExpandedCommentIds(prev => ({ ...prev, [annotation.id]: !isExpanded })) }}>
                    {parseAndRenderContent(displayText)}
                </div>
                {isLong && (
                    <Button type="link" size="small" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); console.log('[Comment] toggleMain via button', { id: annotation.id, from: isExpanded, to: !isExpanded }); setExpandedCommentIds(prev => ({ ...prev, [annotation.id]: !isExpanded })) }}>
                        {isExpanded ? t('normal.collapse') : t('normal.expand')}
                    </Button>
                )}
            </div>
        },
        [editAnnotation, currentAnnotation, expandedCommentIds]
    )

    // 回复框
    const replyInput = useCallback(
        (annotation: IAnnotationStore) => {
            let comment = ''
            if (replyAnnotation && currentAnnotation?.id === annotation.id) {
                const handleSubmit = () => {
                    addReply(annotation, comment)
                    setReplyAnnotation(null)
                }
                return (
                    <>
                        <TextArea
                            autoFocus
                            rows={4}
                            style={{ marginBottom: '8px', marginTop: '8px' }}
                            onBlur={() => setReplyAnnotation(null)}
                            onChange={e => (comment = e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleSubmit()
                                }
                            }}
                        />
                        <Button
                            type="primary"
                            block
                            onMouseDown={handleSubmit}
                        >
                            {t('normal.confirm')}
                        </Button>
                    </>
                )
            }
            return null
        },
        [replyAnnotation, currentAnnotation]
    )

    // 编辑回复框
    const editReplyInput = useCallback(
        (annotation: IAnnotationStore, reply: IAnnotationComment) => {
            let comment = ''
            if (currentReply && currentReply.id === reply.id) {
                const handleSubmit = () => {
                    updateReply(annotation, reply, comment)
                    setCurrentReply(null)
                }
                return (
                    <>
                        <TextArea
                            defaultValue={currentReply.content}
                            autoFocus
                            rows={4}
                            style={{ marginBottom: '8px' }}
                            onBlur={() => setCurrentReply(null)}
                            onChange={e => (comment = e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    handleSubmit()
                                }
                            }}
                        />
                        <Button type="primary" block onMouseDown={handleSubmit}>
                            {t('normal.confirm')}
                        </Button>
                    </>
                )
            }

            const rawText = reply.content || ''
            const lineCount = rawText.split(/\r?\n/).length
            const isLong = (lineCount > 10)
            const isExpanded = !!expandedReplyIds[reply.id]
            console.log('[Comment] renderReply', { id: reply.id, lineCount, isLong, isExpanded })
            return <>
                <div className={`comment-content ${isExpanded ? 'expanded' : 'collapsed'}`} onMouseDown={(e) => { e.stopPropagation(); console.log('[Comment] toggleMain via content', { id: annotation.id, from: isExpanded, to: !isExpanded }); setExpandedCommentIds(prev => ({ ...prev, [annotation.id]: !isExpanded })) }}>
                    <MarkdownContent text={rawText} />
                </div>
                {isLong && (
                    <Button type="link" size="small" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); console.log('[Comment] toggleReply via button', { id: reply.id, from: isExpanded, to: !isExpanded }); setExpandedReplyIds(prev => ({ ...prev, [reply.id]: !isExpanded })) }}>
                        {isExpanded ? t('normal.collapse') : t('normal.expand')}
                    </Button>
                )}
            </>
        },
        [replyAnnotation, currentReply, expandedReplyIds]
    )

    const comments = Object.entries(groupedAnnotations).map(([pageNumber, annotationsForPage]) => {
        // 根据 konvaClientRect.y 对 annotationsForPage 进行排序
        const sortedAnnotations = annotationsForPage.sort((a, b) => a.konvaClientRect.y - b.konvaClientRect.y)

        return (
            <div key={pageNumber} className="group">
                <h3>
                    {t('comment.page', { value: pageNumber })}
                    <span>{t('comment.total', { value: annotationsForPage.length })}</span>
                </h3>
                {sortedAnnotations.map(annotation => {
                    const isSelected = annotation.id === currentAnnotation?.id
                    const commonProps = { className: isSelected ? 'comment selected' : 'comment', id: `annotation-${annotation.id}` }
                    return (
                        <div
                            {...commonProps}
                            key={annotation.id}
                            onClick={() => handleAnnotationClick(annotation)}
                            ref={el => (annotationRefs.current[annotation.id] = el)}
                        >
                            <div className="title">
                                <AnnotationIcon subtype={annotation.subtype} />
                                <div className="username">{annotation.title}
                                    <span>{formatPDFDate(annotation.date, true)}</span>
                                </div>
                                <span className="tool">
                                    <Dropdown
                                        menu={{
                                            items: Object.entries(commentStatusOptions).map(([statusKey, option]) => ({
                                                key: statusKey,
                                                label: t(option.labelKey),
                                                icon: option.icon,
                                                onClick: (e) => {
                                                    addReply(annotation, t('comment.statusText', { value: t(option.labelKey) }), e.key as CommentStatus)
                                                    setReplyAnnotation(null)
                                                }
                                            }))
                                        }}
                                        trigger={['click']}
                                    >
                                        <span className="icon">
                                            {getLastStatusIcon(annotation)}
                                        </span>
                                    </Dropdown>
                                    <Dropdown
                                        menu={{
                                            items: [
                                                {
                                                    label: t('normal.reply'),
                                                    key: '0',
                                                    onClick: e => {
                                                        e.domEvent.stopPropagation()
                                                        setReplyAnnotation(annotation)
                                                    }
                                                },
                                                {
                                                    label: t('normal.edit'),
                                                    key: '1',
                                                    onClick: e => {
                                                        e.domEvent.stopPropagation()
                                                        setEditAnnotation(annotation)
                                                    }
                                                },
                                                {
                                                    label: t('normal.delete'),
                                                    key: '3',
                                                    onClick: e => {
                                                        e.domEvent.stopPropagation()
                                                        deleteAnnotation(annotation)
                                                    }
                                                }
                                            ]
                                        }}
                                        trigger={['click']}
                                    >
                                        <span className="icon">
                                            <MoreOutlined />
                                        </span>
                                    </Dropdown>
                                </span>
                            </div>
                            {commentInput(annotation)}
                            {annotation.comments?.map((reply, index) => (
                                <div className="reply" key={index}>
                                    <div className="title">
                                        <div className="username"> {reply.title}
                                            <span>{formatPDFDate(reply.date, true)}</span>
                                        </div>
                                        <span className="tool">
                                            <Dropdown
                                                menu={{
                                                    items: [
                                                        {
                                                            label: t('normal.edit'),
                                                            key: '1',
                                                            onClick: e => {
                                                                e.domEvent.stopPropagation()
                                                                setCurrentReply(reply)
                                                            }
                                                        },
                                                        {
                                                            label: t('normal.delete'),
                                                            key: '2',
                                                            onClick: e => {
                                                                e.domEvent.stopPropagation()
                                                                deleteReply(annotation, reply)
                                                            }
                                                        }
                                                    ]
                                                }}
                                                trigger={['click']}
                                            >
                                                <span className="icon">
                                                    <MoreOutlined />
                                                </span>
                                            </Dropdown>
                                        </span>
                                    </div>
                                    {editReplyInput(annotation, reply)}
                                </div>
                            ))}
                            <div className="reply-input">
                                {replyInput(annotation)}
                                {
                                    !replyAnnotation &&
                                    !currentReply &&
                                    !editAnnotation &&
                                    currentAnnotation?.id === annotation.id && (
                                        <Button style={{ marginTop: '8px' }} onClick={() => setReplyAnnotation(annotation)} type="primary" block>
                                            {t('normal.reply')}
                                        </Button>
                                    )}
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    })
    return (
        <div className="CustomComment" onScroll={() => {props.onScroll && props.onScroll() }}>
            <div className="filters">
                <Popover content={filterContent} trigger="click" placement="bottomLeft">
                    <Button size="small" icon={<FilterOutlined />} />
                </Popover>
            </div>
            <div className="list">{comments}</div>
        </div>
    )
})

export { CustomComment }
