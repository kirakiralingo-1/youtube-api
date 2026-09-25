# Tube

InvidiousインスタンスをプロキシするYouTube代替フロントエンド。

## デプロイ（ターミナル不要）

1. GitHubで新規リポジトリを作成
2. 上記ファイル群をGitHub Webエディタで追加
3. Render.comでGitHub連携 → New Web Service
4. Language: Node / Build: `npm install` / Start: `npm start`
5. Environment Variables に `INVIDIOUS_URL` を追加（自分のInvidiousインスタンスのURL、末尾スラッシュなし）
6. Deploy   
