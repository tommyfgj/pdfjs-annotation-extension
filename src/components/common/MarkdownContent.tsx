import React, { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import 'github-markdown-css/github-markdown-light.css'

interface MarkdownContentProps {
  text: string
  className?: string
}

// Render sanitized markdown while preserving container styles
export const MarkdownContent: React.FC<MarkdownContentProps> = ({ text, className }) => {
  const html = useMemo(() => {
    // Configure marked for GitHub-flavored markdown basics
    marked.setOptions({
      gfm: true,
      breaks: true
    })
    const rawHtml = marked.parse(text || '') as unknown as string
    const safeHtml = DOMPurify.sanitize(String(rawHtml), { USE_PROFILES: { html: true } })
    return safeHtml
  }, [text])

  return (
    <div className={className ? className : 'markdown-body'} dangerouslySetInnerHTML={{ __html: html }} />
  )
}

export default MarkdownContent
