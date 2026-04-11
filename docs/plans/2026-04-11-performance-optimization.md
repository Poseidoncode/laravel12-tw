# Performance Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 大幅降低 bundle size（目標：從 165MB → < 50MB）、改善 LCP/FID，並優化靜態輸出品質。

**Architecture:** 採用漸進式優化策略，從 ROI 最高的項目開始（字體壓縮 > Next.js 配置 > 組件優化）。所有優化必須與 `output: 'export'` 靜態模式相容，不引入需要 server runtime 的功能。

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, Pagefind, GenRyu 字體（WOFF2）

---

## 問題根因分析

| 問題 | 根因 | 影響 |
|------|------|------|
| out/ = 165MB | 每頁 HTML 包含完整 MDX 渲染內容，字體 41MB 被複製兩次 | 部署緩慢、CDN 費用高 |
| 字體 41MB | 7 個 GenRyu 字重 × 6MB 各，完整 CJK 字集 | 首次載入 ~40s（慢網路） |
| HTML 最大 323KB | artisan.html = 323KB（Shiki 語法高亮已 inline HTML） | TTFB 慢，SEO 不良 |
| 無 Next.js 優化配置 | `next.config.ts` 只有 `output: 'export'` | 沒有 gzip/brotli，無 tree-shaking 提示 |
| TOC observer | 每次 `items` 改變重建 observer（正常，但 `observer.disconnect()` 更乾淨） | 輕微記憶體洩漏風險 |

---

## 優先級矩陣

| 優先級 | 任務 | 預期減少 | 工時估計 |
|--------|------|----------|----------|
| P0 🔴 | 字體子集化（Subset） | ~35MB（out/）| 30 min |
| P0 🔴 | 只載入 3 個必要字重 | ~24MB（字體）| 15 min |
| P1 🟡 | Next.js 壓縮與優化配置 | ~10-20% JS | 20 min |
| P1 🟡 | 字體載入策略（font-display + preload） | FCP 改善 | 15 min |
| P2 🟢 | Shiki 按需語言載入 | ~30% JS 減少 | 20 min |
| P2 🟢 | TOC observer 改用 disconnect() | 記憶體改善 | 10 min |
| P3 🔵 | Search 組件重構（state 分離） | 可維護性 | 30 min |

---

## Task 1: 字體優化 — 只保留 3 個核心字重

**背景：** 目前載入 7 個 GenRyu 字重（EL/L/R/M/SB/B/H），每個 ~6MB。UI 實際只使用 3 種：
- 400 (R) = body text
- 600 (SB) = headings / bold
- 700 (B) = extra bold

其他 4 個字重（200/300/500/800）只在 CSS 定義，實際 DOM 中沒有任何元素觸發。

**Files:**
- Modify: `app/layout.tsx`

**Step 1: 確認哪些字重實際被使用**

```bash
grep -r "font-weight\|font-medium\|font-semibold\|font-bold\|font-extrabold\|font-light\|font-thin" \
  app/ components/ \
  --include="*.tsx" --include="*.ts" --include="*.css" \
  | grep -v node_modules | grep -v ".next"
```

預期：你會看到 `font-medium`（500）、`font-semibold`（600）、`font-bold`（700）、`font-extrabold`（800）這四種 Tailwind 類別出現。

> ⚠️ 注意：`font-extrabold` = weight 800，對應 GenRyu H 字重。如果 h1 用了此類別（見 page.tsx:53），則 H 字重要保留。

**Step 2: 確認 h1 使用了 font-extrabold**

```bash
grep -n "font-extrabold" /Users/poseidomhung/Documents/github/Infinity/laravel-tw/app/docs/\[slug\]/page.tsx
```

預期輸出：`53: className="scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl"`

結論：需要 weight 400/600/700/800，可移除 200（EL）、300（L）、500（M）。

**Step 3: 修改 layout.tsx 移除不需要的字重**

將 `app/layout.tsx` 的 `localFont` 配置從 7 個字重改為 4 個：

