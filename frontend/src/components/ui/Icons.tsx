import type { SVGProps } from "react"

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      {...props}
    >
      {children}
    </svg>
  )
}

export function PencilIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>
}

export function TrashIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></Icon>
}

export function RotateCcwIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>
}

export function ReceiptIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z" /><path d="M9 7h6M9 11h6M9 15h4" /></Icon>
}

export function ArrowLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></Icon>
}

export function CartIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h6.9a2 2 0 0 0 2-1.6L20 7H6" /><circle cx="10" cy="20" r="1" /><circle cx="17" cy="20" r="1" /></Icon>
}

export function PowerIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /></Icon>
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>
}

export function LogOutIcon(props: IconProps) {
  return <Icon {...props}><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></Icon>
}

export function BarcodeIcon(props: IconProps) {
  return <Icon {...props}><path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14" /></Icon>
}

export function XIcon(props: IconProps) {
  return <Icon {...props}><path d="m18 6-12 12M6 6l12 12" /></Icon>
}

export function WifiIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 12.6a10 10 0 0 1 14 0" /><path d="M8.5 16a5 5 0 0 1 7 0" /><path d="M12 20h.01" /><path d="M2 9a15 15 0 0 1 20 0" /></Icon>
}

export function WifiOffIcon(props: IconProps) {
  return <Icon {...props}><path d="m2 2 20 20" /><path d="M8.5 16a5 5 0 0 1 6.7-.3" /><path d="M12 20h.01" /><path d="M5 12.6a10 10 0 0 1 4.3-2.3" /><path d="M15.7 10.3a10 10 0 0 1 3.3 2.3" /><path d="M2 9a15 15 0 0 1 3.4-2.2" /><path d="M10.6 5.2A15 15 0 0 1 22 9" /></Icon>
}

export function MinusIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 12h14" /></Icon>
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>
}
