import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { tokenColor, type ColorMode } from '../lib/color'
import type { TokenInfo } from '../lib/types'
import { TokenInspector } from './TokenInspector'

export interface StripToken extends TokenInfo {
  position: number
}

interface Props {
  tokens: StripToken[]
  colorMode: ColorMode
  selected?: number | null
  focus?: number | null
  /** Positions >= this get a "diverged" underline (compare mode). */
  divergeFrom?: number | null
  onTokenClick?: (position: number, rect: DOMRect) => void
  /** Rendered in a floating layer anchored to the selected token. */
  renderPinned?: (token: StripToken) => ReactNode
  onFocusHandled?: () => void
}

interface Anchor {
  position: number
  rect: DOMRect
}

function Floating({ rect, children }: { rect: DOMRect; children: ReactNode }) {
  const width = 320
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - 8,
  )
  const below = rect.bottom + 8
  const flip = below + 360 > window.innerHeight && rect.top > 380
  const style = flip ? { left, bottom: window.innerHeight - rect.top + 8 } : { left, top: below }
  return createPortal(
    <div className="fixed z-50" style={style}>
      {children}
    </div>,
    document.body,
  )
}

/** A run of coloured, hoverable token chips. */
export function TokenStrip({
  tokens,
  colorMode,
  selected = null,
  focus = null,
  divergeFrom = null,
  onTokenClick,
  renderPinned,
  onFocusHandled,
}: Props) {
  const [hover, setHover] = useState<Anchor | null>(null)
  const [pinnedRect, setPinnedRect] = useState<DOMRect | null>(null)
  const refs = useRef(new Map<number, HTMLSpanElement>())

  const click = useCallback(
    (position: number) => {
      const el = refs.current.get(position)
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPinnedRect(rect)
      setHover(null)
      onTokenClick?.(position, rect)
    },
    [onTokenClick],
  )

  // Sidebar-driven focus: scroll into view, then pin the menu on that token.
  useEffect(() => {
    if (focus === null) return
    const el = refs.current.get(focus)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const t = setTimeout(() => {
      click(focus)
      onFocusHandled?.()
    }, 250)
    return () => clearTimeout(t)
  }, [focus, click, onFocusHandled])

  // Keep a pinned menu attached while the page scrolls or resizes.
  useEffect(() => {
    if (selected === null) return
    const update = () => {
      const el = refs.current.get(selected)
      if (el) setPinnedRect(el.getBoundingClientRect())
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [selected])

  const selectedToken = selected === null ? undefined : tokens.find((t) => t.position === selected)
  const hoverToken = hover ? tokens.find((t) => t.position === hover.position) : undefined

  return (
    <>
      <div className="font-mono text-[15px] leading-[2.1] text-slate-100">
        {tokens.map((t) => (
          <span
            key={t.position}
            ref={(el) => {
              if (el) refs.current.set(t.position, el)
              else refs.current.delete(t.position)
            }}
            data-testid="token"
            data-position={t.position}
            className={clsx(
              'token',
              t.is_fork && 'shadow-[inset_0_-2px_0_rgba(251,191,36,0.95)]',
              t.forced && 'ring-1 ring-cyan-300/80',
              selected === t.position && 'ring-2 ring-violet-400',
              divergeFrom !== null && t.position === divergeFrom && 'ring-2 ring-rose-400',
              divergeFrom !== null && t.position > divergeFrom && 'opacity-90',
            )}
            style={{ background: tokenColor(colorMode, t.prob, t.entropy) }}
            onMouseEnter={(e) =>
              setHover({ position: t.position, rect: e.currentTarget.getBoundingClientRect() })
            }
            onMouseLeave={() => setHover(null)}
            onClick={(e) => {
              e.stopPropagation()
              click(t.position)
            }}
          >
            {t.token}
          </span>
        ))}
      </div>
      {hover && hoverToken && selected === null && (
        <Floating rect={hover.rect}>
          <div className="pointer-events-none">
            <TokenInspector token={hoverToken} position={hoverToken.position} />
          </div>
        </Floating>
      )}
      {selectedToken && pinnedRect && renderPinned && (
        <Floating rect={pinnedRect}>{renderPinned(selectedToken)}</Floating>
      )}
    </>
  )
}