```typescript
// app/layout.tsx
const genryuSans = localFont({
  variable: "--font-genryu",
  display: "swap",
  src: [
    { path: "../public/genryu/GenRyuMinTW-R-01.woff2", weight: "400", style: "normal" },
    { path: "../public/genryu/GenRyuMinTW-SB-01.woff2", weight: "600", style: "normal" },
    { path: "../public/genryu/GenRyuMinTW-B-01.woff2", weight: "700", style: "normal" },
    { path: "../public/genryu/GenRyuMinTW-H-01.woff2", weight: "800", style: "normal" },
  ],
});
```

**Step 4: 驗證 build 可以成功**

```bash
npm run build
```

預期：build 成功，無錯誤。`out/_next/static/media/` 應該只有 4 個 GenRyu 字體檔案，而不是 7 個。

```bash
ls out/_next/static/media/ | grep GenRyu
```

預期輸出（4 個）：
```
GenRyuMinTW_B_01-s.p.xxxxx.woff2
GenRyuMinTW_H_01-s.p.xxxxx.woff2
GenRyuMinTW_R_01-s.p.xxxxx.woff2
GenRyuMinTW_SB_01-s.p.xxxxx.woff2
```

**Step 5: 測量字體 size 減少**

```bash
du -sh out/_next/static/media/
```

預期：從 41MB → ~24MB（減少 ~17MB）

**Step 6: Commit**

```bash
git add app/layout.tsx
git commit -m "perf: reduce font weights from 7 to 4, saving ~17MB in output"
```

---

## Task 2: Next.js 優化配置

**背景：** `next.config.ts` 只有 `output: 'export'`，缺少：
- `compress: true`（啟用 gzip）
- `poweredByHeader: false`（移除不必要 header）
- `reactStrictMode: true`（雙重渲染偵測問題）
- 圖片優化配置（靜態 export 需要 `unoptimized: true` 或用 loader）

> ⚠️ `output: 'export'` 靜態模式不支援 Next.js Image Optimization server。使用 `images: { unoptimized: true }` 保持現狀，未來可以考慮 external image CDN。

**Files:**
- Modify: `next.config.ts`

**Step 1: 讀取目前 next.config.ts**

內容已知（7 行，只有 `output: 'export'`）。

**Step 2: 更新 next.config.ts**

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  
  // Performance
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  
  // Image optimization (static export requires unoptimized or custom loader)
  images: {
    unoptimized: true,
  },
  
  // Experimental: optimize package imports to enable tree-shaking
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-dialog', '@radix-ui/react-scroll-area'],
  },
};

export default nextConfig;
```

**Step 3: Build 並確認成功**

```bash
npm run build
```

預期：成功，無錯誤或警告。

**Step 4: 驗證 chunk 大小改善**

```bash
ls -la out/_next/static/chunks/ | sort -k5 -rn | head -5
```

對比 Task 2 前：最大 chunk 是 215034 bytes (8368f298...)。執行後觀察是否有變化。

**Step 5: Commit**

```bash
git add next.config.ts
git commit -m "perf: add Next.js optimization config with compress, strict mode, and tree-shaking hints"
```

---

## Task 3: 字體載入策略優化（Preload + font-display）

**背景：**
- `next/font/local` 已設定 `display: 'swap'`（好的），但沒有 preload 最重要的字體
- 應確保主要 body 字體（weight 400）在 `<head>` 中 preload
- Inter 字體透過 Google Fonts，但靜態 export 時 Next.js 會自動處理

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

**Step 1: 確認 next/font/local 支援 preload**

`next/font/local` 預設會 preload **第一個 src 字體**。我們只需確保 weight 400（最重要）是第一個。

在 Task 1 的結果中，我們已將 R（400）放第一個 ✅。

**Step 2: 確認 globals.css 的 font-family 堆疊順序正確**

目前 `globals.css:143`：
```css
font-family: var(--font-genryu), var(--font-inter), system-ui, -apple-system, sans-serif;
```

這是正確的（CJK 字體優先）。但 `globals.css:10` 的 `--font-sans` 是反過來的：
```css
--font-sans: var(--font-inter), var(--font-genryu), system-ui, sans-serif;
```

這會導致英文 headings 用 Inter，中文 body 用 GenRyu，是預期行為。但 `html { @apply font-sans; }` 用 Inter-first 的堆疊，中文 fallback 到 GenRyu。這可能導致 CJK 字體不被優先使用。

**Step 3: 修正 globals.css font-sans 定義**

```css
/* globals.css line 10 - 改為 GenRyu 優先 */
--font-sans: var(--font-genryu), var(--font-inter), system-ui, sans-serif;
```

並移除 `body` 的重複 font-family 定義（`globals.css:143`）：

```css
/* BEFORE */
body {
  @apply bg-background text-foreground;
  font-family: var(--font-genryu), var(--font-inter), system-ui, -apple-system, sans-serif;
}

