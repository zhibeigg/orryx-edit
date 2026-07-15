import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, CornerDownLeft, Search } from "lucide-react"
import { filterEnumOptions, nextEnumActiveIndex } from "./enum-input"

interface EnumComboboxProps {
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  label: string
  placeholder?: string
}

interface PopupPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

interface EnumOptionsListProps {
  id: string
  label: string
  options: readonly string[]
  value: string
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onSelect: (value: string) => void
  empty: boolean
}

export function EnumOptionsList({ id, label, options, value, activeIndex, onActiveIndexChange, onSelect, empty }: EnumOptionsListProps) {
  return (
    <div id={id} className="scratch-enum-list" role="listbox" aria-label={`${label}选项`}>
      {options.map((option, index) => (
        <button
          id={`${id}-${index}`}
          key={option}
          type="button"
          role="option"
          aria-selected={option === value}
          data-active={index === activeIndex}
          onMouseEnter={() => onActiveIndexChange(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(option)}
        >
          <span>{option}</span>
          {option === value && <Check aria-hidden />}
        </button>
      ))}
      {empty && <div className="scratch-enum-empty">没有匹配项，输入名称可作为自定义值。</div>}
    </div>
  )
}

export function EnumCombobox({ value, options, onChange, label, placeholder = "选择或搜索…" }: EnumComboboxProps) {
  const listboxId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<PopupPosition | null>(null)
  const filtered = useMemo(() => filterEnumOptions(options, query), [options, query])
  const exactOption = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return undefined
    return options.find((option) => option.toLocaleLowerCase() === normalized)
  }, [options, query])
  const customQuery = query.trim() && !exactOption ? query.trim() : ""
  const customValue = Boolean(value) && !options.includes(value)

  const updatePosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportGap = 8
    const preferredHeight = Math.min(360, Math.max(220, window.innerHeight - viewportGap * 2))
    const roomBelow = window.innerHeight - rect.bottom - viewportGap
    const roomAbove = rect.top - viewportGap
    const placeAbove = roomBelow < 220 && roomAbove > roomBelow
    const maxHeight = Math.max(180, Math.min(preferredHeight, placeAbove ? roomAbove : roomBelow))
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - viewportGap * 2)
    const left = Math.min(Math.max(viewportGap, rect.left), window.innerWidth - width - viewportGap)
    const top = placeAbove ? Math.max(viewportGap, rect.top - maxHeight - 4) : rect.bottom + 4
    setPosition({ top, left, width, maxHeight })
  }

  const close = (restoreFocus = false) => {
    setOpen(false)
    setQuery("")
    setActiveIndex(-1)
    setPosition(null)
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  const select = (nextValue: string) => {
    onChange(nextValue)
    close(true)
  }

  const openPopup = () => {
    setOpen(true)
    setQuery("")
    setActiveIndex(-1)
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0)
    const reposition = () => updatePosition()
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !popupRef.current?.contains(target)) close()
    }
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    document.addEventListener("pointerdown", outside)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
      document.removeEventListener("pointerdown", outside)
    }
  }, [open])

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault()
      setActiveIndex((current) => nextEnumActiveIndex(
        current,
        filtered.values.length,
        event.key as "ArrowDown" | "ArrowUp" | "Home" | "End",
      ))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const active = filtered.values[activeIndex]
      if (active) select(active)
      else if (exactOption) select(exactOption)
      else if (filtered.values.length === 1 && filtered.values[0]) select(filtered.values[0])
      else if (customQuery) select(customQuery)
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      close(true)
    }
  }

  const popup = open && position && typeof document !== "undefined" ? createPortal(
    <div
      ref={popupRef}
      className="kether-editor scratch-enum-popup"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      } as CSSProperties}
    >
      <div className="scratch-enum-search">
        <Search aria-hidden />
        <input
          ref={searchRef}
          role="searchbox"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(-1)
          }}
          onKeyDown={onSearchKeyDown}
          aria-label={`搜索${label}`}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          placeholder={`搜索 ${options.length} 个选项…`}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>Esc</kbd>
      </div>
      <EnumOptionsList
        id={listboxId}
        label={label}
        options={filtered.values}
        value={value}
        activeIndex={activeIndex}
        onActiveIndexChange={setActiveIndex}
        onSelect={select}
        empty={filtered.total === 0 && !customQuery}
      />
      {customQuery && (
        <button type="button" className="scratch-enum-custom" onClick={() => select(customQuery)}>
          <CornerDownLeft aria-hidden />
          <span>使用自定义值</span>
          <code>{customQuery}</code>
        </button>
      )}
      <footer className="scratch-enum-footer">
        <span>{filtered.total} / {options.length} 项</span>
        {filtered.truncated && <span>继续输入以缩小范围</span>}
      </footer>
    </div>,
    document.body,
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="scratch-enum-trigger"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        data-custom={customValue}
        onClick={() => open ? close() : openPopup()}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "Enter", " "].includes(event.key)) {
            event.preventDefault()
            openPopup()
          }
        }}
      >
        <span className={value ? undefined : "is-placeholder"}>{value || placeholder}</span>
        {customValue && <small>自定义</small>}
        <ChevronDown aria-hidden />
      </button>
      {popup}
    </>
  )
}
