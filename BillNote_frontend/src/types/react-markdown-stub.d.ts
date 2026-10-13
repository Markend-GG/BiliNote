// react-markdown@8 自带 .ts 源（lib/complex-types.ts）与 @types/react 19 不兼容（全局 JSX 命名空间已移除），
// skipLibCheck 管不到 .ts。tsconfig 的 paths 把 'react-markdown' 的类型解析指到本 stub，
// 运行时仍用真包（vite 走 node_modules），只是类型层面放宽为 any。
declare const ReactMarkdown: any
export default ReactMarkdown
