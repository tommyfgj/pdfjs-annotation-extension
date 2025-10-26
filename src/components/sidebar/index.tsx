import './index.scss'
import React, { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs } from 'antd'
import { CommentOutlined, MessageOutlined } from '@ant-design/icons'
import { CustomComment, CustomCommentRef } from '../comment'
import { CustomChat, CustomChatRef } from '../chat'
import { IAnnotationStore } from '../../const/definitions'

export interface CustomSidebarRef {
    commentRef: React.RefObject<CustomCommentRef>
    chatRef: React.RefObject<CustomChatRef>
    switchToChat: () => void
    switchToComment: () => void
}

interface CustomSidebarProps {
    userName: string
    onCommentSelected: (annotation: IAnnotationStore) => Promise<void>
    onCommentDelete: (id: string) => void
    onCommentUpdate: (annotation: IAnnotationStore) => void
    onCommentScroll: () => void
}

const CustomSidebar = forwardRef<CustomSidebarRef, CustomSidebarProps>((props, ref) => {
    const { t } = useTranslation()
    const [activeKey, setActiveKey] = useState('comment')
    const commentRef = React.useRef<CustomCommentRef>(null)
    const chatRef = React.useRef<CustomChatRef>(null)

    useImperativeHandle(ref, () => ({
        commentRef,
        chatRef,
        switchToChat: () => setActiveKey('chat'),
        switchToComment: () => setActiveKey('comment')
    }))

    const items = [
        {
            key: 'comment',
            label: (
                <span>
                    <CommentOutlined />
                    {t('anno')}
                </span>
            ),
            children: (
                <CustomComment
                    ref={commentRef}
                    userName={props.userName}
                    onSelected={props.onCommentSelected}
                    onDelete={props.onCommentDelete}
                    onUpdate={props.onCommentUpdate}
                    onScroll={props.onCommentScroll}
                />
            )
        },
        {
            key: 'chat',
            label: (
                <span>
                    <MessageOutlined />
                    {t('chat.title')}
                </span>
            ),
            children: (
                <CustomChat ref={chatRef} />
            )
        }
    ]

    return (
        <div className="CustomSidebar">
            <Tabs
                activeKey={activeKey}
                onChange={setActiveKey}
                items={items}
                className="CustomSidebar-tabs"
            />
        </div>
    )
})

CustomSidebar.displayName = 'CustomSidebar'

export { CustomSidebar }
