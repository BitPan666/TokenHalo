# TokenHalo 卡片玻璃纹理实施计划

**目标：** 为两种展开卡片增加固定、浅蓝、低对比度的斜向玻璃纹理和边缘高光。

**影响文件：**

- `src/styles.css`：实现共享纹理与高光。
- `src/components/CardChrome.test.tsx`：锁定两种卡片共享纹理的视觉契约。

## 实施步骤

- [x] 先增加共享斜向纹理测试，并确认测试因纹理尚不存在而失败。
- [x] 在 `.expanded-card-surface` 背景中加入浅蓝 `135deg` 重复线性渐变。
- [x] 优化 `.expanded-card-surface::before` 的蓝白边缘高光。
- [x] 运行聚焦测试并确认通过。
- [x] 在浏览器预览剩余额度和本机统计卡片。
- [x] 运行完整测试、生产构建和差异检查。
