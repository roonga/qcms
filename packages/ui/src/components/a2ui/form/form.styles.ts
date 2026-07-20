const gaps = { sm: "gap-2", md: "gap-4", lg: "gap-6" } as const

export const getFormStyles = (gap: keyof typeof gaps = "md") => `flex flex-col ${gaps[gap]}`
