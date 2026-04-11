import fs from 'fs'
import path from 'path'
import { compileMDX } from 'next-mdx-remote/rsc'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeShiki from '@shikijs/rehype'
import remarkHeadingId from 'remark-custom-heading-id'
import type { TocItem } from '@/components/docs/toc'

const contentDir = path.join(process.cwd(), 'content/docs')

/**
 * 文檔物件類型定義
 * @typedef {Object} Doc
 * @property {string} slug - 文檔的唯一標識符
 * @property {React.ReactNode} content - 編譯後的 MDX 內容
 * @property {Object} frontmatter - 文檔的元資料
 * @property {string} frontmatter.title - 文檔標題
 * @property {string} [frontmatter.description] - 文檔描述
 * @property {string} [frontmatter.keywords] - SEO 關鍵字
 * @property {TocItem[]} toc - 目錄項目陣列
 */
export type Doc = {
  slug: string
  content: React.ReactNode
  frontmatter: {
    title: string
    description?: string
    keywords?: string
  }
  toc: TocItem[]
}

/**
 * 根據 slug 獲取單個文檔
 * @param {string} slug - 文檔的 slug 標識符（不含副檔名）
 * @returns {Promise<Doc|null>} 文檔物件或 null（如果文檔不存在）
 *
 * @example
 * ```typescript
 * const doc = await getDocBySlug('installation');
 * if (doc) {
 *   console.log(doc.frontmatter.title); // "安裝"
 * }
 * ```
 */
export async function getDocBySlug(slug: string): Promise<Doc | null> {
  const fileName = slug + '.mdx'
  const filePath = path.join(contentDir, fileName)

  if (!fs.existsSync(filePath)) {
    return null
  }

  const source = fs.readFileSync(filePath, 'utf8')

  // Remove manual top-of-page TOC lists placed directly after frontmatter.
  // Many MDX files include a hand-authored list-of-links at the top of the file.
  // The site already renders a right-hand page TOC, so strip these blocks here
  // so we don't need to modify dozens of content files.
  let lines = source.split('\n')

  // 解析 frontmatter 邊界，尋找 --- 分隔符
  const fmIndexes: number[] = []
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    if (lines[i].trim() === '---') fmIndexes.push(i)
    if (fmIndexes.length === 2) break
  }

  // 如果找到完整的 frontmatter (兩個 --- 分隔符)
  if (fmIndexes.length === 2) {
    // index after the closing frontmatter delimiter
    let i = fmIndexes[1] + 1
    // skip initial blank lines
    while (i < lines.length && lines[i].trim() === '') i++

    // If the first non-blank block is a bullet/numbered list containing
    // link entries (e.g. "- [Section](#id)"), strip the entire contiguous
    // list (including nested indented items).
    const listStart = i
    // 匹配清單行：支援 -、* 或數字標號
    const listLineRE = /^\s*([-*]|\d+\.)\s+/
    let foundList = false
    let j = i
    // 遍歷直到行結束或遇到非清單行
    while (j < lines.length && (lines[j].trim() === '' || listLineRE.test(lines[j]))) {
      if (listLineRE.test(lines[j])) foundList = true
      j++
    }

    // 如果找到清單，移除整個清單區塊
    if (foundList) {
      // Remove the lines from listStart..j-1
      lines = [...lines.slice(0, listStart), ...lines.slice(j)]
    }
  }

  // Extract TOC from source
  const toc: TocItem[] = []
  let inFrontmatter = false
  let frontmatterCount = 0

  for (const line of lines) {
    // Skip frontmatter - 避免處理 frontmatter 內容
    if (line.trim() === '---') {
      frontmatterCount++
      inFrontmatter = frontmatterCount === 1
      continue
    }
    if (inFrontmatter || frontmatterCount < 2) continue

    // Match markdown headings (## or ### or ####)
    // 支援 2-4 級標題
    const headingMatch = line.match(/^(#{2,4})\s+(.+)/)
    if (headingMatch) {
      const level = headingMatch[1].length
      let text = headingMatch[2].trim()

      // Check for custom ID in {#custom-id} format
      const customIdMatch = text.match(/\s*\{#([^}]+)\}\s*$/)
      let id: string

      if (customIdMatch) {
        // Use custom ID and remove it from display text
        id = customIdMatch[1]
        text = text.replace(/\s*\{#[^}]+\}\s*$/, '').trim()
      } else {
        // Generate ID from text (similar to rehype-slug)
        // 轉換為小寫，移除非字母數字和中文字符，替換為連字號
        id = text
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
          .replace(/^-|-$/g, '') // 移除開頭和結尾的連字號
      }

      toc.push({ id, text, level })
    }
  }

  const cleanedSource = lines.join('\n')

  const { content, frontmatter } = await compileMDX<{ title: string; description?: string; keywords?: string }>({
    source: cleanedSource,
    components: {},
    options: {
      parseFrontmatter: true,
      mdxOptions: {
        remarkPlugins: [
          remarkHeadingId,
        ],
        rehypePlugins: [
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: 'wrap' }],
          [rehypeShiki, {
            theme: 'github-dark',
            langs: ['php', 'shell', 'blade', 'javascript', 'typescript', 'json', 'html', 'sql', 'yaml', 'ini', 'vue', 'jsx', 'tsx']
          }]
        ]
      }
    }
  })

  return {
    slug,
    content,
    frontmatter,
    toc,
  }
}

/**
 * 獲取所有可用文檔的 slug 列表
 * @returns {Promise<string[]>} 文檔 slug 陣列
 *
 * @example
 * ```typescript
 * const allSlugs = await getAllDocs();
 * console.log(allSlugs); // ['installation', 'configuration', 'routing', ...]
 * ```
 */
export async function getAllDocs() {
  if (!fs.existsSync(contentDir)) return []
  const files = fs.readdirSync(contentDir)
  return files.filter(f => f.endsWith('.mdx')).map((file) => file.replace(/\.mdx$/, ''))
}
