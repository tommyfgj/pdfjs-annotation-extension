import './index.scss'

import { computePosition, flip } from '@floating-ui/dom'
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { annotationDefinitions, AnnotationType, IAnnotationType, PdfjsAnnotationEditorType } from '../../const/definitions'
import { useTranslation } from 'react-i18next'
import { message } from 'antd'

interface CustomPopbarProps {
    onChange: (annotation: IAnnotationType | null, range: Range | null) => void
}

export interface CustomPopbarRef {
    open(range: Range | null): void
    close(): void
}

/**
 * @description CustomPopbar
 */
const CustomPopbar = forwardRef<CustomPopbarRef, CustomPopbarProps>(function CustomPopbar(props, ref) {
    const [show, setShow] = useState(false)
    const [annotations] = useState<IAnnotationType[]>(annotationDefinitions.filter(item => item.pdfjsEditorType === PdfjsAnnotationEditorType.HIGHLIGHT))

    const [currentRange, setCurrentRange] = useState<Range | null>(null)

    const containerRef = useRef<HTMLDivElement | null>(null)

    const { t } = useTranslation()

    useImperativeHandle(ref, () => ({
        open,
        close
    }))

    const open = (range: Range | null) => {
        setCurrentRange(range);
        // 如果 range 为空或 startContainer 和 endContainer 都不是文本节点，隐藏菜单
        if (!range || (range.endContainer.nodeType !== 3 && range.startContainer.nodeType !== 3)) {
            setShow(false);
            return;
        }

        setShow(true);

        // 根据 endContainer 或 startContainer 获取边界矩形
        const { bottom, height, left, right, top, width, x, y } = range.endContainer.nodeType === 3
            ? range.endContainer.parentElement.getBoundingClientRect()
            : range.startContainer.parentElement.getBoundingClientRect();

        // 创建虚拟元素用于计算位置
        const virtualEl = {
            getBoundingClientRect() {
                return {
                    width,
                    height,
                    x,
                    y,
                    left,
                    right,
                    top,
                    bottom
                };
            }
        };

        // 计算位置并调整菜单位置
        computePosition(virtualEl, containerRef.current, {
            placement: 'bottom',
            middleware: [flip()]
        }).then(({ x, y }) => {
            Object.assign(containerRef.current.style, {
                left: `${x}px`,
                top: `${y}px`
            });
        });
    };

    const close = () => {
        setShow(false)
        setCurrentRange(null)
    }

    const handleAnnotationClick = (annotation: IAnnotationType | null) => {
        setShow(false)
        props.onChange(annotation, currentRange)
    }

    const buttons = annotations.map((annotation, index) => {
        return (
            <li key={index} onClick={() => handleAnnotationClick(annotation)}>
                <div className="icon">{annotation.icon}</div>
            </li>
        )
    })

    const handleCopy = async () => {
        try {
            const text = currentRange?.toString() || ''
            if (!text) return
            await navigator.clipboard.writeText(text)
            message.success(t('normal.copySuccess') || t('normal.ok'))
            close()
        } catch (err) {
            message.error(t('normal.copyFail') || t('normal.cancel'))
        }
    }

    return (
        <>
            <div className={`CustomPopbar ${show ? 'show' : 'hide'}`} ref={containerRef}>
                <ul className="buttons">
                    {buttons}
                    <li onClick={handleCopy}>
                        <div className="icon">📋</div>
                    </li>
                </ul>
            </div>
        </>
    )
})

export { CustomPopbar }
