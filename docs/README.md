# 架构与运行

浏览器界面 → Next.js 服务端接口 → Supabase Auth、PostgreSQL 与私有 Storage。AI 请求由服务端转发，密钥不交给客户端。

- src/components：界面与交互
- src/lib/server：鉴权与业务接口
- supabase/migrations：结构与权限迁移，无生产数据导出
- tests：合成数据与自动化测试
- docs/images：作者确认的四个主页面截图

运行需要 Node.js 22 或更新版本，执行 npm ci、npm run setup:local，填写自己的 .env.local 后 npm run dev。请使用独立 Supabase 项目，迁移前核对现有结构。AI、地图和邮件功能需要各自服务配置；没有这些配置不能宣称完整可用。执行 npm run check 检查类型、测试与构建。

历史生产验收记录和部署内部信息不在公开仓库中。截图代表已确认 UI，不保证所有外部服务始终在线。
