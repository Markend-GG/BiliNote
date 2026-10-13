// react-syntax-highlighter 没有自带类型声明，这里补一个最小声明让 tsc 门禁能过
declare module 'react-syntax-highlighter' {
  import type { ComponentType } from 'react'
  export const Prism: ComponentType<any>
  export const Light: ComponentType<any>
  export default ComponentType
}
declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  const styles: Record<string, any>
  export const atomDark: Record<string, any>
  export default styles
}
