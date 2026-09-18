module.exports = {
  apps: [
    {
      name: "mlx-vlm-qwen3.8-27b",
      // cwd 决定 --model 相对路径的基准：mlx_vlm 没有模型显示名参数，
      // /v1/models 的 id 就是 --model 原样字符串，因此这里用
      // /opt/code/model/Qwen3.8-27B-8bit（指向 ...-MLX/8-bit 的软链）的相对名，
      // 让接口和前端都显示 Qwen3.8-27B-8bit 而不是一长串路径。
      cwd: "/opt/code/model",
      script: "/Users/sdhou/miniconda3/envs/model/bin/python",
      args: [
        "-m",
        "mlx_vlm",
        "server",
        "--model",
        "Qwen3.8-27B-8bit",
        // MTP 投机解码在本机实测为净收益≈0（见 ab2/ab3 基准），仅增加 ~1.7GB
        // 常驻显存与抖动，故关闭以缓解 64GB 机器的内存压力。
        "--kv-bits",
        "8",
        "--kv-quant-scheme",
        "uniform",
        "--kv-group-size",
        "64",
        "--max-num-seqs",
        "1",
        "--log-progress-interval",
        "0",
        // 仅监听回环地址：本项目纯本地运行，避免把模型接口暴露给局域网。
        "--host",
        "127.0.0.1",
        "--port",
        "9100",
      ],
      interpreter: "none",
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      kill_timeout: 10000,
      env: {
        PYTHONUNBUFFERED: "1",
        // 前缀缓存是本机最关键的提速项：多轮对话 TTFT 从线性增长
        // （300 token 时 4.03s）压平到恒定 ~1.1s。切勿关闭。
        APC_ENABLED: "1",
        APC_DISK_ENABLED: "0",
        // 准入条件是 memory_reserve + 2*tokens*bytes_per_token <= Metal headroom。
        // 本机 headroom 实测仅 ~5.3GB，而 reserve 默认取 working_set/10
        // （≈5.18GB），等于把余量吃光：实测超过 ~1.6k token 的 prompt 一律
        // 静默拒绝入库（cached_tokens=0），15k 会话因此每轮重付全文 prefill。
        // 降到 3GB 后阈值约到 35k token，同时仍给 prefill 临时缓冲留 3GB。
        APC_MEMORY_RESERVE_GB: "3",
        // APC 常驻硬上限，兜住最坏情况。
        APC_MEMORY_MAX_GB: "3",
        // 打印 APC_TRACE store/lookup，用于确认是否真的入库。
        APC_TRACE: "1",
      },
    },
    {
      name: "quiet-local-chat",
      cwd: "/opt/code/model/web",
      script: "/opt/homebrew/bin/bun",
      args: ["run", "dev"],
      interpreter: "none",
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      kill_timeout: 10000,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
