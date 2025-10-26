import './index.scss'
import { Button, ColorPicker, message, Popover, Space } from 'antd'
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { annotationDefinitions, AnnotationType, IAnnotationStyle, IAnnotationType, PdfjsAnnotationEditorType } from '../../const/definitions'
import { AnnoIcon, ExportIcon, PaletteIcon, SaveIcon, SendToAIIcon } from '../../const/icon'
import { SignatureTool } from './signature'
import { FilePdfOutlined, PlusCircleOutlined } from '@ant-design/icons'
import { StampTool } from './stamp'
import { useTranslation } from 'react-i18next'
import { defaultOptions } from '../../const/default_options'

interface CustomToolbarProps {
    defaultAnnotationName: string
    defaultSidebarOpen: boolean
    userName: string
    onChange: (annotation: IAnnotationType | null, dataTransfer: string | null) => void
    onSave: () => void
    onExport: (type: 'pdf' | 'excel') => void
    onSidebarOpen: (open: boolean) => void
    onChatSidebarOpen: (open: boolean) => void
}

export interface CustomToolbarRef {
    activeAnnotation(annotation: IAnnotationType): void
    updateStyle(annotationType: AnnotationType, style: IAnnotationStyle): void
    toggleSidebarBtn(open: boolean): void
    toggleChatSidebarBtn(open: boolean): void
    setSidebarOpen(open: boolean): void
    setChatSidebarOpen(open: boolean): void
}

/**
 * @description CustomToolbar
 */
