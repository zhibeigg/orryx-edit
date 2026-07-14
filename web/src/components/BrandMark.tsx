import type { SVGProps } from "react"

export function BrandMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      viewBox="0 0 72 48"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path className="brand-mark__flame" d="M13 18 19 4l7 10 7-9 5 13-9 6H18l-5-6Z" />
      <path className="brand-mark__tail" d="m10 24-9-8v16l9-8Z" />
      <path className="brand-mark__body" d="M10 17h36l12 7-12 7H10l7-7-7-7Z" />
      <path className="brand-mark__plate" d="M22 20h22l7 4-7 4H22l4-4-4-4Z" />
      <path className="brand-mark__jaw" d="M51 24h19l-7 7H46l5-7Z" />
      <rect className="brand-mark__eye" x="42" y="20" width="4" height="4" />
      <path className="brand-mark__detail" d="M16 17v14M31 17v14M55 22v4" />
    </svg>
  )
}
