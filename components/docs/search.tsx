'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

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

interface SearchButtonProps {
    variant?: 'default' | 'icon'
}

// Custom hook for Pagefind search functionality
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

        // Dynamic script injection for Pagefind
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
                if ((window as any).__pagefind) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    resolve((window as any).__pagefind)
                } else {
                    reject(new Error('Pagefind load timeout'))
                }
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
        const timer = setTimeout(() => inputRef.current?.focus(), 50)
        return () => clearTimeout(timer)
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
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Dialog */}
            <div className="relative z-50 w-full max-w-lg rounded-lg border bg-white dark:bg-[#1a1f2e] shadow-2xl">
                {/* Input */}
                <div className="flex items-center border-b px-3">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="搜尋文件..."
                        className="flex h-12 w-full rounded-md bg-white/90 dark:bg-[#0b1220]/80 py-3 px-2 text-sm outline-none placeholder:text-gray-500 dark:placeholder:text-gray-400 text-gray-900 dark:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    {query && (
                        <button
                            className="ml-2 rounded-sm opacity-70 hover:opacity-100"
                            onClick={() => setQuery('')}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {/* Results */}
                <div className="max-h-[300px] overflow-y-auto p-2">
                    {loading && (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                            搜尋中...
                        </div>
                    )}

                    {!loading && query && results.length === 0 && (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                            找不到相關結果
                        </div>
                    )}

                    {!loading && !query && (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                            輸入關鍵字開始搜尋
                        </div>
                    )}

                    {!loading && results.map((result, index) => (
                        <button
                            key={result.url}
                            className={`w-full rounded-md px-3 py-2 text-left ${
                                index === selectedIndex
                                    ? 'bg-accent text-accent-foreground'
                                    : 'hover:bg-accent/50'
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

                {/* Footer */}
                <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex gap-2">
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border px-1">↵</kbd> 選擇
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="rounded border px-1">↑↓</kbd> 導航
                        </span>
                    </div>
                    <span className="flex items-center gap-1">
                        <kbd className="rounded border px-1">esc</kbd> 關閉
                    </span>
                </div>
            </div>
        </div>,
        document.body
    )
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
            if (e.key === 'Escape') {
                setOpen(false)
            }
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [])

    return (
        <>
            {variant === 'icon' ? (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => setOpen(true)}
                >
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

            {/* SearchDialog: only mounted when open for better performance */}
            {open && typeof document !== 'undefined' && (
                <SearchDialog onClose={() => setOpen(false)} />
            )}
        </>
    )
}