const CustomToolbar = forwardRef<CustomToolbarRef, CustomToolbarProps>(function CustomToolbar(props, ref) {
    const defaultAnnotation = useMemo(() => {
        if (!props.defaultAnnotationName) return null
        return annotationDefinitions.find(item => item.name === props.defaultAnnotationName) || null
    }, [props.defaultAnnotationName, annotationDefinitions])

    const [currentAnnotation, setCurrentAnnotation] = useState<IAnnotationType | null>(defaultAnnotation)
    const [annotations, setAnnotations] = useState<IAnnotationType[]>(
        annotationDefinitions.filter(item => item.pdfjsEditorType !== PdfjsAnnotationEditorType.HIGHLIGHT)
    )
    const [dataTransfer, setDataTransfer] = useState<string | null>(null)
    const [sidebarOpen, setSidebarOpen] = useState<boolean>(props.defaultSidebarOpen)
    const [chatSidebarOpen, setChatSidebarOpen] = useState<boolean>(false)
    const { t } = useTranslation()

    // 监听状态变化
    useEffect(() => {
        console.log('📊 Toolbar state changed - sidebarOpen:', sidebarOpen, 'chatSidebarOpen:', chatSidebarOpen)
    }, [sidebarOpen, chatSidebarOpen])

    useImperativeHandle(ref, () => ({
        activeAnnotation,
        toggleSidebarBtn,
        toggleChatSidebarBtn,
        updateStyle,
        setSidebarOpen,
        setChatSidebarOpen
    }))

    const activeAnnotation = (annotation: IAnnotationType) => {
        handleAnnotationClick(annotation)
    }

    const toggleSidebarBtn = (open: boolean) => {
        console.log('🔴 toggleSidebarBtn called, setting to:', open)
        setSidebarOpen(open)
    }

    const toggleChatSidebarBtn = (open: boolean) => {
        console.log('🟡 toggleChatSidebarBtn called, setting to:', open)
        setChatSidebarOpen(open)
    }

    const updateStyle = (annotationType: AnnotationType, style: IAnnotationStyle) => {
        setAnnotations(
            annotations.map(annotation => {
                if (annotation.type === annotationType) {
                    annotation.style = {
                        ...annotation.style,
                        ...style
                    }
                }
                return annotation
            })
        )
    }

    const selectedType = currentAnnotation?.type

    const handleAnnotationClick = (annotation: IAnnotationType | null) => {
        setCurrentAnnotation(annotation)
        if (annotation?.type !== AnnotationType.SIGNATURE) {
            setDataTransfer(null) // 非签名类型时清空 dataTransfer
        }
    }

    const handleAdd = (signatureDataUrl, annotation) => {
        message.open({
            type: 'info',
            content: t('toolbar.message.selectPosition')
        })
        setDataTransfer(signatureDataUrl)
        setCurrentAnnotation(annotation)
    }

    const buttons = annotations.map((annotation, index) => {
        const isSelected = annotation.type === selectedType

        const commonProps = {
            className: isSelected ? 'selected' : ''
        }
        switch (annotation.type) {
            case AnnotationType.STAMP:
                return (
                    <li title={t(`annotations.${annotation.name}`)} key={index} {...commonProps}>
                        <StampTool userName={props.userName} annotation={annotation} onAdd={signatureDataUrl => handleAdd(signatureDataUrl, annotation)} />
                    </li>
                )

            case AnnotationType.SIGNATURE:
                return (
                    <li title={t(`annotations.${annotation.name}`)} key={index} {...commonProps}>
                        <SignatureTool annotation={annotation} onAdd={signatureDataUrl => handleAdd(signatureDataUrl, annotation)} />
                    </li>
                )

            default:
                return (
                    <li
                        title={t(`annotations.${annotation.name}`)}
                        key={index}
                        {...commonProps}
                        onClick={() => handleAnnotationClick(isSelected ? null : annotation)}
                    >
                        <div className="icon">{annotation.icon}</div>
                        <div className="name">{t(`annotations.${annotation.name}`)}</div>
                    </li>
                )
        }
    })

    const isColorDisabled = !currentAnnotation?.styleEditable?.color

    useEffect(() => {
        // 调用 onChange 并传递当前的 annotation 和 dataTransfer
        props.onChange(currentAnnotation, dataTransfer)
    }, [currentAnnotation, dataTransfer, props])

    const handleColorChange = (color: string) => {
        if (!currentAnnotation) return
        const updatedAnnotation = { ...currentAnnotation, style: { ...currentAnnotation.style, color } }
        const updatedAnnotations = annotations.map(annotation => (annotation.type === currentAnnotation.type ? updatedAnnotation : annotation))
        setAnnotations(updatedAnnotations)
        setCurrentAnnotation(updatedAnnotation)
    }

    const handleSidebarOpen = isOpen => {
        console.log('🔴 handleSidebarOpen called, current isOpen:', isOpen, 'will set to:', !isOpen)
        props.onSidebarOpen(!isOpen)
        setSidebarOpen(!isOpen)
    }

    const handleChatSidebarOpen = isOpen => {
        console.log('🟡 handleChatSidebarOpen called, current isOpen:', isOpen, 'will set to:', !isOpen)
        props.onChatSidebarOpen(!isOpen)
        setChatSidebarOpen(!isOpen)
    }

    return (
        <div className="CustomToolbar">
            <ul className="buttons">
                {buttons}
                <ColorPicker
                    arrow={false}
                    disabledAlpha
                    value={currentAnnotation?.style?.color || defaultOptions.setting.COLOR}
                    disabled={isColorDisabled}
                    showText={false}
                    onChangeComplete={color => handleColorChange(color.toHexString())}
                    presets={[{ label: '', colors: defaultOptions.colors }]}
                >
                    <li className={isColorDisabled ? 'disabled' : ''} title={t('normal.color')}>
                        <div className="icon">
                            <PaletteIcon style={{ color: currentAnnotation?.style?.color }} />
                        </div>
                        <div className="name">{t('normal.color')}</div>
                    </li>
                </ColorPicker>
            </ul>
            <div className="splitToolbarButtonSeparator"></div>
            <ul className="buttons">
                {defaultOptions.setting.SAVE_BUTTON && (
                    <li
                        title={t('normal.save')}
                        onClick={() => {
                            props.onSave()
                        }}
                    >
                        <div className="icon">
                            <SaveIcon />
                        </div>
                        <div className="name">{t('normal.save')}</div>
                    </li>
                )}
                {(defaultOptions.setting.EXPORT_PDF || defaultOptions.setting.EXPORT_EXCEL) && (
                    <li title={t('normal.export')}>
                        <Popover
                            content={
                                <Space direction="vertical">
                                    {defaultOptions.setting.EXPORT_PDF && (
                                        <Button
                                            block
                                            color="primary"
                                            variant="outlined"
                                            onClick={() => {
                                                props.onExport('pdf')
                                            }}
                                            icon={<FilePdfOutlined />}
                                        >
                                            PDF
                                        </Button>
                                    )}
                                    {defaultOptions.setting.EXPORT_EXCEL && (
                                        <Button
                                            block
                                            color="primary"
                                            variant="outlined"
                                            onClick={() => {
                                                props.onExport('excel')
                                            }}
                                            icon={<FilePdfOutlined />}
                                        >
                                            Excel
                                        </Button>
                                    )}
                                </Space>
                            }
                            trigger="click"
                            placement="bottom"
                            arrow={false}
                        >
                            <div className="icon">
                                <ExportIcon />
                            </div>
                            <div className="name">{t('normal.export')}</div>
                        </Popover>
                    </li>
                )}
            </ul>
            <ul className="buttons right">
                <li onClick={() => handleSidebarOpen(sidebarOpen)} className={`${sidebarOpen ? 'selected' : ''}`}>
                    <div className="icon">
                        <AnnoIcon />
                    </div>
                    <div className="name">{t('anno')}</div>
                </li>
                <li onClick={() => handleChatSidebarOpen(chatSidebarOpen)} className={`${chatSidebarOpen ? 'selected' : ''}`}>
                    <div className="icon">
                        <SendToAIIcon />
                    </div>
                    <div className="name">{t('chat.title')}</div>
                </li>
            </ul>
        </div>
    )
})

export { CustomToolbar }
