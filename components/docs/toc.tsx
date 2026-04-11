'use client'

import { useEffect, useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'

export type TocItem = {
    id: string
    text: string
    level: number
}

type TocProps = {
    items: TocItem[]
}

const containsCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/
const containsLatin = /[A-Za-z]/

function stripEnglishParenthetical(text: string) {
    const match = text.match(/^(.*?)(\s*\(([^)]*)\))$/)

    if (!match) {
        return text
    }

    const [, before, , inside] = match

    if (containsLatin.test(inside) && !containsCJK.test(inside)) {
        const trimmed = before.trim()
        return trimmed.length > 0 ? trimmed : text
    }

    return text
}

export function TableOfContents({ items }: TocProps) {
    const [activeId, setActiveId] = useState<string>('')

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setActiveId(entry.target.id)
                    }
                })
            },
            {
                rootMargin: '-80px 0px -80% 0px',
            }
        )

        // Observe all headings
        items.forEach((item) => {
            const element = document.getElementById(item.id)
            if (element) {
                observer.observe(element)
            }
        })

        // Use disconnect() for cleaner cleanup instead of unobserve
        return () => observer.disconnect()
    }, [items])

    if (items.length === 0) {
        return null
    }

    return (
        <div className="hidden xl:block w-64 sticky top-4 h-[calc(100vh-2rem)] self-start overflow-y-auto">
            <div className="p-6">
                <h4 className="text-sm font-semibold mb-4 text-foreground">On this page</h4>
                <ScrollArea className="h-[calc(100vh-8rem)]">
                    <nav className="space-y-1">
                        {items.map((item, index) => {
                            const isActive = activeId === item.id
                            const paddingLeft = (item.level - 2) * 12 // h2 = 0, h3 = 12px, h4 = 24px
                            const uniqueKey = `${item.id}-${index}`
                            const displayText = stripEnglishParenthetical(item.text)

                            return (
                                <a
                                    key={uniqueKey}
                                    href={`#${item.id}`}
                                    className={`
                    block text-sm py-1 transition-colors
                    ${isActive
                                            ? 'text-foreground font-medium border-l-2 border-foreground -ml-px'
                                            : 'text-foreground/70 hover:text-foreground border-l-2 border-transparent -ml-px'
                                        }
                  `}
                                    style={{ paddingLeft: `${paddingLeft + 12}px` }}
                                    onClick={(e) => {
                                        e.preventDefault()
                                        const element = document.getElementById(item.id)
                                        if (element) {
                                            const top = element.getBoundingClientRect().top + window.scrollY - 80
                                            window.scrollTo({ top, behavior: 'smooth' })
                                        }
                                    }}
                                >
                                    {displayText}
                                </a>
                            )
                        })}
                    </nav>
                </ScrollArea>
            </div>
        </div>
    )
}
