import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:pointer-events-none disabled:opacity-50", { variants: { variant: { default: "bg-[#503629] text-white hover:bg-[#694a39]", outline: "border border-stone-200 bg-white hover:bg-stone-100", ghost: "hover:bg-stone-100" }, size: { default: "h-10 px-4 py-2", sm: "h-8 px-3" } }, defaultVariants: { variant: "default", size: "default" } });
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({className,variant,size,...props},ref)=><button ref={ref} className={cn(buttonVariants({variant,size,className}))} {...props}/>);
Button.displayName="Button";
