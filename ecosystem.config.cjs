module.exports = {
  apps: [
    {
      name: "mlx-vlm-qwen3.8-27b",
      cwd: "/opt/code/model/web",
      script: "/Users/sdhou/miniconda3/envs/model/bin/python",
      args: [
        "-m",
        "mlx_vlm",
        "server",
        "--model",
        "/opt/code/model/Qwen3.8-27B-Uncensored-MLX/8-bit",
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
        APC_MEMORY_MAX_GB: "6",
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