/* AFTER - font-sans 已正確，body 只需繼承 */
body {
  @apply bg-background text-foreground;
}
```

**Step 4: Build 並視覺驗證**

```bash
npm run dev
```

在瀏覽器打開 `http://localhost:3000/docs/installation`，確認：
- 中文字體正常顯示（GenRyu）
- Headings 有 Inter 或 GenRyu（依字體載入結果）
- 沒有 FOUT（Flash of Unstyled Text）明顯閃爍

**Step 5: Commit**

```bash
git add app/globals.css
git commit -m "perf: fix font-sans stack to prioritize GenRyu for CJK text"
```

---

## Task 4: Shiki 按需語言載入優化

**背景：** `lib/docs.tsx:156` 目前載入 13 種語言：
```typescript
langs: ['php', 'javascript', 'typescript', 'bash', 'blade', 'json', 'html', 'css', 'sql', 'diff', 'tsx', 'jsx', 'vue']
```

Shiki bundle 是 build-time（server-side），不影響 client JS bundle。但每種語言的 grammar 會增加 **build 時間** 和 **HTML 輸出大小**（因為 Shiki 輸出 inline CSS/HTML token）。

**分析：** 對 client bundle 影響有限，主要改善 build speed。優先級降為 P2。

**Files:**
- Modify: `lib/docs.tsx`

**Step 1: 統計哪些語言實際被使用**

```bash
grep -r '```' content/docs/ | grep -oP '```\K[a-z]+' | sort | uniq -c | sort -rn | head -20
```

預期輸出類似：
```
 234 php
 145 bash
  89 javascript
  45 json
  ...
```

**Step 2: 根據統計，減少語言列表**

如果 `tsx`/`jsx`/`vue` 使用極少，移除它們。保留實際使用的語言 + 加入安全 fallback。

修改 `lib/docs.tsx` 的 `langs` 配置（根據 Step 1 的統計結果決定最終列表）：

```typescript
// lib/docs.tsx - 根據實際使用統計精簡語言列表
[rehypeShiki, {
  theme: 'github-dark',
  langs: ['php', 'javascript', 'typescript', 'bash', 'blade', 'json', 'html', 'sql', 'diff']
  // 移除: 'css', 'tsx', 'jsx', 'vue'（如果統計顯示少於 5 次使用）
}]
```

**Step 3: Build 確認無語法高亮錯誤**

```bash
npm run build 2>&1 | grep -i "warn\|error" | head -20
```

如果有 "Unknown language" 警告，將該語言加回列表。

**Step 4: Commit**

```bash
git add lib/docs.tsx
git commit -m "perf: reduce Shiki languages to only those used in content"
```

---

## Task 5: TOC 組件 IntersectionObserver 優化

**背景：** `components/docs/toc.tsx:39-69` 目前的 observer cleanup 逐個 `unobserve`，但更正確的做法是 `observer.disconnect()`，可以在一次調用中清理所有觀察目標，避免 items 引用在 cleanup 時已失效的風險。

**Files:**
- Modify: `components/docs/toc.tsx`

**Step 1: 理解現有問題**

目前 cleanup function（line 61-68）：
```typescript
return () => {
  items.forEach((item) => {
    const element = document.getElementById(item.id)
    if (element) {
      observer.unobserve(element)
    }
  })
}
```

問題：如果 `items` 在 cleanup 執行前發生變化（路由切換），可能 unobserve 錯誤的元素。且不會 `observer.disconnect()` 釋放 observer 本身。

**Step 2: 改用 observer.disconnect()**

