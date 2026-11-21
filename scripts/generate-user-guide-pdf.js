/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const docsDir = path.resolve(__dirname, '../docs')
const mdPath = path.join(docsDir, 'backend-flows-user-guide.md')
const htmlPath = path.join(docsDir, 'backend-flows-user-guide.html')
const pdfPath = path.join(docsDir, 'backend-flows-user-guide.pdf')

console.log('[pdf-gen] Reading markdown documentation from:', mdPath)
const mdContent = fs.readFileSync(mdPath, 'utf-8')

// Minimal, resilient Markdown to HTML converter for professional printing
function convertMarkdownToHtml(markdown) {
  let html = markdown
    // Headings
    .replace(/^# (.*$)/gim, '<h1 class="doc-h1">$1</h1>')
    .replace(/^## (.*$)/gim, '<h2 class="doc-h2">$1</h2>')
    .replace(/^### (.*$)/gim, '<h3 class="doc-h3">$1</h3>')
    .replace(/^#### (.*$)/gim, '<h4 class="doc-h4">$1</h4>')
    // Bold & Italics
    .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Code spans
    .replace(/`([^`]+)`/gim, '<code class="inline-code">$1</code>')
    // Images
    .replace(/!\[(.*?)\]\((.*?)\)/gim, (match, alt, src) => {
      const fullSrc = path.join(docsDir, src)
      if (fs.existsSync(fullSrc)) {
        const ext = path.extname(fullSrc).toLowerCase()
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
        const base64 = fs.readFileSync(fullSrc).toString('base64')
        return `<div class="img-wrapper"><img src="data:${mime};base64,${base64}" alt="${alt}" /><p class="img-caption">${alt}</p></div>`
      }
      return `<div class="img-wrapper"><p class="img-caption">[Image: ${alt}]</p></div>`
    })

  // Tables
  const lines = html.split('\n')
  const newLines = []
  let inTable = false
  let tableHeaderParsed = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        inTable = true
        tableHeaderParsed = false
        newLines.push('<div class="table-container"><table class="doc-table">')
      }
      if (line.includes('---')) {
        tableHeaderParsed = true
        continue
      }
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())

      if (!tableHeaderParsed) {
        newLines.push('<thead><tr>' + cells.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>')
      } else {
        newLines.push('<tr>' + cells.map((c) => `<td>${c}</td>`).join('') + '</tr>')
      }
    } else {
      if (inTable) {
        inTable = false
        newLines.push('</tbody></table></div>')
      }
      newLines.push(lines[i])
    }
  }
  if (inTable) newLines.push('</tbody></table></div>')
  html = newLines.join('\n')

  // Code blocks
  html = html.replace(/```([a-z0-9_-]*)\n([\s\S]*?)```/gim, (match, lang, code) => {
    return `<pre class="code-block language-${lang}"><code>${code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</code></pre>`
  })

  // Blockquotes
  html = html.replace(/^> (.*$)/gim, '<div class="callout-note"><p>$1</p></div>')

  // Unordered list items
  html = html.replace(/^[•\-\*] (.*$)/gim, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>')

  // Paragraphs
  html = html
    .split('\n\n')
    .map((chunk) => {
      chunk = chunk.trim()
      if (
        chunk.startsWith('<h') ||
        chunk.startsWith('<div') ||
        chunk.startsWith('<pre') ||
        chunk.startsWith('<table') ||
        chunk.startsWith('<ul') ||
        chunk.startsWith('<li')
      ) {
        return chunk
      }
      return `<p>${chunk}</p>`
    })
    .join('\n\n')

  return html
}

const bodyHtml = convertMarkdownToHtml(mdContent)

const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WACRM Backend Flows: Complete User & Operational Manual</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 14mm 18mm 14mm;
      @bottom-right {
        content: counter(page);
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 9pt;
        color: #64748b;
      }
    }

    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      line-height: 1.6;
      font-size: 10.5pt;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }

    .cover-page {
      padding: 40px 20px;
      margin-bottom: 40px;
      border-bottom: 3px solid #3b82f6;
      page-break-after: always;
    }

    .cover-title {
      font-size: 26pt;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.2;
      margin-bottom: 12px;
    }

    .cover-subtitle {
      font-size: 14pt;
      color: #3b82f6;
      font-weight: 600;
      margin-bottom: 24px;
    }

    .cover-meta {
      font-size: 10pt;
      color: #64748b;
      margin-top: 30px;
      line-height: 1.8;
      border-left: 4px solid #cbd5e1;
      padding-left: 14px;
    }

    .doc-h1 {
      font-size: 20pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 6px;
      margin-top: 35px;
      margin-bottom: 15px;
      page-break-after: avoid;
    }

    .doc-h2 {
      font-size: 15pt;
      font-weight: 700;
      color: #1e3a8a;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 4px;
      margin-top: 28px;
      margin-bottom: 12px;
      page-break-after: avoid;
    }

    .doc-h3 {
      font-size: 12pt;
      font-weight: 600;
      color: #334155;
      margin-top: 20px;
      margin-bottom: 8px;
      page-break-after: avoid;
    }

    .doc-h4 {
      font-size: 11pt;
      font-weight: 600;
      color: #475569;
      margin-top: 14px;
      margin-bottom: 6px;
    }

    p {
      margin-top: 0;
      margin-bottom: 10px;
      text-align: justify;
    }

    strong {
      color: #0f172a;
    }

    .inline-code {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 9pt;
      background-color: #f1f5f9;
      color: #0369a1;
      padding: 2px 5px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }

    .code-block {
      background-color: #0f172a;
      color: #f8fafc;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 8.5pt;
      padding: 12px 14px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 12px 0;
      line-height: 1.45;
      border: 1px solid #1e293b;
      page-break-inside: avoid;
    }

    .table-container {
      margin: 14px 0;
      overflow-x: auto;
      page-break-inside: avoid;
    }

    .doc-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
      text-align: left;
    }

    .doc-table th {
      background-color: #f8fafc;
      color: #0f172a;
      font-weight: 600;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
    }

    .doc-table td {
      padding: 7px 10px;
      border: 1px solid #e2e8f0;
      vertical-align: top;
    }

    .doc-table tr:nth-child(even) {
      background-color: #f8fafc;
    }

    .callout-note {
      background-color: #eff6ff;
      border-left: 4px solid #3b82f6;
      color: #1e40af;
      padding: 10px 14px;
      margin: 14px 0;
      border-radius: 0 6px 6px 0;
      font-size: 9.5pt;
      page-break-inside: avoid;
    }

    .img-wrapper {
      text-align: center;
      margin: 18px 0;
      page-break-inside: avoid;
    }

    .img-wrapper img {
      max-width: 90%;
      max-height: 380px;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    }

    .img-caption {
      font-size: 8.5pt;
      color: #64748b;
      margin-top: 6px;
      font-style: italic;
    }

    ul, ol {
      margin-top: 0;
      margin-bottom: 10px;
      padding-left: 20px;
    }

    li {
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <div class="cover-page">
    <div class="cover-title">WACRM Backend Flows: Complete User & Operational Manual</div>
    <div class="cover-subtitle">The Illusion Cafe & Restaurant — Automated Server-Side Business Pipelines</div>
    <div class="cover-meta">
      <strong>Platform:</strong> WACRM (WhatsApp CRM & Restaurant Management System)<br />
      <strong>Target Restaurant:</strong> The Illusion Cafe & Restaurant, Main Market / Station Road<br />
      <strong>Version:</strong> v0.8.0 Release (Phases 1–5 Complete)<br />
      <strong>Author:</strong> WACRM Dedicated Engineering Team<br />
      <strong>Date:</strong> November 2026
    </div>
  </div>

  <div class="content-body">
    ${bodyHtml}
  </div>
</body>
</html>`

fs.writeFileSync(htmlPath, fullHtml, 'utf-8')
console.log('[pdf-gen] Generated HTML file at:', htmlPath)

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
if (fs.existsSync(edgePath)) {
  console.log('[pdf-gen] Invoking Microsoft Edge to compile PDF...')
  const cmd = `"${edgePath}" --headless --disable-gpu --run-all-compositor-stages-before-draw --print-to-pdf="${pdfPath}" "${htmlPath}"`
  try {
    execSync(cmd, { stdio: 'inherit' })
    console.log('[pdf-gen] PDF generated successfully at:', pdfPath)
  } catch (err) {
    console.error('[pdf-gen] Error generating PDF:', err.message)
  }
} else {
  console.log('[pdf-gen] Edge not found at standard path, HTML output available.')
}
