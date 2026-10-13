import * as Icons from '@lobehub/icons';

interface AILogoProps {
    name: string;               // 图标名称（区分大小写！如 OpenAI、DeepSeek）
    style?: 'Color' | 'Text' | 'Outlined' | 'Glyph';
    size?: number;
}

const AILogo = ({ name, style = 'Color', size = 24 }: AILogoProps) => {
    const Icon = name ? Icons[name as keyof typeof Icons] : undefined;
    if (!Icon) {
        if (name && name !== 'custom') {
            console.warn(`AILogo: 未匹配到图标，使用占位: ${name}`);
        }
        return <span style={{ fontSize: size }}>🚫</span>;
    }

    // @lobehub/icons 的类型把图标声明成常量对象而非组件，这里按组件用
    const IconComp = Icon as unknown as React.ComponentType<{ size?: number }>;
    const Variant = IconComp[style as keyof typeof IconComp] as React.ComponentType<{ size?: number }> | undefined;
    if (!Variant) {
        return <IconComp size={size} />;
    }

    return <Variant size={size} />;
};

export default AILogo;