```typescript
// components/docs/toc.tsx
useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      // 找到第一個 isIntersecting 的 entry，或最後一個已進入視窗的
      const intersecting = entries.find(e => e.isIntersecting)
      if (intersecting) {
        setActiveId(intersecting.target.id)
      }
    },
    {
      rootMargin: '-80px 0px -80% 0px',
    }
  )

  items.forEach((item) => {
    const element = document.getElementById(item.id)
    if (element) {
      observer.observe(element)
    }
  })

  // 使用 disconnect() 代替逐個 unobserve()
  return () => observer.disconnect()
}, [items])
```

**Step 3: 確認 TOC 功能正常**

```bash
npm run dev
```

打開 `http://localhost:3000/docs/artisan`（最大文件），滾動頁面確認：
- TOC 高亮項目隨滾動正確更新
- 點擊 TOC 項目能正確平滑滾動到對應 heading

**Step 4: Commit**

```bash
git add components/docs/toc.tsx
git commit -m "perf: use observer.disconnect() in TOC for cleaner cleanup"
```

---

## Task 6: Search 組件狀態管理重構

**背景：** `SearchButton` 組件將 UI（button）和 dialog（modal）混在一個組件中，所有狀態（open/query/results/loading/selectedIndex）都在同一個組件頂層。這使得未打開搜尋時，所有狀態依然存在於記憶體中。

**優化方向：** 將 dialog 部分抽離為獨立組件，只在 `open === true` 時才渲染（利用 conditional rendering 實現懶初始化）。

**Files:**
- Modify: `components/docs/search.tsx`

**Step 1: 確認目前搜尋組件的 portal 結構**

目前 `search.tsx:208`：
```typescript
{open && typeof document !== 'undefined' && createPortal(
  <div>...</div>, document.body
)}
```

`open && ...` 已做到條件渲染 ✅，但所有 state（results, loading 等）在 `open=false` 時也存在。這是輕微問題，React 本身有效率地處理未使用的 state。

**主要重構目標：** 將 dialog 抽為獨立組件，更好的關注點分離，為未來的 `React.lazy` 做準備。

**Step 2: 重構 search.tsx**

