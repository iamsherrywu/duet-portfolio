# 架构与运行

浏览器界面 → Next.js 服务端接口 → Supabase Auth、PostgreSQL 与私有 Storage。AI 请求由服务端转发，密钥不交给客户端。

- src/components：界面与交互
- src/lib/server：鉴权与业务接口
- supabase/migrations：结构与权限迁移，无生产数据导出
- tests：合成数据与自动化测试
- docs/images：作者确认的四个主页面截图

运行需要 Node.js 22 或更新版本，执行 npm ci、npm run setup:local，填写自己的 .env.local 后 npm run dev。请使用独立 Supabase 项目，迁移前核对现有结构。AI、地图和邮件功能需要各自服务配置；没有这些配置不能宣称完整可用。执行 npm run check 检查类型、测试与构建。

历史生产验收记录和部署内部信息不在公开仓库中。截图代表已确认 UI，不保证所有外部服务始终在线。

## 为什么保留这些文件

| 文件 | 用途 | 是否为运行必需 |
| --- | --- | --- |
| src、public | 应用逻辑和界面资源 | 是，不能随意删除 |
| package.json、package-lock.json、Next.js/TypeScript 配置 | 安装与可重复构建 | 是 |
| supabase/migrations | 数据库结构、权限与接口 | 后端初始化需要 |
| tests | 展示并验证权限隔离和业务规则 | 非运行必需，保留作为工程证据 |
| docs/images、README | 产品展示 | 非运行必需，简历展示需要 |
| scripts | 配置辅助与云端只读检查 | 开发辅助 |
| netlify、netlify.toml、vercel.json | 对应托管平台配置与定时任务 | 按部署平台选用 |

没有为减少文件数量而合并业务模块或删除测试。根目录保持构建工具预期位置，详细解释放在本页，项目首页优先呈现产品。
