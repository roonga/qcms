import { createContext } from "react"

export interface FormStateCtx {
	setValue: (key: string, value: string | string[]) => void
}

export const FormStateContext = createContext<FormStateCtx | null>(null)