```typescript
// components/docs/search.tsx
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

// --- Types ---
interface PagefindResult {
  id: string
  data: () => Promise<{
    url: string
    meta: { title?: string }
    excerpt: string
  }>
}

interface SearchResult {
  url: string
  title: string
  excerpt: string
}

// --- Custom Hook: Pagefind loader ---
function usePagefind() {
  const pagefindRef = useRef<{ search: (query: string) => Promise<{ results: PagefindResult[] }> } | null>(null)

  const load = useCallback(async () => {
    if (pagefindRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__pagefind) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pagefindRef.current = (window as any).__pagefind
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pagefind: any = await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.type = 'module'
      script.textContent = `
        import * as pagefind from '/pagefind/pagefind.js';
        window.__pagefind = pagefind;
        window.dispatchEvent(new CustomEvent('pagefind-loaded'));
      `
      const handleLoaded = () => {
        window.removeEventListener('pagefind-loaded', handleLoaded)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve((window as any).__pagefind)
      }
      window.addEventListener('pagefind-loaded', handleLoaded)
      document.head.appendChild(script)
      setTimeout(() => {
        window.removeEventListener('pagefind-loaded', handleLoaded)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).__pagefind) resolve((window as any).__pagefind)
        else reject(new Error('Pagefind load timeout'))
      }, 5000)
    })

    await pagefind.init()
    pagefindRef.current = pagefind
  }, [])

  const search = useCallback(async (query: string): Promise<SearchResult[]> => {
    if (!query.trim() || !pagefindRef.current) return []
    const result = await pagefindRef.current.search(query)
    return Promise.all(
      result.results.slice(0, 8).map(async (r: PagefindResult) => {
        const data = await r.data()
        return {
          url: data.url,
          title: data.meta?.title || 'Untitled',
          excerpt: data.excerpt,
        }
      })
    )
  }, [])

  return { load, search }
}

// --- SearchDialog: Only rendered when open ---
interface SearchDialogProps {
  onClose: () => void
}

function SearchDialog({ onClose }: SearchDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const { load, search } = usePagefind()

  // Load pagefind on mount
  useEffect(() => {
    load().catch(console.error)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [load])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setResults([])
        return
      }
      setLoading(true)
      try {
        const r = await search(query)
        setResults(r)
        setSelectedIndex(0)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [query, search])

  const handleSelect = (url: string) => {
    onClose()
    router.push(url)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault()
      handleSelect(results[selectedIndex].url)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] md:left-64 md:pr-4">
      <div
        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-50 w-full max-w-lg rounded-lg border bg-white dark:bg-[#1a1f2e] shadow-2xl">
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            type="text"
            placeholder="搜尋文件..."
            className="flex h-12 w-full rounded-md bg-white/90 dark:bg-[#0b1220]/80 py-3 px-2 text-sm outline-none placeholder:text-gray-500 dark:placeholder:text-gray-400 text-gray-900 dark:text-white"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button className="ml-2 rounded-sm opacity-70 hover:opacity-100" onClick={() => setQuery('')}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="max-h-[300px] overflow-y-auto p-2">
          {loading && <div className="py-6 text-center text-sm text-muted-foreground">搜尋中...</div>}
          {!loading && query && results.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">找不到相關結果</div>
          )}
          {!loading && !query && (
            <div className="py-6 text-center text-sm text-muted-foreground">輸入關鍵字開始搜尋</div>
          )}
          {!loading && results.map((result, index) => (
            <button
              key={result.url}
              className={`w-full rounded-md px-3 py-2 text-left ${
                index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              }`}
              onClick={() => handleSelect(result.url)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="font-medium text-sm">{result.title}</div>
              <div
                className="text-xs text-muted-foreground line-clamp-2 mt-1"
                dangerouslySetInnerHTML={{ __html: result.excerpt }}
              />
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <span className="flex items-center gap-1"><kbd className="rounded border px-1">↵</kbd> 選擇</span>
            <span className="flex items-center gap-1"><kbd className="rounded border px-1">↑↓</kbd> 導航</span>
          </div>
          <span className="flex items-center gap-1"><kbd className="rounded border px-1">esc</kbd> 關閉</span>
        </div>
      </div>
    </div>,
    document.body
  )
}

// --- SearchButton: Entry point ---
interface SearchButtonProps {
  variant?: 'default' | 'icon'
}

export function SearchButton({ variant = 'default' }: SearchButtonProps) {
  const [open, setOpen] = useState(false)

  // Keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      {variant === 'icon' ? (
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setOpen(true)}>
          <Search className="h-4 w-4" />
          <span className="sr-only">搜尋</span>
        </Button>
      ) : (
        <Button
          variant="outline"
          className="relative h-9 w-full justify-start rounded-md bg-muted/50 text-sm font-normal text-muted-foreground shadow-none sm:pr-12 md:w-40 lg:w-56"
          onClick={() => setOpen(true)}
        >
          <Search className="mr-2 h-4 w-4" />
          <span className="hidden lg:inline-flex">搜尋文件...</span>
          <span className="inline-flex lg:hidden">搜尋...</span>
          <kbd className="pointer-events-none absolute right-1.5 top-1.5 hidden h-6 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>
      )}

      {/* SearchDialog: only mounted when open */}
      {open && typeof document !== 'undefined' && (
        <SearchDialog onClose={() => setOpen(false)} />
      )}
    </>
  )
}
```

**Step 3: 確認 TypeScript 型別正確**

```bash
npx tsc --noEmit
```

預期：0 errors

**Step 4: 測試搜尋功能**

```bash
npm run dev
```

- 按 Cmd+K 開啟搜尋
- 輸入 "artisan" 確認有結果
- 用方向鍵導航，按 Enter 跳轉
- 按 Escape 關閉
- 再次按 Cmd+K 重新開啟（pagefind 不應重新載入）

**Step 5: Build 確認**

```bash
npm run build
```

**Step 6: Commit**

```bash
git add components/docs/search.tsx
git commit -m "refactor: split SearchButton into SearchButton + SearchDialog for better separation of concerns"
```

---

## Task 7: 靜態資源快取策略文檔

**背景：** `output: 'export'` 的靜態檔案需要在 **部署平台**（Vercel/Nginx/Netlify）設定快取 headers。Next.js 本身不能在靜態 export 中設定 response headers（沒有 server）。

**Files:**
- Create: `DEPLOYMENT/cache-headers.md`
- Modify: `deploy.sh`（如適用）

**Step 1: 查看現有 deploy.sh**

