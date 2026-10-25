# 每日飲食控管

BMI 與體脂率評估、依國健署標準建議每日熱量與六大類份數，並逐餐記錄飲食熱量。

- 網站：https://jenz-tseng.github.io/daily-diet/
- 飲食紀錄存在使用者自己的瀏覽器（localStorage），不會上傳。
- 拍照估算熱量經由 `worker/` 裡的 Cloudflare Worker 呼叫 OpenAI，需要輸入使用密碼。
  OpenAI 金鑰與使用密碼存在 Cloudflare 的 Secrets（`OPENAI_API_KEY`、`ACCESS_PASSWORD`），不在這個儲存庫裡。
- 數值為估計，僅供自我管理參考。
