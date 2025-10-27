import Highlighter from 'web-highlighter'

/**
 * WebSelection 类用于处理网页选区的实用工具类。
 */
export class WebSelection {
    isEditing: boolean // 指示是否启用编辑模式
    onSelect: (range: Range | null) => void // 当选区被选中时调用的回调函数
    onHighlight: (selection: Partial<Record<number, any[]>>) => void
    highlighterObj: null | Highlighter

    /**
     * 构造一个新的 WebSelection 实例。
     * @param onSelect 当选区被选中时调用的回调函数
     */
    constructor({ onSelect, onHighlight }: { onSelect: (range: Range | null) => void; onHighlight: (selection: Partial<Record<number, any[]>>) => void }) {
        this.isEditing = false
        this.onSelect = onSelect
        this.onHighlight = onHighlight
        this.highlighterObj = null
    }

    /**
     * 在指定的根元素和页码上创建一个高亮器。
     * @param root 要应用高亮器的根元素
     */
    public create(root: HTMLDivElement) {
        let isSelecting = false

        this.highlighterObj = new Highlighter({
            $root: root,
            wrapTag: 'mark'
        })
        this.highlighterObj.stop()
        // 监听文本选择变化
        document.addEventListener('selectionchange', () => {
            const selection = window.getSelection()
            if (selection.type === 'Caret') {
                this.onSelect(null)
                return
            }
            if (selection && selection.toString() && selection.rangeCount > 0) {
                const range = selection.getRangeAt(0)
                const selectedElement = range.commonAncestorContainer
                // 检查选区是否在特定的 div 内
                if (root.contains(selectedElement)) {
                    isSelecting = true
                }
            }
        })

        // 监听鼠标松开事件
        document.addEventListener('mouseup', () => {
            if (isSelecting) {
                isSelecting = false // 重置状态
                const selection = window.getSelection()
                if (selection && selection.rangeCount > 0) {
                    this.onSelect(selection.getRangeAt(0))
                }
            }
        })

        // 监听触摸屏操作结束事件
        document.addEventListener('touchend', () => {
            if (isSelecting) {
                isSelecting = false // 重置状态
                const selection = window.getSelection()
                if (selection && selection.rangeCount > 0) {
                    this.onSelect(selection.getRangeAt(0))
                }
            }
        })

        this.highlighterObj.on('selection:create', data => {
            const allSourcesId = data.sources.map(item => item.id)
            const allSourcesSpan = []
            allSourcesId.forEach(value => {
                allSourcesSpan.push(...this.highlighterObj.getDoms(value))
            })

            const pageSelection = Object.groupBy(allSourcesSpan, span => {
                return span.closest('.page').getAttribute('data-page-number')
            })

            this.onHighlight(pageSelection)
            this.highlighterObj.removeAll()
            window.getSelection().removeAllRanges()
        })
    }

    public highlight(range: Range) {
        if (range) {
            this.highlighterObj.fromRange(range)
        }
    }
}