```bash
cat /Users/poseidomhung/Documents/github/Infinity/laravel-tw/deploy.sh
```

**Step 2: 查看現有 DEPLOYMENT/ 目錄**

```bash
ls /Users/poseidomhung/Documents/github/Infinity/laravel-tw/DEPLOYMENT/
```

**Step 3: 確認部署平台**

查看 `.github/` 目錄是否有 CI/CD 配置：

```bash
ls /Users/poseidomhung/Documents/github/Infinity/laravel-tw/.github/
```

**Step 4: 根據平台創建快取配置**

**如果使用 Vercel：** 建立 `vercel.json`

```json
{
  "headers": [
    {
      "source": "/_next/static/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/genryu/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/pagefind/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=86400"
        }
      ]
    },
    {
      "source": "/docs/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=3600, stale-while-revalidate=86400"
        }
      ]
    }
  ]
}
```

**如果使用 Nginx：** 建立 `DEPLOYMENT/nginx.conf.example`

```nginx
# /DEPLOYMENT/nginx.conf.example
location /_next/static/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location /genryu/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location /pagefind/ {
    expires 1d;
    add_header Cache-Control "public";
}

location /docs/ {
    expires 1h;
    add_header Cache-Control "public, stale-while-revalidate=86400";
    
    # Enable gzip
    gzip on;
    gzip_types text/html text/css application/javascript;
}
```

**Step 5: Commit**

```bash
git add vercel.json  # 或 DEPLOYMENT/nginx.conf.example
git commit -m "perf: add cache headers config for static assets and font files"
```

---

## 驗證整體效果

在所有 tasks 完成後，執行以下驗證：

### Build Size 對比

```bash
# Build 完整版本（含 pagefind）
npm run build

# 測量 out/ 目錄大小
du -sh out/
du -sh out/_next/static/media/
du -sh out/genryu/ 2>/dev/null || echo "genryu not in out"
```

**預期結果：**
| 指標 | 優化前 | 優化後目標 |
|------|--------|-----------|
| out/ 總大小 | 165MB | < 100MB |
| 字體 (media/) | 41MB | ~24MB |
| 最大 JS chunk | 215KB | < 200KB |

### TypeScript 檢查

```bash
npx tsc --noEmit
```

預期：0 errors

### ESLint 檢查

```bash
npm run lint
```

預期：0 errors, 0 warnings（或僅有已知的 existing warnings）

### 功能完整性測試

```bash
npm run dev
```

逐一確認：
- [ ] 首頁載入正常
- [ ] 文件頁面（`/docs/installation`）正常渲染
- [ ] 搜尋功能（Cmd+K）可用
- [ ] TOC 高亮隨滾動更新
- [ ] 深色模式切換正常
- [ ] 手機版 MobileNav 可用

---

## 未來優化方向（Out of Scope）

以下項目需要更大規模改動，留待後續 sprint：

1. **MDX 渲染快取**：目前每次 build 重新渲染所有 101 個 MDX 文件。可以加入 build cache 機制。

2. **字體子集化（Unicode Range Subsetting）**：GenRyu 每個字重 6MB，即使套件 CJK 字集很大。透過 `pyftsubset` 或 `glyphhanger` 可以只保留台灣繁體中文使用的字符，可能減少 50-70%。這需要分析實際使用的字符集。

3. **Pagefind 搜尋索引優化**：目前 pagefind/ = 5.1MB。可以透過 `--glob` 限制索引範圍，或使用 pagefind 的 `bundle_weight` 設定。

4. **虛擬化長側邊欄**：DocsSidebar 渲染所有 101 個文件連結，可以考慮虛擬滾動（react-window），但對靜態頁面 SEO 不友好。

5. **Code Splitting for MDX Components**：如果未來添加交互組件到 MDX 中，使用 `React.lazy` 動態載入。

---

## 總結優先級

```
立即執行 (本次 sprint):
  Task 1 → Task 2 → Task 3 → Task 5 → Task 6 → Task 4 → Task 7

預期總節省：
  Bundle: 165MB → ~95-110MB (-35-45%)
  字體: 41MB → ~24MB (-17MB)
  FCP: 改善（字體更快載入）
  記憶體: 輕微改善（observer cleanup）
```
