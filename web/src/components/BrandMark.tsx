import type { ImgHTMLAttributes } from "react"
import orryxMarkUrl from "@/assets/orryx.png"

type BrandMarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "width" | "height">

export function BrandMark({ className, ...props }: BrandMarkProps) {
  return (
    <img
      {...props}
      className={className}
      src={orryxMarkUrl}
      width={488}
      height={248}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
  )
}
