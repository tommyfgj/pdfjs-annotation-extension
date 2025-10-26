import { KonvaEventObject } from 'konva/lib/Node'
import { AnnotationType, IAnnotationStore, IAnnotationStyle } from '../../const/definitions'
import { Editor, IEditorOptions } from './editor'
import { createDocumentIcon } from '../../utils/documentIcon'
export class EditorNote extends Editor {
    constructor(EditorOptions: IEditorOptions) {
        super({ ...EditorOptions, editorType: AnnotationType.NOTE })
    }

    protected mouseDownHandler() {}
    protected mouseMoveHandler() {}

    protected async mouseUpHandler(e: KonvaEventObject<PointerEvent>) {
        const color = 'rgb(255, 222, 33)'
        // 兼容从外部注入的 clientX/clientY 位置
        const pointer = this.konvaStage.getPointerPosition()
        const pos = pointer ? pointer : this.konvaStage.getRelativePointerPosition()
        const x = pos?.x ?? 50
        const y = pos?.y ?? 50
        if (e.currentTarget !== this.konvaStage) {
            return
        }
        this.isPainting = true
        this.currentShapeGroup = this.createShapeGroup()
        this.getBgLayer().add(this.currentShapeGroup.konvaGroup)

        const docIcon = createDocumentIcon({ x, y, fill: color })

        this.currentShapeGroup.konvaGroup.add(...docIcon)
        const id = this.currentShapeGroup.konvaGroup.id()
        this.setShapeGroupDone({
            id,
            contentsObj: {
                text: this.currentShapeGroup?.annotation ? (this.currentShapeGroup.annotation as any).pendingText ?? '' : ''
            },
            color
        })
    }

    protected changeStyle(): void {}
}
